import { SupabaseClient } from '@supabase/supabase-js';
import { ERROR_CODES, formatErrorWithCode } from '@/lib/constants/error-codes';

export interface CooldownCheckResult {
  allowed: boolean;
  declinedCount: number;
  remainingAttempts?: number;
  cooldownUntil?: Date;
  cooldownRemainingFormatted?: string;
  reason?: string;
  code?: string;
  message?: string;
}

/**
 * Formats a millisecond duration into a clean human-readable countdown string.
 */
export function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return '0 minutes';

  const totalMinutes = Math.ceil(ms / (60 * 1000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days} days`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours} hours`;
  }
  return `${minutes} min`;
}

/**
 * Checks whether the current user is permitted to send a new debt or lending request
 * to the specified counterparty, enforcing privacy anti-harassment cooldowns:
 * - 3 consecutive declines -> 3-day cooldown
 * - 4+ consecutive declines -> 30-day (1 month) cooldown
 */
export async function checkDebtRequestCooldown(
  supabase: SupabaseClient,
  targetUserId: string
): Promise<CooldownCheckResult> {
  if (!targetUserId) return { allowed: true, declinedCount: 0 };

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { allowed: true, declinedCount: 0 };

    // 1. Try secure RPC function
    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc(
        'check_debt_request_cooldown',
        { p_target_id: targetUserId }
      );

      if (!rpcErr && rpcRes) {
        if (rpcRes.allowed === false) {
          const cooldownUntil = rpcRes.cooldown_until ? new Date(rpcRes.cooldown_until) : undefined;
          const remainingMs = cooldownUntil ? Math.max(0, cooldownUntil.getTime() - Date.now()) : 0;
          const formattedTime = formatTimeRemaining(remainingMs);
          const code = rpcRes.code || (rpcRes.reason === 'cooldown_30d' ? ERROR_CODES.DEBT_REQUEST_COOLDOWN_30D : ERROR_CODES.DEBT_REQUEST_COOLDOWN_3D);

          return {
            allowed: false,
            declinedCount: rpcRes.declined_count || 3,
            cooldownUntil,
            cooldownRemainingFormatted: formattedTime,
            reason: rpcRes.reason,
            code,
            message: formatErrorWithCode(
              rpcRes.message || `Requesting this person is paused for ${formattedTime}.`,
              code
            ),
          };
        }

        return {
          allowed: true,
          declinedCount: rpcRes.declined_count || 0,
          remainingAttempts: rpcRes.remaining_attempts,
        };
      }
    } catch (_) {
      // Fall through to client query fallback
    }

    // 2. Direct client query fallback
    const { data: debts, error: debtsErr } = await supabase
      .from('debts')
      .select('status, created_at, lender_id, borrower_id')
      .eq('created_by', user.id)
      .or(
        `and(lender_id.eq.${user.id},borrower_id.eq.${targetUserId}),and(borrower_id.eq.${user.id},lender_id.eq.${targetUserId})`
      )
      .order('created_at', { ascending: false });

    if (debtsErr || !debts) {
      return { allowed: true, declinedCount: 0 };
    }

    let declinedCount = 0;
    let lastDeclinedAt: Date | null = null;

    for (const d of debts) {
      if (d.status === 'active' || d.status === 'settled') {
        break; // An accepted agreement resets the consecutive decline streak
      }
      if (d.status === 'declined') {
        declinedCount++;
        if (!lastDeclinedAt) {
          lastDeclinedAt = new Date(d.created_at);
        }
      }
    }

    if (declinedCount >= 4 && lastDeclinedAt) {
      const cooldownEnd = new Date(lastDeclinedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      const remainingMs = cooldownEnd.getTime() - Date.now();
      if (remainingMs > 0) {
        const formatted = formatTimeRemaining(remainingMs);
        const code = ERROR_CODES.DEBT_REQUEST_COOLDOWN_30D;
        return {
          allowed: false,
          declinedCount,
          cooldownUntil: cooldownEnd,
          cooldownRemainingFormatted: formatted,
          reason: 'cooldown_30d',
          code,
          message: formatErrorWithCode(
            `This user has declined your requests multiple times. For privacy, you cannot request them again for ${formatted} (1-month cooldown).`,
            code
          ),
        };
      }
    } else if (declinedCount === 3 && lastDeclinedAt) {
      const cooldownEnd = new Date(lastDeclinedAt.getTime() + 3 * 24 * 60 * 60 * 1000);
      const remainingMs = cooldownEnd.getTime() - Date.now();
      if (remainingMs > 0) {
        const formatted = formatTimeRemaining(remainingMs);
        const code = ERROR_CODES.DEBT_REQUEST_COOLDOWN_3D;
        return {
          allowed: false,
          declinedCount,
          cooldownUntil: cooldownEnd,
          cooldownRemainingFormatted: formatted,
          reason: 'cooldown_3d',
          code,
          message: formatErrorWithCode(
            `This user declined your previous 3 requests. For privacy, you cannot request them again for ${formatted} (3-day cooldown).`,
            code
          ),
        };
      }
    }

    return {
      allowed: true,
      declinedCount,
      remainingAttempts: declinedCount < 3 ? 3 - declinedCount : 1,
    };
  } catch (err) {
    console.warn('Debt request cooldown check notice:', err);
    return { allowed: true, declinedCount: 0 };
  }
}
