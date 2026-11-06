import { Debt, Payment } from '@/lib/types/database';
import { calculateDebtBalance } from './interest';

/**
 * Detects any active debts whose verified payments have cleared the balance (<= 0.01),
 * updates them to 'settled' in Supabase, and inserts an audit log entry.
 * Returns the array of debt IDs that were updated.
 */
export async function autoSettleClearedDebts(
  supabase: any,
  debts: Debt[],
  payments: Payment[]
): Promise<string[]> {
  if (!debts || debts.length === 0) return [];

  const settledIds: string[] = [];
  const nowIso = new Date().toISOString();

  for (const d of debts) {
    if (d.status === 'active') {
      const dPayments = (payments || []).filter((p) => p.debt_id === d.id);
      const calc = calculateDebtBalance(d, dPayments);
      if (calc.currentBalance <= 0.01) {
        settledIds.push(d.id);
      }
    }
  }

  if (settledIds.length === 0) return [];

  try {
    const { error: updErr } = await supabase
      .from('debts')
      .update({
        status: 'settled',
        settled_at: nowIso,
        updated_at: nowIso,
      })
      .in('id', settledIds);

    if (updErr) {
      console.warn('Auto-settle update warning:', updErr.message);
    }

    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id;
    if (userId) {
      for (const debtId of settledIds) {
        await supabase
          .from('activity_log')
          .insert({
            user_id: userId,
            debt_id: debtId,
            action: 'debt_settled',
            details: {
              reason: 'Zero balance remaining - automatically settled in full',
              settled_at: nowIso,
            },
          })
          .then(() => {}, () => {});
      }
    }
  } catch (err) {
    console.warn('Auto-settle background sync warning:', err);
  }

  return settledIds;
}
