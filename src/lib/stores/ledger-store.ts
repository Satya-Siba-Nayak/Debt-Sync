'use client';

import { Debt, Payment } from '../types/database';
import { calculateDebtBalance, calculatePortfolioAccrualRates, isDebtPurgedByAdmin, round2 } from '../utils/interest';
import { invalidateServerTrustCache } from '../utils/trust-score';

export interface LedgerCacheData {
  userId: string;
  debts: Debt[];
  payments: Payment[];
  contacts?: any[];
  people?: any[];
  currency: string;
  timestamp: number;
}

export function computeDashboardStats(allDebts: Debt[], allPayments: Payment[], userId: string) {
  let lentSum = 0;
  let owedSum = 0;
  let lentCount = 0;
  let owedCount = 0;
  let lenderInterestSum = 0;
  let borrowerInterestSum = 0;

  for (const d of allDebts) {
    if (
      d.status === 'settled' ||
      d.status === 'declined' ||
      d.status === 'pending' ||
      d.status === 'purged' ||
      isDebtPurgedByAdmin(d)
    ) {
      continue;
    }

    const debtPayments = allPayments.filter((p) => p.debt_id === d.id);
    const calc = calculateDebtBalance(d, debtPayments);

    if (d.lender_id === userId) {
      lentSum += calc.currentBalance;
      lentCount++;
      lenderInterestSum += calc.totalAccruedInterest;
    } else {
      owedSum += calc.currentBalance;
      owedCount++;
      borrowerInterestSum += calc.totalAccruedInterest;
    }
  }

  const rates = calculatePortfolioAccrualRates(
    allDebts.filter((d) => d.lender_id === userId)
  );

  return {
    totalLent: round2(lentSum),
    totalOwed: round2(owedSum),
    netPosition: round2(lentSum - owedSum),
    activeLentCount: lentCount,
    activeOwedCount: owedCount,
    totalInterestAccrued: round2(lenderInterestSum),
    borrowingInterestAccrued: round2(borrowerInterestSum),
    dailyAccrualRate: rates.dailyInterestGrowth,
  };
}

// In-memory hot cache for frame-0 instant navigation
let memoryCache: LedgerCacheData | null = null;

const CACHE_KEY = 'debtsync_ledger_cache_v2';
const CACHE_TTL_MS = 60 * 1000; // 1 minute fresh TTL before soft background revalidation

export function getLedgerCache(userId?: string | null): LedgerCacheData | null {
  if (memoryCache && (!userId || memoryCache.userId === userId)) {
    return memoryCache;
  }

  if (typeof window === 'undefined') return null;

  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed: LedgerCacheData = JSON.parse(raw);
      if (!userId || parsed.userId === userId) {
        memoryCache = parsed;
        return parsed;
      }
    }
  } catch (_) {}

  return null;
}

export function setLedgerCache(data: LedgerCacheData): void {
  // Preserve cached people list if new data doesn't supply it
  if (!data.people && memoryCache?.people && memoryCache.userId === data.userId) {
    data.people = memoryCache.people;
  }
  memoryCache = data;
  if (typeof window === 'undefined') return;

  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (_) {}
}

export function invalidateLedgerCache(): void {
  memoryCache = null;
  invalidateServerTrustCache();
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch (_) {}
}

/**
 * Checks if cache is fresh enough to skip background re-fetch if needed.
 */
export function isCacheFresh(cache: LedgerCacheData | null): boolean {
  if (!cache) return false;
  return Date.now() - cache.timestamp < CACHE_TTL_MS;
}
