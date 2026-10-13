import { Debt, Payment } from '../types/database';
import { calculateDebtBalance } from './interest';

export interface CashflowDataPoint {
  label: string;
  moneyIn: number;
  moneyOut: number;
}

export interface GrowthDataPoint {
  date: string;
  timestamp: number;
  owedToYou: number | null;
  youOwe: number | null;
  netBalance: number | null;
  projectedOwedToYou?: number | null;
  projectedYouOwe?: number | null;
}

/**
 * Computes actual Money In (Repayments received & loans borrowed) vs Money Out (Loans issued & repayments made)
 * across 1 Month (weekly), 3 Months (monthly), or 1 Year (monthly).
 */
export function generateCashflowData(
  debts: Debt[],
  payments: Payment[],
  currentUserId: string,
  period: '1M' | '3M' | '1Y' = '3M'
): CashflowDataPoint[] {
  const now = new Date();

  if (period === '1M') {
    // Last 4 weeks
    const points: CashflowDataPoint[] = [];
    for (let w = 3; w >= 0; w--) {
      const weekStart = new Date(now.getTime() - (w + 1) * 7 * 86400000);
      const weekEnd = new Date(now.getTime() - w * 7 * 86400000);
      const label = `Wk ${4 - w}`;

      let moneyIn = 0;
      let moneyOut = 0;

      // Loans created in this week
      for (const d of debts) {
        if (d.status === 'declined' || d.status === 'purged') continue;
        const dDate = new Date(d.created_at);
        if (dDate >= weekStart && dDate < weekEnd) {
          if (d.lender_id === currentUserId) {
            moneyOut += Number(d.principal) || 0; // Lent out
          }
        }
      }

      // Payments in this week
      for (const p of payments) {
        const pDate = new Date(p.created_at);
        if (pDate >= weekStart && pDate < weekEnd) {
          const debt = debts.find((d) => d.id === p.debt_id);
          if (debt && debt.lender_id === currentUserId) {
            moneyIn += Number(p.amount) || 0; // Received repayment
          }
        }
      }

      points.push({ label, moneyIn: Math.round(moneyIn), moneyOut: Math.round(moneyOut) });
    }
    return points;
  }

  if (period === '3M') {
    // Last 3 months
    const points: CashflowDataPoint[] = [];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    for (let m = 2; m >= 0; m--) {
      const targetDate = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const nextMonth = new Date(now.getFullYear(), now.getMonth() - m + 1, 1);
      const label = monthNames[targetDate.getMonth()];

      let moneyIn = 0;
      let moneyOut = 0;

      for (const d of debts) {
        if (d.status === 'declined' || d.status === 'purged') continue;
        const dDate = new Date(d.created_at);
        if (dDate >= targetDate && dDate < nextMonth) {
          if (d.lender_id === currentUserId) {
            moneyOut += Number(d.principal) || 0;
          }
        }
      }

      for (const p of payments) {
        const pDate = new Date(p.created_at);
        if (pDate >= targetDate && pDate < nextMonth) {
          const debt = debts.find((d) => d.id === p.debt_id);
          if (debt && debt.lender_id === currentUserId) {
            moneyIn += Number(p.amount) || 0;
          }
        }
      }

      points.push({ label, moneyIn: Math.round(moneyIn), moneyOut: Math.round(moneyOut) });
    }
    return points;
  }

  // 1Y: Last 12 months
  const points: CashflowDataPoint[] = [];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  for (let m = 11; m >= 0; m--) {
    const targetDate = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() - m + 1, 1);
    const label = monthNames[targetDate.getMonth()];

    let moneyIn = 0;
    let moneyOut = 0;

    for (const d of debts) {
      if (d.status === 'declined' || d.status === 'purged') continue;
      const dDate = new Date(d.created_at);
      if (dDate >= targetDate && dDate < nextMonth) {
        if (d.lender_id === currentUserId) {
          moneyOut += Number(d.principal) || 0;
        }
      }
    }

    for (const p of payments) {
      const pDate = new Date(p.created_at);
      if (pDate >= targetDate && pDate < nextMonth) {
        const debt = debts.find((d) => d.id === p.debt_id);
        if (debt && debt.lender_id === currentUserId) {
          moneyIn += Number(p.amount) || 0;
        }
      }
    }

    points.push({ label, moneyIn: Math.round(moneyIn), moneyOut: Math.round(moneyOut) });
  }

  return points;
}

/**
 * Generates historical trajectory and future compounding projection curves
 * based on active loans and real payments.
 */
export function generatePortfolioGrowthData(
  debts: Debt[],
  payments: Payment[],
  currentUserId: string,
  projDays: 30 | 90 | 365 = 30
): {
  labels: string[];
  historicalOwedToYou: (number | null)[];
  historicalYouOwe: (number | null)[];
  projectedOwedToYou: (number | null)[];
  projectedYouOwe: (number | null)[];
  hasActiveInterest: boolean;
} {
  const activeDebts = debts.filter((d) => d.status !== 'declined' && d.status !== 'settled');

  if (activeDebts.length === 0 && debts.length === 0) {
    return {
      labels: ['Today', `+${projDays}D`],
      historicalOwedToYou: [0, null],
      historicalYouOwe: [0, null],
      projectedOwedToYou: [0, 0],
      projectedYouOwe: [0, 0],
      hasActiveInterest: false,
    };
  }

  const nowMs = Date.now();
  const allTimestamps = debts.map((d) => new Date(d.created_at).getTime());
  const minStartMs = allTimestamps.length > 0 ? Math.min(...allTimestamps) : nowMs - 30 * 86400000;
  // Bound earliest history to at most 90 days ago if very old to keep graph readable
  const startMs = Math.max(minStartMs, nowMs - 90 * 86400000);
  const endMs = nowMs + projDays * 86400000;

  const totalDuration = endMs - startMs;
  const numSteps = 24; // Smooth 24-point graph
  const stepMs = Math.max(86400000, totalDuration / numSteps);

  const labels: string[] = [];
  const historicalOwedToYou: (number | null)[] = [];
  const historicalYouOwe: (number | null)[] = [];
  const projectedOwedToYou: (number | null)[] = [];
  const projectedYouOwe: (number | null)[] = [];

  let hasActiveInterest = false;

  for (let t = startMs; t <= endMs + stepMs / 2; t += stepMs) {
    const dObj = new Date(t);
    const dateLabel = dObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    labels.push(dateLabel);

    let totalLentAtT = 0;
    let totalOwedAtT = 0;

    for (const d of debts) {
      if (d.status === 'declined' || d.status === 'purged') continue;
      const dCreatedMs = new Date(d.created_at).getTime();
      if (t < dCreatedMs) continue;

      if (d.interest_type !== 'none' && (Number(d.interest_rate) || 0) > 0) {
        hasActiveInterest = true;
      }

      // Only payments up to t
      const debtPayments = payments.filter(
        (p) => p.debt_id === d.id && new Date(p.created_at).getTime() <= t
      );
      const calc = calculateDebtBalance(d, debtPayments, dObj);

      if (d.lender_id === currentUserId) {
        totalLentAtT += calc.currentBalance;
      } else {
        totalOwedAtT += calc.currentBalance;
      }
    }

    const roundedLent = Math.round(totalLentAtT * 100) / 100;
    const roundedOwed = Math.round(totalOwedAtT * 100) / 100;

    if (t <= nowMs) {
      // Historical point
      historicalOwedToYou.push(roundedLent);
      historicalYouOwe.push(roundedOwed);
      // Link to projected at present
      if (t + stepMs > nowMs) {
        projectedOwedToYou.push(roundedLent);
        projectedYouOwe.push(roundedOwed);
      } else {
        projectedOwedToYou.push(null);
        projectedYouOwe.push(null);
      }
    } else {
      // Future projected point
      historicalOwedToYou.push(null);
      historicalYouOwe.push(null);
      projectedOwedToYou.push(roundedLent);
      projectedYouOwe.push(roundedOwed);
    }
  }

  return {
    labels,
    historicalOwedToYou,
    historicalYouOwe,
    projectedOwedToYou,
    projectedYouOwe,
    hasActiveInterest,
  };
}

/**
 * Generates person-specific growth & historical repayment data.
 */
export function generatePersonGrowthData(
  personDebts: Debt[],
  personPayments: Payment[],
  currentUserId: string,
  projDays: 30 | 90 | 365 = 30
): {
  labels: string[];
  historicalBalance: (number | null)[];
  projectedBalance: (number | null)[];
  cumulativeRepayments: number[];
} {
  const nowMs = Date.now();
  const allTimestamps = personDebts.map((d) => new Date(d.created_at).getTime());
  const startMs = allTimestamps.length > 0 ? Math.min(...allTimestamps) : nowMs - 30 * 86400000;
  const endMs = nowMs + projDays * 86400000;

  const totalDuration = endMs - startMs;
  const numSteps = 20;
  const stepMs = Math.max(86400000, totalDuration / numSteps);

  const labels: string[] = [];
  const historicalBalance: (number | null)[] = [];
  const projectedBalance: (number | null)[] = [];
  const cumulativeRepayments: number[] = [];

  for (let t = startMs; t <= endMs + stepMs / 2; t += stepMs) {
    const dObj = new Date(t);
    labels.push(dObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));

    let netAtT = 0;
    let paidUpToT = 0;

    for (const d of personDebts) {
      if (d.status === 'declined' || d.status === 'purged') continue;
      const dCreatedMs = new Date(d.created_at).getTime();
      if (t < dCreatedMs) continue;

      const debtPayments = personPayments.filter(
        (p) => p.debt_id === d.id && new Date(p.created_at).getTime() <= t
      );
      const calc = calculateDebtBalance(d, debtPayments, dObj);

      if (d.lender_id === currentUserId) {
        netAtT += calc.currentBalance;
      } else {
        netAtT -= calc.currentBalance;
      }

      paidUpToT += calc.totalPaid;
    }

    const roundedNet = Math.round(netAtT * 100) / 100;
    cumulativeRepayments.push(Math.round(paidUpToT * 100) / 100);

    if (t <= nowMs) {
      historicalBalance.push(roundedNet);
      if (t + stepMs > nowMs) {
        projectedBalance.push(roundedNet);
      } else {
        projectedBalance.push(null);
      }
    } else {
      historicalBalance.push(null);
      projectedBalance.push(roundedNet);
    }
  }

  return {
    labels,
    historicalBalance,
    projectedBalance,
    cumulativeRepayments,
  };
}
