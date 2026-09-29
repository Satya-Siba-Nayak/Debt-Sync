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

export interface TrustScoreBreakdown {
  score: number;           // 350-850
  rating: string;          // 'Exceptional' | 'Very Good' | 'Good' | 'Fair' | 'Poor'
  ratingColor: string;     // Tailwind color class
  factors: TrustFactor[];  // Individual factor contributions
  tips: string[];          // Actionable improvement tips
}

const BASE_SCORE = 720;
const MIN_SCORE = 350;
const MAX_SCORE = 850;

/**
 * Calculate a comprehensive trust score with factor-by-factor breakdown.
 * This can be called for the current user OR a counterparty (given their debts/payments).
 */
export function calculateTrustScore(
  debts: Debt[],
  payments: Payment[],
  userId?: string
): TrustScoreBreakdown {
  const factors: TrustFactor[] = [];
  const tips: string[] = [];

  // --- Factor 1: Base Score ---
  factors.push({
    name: 'Base Score',
    impact: 'neutral',
    points: BASE_SCORE,
    description: 'Starting baseline for all DebtSync users',
    icon: 'shield',
  });

  // --- Factor 2: Settled Debts ---
  const settledCount = debts.filter((d) => d.status === 'settled').length;
  if (settledCount > 0) {
    const settledPoints = settledCount * 25;
    factors.push({
      name: 'Settled Debts',
      impact: 'positive',
      points: settledPoints,
      description: `${settledCount} debt${settledCount > 1 ? 's' : ''} fully settled (+25 each)`,
      icon: 'check_circle',
    });
  } else if (debts.length > 0) {
    tips.push('Settle outstanding debts to earn +25 points per settled debt.');
  }

  // --- Factor 3: Declined Debts ---
  const declinedCount = debts.filter((d) => d.status === 'declined').length;
  if (declinedCount > 0) {
    const declinedPoints = -(declinedCount * 40);
    factors.push({
      name: 'Declined Requests',
      impact: 'negative',
      points: declinedPoints,
      description: `${declinedCount} debt request${declinedCount > 1 ? 's' : ''} declined (-40 each)`,
      icon: 'block',
    });
    tips.push('Avoid situations that lead to declined debt requests — each costs 40 points.');
  }

  // --- Factor 4: Repayment Velocity ---
  const verifiedPayments = payments.filter(
    (p) => p.is_verified && !(typeof p.note === 'string' && p.note.includes('[DISPUTED]'))
  );
  const totalRepaid = round2(verifiedPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));

  // Calculate total obligations (sum of all active/settled debt principals where user is borrower)
  const borrowedDebts = userId
    ? debts.filter((d) => d.borrower_id === userId && (d.status === 'active' || d.status === 'settled'))
    : debts.filter((d) => d.status === 'active' || d.status === 'settled');
  const totalObligations = round2(borrowedDebts.reduce((sum, d) => sum + (Number(d.principal) || 0), 0));

  const repaymentVelocity = totalObligations > 0
    ? Math.min(100, Math.round((totalRepaid / totalObligations) * 100))
    : debts.length === 0 ? 100 : 85;

  if (repaymentVelocity >= 80) {
    factors.push({
      name: 'Repayment Velocity',
      impact: 'positive',
      points: 30,
      description: `${repaymentVelocity}% of obligations repaid (≥80% threshold met)`,
      icon: 'speed',
    });
  } else {
    factors.push({
      name: 'Repayment Velocity',
      impact: 'negative',
      points: -20,
      description: `${repaymentVelocity}% of obligations repaid (below 80% threshold)`,
      icon: 'speed',
    });
    tips.push('Increase repayment velocity above 80% to earn +30 bonus points (currently -20).');
  }

  // --- Factor 5: On-Time Payments ---
  let onTimeCount = 0;
  let lateCount = 0;
  for (const d of debts) {
    if (d.status !== 'settled' || !d.due_date || !d.settled_at) continue;
    const dueDate = new Date(d.due_date).getTime();
    const settledDate = new Date(d.settled_at).getTime();
    if (settledDate <= dueDate) {
      onTimeCount++;
    } else {
      lateCount++;
    }
  }

  if (onTimeCount > 0) {
    factors.push({
      name: 'On-Time Settlements',
      impact: 'positive',
      points: onTimeCount * 15,
      description: `${onTimeCount} debt${onTimeCount > 1 ? 's' : ''} settled on or before due date (+15 each)`,
      icon: 'schedule',
    });
  }

  if (lateCount > 0) {
    factors.push({
      name: 'Late Settlements',
      impact: 'negative',
      points: -(lateCount * 10),
      description: `${lateCount} debt${lateCount > 1 ? 's' : ''} settled after due date (-10 each)`,
      icon: 'event_busy',
    });
    tips.push('Pay on or before due dates to earn +15 per on-time settlement instead of losing -10 for late ones.');
  }

  // --- Factor 6: Disputed Payments ---
  const disputedPayments = payments.filter(
    (p) => typeof p.note === 'string' && p.note.includes('[DISPUTED]')
  );
  if (disputedPayments.length > 0) {
    factors.push({
      name: 'Disputed Payments',
      impact: 'negative',
      points: -(disputedPayments.length * 20),
      description: `${disputedPayments.length} payment${disputedPayments.length > 1 ? 's' : ''} disputed (-20 each)`,
      icon: 'gavel',
    });
    tips.push('Resolve payment disputes to avoid -20 point penalties per dispute.');
  }

  // --- Factor 7: Account Age / Activity ---
  if (debts.length === 0) {
    factors.push({
      name: 'New Account',
      impact: 'neutral',
      points: 30,
      description: 'New account bonus — build history to unlock higher scores',
      icon: 'new_releases',
    });
    tips.push('Start recording debts and making payments to build your trust history.');
  }

  // --- Calculate Total ---
  const rawScore = factors.reduce((sum, f) => sum + f.points, 0);
  const score = Math.min(MAX_SCORE, Math.max(MIN_SCORE, rawScore));

  const rating =
    score >= 780 ? 'Exceptional'
    : score >= 740 ? 'Very Good'
    : score >= 670 ? 'Good'
    : score >= 550 ? 'Fair'
    : 'Poor';

  const ratingColor =
    score >= 780 ? 'text-emerald-500'
    : score >= 740 ? 'text-green-500'
    : score >= 670 ? 'text-blue-500'
    : score >= 550 ? 'text-amber-500'
    : 'text-red-500';

  // Add general tips if score can improve
  if (score < MAX_SCORE && tips.length === 0) {
    tips.push('Continue settling debts on time to maintain and increase your score.');
  }

  return { score, rating, ratingColor, factors, tips };
}

/**
 * Get a quick trust score number without full breakdown (for badges/cards).
 */
export function getQuickTrustScore(debts: Debt[], payments: Payment[], userId?: string): number {
  return calculateTrustScore(debts, payments, userId).score;
}

/**
 * Get trust rating label from score.
 */
export function getTrustRating(score: number): string {
  return score >= 780 ? 'Exceptional'
    : score >= 740 ? 'Very Good'
    : score >= 670 ? 'Good'
    : score >= 550 ? 'Fair'
    : 'Poor';
}
