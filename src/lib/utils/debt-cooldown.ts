import { SupabaseClient } from '@supabase/supabase-js';
import { ERROR_CODES, formatErrorWithCode } from '@/lib/constants/error-codes';
import { getCurrentUserFast } from '@/lib/utils/auth-session';

export interface CooldownCheckResult {
  allowed: boolean;
  declinedCount: number;
  remainingAttempts?: number;
  cooldownUntil?: Date;
  cooldownRemainingFormatted?: string;
  requiresConnection?: boolean;
  contactRequestStatus?: 'none' | 'pending' | 'accepted' | 'declined';
  contactRequestId?: string;
  reason?: string;
  code?: string;
  message?: string;
}

interface CooldownCacheEntry {
  result: CooldownCheckResult;
  timestamp: number;
}

const cooldownCache = new Map<string, CooldownCacheEntry>();
const COOLDOWN_CACHE_TTL = 30 * 1000; // 30 seconds

export function invalidateCooldownCache(targetUserId?: string): void {
  if (targetUserId) {
    cooldownCache.delete(targetUserId);
  } else {
    cooldownCache.clear();
  }
}

/**
 * Sends a connection request to a target user who previously declined or who needs to connect.
 */
export async function sendConnectRequestToUser(
  supabase: SupabaseClient,
  targetUserId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getCurrentUserFast(supabase);
    if (!user) throw new Error('You must be logged in to send a connection request');
    if (user.id === targetUserId) throw new Error('Cannot connect with yourself');

    const { error } = await supabase
      .from('contact_requests')
      .upsert({
        sender_id: user.id,
        receiver_id: targetUserId,
        status: 'pending',
      }, { onConflict: 'sender_id,receiver_id' });

    if (error) throw error;
    invalidateCooldownCache(targetUserId);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to send connection request' };
  }
}

/**
 * Checks whether the current user is permitted to send a new debt or lending request
 * to the specified counterparty:
 * 1. If already in contacts or has active/settled history -> Allowed directly.
 * 2. If target user previously declined a debt from caller and they are not contacts:
 *    -> BLOCKED until target user accepts a connection request.
 * 3. If no previous declines (first interaction) -> Allowed directly without needing prior connection.
 */
export async function checkDebtRequestCooldown(
  supabase: SupabaseClient,
  targetUserId: string
): Promise<CooldownCheckResult> {
  if (!targetUserId) return { allowed: true, declinedCount: 0, requiresConnection: false };

  const cached = cooldownCache.get(targetUserId);
  if (cached && Date.now() - cached.timestamp < COOLDOWN_CACHE_TTL) {
    return cached.result;
  }

  const setAndReturn = (result: CooldownCheckResult): CooldownCheckResult => {
    cooldownCache.set(targetUserId, { result, timestamp: Date.now() });
    return result;
  };

  try {
    const user = await getCurrentUserFast(supabase);
    if (!user || user.id === targetUserId) {
      return { allowed: true, declinedCount: 0, requiresConnection: false };
    }

    // 1. Try secure RPC function check_can_request_debt
    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc(
        'check_can_request_debt',
        { p_target_id: targetUserId }
      );

      if (!rpcErr && rpcRes) {
        return setAndReturn({
          allowed: rpcRes.allowed !== false,
          requiresConnection: Boolean(rpcRes.requires_connection),
          contactRequestStatus: rpcRes.contact_request_status || 'none',
          contactRequestId: rpcRes.contact_request_id,
          declinedCount: rpcRes.declined_count || 0,
          reason: rpcRes.reason,
          code: rpcRes.code,
          message: rpcRes.message,
        });
      }
    } catch (_) {
      // Fall through to client query fallback
    }

    // 2. Client query fallback
    // Step A: Check if target is already in caller's contacts
    const { data: contactRow } = await supabase
      .from('contacts')
      .select('id')
      .eq('owner_id', user.id)
      .eq('contact_id', targetUserId)
      .maybeSingle();

    if (contactRow) {
      return setAndReturn({
        allowed: true,
        declinedCount: 0,
        requiresConnection: false,
      });
    }

    // Step B: Check if they have ANY active or settled debts together
    const { data: activeOrSettled } = await supabase
      .from('debts')
      .select('id')
      .or(
        `and(lender_id.eq.${user.id},borrower_id.eq.${targetUserId}),and(borrower_id.eq.${user.id},lender_id.eq.${targetUserId})`
      )
      .in('status', ['active', 'settled'])
      .limit(1);

    if (activeOrSettled && activeOrSettled.length > 0) {
      return setAndReturn({
        allowed: true,
        declinedCount: 0,
        requiresConnection: false,
      });
    }

    // Step C: Check if target user has declined ANY debt created by caller
    const { data: declinedDebts } = await supabase
      .from('debts')
      .select('id, created_at')
      .eq('created_by', user.id)
      .or(
        `and(lender_id.eq.${user.id},borrower_id.eq.${targetUserId}),and(borrower_id.eq.${user.id},lender_id.eq.${targetUserId})`
      )
      .eq('status', 'declined')
      .order('created_at', { ascending: false });

    if (declinedDebts && declinedDebts.length > 0) {
      // Check contact_requests table
      const { data: reqRow } = await supabase
        .from('contact_requests')
        .select('id, status')
        .eq('sender_id', user.id)
        .eq('receiver_id', targetUserId)
        .maybeSingle();

      if (reqRow?.status === 'accepted') {
        return setAndReturn({
          allowed: true,
          declinedCount: declinedDebts.length,
          requiresConnection: false,
          contactRequestStatus: 'accepted',
        });
      }

      if (reqRow?.status === 'pending') {
        return setAndReturn({
          allowed: false,
          declinedCount: declinedDebts.length,
          requiresConnection: true,
          contactRequestStatus: 'pending',
          contactRequestId: reqRow.id,
          reason: 'connect_pending',
          code: 'ERR_CONNECT_REQUEST_PENDING',
          message: 'This person declined your previous request. Your connection request is currently pending their approval in Notifications.',
        });
      }

      if (reqRow?.status === 'declined') {
        return setAndReturn({
          allowed: false,
          declinedCount: declinedDebts.length,
          requiresConnection: true,
          contactRequestStatus: 'declined',
          contactRequestId: reqRow.id,
          reason: 'connect_declined',
          code: 'ERR_CONNECT_REQUEST_DECLINED',
          message: 'This person declined your transaction and declined to connect. To protect user privacy, you cannot send requests to them.',
        });
      }

      // No contact request sent yet:
      return setAndReturn({
        allowed: false,
        declinedCount: declinedDebts.length,
        requiresConnection: true,
        contactRequestStatus: 'none',
        reason: 'must_connect',
        code: 'ERR_MUST_CONNECT_FIRST',
        message: 'This person declined your previous request. To prevent spam, you must send a connection request and be accepted as a contact before sending new transaction requests.',
      });
    }

    // Step D: First interaction! (No previous declines and no existing debts)
    return setAndReturn({
      allowed: true,
      declinedCount: 0,
      requiresConnection: false,
    });
  } catch (err) {
    console.warn('Debt request permission check notice:', err);
    return { allowed: true, declinedCount: 0, requiresConnection: false };
  }
}
