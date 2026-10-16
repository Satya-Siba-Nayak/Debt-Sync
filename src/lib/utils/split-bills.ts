import { Debt, SplitBillDetails, SplitBillParticipant } from '../types/database';
import { round2 } from './interest';
import { isSameEmail } from './email-normalize';

export interface TransactionShareSnapshotPayment {
  id: string;
  amount: number;
  currency: string;
  created_at: string;
  is_verified?: boolean;
  verified_at?: string | null;
  payment_method?: string | null;
  transaction_ref?: string | null;
  note?: string | null;
}

export interface TransactionShareSnapshotLog {
  id: string;
  action: string;
  created_at: string;
  details?: Record<string, any>;
}

export interface TransactionShareMetadata {
  globalEnabled: boolean;
  globalToken?: string | null;
  enabledBy?: string | null;
  enabledByName?: string | null;
  enabledAt?: string | null;
  disabledBy?: string | null;
  disabledByName?: string | null;
  disabledAt?: string | null;
  dismissedAlertBy?: string[];
  snapshot?: {
    counterpartyNotes?: string | null;
    dueDate?: string | null;
    settledAt?: string | null;
    payments?: TransactionShareSnapshotPayment[];
    auditLog?: TransactionShareSnapshotLog[];
    updatedAt?: string;
  };
}

/**
 * Generates a cryptographically strong random URL-safe token for global sharing links.
 */
export function generateShareToken(prefix = 'gsh'): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let result = `${prefix}_`;
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const arr = new Uint8Array(18);
    window.crypto.getRandomValues(arr);
    for (let i = 0; i < arr.length; i++) {
      result += chars[arr[i] % chars.length];
    }
    return result;
  }
  for (let i = 0; i < 18; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Calculates equal division of a monetary amount across a given number of participants,
 * allocating any fractional penny / paise remainder so that the sum of all shares exactly
 * matches totalAmount with zero floating point drift.
 *
 * Example: 100 divided among 3 -> [33.34, 33.33, 33.33] (sum = 100.00)
 */
export function calculateEqualSplit(totalAmount: number, numParticipants: number): number[] {
  if (numParticipants <= 0 || totalAmount <= 0) return [];
  if (numParticipants === 1) return [round2(totalAmount)];

  const totalCents = Math.round(Number(totalAmount) * 100);
  const baseCents = Math.floor(totalCents / numParticipants);
  const remainderCents = totalCents - baseCents * numParticipants;

  const shares: number[] = [];
  for (let i = 0; i < numParticipants; i++) {
    // Distribute remaining cents 1-by-1 to the first participants
    const shareCents = baseCents + (i < remainderCents ? 1 : 0);
    shares.push(round2(shareCents / 100));
  }

  return shares;
}

/**
 * Checks whether a debt record was generated from a group expense split bill.
 */
export function isSplitDebt(debt: Debt | any): boolean {
  if (!debt) return false;
  if (debt.split_group_id || debt.split_details) return true;
  if (typeof debt.notes === 'string' && debt.notes.includes('[SPLIT:')) return true;
  return false;
}

/**
 * Generic helper to find the matching closing bracket for a structured tag like [SPLIT:...] or [SHARE:...].
 * Accounts for nested brackets and string literals inside JSON.
 */
export function findStructuredTagRange(
  text: string,
  tagPrefix: '[SPLIT:' | '[SHARE:'
): { startIdx: number; endIdx: number } | null {
  const startIdx = text.indexOf(tagPrefix);
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === '[') {
        depth++;
      } else if (ch === ']') {
        depth--;
        if (depth === 0) {
          return { startIdx, endIdx: i };
        }
      }
    }
  }
  return null;
}

/**
 * Helper to find the matching closing bracket for [SPLIT:...].
 */
export function findSplitTagRange(text: string): { startIdx: number; endIdx: number } | null {
  return findStructuredTagRange(text, '[SPLIT:');
}

/**
 * Helper to find the matching closing bracket for [SHARE:...].
 */
export function findShareTagRange(text: string): { startIdx: number; endIdx: number } | null {
  return findStructuredTagRange(text, '[SHARE:');
}

/**
 * Robustly parses SplitBillDetails from either native column (split_details)
 * or structured notes fallback tag ([SPLIT:{...}]).
 */
export function parseSplitDetails(debt: Debt | any): SplitBillDetails | null {
  if (!debt) return null;

  // 1. Direct JSON column (Postgres JSONB)
  if (debt.split_details && typeof debt.split_details === 'object' && debt.split_details.groupId) {
    return debt.split_details as SplitBillDetails;
  }

  // 2. Stringified JSON column
  if (typeof debt.split_details === 'string') {
    try {
      const parsed = JSON.parse(debt.split_details);
      if (parsed && parsed.groupId) return parsed;
    } catch (_) {}
  }

  // 3. Structured Note prefix fallback: [SPLIT:{...}]
  if (typeof debt.notes === 'string' && debt.notes.includes('[SPLIT:')) {
    try {
      const range = findSplitTagRange(debt.notes);
      if (range) {
        const jsonStr = debt.notes.slice(range.startIdx + 7, range.endIdx);
        const parsed = JSON.parse(jsonStr);
        if (parsed && (parsed.groupId || parsed.title)) {
          return parsed as SplitBillDetails;
        }
      }
    } catch (err) {
      console.warn('Failed to parse split metadata from debt notes:', err);
    }
  }

  return null;
}

/**
 * Parses TransactionShareMetadata from a debt's notes ([SHARE:{...}]) or native share_details column.
 */
export function parseShareMetadata(debt: Debt | any): TransactionShareMetadata | null {
  if (!debt) return null;

  if (debt.share_details && typeof debt.share_details === 'object') {
    return debt.share_details as TransactionShareMetadata;
  }

  const notesStr = typeof debt === 'string' ? debt : debt.notes;
  if (typeof notesStr === 'string' && notesStr.includes('[SHARE:')) {
    try {
      const range = findShareTagRange(notesStr);
      if (range) {
        const jsonStr = notesStr.slice(range.startIdx + 7, range.endIdx);
        const parsed = JSON.parse(jsonStr);
        if (parsed && typeof parsed === 'object') {
          return parsed as TransactionShareMetadata;
        }
      }
    } catch (err) {
      console.warn('Failed to parse share metadata from debt notes:', err);
    }
  }

  return null;
}

/**
 * Strips out internal [SPLIT:{...}] and [SHARE:{...}] tags from user notes for clean display in UI cards and lists.
 * Also cleans any leftover title tags or legacy corrupted JSON fragments.
 */
export function getCleanDebtNotes(notes: string | null | undefined): string {
  if (!notes) return '';
  let cleaned = notes;

  // 1. Remove all [SPLIT: ... ] and [SHARE: ... ] tags properly with bracket balance matching
  const prefixes: Array<'[SPLIT:' | '[SHARE:'> = ['[SPLIT:', '[SHARE:'];
  for (const prefix of prefixes) {
    let safety = 0;
    while (cleaned.includes(prefix) && safety < 5) {
      safety++;
      const range = findStructuredTagRange(cleaned, prefix);
      if (range) {
        const before = cleaned.slice(0, range.startIdx).trim();
        const after = cleaned.slice(range.endIdx + 1).trim();
        cleaned = [before, after].filter(Boolean).join(' ');
      } else {
        const lastBracket = cleaned.lastIndexOf(']');
        if (lastBracket !== -1 && lastBracket > cleaned.indexOf(prefix)) {
          const before = cleaned.slice(0, cleaned.indexOf(prefix)).trim();
          const after = cleaned.slice(lastBracket + 1).trim();
          cleaned = [before, after].filter(Boolean).join(' ');
        } else {
          cleaned = cleaned.slice(0, cleaned.indexOf(prefix)).trim();
        }
      }
    }
  }

  // 2. Remove administrative purge notice tags so internal system notices don't clutter personal user notes
  cleaned = cleaned.replace(/\[TRANSACTION PURGED BY ADMIN:[^\]]*\]/gi, '').trim();
  cleaned = cleaned.replace(/\[ADMIN_PURGED:[^\]]*\]/gi, '').trim();

  // 3. Remove any lingering JSON fragment artifacts from previously saved buggy notes
  cleaned = cleaned.replace(/^,?"[^"]*":(?:null|"[^"]*"|\d+|true|false)(?:,[^]]*)*\]*\]*/i, '').trim();
  cleaned = cleaned.replace(/^\]+/, '').trim();

  // 4. Strip auto-generated title fallbacks if user didn't write an explicit personal note
  cleaned = cleaned.replace(/^Group Split Bill(\s*-\s*)?/i, '').trim();
  cleaned = cleaned.replace(/^Split:\s*[^-\n]+(\s*-\s*)?/i, '').trim();

  return cleaned.trim();
}

/**
 * Returns a clean, human-readable title/label for any debt (handling split bills, custom notes, and fallback IDs).
 */
export function getDebtDisplayLabel(debt: Debt | any): string {
  if (!debt) return 'Loan';
  const split = parseSplitDetails(debt);
  const cleanNote = getCleanDebtNotes(debt.notes);

  if (split?.title) {
    return cleanNote ? `Split: ${split.title} (${cleanNote})` : `Split: ${split.title}`;
  }
  if (cleanNote) {
    return cleanNote;
  }
  return debt.id ? `Loan #${String(debt.id).slice(0, 6)}` : 'Loan';
}

/**
 * Builds the full `notes` column string while preserving [SPLIT:{...}], [SHARE:{...}], and the clean user note.
 */
export function buildDebtNotesWithMetadata(
  debtOrNotes: Debt | string | null | undefined,
  overrides: {
    userNote?: string | null;
    splitDetails?: SplitBillDetails | null;
    shareMetadata?: TransactionShareMetadata | null;
  } = {}
): string {
  const existingDebtObj =
    typeof debtOrNotes === 'object' && debtOrNotes !== null
      ? debtOrNotes
      : { notes: typeof debtOrNotes === 'string' ? debtOrNotes : '' };

  const split =
    overrides.splitDetails !== undefined
      ? overrides.splitDetails
      : parseSplitDetails(existingDebtObj);

  const share =
    overrides.shareMetadata !== undefined
      ? overrides.shareMetadata
      : parseShareMetadata(existingDebtObj);

  const cleanUserNote =
    overrides.userNote !== undefined
      ? getCleanDebtNotes(overrides.userNote || '')
      : getCleanDebtNotes(existingDebtObj.notes);

  const parts: string[] = [];
  if (split) {
    parts.push(`[SPLIT:${JSON.stringify(split)}]`);
  }
  if (share) {
    parts.push(`[SHARE:${JSON.stringify(share)}]`);
  }
  if (cleanUserNote) {
    parts.push(cleanUserNote);
  }

  return parts.join(' ');
}

/**
 * Encodes SplitBillDetails as a structured note prefix tag for fallback compatibility,
 * while also preserving any existing [SHARE:{...}] metadata if present.
 */
export function buildSplitNotes(
  details: SplitBillDetails,
  userNote?: string | null,
  existingNotes?: string | null
): string {
  return buildDebtNotesWithMetadata(existingNotes || null, {
    splitDetails: details,
    userNote: userNote || '',
  });
}

/**
 * Checks whether a given user (by ID or primary/secondary email) is a participating member
 * of a debt agreement — including the Lender, the Borrower, or any participant in a Split Bill group!
 */
export function isUserParticipantInDebt(
  debt: Debt | any,
  user: { id?: string | null; email?: string | null } | null | undefined,
  userSecondaryEmails: string[] = []
): { isParticipant: boolean; role: 'lender' | 'borrower' | 'split_member' | 'none' } {
  if (!debt || !user) return { isParticipant: false, role: 'none' };

  const uid = user.id || '';
  const allUserEmails = [
    user.email,
    ...(Array.isArray(userSecondaryEmails) ? userSecondaryEmails : []),
  ]
    .filter((e): e is string => Boolean(e && e.trim()))
    .map((e) => e.trim().toLowerCase());

  // 1. Direct UID match for Lender or Borrower
  if (uid && debt.lender_id === uid) {
    return { isParticipant: true, role: 'lender' };
  }
  if (uid && debt.borrower_id === uid) {
    return { isParticipant: true, role: 'borrower' };
  }
  if (uid && debt.created_by === uid) {
    return { isParticipant: true, role: debt.lender_id === uid ? 'lender' : 'borrower' };
  }

  // 2. Email match against Lender or Borrower profile email
  const lenderEmail = debt.lender?.email || debt.lender_email || '';
  const borrowerEmail = debt.borrower?.email || debt.borrower_email || '';

  if (lenderEmail && allUserEmails.some((ue) => isSameEmail(ue, lenderEmail))) {
    return { isParticipant: true, role: 'lender' };
  }
  if (borrowerEmail && allUserEmails.some((ue) => isSameEmail(ue, borrowerEmail))) {
    return { isParticipant: true, role: 'borrower' };
  }

  // 3. Split Bill group participant match (by UID or email)
  const split = parseSplitDetails(debt);
  if (split) {
    if (uid && split.payerId === uid) {
      return { isParticipant: true, role: 'lender' };
    }
    if (Array.isArray(split.participants)) {
      for (const pt of split.participants) {
        if (uid && pt.userId === uid) {
          return { isParticipant: true, role: pt.isPayer ? 'lender' : 'split_member' };
        }
        if (pt.email && allUserEmails.some((ue) => isSameEmail(ue, pt.email!))) {
          return { isParticipant: true, role: pt.isPayer ? 'lender' : 'split_member' };
        }
      }
    }
  }

  return { isParticipant: false, role: 'none' };
}

