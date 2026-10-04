import { Debt, SplitBillDetails, SplitBillParticipant } from '../types/database';
import { round2 } from './interest';

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
      const startIdx = debt.notes.indexOf('[SPLIT:');
      const endIdx = debt.notes.indexOf(']', startIdx);
      if (startIdx !== -1 && endIdx > startIdx) {
        const jsonStr = debt.notes.slice(startIdx + 7, endIdx);
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
 * Strips out the internal [SPLIT:{...}] tag from user notes for clean display in UI cards and lists.
 */
export function getCleanDebtNotes(notes: string | null | undefined): string {
  if (!notes) return '';
  if (notes.includes('[SPLIT:')) {
    const startIdx = notes.indexOf('[SPLIT:');
    const endIdx = notes.indexOf(']', startIdx);
    if (startIdx !== -1 && endIdx !== -1) {
      const prefix = notes.slice(0, startIdx).trim();
      const suffix = notes.slice(endIdx + 1).trim();
      return [prefix, suffix].filter(Boolean).join(' ');
    }
  }
  return notes;
}

/**
 * Encodes SplitBillDetails as a structured note prefix tag for fallback compatibility.
 */
export function buildSplitNotes(details: SplitBillDetails, userNote?: string | null): string {
  const jsonTag = `[SPLIT:${JSON.stringify(details)}]`;
  const cleanUserNote = userNote ? userNote.trim() : '';
  const titleInfo = details.title ? `Split: ${details.title}` : 'Group Split Bill';

  if (cleanUserNote) {
    return `${jsonTag} ${titleInfo} - ${cleanUserNote}`;
  }
  return `${jsonTag} ${titleInfo}`;
}
