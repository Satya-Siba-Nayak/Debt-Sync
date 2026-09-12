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
  
  // Only verified payments clear the active balance; unverified payments are pending verification
  const verifiedPayments = payments.filter((p) => (p as any).is_verified !== false);
  const pendingPayments = payments.filter((p) => (p as any).is_verified === false);
  
  const totalPaid = round2(verifiedPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
  const pendingVerificationPaid = round2(pendingPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));

  // Declined agreements are void: balance is 0 and no interest accrues
  if (debt.status === 'declined') {
    return {
      principal,
      totalAccruedInterest: 0,
      rawAccruedInterest: 0,
      totalPaid,
      pendingVerificationPaid,
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
