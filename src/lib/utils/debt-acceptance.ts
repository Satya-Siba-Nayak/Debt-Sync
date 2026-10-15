import { SupabaseClient } from '@supabase/supabase-js';
import { invalidateCooldownCache } from './debt-cooldown';
import { invalidateLedgerCache } from '../stores/ledger-store';

export interface DebtResponseResult {
  success: boolean;
  status: 'active' | 'declined';
  error?: string;
}

/**
 * Responds to a pending debt agreement (accept or decline).
 * - On 'active' acceptance: Adds both parties as mutual contacts in the contacts table,
 *   and marks any pending contact requests between them as accepted.
 * - On 'declined': Records the rejection and, if no other active/settled debts exist,
 *   ensures they are not in each other's contacts.
 */
export async function respondToDebtAgreement(
  supabase: SupabaseClient,
  debtId: string,
  decision: 'active' | 'declined'
): Promise<DebtResponseResult> {
  try {
    // 1. Try secure RPC accept_debt
    let rpcSuccess = false;
    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('accept_debt', {
        p_debt_id: debtId,
        p_decision: decision,
      });
      if (!rpcErr && rpcRes && rpcRes.success) {
        rpcSuccess = true;
      }
    } catch (_) {}

    // 2. Client fallback if RPC not present or fails
    if (!rpcSuccess) {
      const { data: debt, error: fetchErr } = await supabase
        .from('debts')
        .select('id, lender_id, borrower_id, created_by')
        .eq('id', debtId)
        .single();

      if (fetchErr || !debt) {
        throw new Error('Debt agreement not found');
      }

      const { error: updateErr } = await supabase
        .from('debts')
        .update({
          status: decision,
          accepted_at: decision === 'active' ? new Date().toISOString() : null,
        })
        .eq('id', debtId);

      if (updateErr) throw updateErr;

      const { data: { user } } = await supabase.auth.getUser();
      const currentUserId = user?.id || debt.borrower_id;

      try {
        await supabase.from('activity_log').insert({
          user_id: currentUserId,
          debt_id: debt.id,
          action: decision === 'active' ? 'debt_accepted' : 'debt_declined',
          details: { decision },
        });
      } catch (_) {}

      // Manage mutual contacts
      if (debt.lender_id && debt.borrower_id && debt.lender_id !== debt.borrower_id) {
        if (decision === 'active') {
          // Add mutual contacts upon acceptance
          await supabase.from('contacts').upsert([
            { owner_id: debt.lender_id, contact_id: debt.borrower_id },
            { owner_id: debt.borrower_id, contact_id: debt.lender_id },
          ], { onConflict: 'owner_id,contact_id' });

          // Auto-accept any pending contact request between them
          try {
            await supabase
              .from('contact_requests')
              .update({ status: 'accepted', responded_at: new Date().toISOString() })
              .or(
                `and(sender_id.eq.${debt.lender_id},recipient_id.eq.${debt.borrower_id}),and(sender_id.eq.${debt.borrower_id},recipient_id.eq.${debt.lender_id})`
              )
              .eq('status', 'pending');
          } catch (_) {}
        } else {
          // Check if other active/settled debts exist
          const { data: existingActive } = await supabase
            .from('debts')
            .select('id')
            .neq('id', debtId)
            .or(
              `and(lender_id.eq.${debt.lender_id},borrower_id.eq.${debt.borrower_id}),and(lender_id.eq.${debt.borrower_id},borrower_id.eq.${debt.lender_id})`
            )
            .in('status', ['active', 'settled'])
            .limit(1);

          if (!existingActive || existingActive.length === 0) {
            await supabase
              .from('contacts')
              .delete()
              .or(
                `and(owner_id.eq.${debt.lender_id},contact_id.eq.${debt.borrower_id}),and(owner_id.eq.${debt.borrower_id},contact_id.eq.${debt.lender_id})`
              );
          }
        }
      }
    }

    // Invalidate permission & ledger caches
    invalidateCooldownCache();
    invalidateLedgerCache();

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('debtsync:refresh'));
    }

    return { success: true, status: decision };
  } catch (err: any) {
    console.error('Error responding to debt agreement:', err);
    throw err;
  }
}

/**
 * Allows the creator of a pending debt agreement to take it back (cancel before acceptance).
 */
export async function cancelPendingDebt(
  supabase: SupabaseClient,
  debtId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Try secure RPC cancel_pending_debt
    let rpcSuccess = false;
    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('cancel_pending_debt', {
        p_debt_id: debtId,
      });
      if (!rpcErr && rpcRes && rpcRes.success) {
        rpcSuccess = true;
      }
    } catch (_) {}

    // 2. Client fallback
    if (!rpcSuccess) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const currentUserId = user?.id;

      const { data: debt, error: fetchErr } = await supabase
        .from('debts')
        .select('*')
        .eq('id', debtId)
        .single();

      if (fetchErr || !debt) {
        throw new Error('Transaction record not found.');
      }

      if (debt.status !== 'pending') {
        throw new Error('Only pending transactions that have not yet been accepted can be taken back.');
      }

      // Delete payments attached to this debt if any
      await supabase.from('payments').delete().eq('debt_id', debtId);

      // Attempt delete of debt
      const { error: delErr } = await supabase.from('debts').delete().eq('id', debtId);
      if (delErr) {
        // If delete fails due to RLS, set status to declined and hide
        const existingHidden = Array.isArray(debt.hidden_by) ? debt.hidden_by : [];
        const nextHidden =
          currentUserId && !existingHidden.includes(currentUserId)
            ? [...existingHidden, currentUserId]
            : existingHidden;

        await supabase
          .from('debts')
          .update({
            status: 'declined',
            hidden_by: nextHidden,
          })
          .eq('id', debtId);
      }

      // Log in activity log (pass debt_id: null if debt row was deleted to avoid FK 23503 error)
      if (currentUserId) {
        try {
          await supabase.from('activity_log').insert({
            user_id: currentUserId,
            debt_id: delErr ? debtId : null,
            action: 'debt_cancelled_by_creator',
            details: {
              debt_id: debtId,
              principal: debt.principal,
              currency: debt.currency,
              lender_id: debt.lender_id,
              borrower_id: debt.borrower_id,
              timestamp: new Date().toISOString(),
            },
          });
        } catch (_) {}
      }
    }

    invalidateCooldownCache();
    invalidateLedgerCache();

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('debtsync:refresh'));
    }

    return { success: true };
  } catch (err: any) {
    console.error('Error cancelling pending debt:', err);
    throw err;
  }
}
