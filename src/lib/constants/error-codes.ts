/**
 * Standardized DebtSync Error Codes for Authentication & Rate Limiting.
 * Provides clear diagnostic codes across client, server, and third-party provider responses.
 */

export const ERROR_CODES = {
  // Rate Limits & Throttling
  AUTH_RATE_LIMIT_SESSION_1H: 'ERR_AUTH_RATE_LIMIT_SESSION_1H',
  AUTH_RATE_LIMIT_SESSION_24H: 'ERR_AUTH_RATE_LIMIT_SESSION_24H',
  AUTH_RATE_LIMIT_EMAIL_6H: 'ERR_AUTH_RATE_LIMIT_EMAIL_6H',
  AUTH_RATE_LIMIT_IP_24H: 'ERR_AUTH_RATE_LIMIT_IP_24H',
  AUTH_RATE_LIMIT_PROVIDER: 'ERR_AUTH_RATE_LIMIT_PROVIDER',
  AUTH_RATE_LIMIT_GENERIC: 'ERR_AUTH_RATE_LIMIT_EXCEEDED',

  // Validation & Credentials
  AUTH_PASSWORD_TOO_SHORT: 'ERR_AUTH_PASSWORD_TOO_SHORT',
  AUTH_EMAIL_EXISTS: 'ERR_AUTH_EMAIL_ALREADY_EXISTS',
  AUTH_PHONE_EXISTS: 'ERR_AUTH_PHONE_ALREADY_EXISTS',
  AUTH_EMAIL_ALIAS_EXISTS: 'ERR_AUTH_EMAIL_ALIAS_EXISTS',
  AUTH_INVALID_EMAIL: 'ERR_AUTH_INVALID_EMAIL',
  AUTH_INVALID_PHONE: 'ERR_AUTH_INVALID_PHONE',
  AUTH_INVALID_CREDENTIALS: 'ERR_AUTH_INVALID_CREDENTIALS',
  ACCOUNT_DELETION_BLOCKED: 'ERR_ACCOUNT_DELETION_BLOCKED',

  // Magic Link & Account Existence
  AUTH_MAGIC_LINK_USE_PRIMARY: 'ERR_AUTH_MAGIC_LINK_USE_PRIMARY',
  AUTH_ACCOUNT_NOT_FOUND: 'ERR_AUTH_ACCOUNT_NOT_FOUND',
  AUTH_SHADOW_SETUP_PENDING: 'ERR_AUTH_SHADOW_SETUP_PENDING',

  // Debt Requests & Anti-Harassment Cooldowns
  DEBT_REQUEST_COOLDOWN_3D: 'ERR_DEBT_REQUEST_COOLDOWN_3D',
  DEBT_REQUEST_COOLDOWN_30D: 'ERR_DEBT_REQUEST_COOLDOWN_30D',
  DEBT_REQUEST_PENDING_EXISTS: 'ERR_DEBT_REQUEST_PENDING_EXISTS',
  CONTACT_REQUEST_PENDING: 'ERR_CONTACT_REQUEST_PENDING',

  // Payments & Ledger Verification
  PAYMENT_VERIFICATION_REQUIRED: 'ERR_PAYMENT_VERIFICATION_REQUIRED',
  PAYMENT_ALREADY_VERIFIED: 'ERR_PAYMENT_ALREADY_VERIFIED',

  // Network & System
  AUTH_NETWORK_FAILURE: 'ERR_AUTH_NETWORK_FAILURE',
  AUTH_UNKNOWN: 'ERR_AUTH_UNKNOWN',
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

/**
 * Appends a standardized error code to a user message if not already present.
 */
export function formatErrorWithCode(message: string, code: string): string {
  if (!message) return `An error occurred (Code: [${code}])`;
  if (message.includes('[ERR_') || message.includes('Code:')) return message;
  return `${message.trim()} (Code: [${code}])`;
}

/**
 * Parses raw error from Supabase Auth or network response into a clean message and standardized code.
 */
export function parseAuthError(err: any): { message: string; code: string } {
  const raw = err?.message || err?.error_description || String(err || '');
  const lower = raw.toLowerCase();

  // Supabase email send rate limit or free-tier throttle
  if (
    lower.includes('rate limit') ||
    lower.includes('over_email_send_rate_limit') ||
    lower.includes('too many requests')
  ) {
    return {
      message: 'Rate limit reached from authentication provider. Please wait a few minutes before trying again.',
      code: ERROR_CODES.AUTH_RATE_LIMIT_PROVIDER,
    };
  }

  // Already registered user
  if (
    lower.includes('already registered') ||
    lower.includes('user already exists') ||
    lower.includes('email exists')
  ) {
    return {
      message: 'An account with this email address already exists. Please sign in instead.',
      code: ERROR_CODES.AUTH_EMAIL_EXISTS,
    };
  }

  // Invalid login credentials
  if (
    lower.includes('invalid login credentials') ||
    lower.includes('invalid credentials') ||
    lower.includes('wrong password')
  ) {
    return {
      message: 'Invalid email/phone or password. Please verify your credentials and try again.',
      code: ERROR_CODES.AUTH_INVALID_CREDENTIALS,
    };
  }

  // Password too short
  if (lower.includes('password') && (lower.includes('short') || lower.includes('least 6') || lower.includes('character'))) {
    return {
      message: 'Password must be at least 6 characters long.',
      code: ERROR_CODES.AUTH_PASSWORD_TOO_SHORT,
    };
  }

  // Network failure
  if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('timeout')) {
    return {
      message: 'Network connection issue. Please check your internet connection.',
      code: ERROR_CODES.AUTH_NETWORK_FAILURE,
    };
  }

  return {
    message: raw || 'Authentication request could not be completed.',
    code: ERROR_CODES.AUTH_UNKNOWN,
  };
}
