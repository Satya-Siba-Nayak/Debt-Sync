/**
 * Normalizes an email address by stripping provider-specific aliases:
 * - Removes '+' subaddress tags across Gmail, Outlook, iCloud, Proton, and other providers.
 * - Removes '.' (dots) from Gmail / Googlemail addresses (since j.o.h.n@gmail.com == john@gmail.com).
 * - Converts googlemail.com to gmail.com.
 * - Trims and converts to lowercase.
 */
export function canonicalizeEmail(email: string | null | undefined): string {
  if (!email || !email.trim()) return '';

  const clean = email.trim().toLowerCase();
  const atIndex = clean.lastIndexOf('@');
  if (atIndex === -1 || atIndex === 0 || atIndex === clean.length - 1) {
    return clean;
  }

  let localPart = clean.slice(0, atIndex);
  let domainPart = clean.slice(atIndex + 1);

  // Normalize Google domain
  if (domainPart === 'googlemail.com') {
    domainPart = 'gmail.com';
  }

  // Handle Gmail dot-insensitivity and '+' subaddressing
  if (domainPart === 'gmail.com') {
    localPart = localPart.split('+')[0];
    localPart = localPart.replace(/\./g, '');
  } else if (
    domainPart === 'outlook.com' ||
    domainPart === 'hotmail.com' ||
    domainPart === 'live.com' ||
    domainPart === 'msn.com' ||
    domainPart === 'icloud.com' ||
    domainPart === 'me.com' ||
    domainPart === 'proton.me' ||
    domainPart === 'protonmail.com'
  ) {
    // Other major providers with '+' subaddressing
    localPart = localPart.split('+')[0];
  } else if (domainPart === 'yahoo.com' || domainPart === 'ymail.com') {
    // Yahoo uses '-' or '+' for aliases
    localPart = localPart.split('-')[0].split('+')[0];
  } else {
    // General RFC 5233 subaddressing: strip '+' tag
    localPart = localPart.split('+')[0];
  }

  return `${localPart}@${domainPart}`;
}

/**
 * Normalizes a phone number into a standardized numeric sequence for duplicate detection:
 * - Strips all non-digit characters (+, -, spaces, brackets).
 * - Standardizes Indian 10-digit numbers to '91' + 10 digits.
 * - Strips Indian trunk '0' prefix (09876543210 -> 919876543210).
 */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone || !phone.trim()) return '';

  const digits = phone.replace(/[^\d]/g, '');
  if (!digits) return '';

  // 10 digits (assume Indian national subscriber if no country code)
  if (digits.length === 10) {
    return `91${digits}`;
  }

  // 11 digits starting with 0 (Indian trunk prefix)
  if (digits.length === 11 && digits.startsWith('0')) {
    return `91${digits.slice(1)}`;
  }

  return digits;
}

/**
 * Checks if two email addresses are equivalent (taking Gmail dots and aliases into account).
 */
export function isSameEmail(emailA: string, emailB: string): boolean {
  return canonicalizeEmail(emailA) === canonicalizeEmail(emailB);
}

/**
 * Checks if two phone numbers refer to the same subscriber.
 */
export function isSamePhone(phoneA: string, phoneB: string): boolean {
  const normA = normalizePhone(phoneA);
  const normB = normalizePhone(phoneB);

  if (!normA || !normB) return false;
  if (normA === normB) return true;

  // Compare last 10 digits if both have at least 10 digits
  if (normA.length >= 10 && normB.length >= 10) {
    return normA.slice(-10) === normB.slice(-10);
  }

  return false;
}
