import { createClient } from '@/lib/supabase/client';

export type RateLimitAction = 'signup' | 'magic_link' | 'password_reset';

export interface RateLimitResult {
  allowed: boolean;
  message?: string;
  reason?: string;
}

export interface AccountStatusResult {
  status: 'primary' | 'secondary' | 'shadow' | 'not_found' | 'invalid';
  primary_email?: string;
  message?: string;
}

/**
 * Get or initialize persistent client session UUID in localStorage
 */
export function getClientSessionId(): string {
  if (typeof window === 'undefined') return 'server_session';
  try {
    let id = localStorage.getItem('debtsync_client_session_id');
    if (!id || id.length < 8) {
      id = crypto.randomUUID();
      localStorage.setItem('debtsync_client_session_id', id);
    }
    return id;
  } catch (_) {
    return 'fallback_session';
  }
}

/**
 * Client-side fast timestamp cache check to avoid unnecessary network calls
 * on repeated button presses or automated script loops
 */
function checkClientTimestamps(action: RateLimitAction): { allowed: boolean; message?: string } {
  if (typeof window === 'undefined') return { allowed: true };

  try {
    const now = Date.now();
    const storageKey =
      action === 'signup' ? 'debtsync_local_signups' : 'debtsync_local_emails';

    const raw = localStorage.getItem(storageKey);
    const timestamps: number[] = raw ? JSON.parse(raw) : [];

    if (action === 'signup') {
      // Clean up records older than 24 hours
      const valid = timestamps.filter((t) => now - t < 24 * 60 * 60 * 1000);
      const last1h = valid.filter((t) => now - t < 60 * 60 * 1000);

      if (last1h.length >= 3) {
        return {
          allowed: false,
          message:
            'Too many accounts created from this browser session. Maximum 3 accounts per hour allowed. Please try again later.',
        };
      }
      if (valid.length >= 5) {
        return {
          allowed: false,
          message:
            'Daily account creation limit reached for this browser session (max 5/day). Please try again tomorrow.',
        };
      }
    } else {
      // Email actions ('magic_link', 'password_reset')
      const valid = timestamps.filter((t) => now - t < 6 * 60 * 60 * 1000);
      if (valid.length >= 5) {
        return {
          allowed: false,
          message:
            'Rate limit reached: Maximum 5 security emails allowed every 6 hours. Please check your inbox or try again later.',
        };
      }
    }

    return { allowed: true };
  } catch (_) {
    return { allowed: true };
  }
}

/**
 * Record successful action in client-side timestamp cache
 */
function recordClientTimestamp(action: RateLimitAction) {
  if (typeof window === 'undefined') return;
  try {
    const now = Date.now();
    const storageKey =
      action === 'signup' ? 'debtsync_local_signups' : 'debtsync_local_emails';

    const raw = localStorage.getItem(storageKey);
    const timestamps: number[] = raw ? JSON.parse(raw) : [];
    timestamps.push(now);

    // Keep array bounded
    const maxAge = action === 'signup' ? 24 * 60 * 60 * 1000 : 6 * 60 * 60 * 1000;
    const filtered = timestamps.filter((t) => now - t < maxAge);
    localStorage.setItem(storageKey, JSON.stringify(filtered));
  } catch (_) {}
}

/**
 * Full Rate Limit Verification
 * Checks client local cache first, then validates against server route /api/auth/rate-limit
 */
export async function checkAuthRateLimit(
  action: RateLimitAction,
  identifier?: string
): Promise<RateLimitResult> {
  // 1. Client-side instant evaluation
  const localCheck = checkClientTimestamps(action);
  if (!localCheck.allowed) {
    return { allowed: false, message: localCheck.message };
  }

  // 2. Server API Route evaluation (validates IP address and persistent HttpOnly cookie)
  try {
    const clientSessionId = getClientSessionId();
    const res = await fetch('/api/auth/rate-limit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        identifier: identifier ? identifier.trim().toLowerCase() : undefined,
        clientSessionId,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data?.allowed === false) {
      return {
        allowed: false,
        message:
          data?.message ||
          'Rate limit exceeded. Please wait a while before trying again.',
        reason: data?.reason,
      };
    }

    // Record locally on pass
    recordClientTimestamp(action);
    return { allowed: true };
  } catch (err) {
    console.warn('Rate limit server check warning (proceeding):', err);
    recordClientTimestamp(action);
    return { allowed: true };
  }
}

/**
 * Verify if an account exists for a given email address before triggering magic links or reset emails
 */
export async function checkAccountStatusForLogin(
  identifier: string
): Promise<AccountStatusResult> {
  const clean = identifier.trim().toLowerCase();
  if (!clean || !clean.includes('@')) {
    return { status: 'invalid', message: 'Please enter a valid email address.' };
  }

  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc('check_account_status_for_login', {
      p_identifier: clean,
    });

    if (!error && data && data.status) {
      return data as AccountStatusResult;
    }
  } catch (_) {}

  // Fallback direct check against profiles table if RPC is not yet created
  try {
    const { data: primary } = await supabase
      .from('profiles')
      .select('email, is_shadow')
      .ilike('email', clean)
      .single();

    if (primary) {
      if (primary.is_shadow) {
        return {
          status: 'shadow',
          primary_email: primary.email,
          message: 'This email has recorded peer debts but has not completed account signup yet.',
        };
      }
      return { status: 'primary', primary_email: primary.email };
    }

    const { data: secondaryList } = await supabase
      .from('profiles')
      .select('email, secondary_emails')
      .contains('secondary_emails', [clean]);

    if (secondaryList && secondaryList.length > 0) {
      return {
        status: 'secondary',
        primary_email: secondaryList[0].email,
        message: 'This email is registered as a secondary email for an account.',
      };
    }

    return {
      status: 'not_found',
      message: 'No account found with this email address.',
    };
  } catch (fallbackErr) {
    console.warn('Account status check fallback error:', fallbackErr);
    // If table query fails, fail open
    return { status: 'primary' };
  }
}
