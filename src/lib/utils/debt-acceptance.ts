import { SupabaseClient } from '@supabase/supabase-js';
import { invalidateCooldownCache } from './debt-cooldown';

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
          await supabase
            .from('contact_requests')
            .update({ status: 'accepted', responded_at: new Date().toISOString() })
            .or(
              `and(sender_id.eq.${debt.lender_id},receiver_id.eq.${debt.borrower_id}),and(sender_id.eq.${debt.borrower_id},receiver_id.eq.${debt.lender_id})`
            )
            .eq('status', 'pending');
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

    // Invalidate permission cache
    invalidateCooldownCache();

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('debtsync:refresh'));
    }

    return { success: true, status: decision };
  } catch (err: any) {
    console.error('Error responding to debt agreement:', err);
    throw err;
  }
}
