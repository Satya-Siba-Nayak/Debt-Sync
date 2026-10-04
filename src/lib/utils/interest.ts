import { Debt, Payment } from '../types/database';

/**
 * Standard financial rounding to 2 decimal places (cents / paise).
 */
export function round2(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export interface DebtBalanceCalculation {
  principal: number;
  totalAccruedInterest: number; // 2-decimal rounded for actual ledger calculations; 0 if < 0.01
  rawAccruedInterest: number;   // High-precision float for live continuous compounding ticker animations
  totalPaid: number;
  pendingVerificationPaid?: number;
  disputedPaid?: number;
  currentBalance: number;       // 2-decimal rounded; strictly 0 if settled or balance cleared
  isOverdue?: boolean;
}

/**
 * Calculates current outstanding balance including simple or compound interest.
 * Financial Rule: Only interest accrued at or above 2 decimal places (>= 0.01) is added to actual calculations.
 *
 * @param debt The debt record
 * @param payments List of payments made against this debt
 * @param asOfDate Date up to which to compute interest (default: now)
 */
export function calculateDebtBalance(
  debt: Debt,
  payments: Payment[] = [],
  asOfDate: Date = new Date()
): DebtBalanceCalculation {
  const principal = round2(Number(debt.principal) || 0);
  
  // Helper to identify disputed/rejected repayments
  const isPaymentDisputed = (p: any) =>
    p.status === 'disputed' ||
    (p.is_verified === false && p.verified_at != null) ||
    (typeof p.note === 'string' && p.note.includes('[DISPUTED]'));

  // Only verified payments clear the active balance; unverified, non-disputed payments are pending verification
  const verifiedPayments = payments.filter((p) => (p as any).is_verified === true);
  const pendingPayments = payments.filter(
    (p) => (p as any).is_verified === false && !isPaymentDisputed(p)
  );
  const disputedPayments = payments.filter(isPaymentDisputed);
  
  const totalPaid = round2(verifiedPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
  const pendingVerificationPaid = round2(pendingPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
  const disputedPaid = round2(disputedPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));

  // Declined agreements are void: balance is 0 and no interest accrues
  if (debt.status === 'declined') {
    return {
      principal,
      totalAccruedInterest: 0,
      rawAccruedInterest: 0,
      totalPaid,
      pendingVerificationPaid,
      disputedPaid,
      currentBalance: 0,
    };
  }

  // Settled agreements are completed: balance is 0 and interest is frozen at settled amount
  if (debt.status === 'settled') {
    const interestPaid = Math.max(0, round2(totalPaid - principal));
    return {
      principal,
      totalAccruedInterest: interestPaid,
      rawAccruedInterest: interestPaid,
      totalPaid,
      pendingVerificationPaid,
      disputedPaid,
      currentBalance: 0,
    };
  }

  // Interest-free agreements
  if (debt.interest_type === 'none' || !debt.interest_rate || debt.interest_rate <= 0) {
    let currentBalance = Math.max(0, round2(principal - totalPaid));
    if (currentBalance < 0.01) currentBalance = 0;

    return {
      principal,
      totalAccruedInterest: 0,
      rawAccruedInterest: 0,
      totalPaid,
      pendingVerificationPaid,
      disputedPaid,
      currentBalance,
    };
  }

  const startDate = new Date(debt.created_at);
  const diffTime = Math.max(0, asOfDate.getTime() - startDate.getTime());
  const diffDays = diffTime / (1000 * 60 * 60 * 24);
  const annualRate = (Number(debt.interest_rate) || 0) / 100; // e.g. 5% -> 0.05

  let totalWithInterest = principal;

  if (debt.interest_type === 'simple') {
    // Simple Interest: Total = P * (1 + r * t) where t is in years
    const timeInYears = diffDays / 365;
    totalWithInterest = principal * (1 + annualRate * timeInYears);
  } else if (debt.interest_type === 'compound') {
    // Compound Interest based on compound_freq
    const freq = debt.compound_freq || 'monthly';
    let n = 12; // periods per year
    if (freq === 'daily') n = 365;
    else if (freq === 'weekly') n = 52;
    else if (freq === 'monthly') n = 12;
    else if (freq === 'yearly') n = 1;

    const timeInYears = diffDays / 365;
    // A = P * (1 + r/n)^(n*t)
    totalWithInterest = principal * Math.pow(1 + annualRate / n, n * timeInYears);
  }

  const rawAccruedInterest = Math.max(0, totalWithInterest - principal);
  const roundedInterest = round2(rawAccruedInterest);

  // 2-DECIMAL PLACES RULE:
  // If interest is less than 0.01 (sub-cent / sub-paise fractional accrual), it has NOT materialized
  // into actual currency and is 0 in actual calculations. Only when >= 0.01 is it added to balances.
  const effectiveInterest = roundedInterest >= 0.01 ? roundedInterest : 0;

  let currentBalance = Math.max(0, round2(principal + effectiveInterest - totalPaid));
  // Any residual under 0.01 is treated as settled / cleared
  if (currentBalance < 0.01) {
    currentBalance = 0;
  }

  return {
    principal,
    totalAccruedInterest: effectiveInterest,
    rawAccruedInterest,
    totalPaid,
    pendingVerificationPaid,
    disputedPaid,
    currentBalance,
  };
}

/**
 * Calculates aggregate portfolio metrics from active debts.
 */
export function calculatePortfolioAccrualRates(debts: Debt[]) {
  let dailyInterestGrowth = 0;
  let monthlyInterestGrowth = 0;

  for (const debt of debts) {
    if (debt.status !== 'active') continue;
    if (debt.interest_type === 'none' || !debt.interest_rate) continue;

    const principal = Number(debt.principal) || 0;
    const rate = Number(debt.interest_rate) / 100;

    const annualInterest = principal * rate;
    dailyInterestGrowth += annualInterest / 365;
    monthlyInterestGrowth += annualInterest / 12;
  }

  return {
    dailyInterestGrowth,
    monthlyInterestGrowth,
  };
}

/**
 * Generates projected monthly values for charts (e.g. 12-month trajectory).
 */
export function projectDebtGrowth(
  principal: number,
  interestType: 'none' | 'simple' | 'compound',
  annualRatePercent: number,
  compoundFreq: 'daily' | 'weekly' | 'monthly' | 'yearly' = 'monthly',
  monthsCount: number = 12
): { month: number; principal: number; interest: number; total: number }[] {
  const points = [];
  const r = (annualRatePercent || 0) / 100;

  let n = 12;
  if (compoundFreq === 'daily') n = 365;
  else if (compoundFreq === 'weekly') n = 52;
  else if (compoundFreq === 'monthly') n = 12;
  else if (compoundFreq === 'yearly') n = 1;

  for (let m = 0; m <= monthsCount; m++) {
    const t = m / 12; // time in years
    let total = principal;

    if (interestType === 'none' || r <= 0) {
      total = principal;
    } else if (interestType === 'simple') {
      total = principal * (1 + r * t);
    } else if (interestType === 'compound') {
      total = principal * Math.pow(1 + r / n, n * t);
    }

    const interest = Math.max(0, total - principal);
    points.push({
      month: m,
      principal,
      interest: Math.round(interest * 100) / 100,
      total: Math.round(total * 100) / 100,
    });
  }

  return points;
}

/**
 * Smart bulk payment allocation: Distributes a lump sum prioritizing debts with highest interest rates (Avalanche method).
 */
export function allocateBulkPayment(
  totalPaymentAmount: number,
  debtsWithBalances: { debt: Debt; currentBalance: number }[]
): { debtId: string; amountToPay: number; remainingBalance: number }[] {
  // Sort descending by annual interest rate, highest interest first
  const sorted = [...debtsWithBalances].sort((a, b) => {
    const rateA = a.debt.interest_type === 'none' ? 0 : Number(a.debt.interest_rate) || 0;
    const rateB = b.debt.interest_type === 'none' ? 0 : Number(b.debt.interest_rate) || 0;
    return rateB - rateA;
  });

  let remainingPayment = totalPaymentAmount;
  const allocations = [];

  for (const item of sorted) {
    const itemBalance = round2(item.currentBalance);
    if (remainingPayment <= 0 || itemBalance <= 0) {
      allocations.push({
        debtId: item.debt.id,
        amountToPay: 0,
        remainingBalance: itemBalance,
      });
      continue;
    }

    const payForThisDebt = round2(Math.min(remainingPayment, itemBalance));
    remainingPayment = round2(remainingPayment - payForThisDebt);

    allocations.push({
      debtId: item.debt.id,
      amountToPay: payForThisDebt,
      remainingBalance: round2(Math.max(0, itemBalance - payForThisDebt)),
    });
  }

  return allocations;
}

/**
 * Helper to check if an active debt is overdue.
 */
export function isDebtOverdue(dueDate?: string | null, status?: string): boolean {
  if (!dueDate || status === 'settled' || status === 'declined') return false;
  const now = new Date();
  const due = new Date(dueDate);
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  return dueDay < nowDay;
}

/**
 * Priority order for debt obligations:
 * 1. Overdue debts appear on the very top (urgent repayment action required)
 * 2. Pending debts follow (unaccepted agreements awaiting approval/acceptance)
 * 3. Active debts follow, sorted by date (newest first)
 * 4. Disputed debts
 * 5. Settled debts
 * 6. Declined debts
 */
export const DEBT_STATUS_PRIORITY: Record<string, number> = {
  pending: 1,
  active: 2,
  disputed: 3,
  settled: 4,
  declined: 5,
};

export function sortDebtsActiveFirst<T extends Pick<Debt, 'status' | 'created_at'> & { due_date?: string | null; settled_at?: string | null }>(
  debtsList: T[]
): T[] {
  return [...debtsList].sort((a, b) => {
    const aOverdue = a.status === 'active' && isDebtOverdue(a.due_date, a.status);
    const bOverdue = b.status === 'active' && isDebtOverdue(b.due_date, b.status);

    // 1. Overdue debts appear at the top-most
    if (aOverdue && !bOverdue) return -1;
    if (!aOverdue && bOverdue) return 1;
    if (aOverdue && bOverdue) {
      const dateA = a.due_date ? new Date(a.due_date).getTime() : 0;
      const dateB = b.due_date ? new Date(b.due_date).getTime() : 0;
      if (dateA !== dateB) return dateA - dateB; // earliest due date (most overdue) first
    }

    // 2. Status priority: pending (1) -> active (2) -> disputed (3) -> settled (4) -> declined (5)
    const pA = DEBT_STATUS_PRIORITY[a.status] ?? 99;
    const pB = DEBT_STATUS_PRIORITY[b.status] ?? 99;
    if (pA !== pB) return pA - pB;

    // 3. Within same priority, sort by created_at descending (newest on top)
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export function sortPaymentsPendingFirst<T extends Pick<Payment, 'created_at'> & { is_verified?: boolean }>(paymentsList: T[]): T[] {
  return [...paymentsList].sort((a, b) => {
    const isAPending = a.is_verified === false;
    const isBPending = b.is_verified === false;
    if (isAPending && !isBPending) return -1;
    if (!isAPending && isBPending) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}
