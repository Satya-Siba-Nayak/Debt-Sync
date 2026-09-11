import { createClient } from '@/lib/supabase/client';
import { ERROR_CODES, formatErrorWithCode } from '@/lib/constants/error-codes';

export type RateLimitAction = 'signup' | 'magic_link' | 'password_reset';

export interface RateLimitResult {
  allowed: boolean;
  message?: string;
  code?: string;
  reason?: string;
}

export interface AccountStatusResult {
  status: 'primary' | 'secondary' | 'shadow' | 'not_found' | 'invalid';
  primary_email?: string;
  message?: string;
  code?: string;
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
function checkClientTimestamps(action: RateLimitAction): { allowed: boolean; message?: string; code?: string } {
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
        const code = ERROR_CODES.AUTH_RATE_LIMIT_SESSION_1H;
        return {
          allowed: false,
          code,
          message: formatErrorWithCode(
            'Too many accounts created from this browser session. Maximum 3 accounts per hour allowed. Please try again later.',
            code
          ),
        };
      }
      if (valid.length >= 5) {
        const code = ERROR_CODES.AUTH_RATE_LIMIT_SESSION_24H;
        return {
          allowed: false,
          code,
          message: formatErrorWithCode(
            'Daily account creation limit reached for this browser session (max 5/day). Please try again tomorrow.',
            code
          ),
        };
      }
    } else {
      // Email actions ('magic_link', 'password_reset')
      const valid = timestamps.filter((t) => now - t < 6 * 60 * 60 * 1000);
      if (valid.length >= 5) {
        const code = ERROR_CODES.AUTH_RATE_LIMIT_EMAIL_6H;
        return {
          allowed: false,
          code,
          message: formatErrorWithCode(
            'Rate limit reached: Maximum 5 security emails allowed every 6 hours. Please check your inbox or try again later.',
            code
          ),
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
 * Checks client session cache first, then validates directly against Supabase RPC.
 * Works seamlessly across static exports (Cloudflare Pages), mobile apps, and shared WiFi NATs.
 * Fails OPEN if RPC or network encounters any error to never block legitimate users.
 */
export async function checkAuthRateLimit(
  action: RateLimitAction,
  identifier?: string
): Promise<RateLimitResult> {
  // 1. Client-side instant evaluation
  const localCheck = checkClientTimestamps(action);
  if (!localCheck.allowed) {
    return {
      allowed: false,
      message: localCheck.message,
      code: localCheck.code,
    };
  }

  // 2. Direct Supabase RPC check (eliminates reliance on Next.js /api server routes)
  try {
    const clientSessionId = getClientSessionId();
    const supabase = createClient();

    const { data, error } = await supabase.rpc('check_and_record_rate_limit', {
      p_action: action,
      p_identifier: identifier ? identifier.trim().toLowerCase() : null,
      p_ip_address: 'client-direct',
      p_session_id: clientSessionId,
    });

    if (error) {
      // Fail-open for legitimate users if RPC is unconfigured or blocked
      recordClientTimestamp(action);
      return { allowed: true };
    }

    if (data && data.allowed === false) {
      const reason = data.reason || 'rate_limit';
      const code =
        reason === 'session_hourly_limit'
          ? ERROR_CODES.AUTH_RATE_LIMIT_SESSION_1H
          : reason === 'session_daily_limit'
          ? ERROR_CODES.AUTH_RATE_LIMIT_SESSION_24H
          : reason === 'email_limit'
          ? ERROR_CODES.AUTH_RATE_LIMIT_EMAIL_6H
          : reason === 'ip_daily_limit'
          ? ERROR_CODES.AUTH_RATE_LIMIT_IP_24H
          : ERROR_CODES.AUTH_RATE_LIMIT_GENERIC;

      return {
        allowed: false,
        code,
        message: formatErrorWithCode(
          data.message || 'Rate limit reached. Please wait a while before trying again.',
          code
        ),
        reason,
      };
    }

    // Record locally on pass
    recordClientTimestamp(action);
    return { allowed: true };
  } catch (err) {
    console.warn('Rate limit direct check notice (failing open):', err);
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
      const resData = data as AccountStatusResult;
      if (resData.status === 'not_found') {
        resData.code = ERROR_CODES.AUTH_ACCOUNT_NOT_FOUND;
        resData.message = formatErrorWithCode(resData.message || 'No account found with this email address.', resData.code);
      } else if (resData.status === 'secondary') {
        resData.code = ERROR_CODES.AUTH_MAGIC_LINK_USE_PRIMARY;
        resData.message = formatErrorWithCode(resData.message || 'Please use your primary email address for magic links.', resData.code);
      } else if (resData.status === 'shadow') {
        resData.code = ERROR_CODES.AUTH_SHADOW_SETUP_PENDING;
        resData.message = formatErrorWithCode(resData.message || 'Account setup pending.', resData.code);
      }
      return resData;
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
        const code = ERROR_CODES.AUTH_SHADOW_SETUP_PENDING;
        return {
          status: 'shadow',
          primary_email: primary.email,
          code,
          message: formatErrorWithCode('This email has recorded peer debts but has not completed account signup yet.', code),
        };
      }
      return { status: 'primary', primary_email: primary.email };
    }

    const { data: secondaryList } = await supabase
      .from('profiles')
      .select('email, secondary_emails')
      .contains('secondary_emails', [clean]);

    if (secondaryList && secondaryList.length > 0) {
      const code = ERROR_CODES.AUTH_MAGIC_LINK_USE_PRIMARY;
      return {
        status: 'secondary',
        primary_email: secondaryList[0].email,
        code,
        message: formatErrorWithCode('This email is registered as a secondary email for an account.', code),
      };
    }

    const code = ERROR_CODES.AUTH_ACCOUNT_NOT_FOUND;
    return {
      status: 'not_found',
      code,
      message: formatErrorWithCode('No account found with this email address.', code),
    };
  } catch (fallbackErr) {
    console.warn('Account status check fallback error:', fallbackErr);
    // If table query fails, fail open
    return { status: 'primary' };
  }
}
