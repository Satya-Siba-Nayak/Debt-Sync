'use client';

import { Debt, Payment } from '@/lib/types/database';
import { round2 } from '@/lib/utils/interest';

export interface TrustFactor {
  name: string;
  impact: 'positive' | 'negative' | 'neutral';
  points: number;
  description: string;
  icon: string; // Material Symbols icon name
}

export interface TrustScorePillars {
  paymentHistory: number;    // 0 - 100%
  debtClearance: number;     // 0 - 100%
  networkBreadth: number;    // 0 - 100%
  disputeCleanliness: number;// 0 - 100%
}

export interface TrustScoreBreakdown {
  score: number;             // 300 - 850
  rating: string;            // 'Exceptional' | 'Very Good' | 'Good' | 'Fair' | 'Poor'
  ratingColor: string;       // Tailwind color class
  factors: TrustFactor[];    // Individual factor contributions
  tips: string[];            // Actionable improvement tips
  pillars: TrustScorePillars;// Quantitative pillars
  isCalibrated: boolean;     // Whether user has enough transactional history
  overdueActiveCount: number;// Currently delinquent active debts
}

const BASE_SCORE = 650;      // Standard neutral baseline for new participants
const MIN_SCORE = 300;       // Minimum rating floor
const MAX_SCORE = 850;       // Maximum prime credit score

/**
 * Enhanced Multi-Dimensional Network Score Engine
 *
 * Evaluates:
 * 1. Payment History (On-time settlements, overdue active debts, delinquency penalty)
 * 2. Debt Clearance Velocity (Repayment volume, obligations vs cleared ratio)
 * 3. Network Breadth & Counterparty Diversity (Cross-peer settlements vs wash trading)
 * 4. Dispute Cleanliness & Security Standing (Zero disputes, admin isolation penalty)
 */
export function calculateTrustScore(
  debts: Debt[],
  payments: Payment[],
  userId?: string,
  extraOptions?: { isIsolated?: boolean; isVerified?: boolean }
): TrustScoreBreakdown {
  const factors: TrustFactor[] = [];
  const tips: string[] = [];
  const now = Date.now();

  // Filter debts and payments relevant to this user if userId is provided
  const relevantDebts = userId
    ? debts.filter((d) => d.borrower_id === userId || d.lender_id === userId)
    : debts;
  const relevantPayments = userId
    ? payments.filter((p) => p.paid_by === userId || relevantDebts.some((d) => d.id === p.debt_id))
    : payments;

  // --- 0. Zero History Check (Credit Bureau Unscored File: -1 / NH) ---
  if (relevantDebts.length === 0 && relevantPayments.length === 0) {
    return {
      score: -1,
      rating: 'No Score',
      ratingColor: 'text-[var(--outline)]',
      factors: [
        {
          name: 'No Credit History',
          impact: 'neutral',
          points: 0,
          description: 'No loan, debt, or repayment transactions on record. Unrated (-1) until first transaction.',
          icon: 'history_toggle_off',
        },
      ],
      tips: ['Complete your first loan, debt, or repayment transaction to generate a calibrated network score.'],
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

  // --- 1. Base Starting Score ---
  factors.push({
    name: 'Starting Baseline',
    impact: 'neutral',
    points: BASE_SCORE,
    description: 'Neutral benchmark for all verified DebtSync participants',
    icon: 'shield',
  });

  // Filter debts where this user is borrower vs lender
  const borrowedDebts = userId
    ? relevantDebts.filter((d) => d.borrower_id === userId)
    : debts;
  const lentDebts = userId
    ? relevantDebts.filter((d) => d.lender_id === userId)
    : [];

  const verifiedPayments = relevantPayments.filter(
    (p) => p.is_verified && !(typeof p.note === 'string' && p.note.includes('[DISPUTED]'))
  );

  // --- 2. Real-Time Overdue Active Debts (Delinquency Penalty) ---
  let overdueActiveCount = 0;
  let severeDelinquentCount = 0;
  let totalOverdueAmount = 0;

  for (const d of borrowedDebts) {
    if (d.status === 'active' && d.due_date) {
      const dueTimestamp = new Date(d.due_date).getTime();
      if (now > dueTimestamp) {
        overdueActiveCount++;
        const daysPastDue = Math.floor((now - dueTimestamp) / (1000 * 60 * 60 * 24));
        totalOverdueAmount += Number(d.principal) || 0;
        if (daysPastDue > 30) {
          severeDelinquentCount++;
        }
      }
    }
  }

  if (overdueActiveCount > 0) {
    // Penalty scales with count and severe delinquency (>30 days overdue)
    const overduePenalty = -(overdueActiveCount * 30 + severeDelinquentCount * 35);
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
  }

  // --- 3. Settled Debts & On-Time Performance ---
  const settledDebts = relevantDebts.filter((d) => d.status === 'settled');
  let onTimeSettlements = 0;
  let lateSettlements = 0;
  let undatedSettlements = 0;

  for (const d of settledDebts) {
    if (!d.due_date || !d.settled_at) {
      undatedSettlements++;
      continue;
    }
    const dueDate = new Date(d.due_date).getTime();
    const settledDate = new Date(d.settled_at).getTime();
    // 24-hour grace period for payment confirmations
    if (settledDate <= dueDate + 86400000) {
      onTimeSettlements++;
    } else {
      lateSettlements++;
    }
  }

  if (onTimeSettlements > 0) {
    // Diminishing returns after 5 to prevent gaming small circular settlements
    const effectiveOnTime = Math.min(8, onTimeSettlements);
    const onTimePoints = effectiveOnTime * 18 + Math.max(0, onTimeSettlements - 8) * 8;
    factors.push({
      name: 'On-Time Settlements',
      impact: 'positive',
      points: onTimePoints,
      description: `${onTimeSettlements} debt${onTimeSettlements > 1 ? 's' : ''} settled on or before agreed due date`,
      icon: 'verified',
    });
  }

  if (lateSettlements > 0) {
    const latePoints = -(lateSettlements * 12);
    factors.push({
      name: 'Late Settlements',
      impact: 'negative',
      points: latePoints,
      description: `${lateSettlements} debt${lateSettlements > 1 ? 's' : ''} settled past the due date (-12 each)`,
      icon: 'history_toggle_off',
    });
    tips.push('Settling on or before agreed due dates earns up to +18 points per debt instead of losing points.');
  }

  if (undatedSettlements > 0) {
    const undatedPoints = Math.min(5, undatedSettlements) * 10;
    factors.push({
      name: 'Open Settlements',
      impact: 'positive',
      points: undatedPoints,
      description: `${undatedSettlements} open debt${undatedSettlements > 1 ? 's' : ''} settled in full`,
      icon: 'check_circle',
    });
  }

  // --- 4. Counterparty Diversity (Cross-Network Breadth) ---
  const uniqueCounterparties = new Set<string>();
  for (const d of relevantDebts) {
    if (d.status === 'settled' || d.status === 'active') {
      if (d.lender_id && d.lender_id !== userId) uniqueCounterparties.add(d.lender_id);
      if (d.borrower_id && d.borrower_id !== userId) uniqueCounterparties.add(d.borrower_id);
    }
  }

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
  } else if (relevantDebts.length > 3 && peerCount <= 1) {
    tips.push('Transact with more unique network peers to prove broad community trustworthiness.');
  }

  // --- 5. Repaid Volume & Capital Velocity ---
  const totalRepaidAmount = round2(
    verifiedPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
  );
  if (totalRepaidAmount >= 50000) {
    factors.push({
      name: 'High Capital Velocity',
      impact: 'positive',
      points: 45,
      description: `Substantial proven repayments totaling ₹${totalRepaidAmount.toLocaleString()}`,
      icon: 'workspace_premium',
    });
  } else if (totalRepaidAmount >= 10000) {
    factors.push({
      name: 'Proven Repayment Volume',
      impact: 'positive',
      points: 25,
      description: `Established volume of ₹${totalRepaidAmount.toLocaleString()} successfully settled`,
      icon: 'payments',
    });
  } else if (totalRepaidAmount >= 2500) {
    factors.push({
      name: 'Active Repayment Volume',
      impact: 'positive',
      points: 15,
      description: `Repayments totaling ₹${totalRepaidAmount.toLocaleString()} verified on-ledger`,
      icon: 'payments',
    });
  }

  // --- 6. Clearance Ratio (Obligations vs Settlements) ---
  const totalBorrowedPrincipal = round2(
    borrowedDebts.reduce((sum, d) => sum + (Number(d.principal) || 0), 0)
  );

  const clearanceRatio =
    totalBorrowedPrincipal > 0
      ? Math.min(100, Math.round((totalRepaidAmount / totalBorrowedPrincipal) * 100))
      : relevantDebts.length === 0
      ? 100
      : 90;

  if (clearanceRatio >= 90 && settledDebts.length > 0) {
    factors.push({
      name: 'High Debt Clearance Rate',
      impact: 'positive',
      points: 30,
      description: `${clearanceRatio}% of lifetime obligations satisfied`,
      icon: 'speed',
    });
  } else if (clearanceRatio < 50 && overdueActiveCount > 0) {
    factors.push({
      name: 'Low Clearance Velocity',
      impact: 'negative',
      points: -25,
      description: `Only ${clearanceRatio}% of obligations satisfied with active delinquent debts`,
      icon: 'trending_down',
    });
    tips.push('Maintain an obligations clearance rate above 80% to earn +30 bonus points.');
  }

  // --- 7. Disputes & Declines ---
  const disputedDebtsCount = relevantDebts.filter((d) => d.status === 'disputed').length;
  const disputedPaymentsCount = relevantPayments.filter(
    (p) => typeof p.note === 'string' && p.note.includes('[DISPUTED]')
  ).length;
  const totalDisputes = disputedDebtsCount + disputedPaymentsCount;

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

  const declinedCount = relevantDebts.filter((d) => d.status === 'declined').length;
  if (declinedCount > 0) {
    const declinedPoints = -(declinedCount * 25);
    factors.push({
      name: 'Declined Proposals',
      impact: 'negative',
      points: declinedPoints,
      description: `${declinedCount} debt proposal${declinedCount > 1 ? 's' : ''} rejected by counterparty`,
      icon: 'cancel',
    });
    tips.push('Ensure counterparty consensus before sending debt terms to avoid declined proposals.');
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
  const isCalibrated = relevantDebts.length >= 3 || settledDebts.length >= 1;
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

  // Determine Rating Tier
  const rating =
    score >= 800 ? 'Exceptional'
    : score >= 740 ? 'Very Good'
    : score >= 670 ? 'Good'
    : score >= 580 ? 'Fair'
    : 'Poor';

  const ratingColor =
    score >= 800 ? 'text-emerald-500'
    : score >= 740 ? 'text-green-500'
    : score >= 670 ? 'text-blue-500'
    : score >= 580 ? 'text-amber-500'
    : 'text-red-500';

  // --- Compute Quantitative Pillars (0 - 100%) ---
  const paymentHistory = Math.min(
    100,
    Math.max(
      20,
      Math.round(
        100 -
          (overdueActiveCount * 25 + lateSettlements * 15 + (totalDisputes > 0 ? 30 : 0)) +
          onTimeSettlements * 8
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
    Math.min(100, Math.round(100 - totalDisputes * 35 - declinedCount * 15))
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
  return score >= 800 ? 'Exceptional'
    : score >= 740 ? 'Very Good'
    : score >= 670 ? 'Good'
    : score >= 580 ? 'Fair'
    : 'Poor';
}
