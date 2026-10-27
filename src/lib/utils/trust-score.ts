'use client';

import { Debt, Payment } from '@/lib/types/database';
import { isDebtPurgedByAdmin, round2 } from '@/lib/utils/interest';

export interface TrustFactor {
  name: string;
  impact: 'positive' | 'negative' | 'neutral';
  points: number;
  description: string;
  icon: string; // Material Symbols icon name
}

export interface TrustScorePillars {
  paymentHistory: number;     // 0 - 100%
  debtClearance: number;      // 0 - 100%
  networkBreadth: number;     // 0 - 100%
  disputeCleanliness: number; // 0 - 100%
}

export interface TrustScoreBreakdown {
  score: number;              // 300 - 850 (or -1 if unrated)
  rating: string;             // 'Exceptional' | 'Very Good' | 'Good' | 'Fair' | 'Poor' | 'No Score'
  ratingColor: string;        // Tailwind color class
  factors: TrustFactor[];     // Individual factor contributions
  tips: string[];             // Actionable improvement tips
  pillars: TrustScorePillars; // Quantitative pillars
  isCalibrated: boolean;      // Whether user has enough transactional history
  overdueActiveCount: number; // Currently delinquent active debts
}

const BASE_SCORE = 650;       // Standard neutral baseline for verified participants
const MIN_SCORE = 300;        // Minimum rating floor
const MAX_SCORE = 850;        // Maximum prime credit score
const TOMBSTONE_UUID = '00000000-0000-0000-0000-000000000001';

/**
 * Parses a date string ('YYYY-MM-DD' or ISO timestamp) into a UTC calendar day integer
 * (days since Unix epoch) to guarantee zero device timezone drift.
 */
function toUtcCalendarDayNumber(dateStr: string): number {
  const clean = dateStr.trim().split('T')[0];
  const parts = clean.split('-').map(Number);
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86400000);
  }
  const parsed = new Date(dateStr);
  return Math.floor(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()) / 86400000
  );
}

function getUnratedBreakdown(): TrustScoreBreakdown {
  return {
    score: -1,
    rating: 'No Score',
    ratingColor: 'text-[var(--outline)]',
    factors: [
      {
        name: 'No Credit History',
        impact: 'neutral',
        points: 0,
        description:
          'No confirmed loan, debt, or repayment agreements on record. Unrated (-1) until first active or settled agreement.',
        icon: 'history_toggle_off',
      },
    ],
    tips: [
      'Complete your first loan, debt, or repayment transaction to generate a calibrated network score.',
    ],
    pillars: {
      paymentHistory: 0,
      debtClearance: 0,
      networkBreadth: 0,
      disputeCleanliness: 0,
    },
    isCalibrated: false,
    overdueActiveCount: 0,
  };
}

/**
 * Enhanced Multi-Dimensional Network Score Engine (100% Parity with Server SQL RPC)
 *
 * Evaluates:
 * 1. Payment History (On-time settlements, active good standing, graduated overdue penalties)
 * 2. Debt Clearance Velocity (Borrower obligations cleared including direct settlements + lender volume)
 * 3. Network Breadth & Counterparty Diversity (Cross-peer settlements vs wash trading)
 * 4. Dispute Cleanliness & Security Standing (Disputes, outbound rejected proposals, admin verification/isolation)
 */
export function calculateTrustScore(
  debts: Debt[],
  payments: Payment[],
  userId?: string,
  extraOptions?: { isIsolated?: boolean; isVerified?: boolean }
): TrustScoreBreakdown {
  if (userId === TOMBSTONE_UUID) {
    return getUnratedBreakdown();
  }

  const factors: TrustFactor[] = [];
  const tips: string[] = [];
  const nowUtcDay = Math.floor(Date.now() / 86400000);

  // Filter out admin-purged debts and system tombstone counterparties
  const validDebts = debts.filter((d) => {
    if (!d || isDebtPurgedByAdmin(d)) return false;
    if (d.lender_id === TOMBSTONE_UUID || d.borrower_id === TOMBSTONE_UUID) return false;
    if (userId && d.lender_id !== userId && d.borrower_id !== userId) return false;
    return true;
  });

  // Only confirmed agreements ('active', 'settled', 'disputed') establish a credit file
  const confirmedDebts = validDebts.filter(
    (d) => d.status === 'active' || d.status === 'settled' || d.status === 'disputed'
  );

  // --- 0. Zero Confirmed History Check (Credit Bureau Unscored File: -1 / NH) ---
  if (confirmedDebts.length === 0) {
    return getUnratedBreakdown();
  }

  const confirmedDebtIds = new Set(confirmedDebts.map((d) => d.id));
  const relevantPayments = payments.filter((p) => p && confirmedDebtIds.has(p.debt_id));

  // --- 1. Base Starting Score ---
  factors.push({
    name: 'Starting Baseline',
    impact: 'neutral',
    points: BASE_SCORE,
    description: 'Neutral benchmark for all verified DebtSync participants',
    icon: 'shield',
  });

  const activeDebts = confirmedDebts.filter((d) => d.status === 'active');
  const settledDebts = confirmedDebts.filter((d) => d.status === 'settled');
  const disputedDebts = confirmedDebts.filter((d) => d.status === 'disputed');

  let overdueActiveCount = 0;
  let moderateOverdueCount = 0;
  let severeDelinquentCount = 0;

  let onTimeSettlements = 0;
  let lateSettlements = 0;
  let undatedSettlements = 0;

  let totalBorrowedPrincipal = 0;
  let totalBorrowerCleared = 0;
  let totalLentSettled = 0;
  let disputedPaymentsCount = 0;

  const uniqueCounterparties = new Set<string>();

  for (const d of confirmedDebts) {
    const isBorrower = userId ? d.borrower_id === userId : true;
    const isLender = userId ? d.lender_id === userId : false;
    const principal = Number(d.principal) || 0;

    if (d.status === 'active' || d.status === 'settled') {
      if (userId) {
        const peerId = d.lender_id === userId ? d.borrower_id : d.lender_id;
        if (peerId && peerId !== userId) uniqueCounterparties.add(peerId);
      } else {
        if (d.lender_id) uniqueCounterparties.add(d.lender_id);
        if (d.borrower_id) uniqueCounterparties.add(d.borrower_id);
      }
    }

    const debtPayments = relevantPayments.filter((p) => p.debt_id === d.id);
    const verifiedPaidOnDebt = debtPayments
      .filter((p) => p.is_verified && !(typeof p.note === 'string' && p.note.includes('[DISPUTED]')))
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    const disputedOnDebt = debtPayments.filter(
      (p) =>
        (!userId || p.paid_by === userId) &&
        typeof p.note === 'string' &&
        p.note.includes('[DISPUTED]')
    ).length;
    disputedPaymentsCount += disputedOnDebt;

    if (isBorrower && !isLender) {
      totalBorrowedPrincipal += principal;
      if (d.status === 'settled') {
        totalBorrowerCleared += Math.max(principal, verifiedPaidOnDebt);
      } else {
        totalBorrowerCleared += Math.min(principal, verifiedPaidOnDebt);
      }

      // Check overdue status strictly by UTC calendar day (due today is NOT overdue)
      if (d.status === 'active' && d.due_date) {
        const dueDay = toUtcCalendarDayNumber(d.due_date);
        const daysPastDue = nowUtcDay - dueDay;
        if (daysPastDue >= 1) {
          overdueActiveCount++;
          if (daysPastDue > 30) {
            severeDelinquentCount++;
          } else if (daysPastDue > 7) {
            moderateOverdueCount++;
          }
        }
      }
    } else {
      // User is lender
      if (d.status === 'settled') {
        totalLentSettled += Math.max(principal, verifiedPaidOnDebt);
      } else {
        totalLentSettled += verifiedPaidOnDebt;
      }
    }

    if (d.status === 'settled') {
      if (!d.due_date || !d.settled_at) {
        undatedSettlements++;
      } else {
        const dueDay = toUtcCalendarDayNumber(d.due_date);
        const settledDay = toUtcCalendarDayNumber(d.settled_at);
        // 1-day grace period on settlement confirmation
        if (settledDay <= dueDay + 1) {
          onTimeSettlements++;
        } else if (isBorrower && !isLender) {
          lateSettlements++;
        } else {
          onTimeSettlements++;
        }
      }
    }
  }

  // --- 2. Real-Time Overdue Active Debts vs Active Good Standing ---
  if (overdueActiveCount > 0) {
    const overduePenalty = -(
      overdueActiveCount * 25 +
      moderateOverdueCount * 10 +
      severeDelinquentCount * 30
    );
    factors.push({
      name: 'Active Overdue Debts',
      impact: 'negative',
      points: overduePenalty,
      description: `${overdueActiveCount} active debt${overdueActiveCount > 1 ? 's are' : ' is'} past due (${severeDelinquentCount} severely delinquent >30 days)`,
      icon: 'warning',
    });
    tips.push(
      `Clear your ${overdueActiveCount} overdue active debt${overdueActiveCount > 1 ? 's' : ''} immediately to recover ${Math.abs(overduePenalty)} points.`
    );
  } else if (activeDebts.length > 0) {
    factors.push({
      name: 'Current on Active Ledgers',
      impact: 'positive',
      points: 15,
      description: `${activeDebts.length} active agreement${activeDebts.length > 1 ? 's' : ''} maintained in good standing with zero overdue balances`,
      icon: 'task_alt',
    });
  }

  // --- 3. Settled Debts & On-Time Performance ---
  if (onTimeSettlements > 0) {
    const effectiveOnTime = Math.min(8, onTimeSettlements);
    const onTimePoints = Math.min(
      184,
      effectiveOnTime * 18 + Math.max(0, onTimeSettlements - 8) * 8
    );
    factors.push({
      name: 'On-Time Settlements',
      impact: 'positive',
      points: onTimePoints,
      description: `${onTimeSettlements} debt${onTimeSettlements > 1 ? 's' : ''} settled on or before agreed due date`,
      icon: 'verified',
    });
  }

  if (lateSettlements > 0) {
    const latePoints = -Math.min(72, lateSettlements * 12);
    factors.push({
      name: 'Late Settlements',
      impact: 'negative',
      points: latePoints,
      description: `${lateSettlements} debt${lateSettlements > 1 ? 's' : ''} settled past the due date (-12 each)`,
      icon: 'history_toggle_off',
    });
    tips.push('Settling on or before agreed due dates earns +18 points per debt instead of losing points.');
  }

  if (undatedSettlements > 0) {
    const undatedPoints = Math.min(
      80,
      Math.min(5, undatedSettlements) * 12 + Math.max(0, undatedSettlements - 5) * 5
    );
    factors.push({
      name: 'Completed Open Settlements',
      impact: 'positive',
      points: undatedPoints,
      description: `${undatedSettlements} open agreement${undatedSettlements > 1 ? 's' : ''} settled in full`,
      icon: 'check_circle',
    });
  }

  // --- 4. Counterparty Diversity (Cross-Network Breadth) ---
  const peerCount = uniqueCounterparties.size;
  if (peerCount >= 5) {
    factors.push({
      name: 'Broad Network Trust',
      impact: 'positive',
      points: 40,
      description: `Transactions confirmed across ${peerCount} distinct counterparties`,
      icon: 'hub',
    });
  } else if (peerCount >= 3) {
    factors.push({
      name: 'Diverse Peer Network',
      impact: 'positive',
      points: 25,
      description: `Active trusted relationships with ${peerCount} unique counterparties`,
      icon: 'groups',
    });
  } else if (peerCount === 2) {
    factors.push({
      name: 'Growing Peer Network',
      impact: 'positive',
      points: 12,
      description: 'Verified ledger history across 2 distinct counterparties',
      icon: 'group_add',
    });
  } else if (confirmedDebts.length > 3 && peerCount <= 1) {
    tips.push('Transact with more unique network peers to prove broad community trustworthiness.');
  }

  // --- 5. Repaid & Settled Capital Volume ---
  const effectiveVolume = round2(totalBorrowerCleared + totalLentSettled * 0.5);
  if (effectiveVolume >= 50000) {
    factors.push({
      name: 'High Capital Velocity',
      impact: 'positive',
      points: 45,
      description: `Substantial proven settlement volume (₹${Math.round(effectiveVolume).toLocaleString()} cleared)`,
      icon: 'workspace_premium',
    });
  } else if (effectiveVolume >= 10000) {
    factors.push({
      name: 'Proven Settlement Volume',
      impact: 'positive',
      points: 25,
      description: `Established volume of ₹${Math.round(effectiveVolume).toLocaleString()} successfully cleared`,
      icon: 'payments',
    });
  } else if (effectiveVolume >= 2500) {
    factors.push({
      name: 'Active Settlement Volume',
      impact: 'positive',
      points: 15,
      description: `Settlements totaling ₹${Math.round(effectiveVolume).toLocaleString()} verified on-ledger`,
      icon: 'payments',
    });
  } else if (effectiveVolume >= 500) {
    factors.push({
      name: 'Initial Settlement Volume',
      impact: 'positive',
      points: 8,
      description: `Initial ₹${Math.round(effectiveVolume).toLocaleString()} in verified settlements recorded`,
      icon: 'payments',
    });
  }

  // --- 6. Clearance Ratio (Obligations vs Settlements) ---
  const clearanceRatio =
    totalBorrowedPrincipal > 0
      ? Math.min(100, Math.round((totalBorrowerCleared / totalBorrowedPrincipal) * 100))
      : settledDebts.length > 0
      ? 100
      : 90;

  if (clearanceRatio >= 85 && settledDebts.length > 0) {
    factors.push({
      name: 'High Debt Clearance Rate',
      impact: 'positive',
      points: 30,
      description: `${clearanceRatio}% of lifetime obligations satisfied`,
      icon: 'speed',
    });
  } else if (clearanceRatio >= 60 && settledDebts.length > 0) {
    factors.push({
      name: 'Solid Clearance Progress',
      impact: 'positive',
      points: 15,
      description: `${clearanceRatio}% of lifetime obligations satisfied`,
      icon: 'trending_up',
    });
  } else if (clearanceRatio < 40 && overdueActiveCount > 0) {
    factors.push({
      name: 'Low Clearance Velocity',
      impact: 'negative',
      points: -25,
      description: `Only ${clearanceRatio}% of obligations satisfied with active delinquent debts`,
      icon: 'trending_down',
    });
    tips.push('Maintain an obligations clearance rate above 85% to earn +30 bonus points.');
  }

  // --- 7. Disputes & Outbound Rejected Proposals ---
  const totalDisputes = disputedDebts.length + disputedPaymentsCount;
  if (totalDisputes > 0) {
    const disputePenalty = -(totalDisputes * 40);
    factors.push({
      name: 'Contested Disputes',
      impact: 'negative',
      points: disputePenalty,
      description: `${totalDisputes} contested transaction dispute${totalDisputes > 1 ? 's' : ''} on record (-40 each)`,
      icon: 'gavel',
    });
    tips.push('Resolve all open transaction disputes to lift point deductions.');
  }

  // Only penalize the creator of rejected outbound proposals (and only when >= 2 rejected)
  const rejectedCreatedCount = validDebts.filter(
    (d) => d.status === 'declined' && (!userId || d.created_by === userId)
  ).length;
  if (rejectedCreatedCount >= 2) {
    const declinedPoints = -Math.min(100, (rejectedCreatedCount - 1) * 20);
    factors.push({
      name: 'Rejected Outbound Proposals',
      impact: 'negative',
      points: declinedPoints,
      description: `${rejectedCreatedCount} outbound debt proposals rejected by counterparties`,
      icon: 'cancel',
    });
    tips.push('Ensure counterparty consensus before sending debt terms to avoid rejected proposals.');
  }

  // --- 8. Admin Security Isolation / Verification Flag ---
  if (extraOptions?.isIsolated) {
    factors.push({
      name: 'Account Isolated by Admin',
      impact: 'negative',
      points: -150,
      description: 'Account placed in restricted security quarantine by platform administrator',
      icon: 'security',
    });
    tips.push('Contact support or platform admin to review account isolation status.');
  }

  if (extraOptions?.isVerified) {
    factors.push({
      name: 'Admin-Verified Account',
      impact: 'positive',
      points: 25,
      description: 'Identity and contact details independently verified by administrator',
      icon: 'verified_user',
    });
  }

  // --- 9. Calibration Check ---
  const isCalibrated = confirmedDebts.length >= 3 || settledDebts.length >= 1;
  if (!isCalibrated) {
    factors.push({
      name: 'Building History',
      impact: 'neutral',
      points: 0,
      description: 'Score is provisional until at least 3 transactions or 1 settlement are confirmed',
      icon: 'hourglass_empty',
    });
    tips.push('Complete your first settled transaction to establish full score calibration.');
  }

  // --- Calculate Final Clamped Score ---
  const rawScore = factors.reduce((sum, f) => sum + f.points, 0);
  const score = Math.min(MAX_SCORE, Math.max(MIN_SCORE, rawScore));

  const rating =
    score >= 800
      ? 'Exceptional'
      : score >= 740
      ? 'Very Good'
      : score >= 670
      ? 'Good'
      : score >= 580
      ? 'Fair'
      : 'Poor';

  const ratingColor =
    score >= 800
      ? 'text-emerald-500'
      : score >= 740
      ? 'text-green-500'
      : score >= 670
      ? 'text-blue-500'
      : score >= 580
      ? 'text-amber-500'
      : 'text-red-500';

  // --- Compute 4 Quantitative Pillars (0 - 100%) ---
  const paymentHistory = Math.min(
    100,
    Math.max(
      20,
      Math.round(
        100 -
          (overdueActiveCount * 25 + lateSettlements * 15 + (totalDisputes > 0 ? 30 : 0)) +
          (onTimeSettlements + undatedSettlements) * 8
      )
    )
  );

  const debtClearance = Math.min(100, Math.max(15, clearanceRatio));

  const networkBreadth = Math.min(
    100,
    Math.max(20, Math.round((peerCount / 5) * 80 + (settledDebts.length > 0 ? 20 : 0)))
  );

  const disputeCleanliness = Math.max(
    0,
    Math.min(100, Math.round(100 - totalDisputes * 35 - Math.max(0, rejectedCreatedCount - 1) * 15))
  );

  if (score < MAX_SCORE && tips.length === 0) {
    tips.push('Maintain timely on-ledger repayments to keep your score in the prime 750+ tier.');
  }

  return {
    score,
    rating,
    ratingColor,
    factors,
    tips,
    pillars: {
      paymentHistory,
      debtClearance,
      networkBreadth,
      disputeCleanliness,
    },
    isCalibrated,
    overdueActiveCount,
  };
}

/**
 * Get a quick trust score number without full breakdown.
 */
export function getQuickTrustScore(
  debts: Debt[],
  payments: Payment[],
  userId?: string,
  extraOptions?: { isIsolated?: boolean; isVerified?: boolean }
): number {
  return calculateTrustScore(debts, payments, userId, extraOptions).score;
}

/**
 * Get trust rating label from score.
 */
export function getTrustRating(score: number): string {
  if (score < 0) return 'No Score';
  return score >= 800
    ? 'Exceptional'
    : score >= 740
    ? 'Very Good'
    : score >= 670
    ? 'Good'
    : score >= 580
    ? 'Fair'
    : 'Poor';
}

// ============================================================================
// Server-Provided Dynamic Trust Score Cache & RPC Client
// Ensures every device and user sees the exact same global Network Trust Score
// ============================================================================

const TRUST_CACHE_STORAGE_KEY = 'debtsync_server_trust_cache_v1';
const TRUST_CACHE_TTL_MS = 45 * 1000; // 45s fresh TTL

interface CachedTrustEntry {
  breakdown: TrustScoreBreakdown;
  timestamp: number;
}

const memoryTrustCache = new Map<string, CachedTrustEntry>();

function loadSessionTrustCache(): void {
  if (typeof window === 'undefined' || memoryTrustCache.size > 0) return;
  try {
    const raw = sessionStorage.getItem(TRUST_CACHE_STORAGE_KEY);
    if (!raw) return;
    const parsed: Record<string, CachedTrustEntry> = JSON.parse(raw);
    const now = Date.now();
    for (const [uid, entry] of Object.entries(parsed)) {
      if (entry && entry.breakdown && now - entry.timestamp < TRUST_CACHE_TTL_MS * 4) {
        memoryTrustCache.set(uid, entry);
      }
    }
  } catch (_) {}
}

function persistSessionTrustCache(): void {
  if (typeof window === 'undefined') return;
  try {
    const obj: Record<string, CachedTrustEntry> = {};
    for (const [uid, entry] of memoryTrustCache.entries()) {
      obj[uid] = entry;
    }
    sessionStorage.setItem(TRUST_CACHE_STORAGE_KEY, JSON.stringify(obj));
  } catch (_) {}
}

export function getCachedServerTrustScore(userId?: string | null): TrustScoreBreakdown | null {
  if (!userId) return null;
  loadSessionTrustCache();
  const entry = memoryTrustCache.get(userId);
  return entry ? entry.breakdown : null;
}

export function invalidateServerTrustCache(): void {
  memoryTrustCache.clear();
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(TRUST_CACHE_STORAGE_KEY);
  } catch (_) {}
}

/**
 * Fetches the authoritative, server-computed Network Trust Score breakdown for a single user.
 * Falls back to local calculation only if the RPC is unreachable.
 */
export async function fetchServerTrustScore(
  supabase: any,
  userId: string,
  fallbackDebts: Debt[] = [],
  fallbackPayments: Payment[] = [],
  extraOptions?: { isIsolated?: boolean; isVerified?: boolean }
): Promise<TrustScoreBreakdown> {
  if (!userId || userId === TOMBSTONE_UUID) {
    return getUnratedBreakdown();
  }

  loadSessionTrustCache();
  try {
    const { data, error } = await supabase.rpc('calculate_user_trust_score', {
      p_user_id: userId,
    });
    if (!error && data && typeof data.score === 'number') {
      const breakdown = data as TrustScoreBreakdown;
      memoryTrustCache.set(userId, { breakdown, timestamp: Date.now() });
      persistSessionTrustCache();
      return breakdown;
    }
  } catch (_) {}

  const cached = memoryTrustCache.get(userId);
  if (cached) return cached.breakdown;

  return calculateTrustScore(fallbackDebts, fallbackPayments, userId, extraOptions);
}

/**
 * Batch-fetches authoritative, server-computed Network Trust Scores for multiple users in 1 RPC call.
 * Ensures Directory, RecordDebtModal, and Admin views display identical global scores across all devices.
 */
export async function fetchBatchServerTrustScores(
  supabase: any,
  userIds: string[],
  fallbackDebts: Debt[] = [],
  fallbackPayments: Payment[] = []
): Promise<Record<string, TrustScoreBreakdown>> {
  const uniqueIds = Array.from(
    new Set(userIds.filter((id) => id && id !== TOMBSTONE_UUID))
  );
  const result: Record<string, TrustScoreBreakdown> = {};
  if (uniqueIds.length === 0) return result;

  loadSessionTrustCache();

  try {
    const { data, error } = await supabase.rpc('get_batch_trust_scores', {
      p_user_ids: uniqueIds,
    });
    if (!error && data && typeof data === 'object') {
      const now = Date.now();
      for (const uid of uniqueIds) {
        const entry = (data as Record<string, TrustScoreBreakdown>)[uid];
        if (entry && typeof entry.score === 'number') {
          result[uid] = entry;
          memoryTrustCache.set(uid, { breakdown: entry, timestamp: now });
        }
      }
      persistSessionTrustCache();
      if (Object.keys(result).length > 0) {
        return result;
      }
    }
  } catch (_) {}

  // Fallback to cached or local calculation if offline
  for (const uid of uniqueIds) {
    const cached = memoryTrustCache.get(uid);
    if (cached) {
      result[uid] = cached.breakdown;
    } else {
      result[uid] = calculateTrustScore(fallbackDebts, fallbackPayments, uid);
    }
  }
  return result;
}
