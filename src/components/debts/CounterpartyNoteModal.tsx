'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { createClient } from '@/lib/supabase/client';
import { Debt } from '@/lib/types/database';

interface CounterpartyNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  debt: Debt;
  currentUserId: string;
  onNoteUpdated?: () => void;
}

export function CounterpartyNoteModal({
  isOpen,
  onClose,
  debt,
  currentUserId,
  onNoteUpdated,
}: CounterpartyNoteModalProps) {
  const supabase = React.useMemo(() => createClient(), []);
  const isCreator = debt.created_by === currentUserId;

  const [creatorNote, setCreatorNote] = useState(debt.notes || '');
  const [counterpartyNote, setCounterpartyNote] = useState(debt.counterparty_notes || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const prevIsOpenRef = React.useRef(false);
  const prevDebtIdRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      prevIsOpenRef.current = false;
      return;
    }

    const isJustOpening = !prevIsOpenRef.current;
    const isDifferentDebt = prevDebtIdRef.current !== debt.id;

    if (isJustOpening || isDifferentDebt) {
      setCreatorNote(debt.notes || '');
      setCounterpartyNote(debt.counterparty_notes || '');
      setError('');
      prevDebtIdRef.current = debt.id;
    }

    prevIsOpenRef.current = true;
  }, [debt.id, isOpen]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const updates: Partial<Debt> = {};
      if (isCreator) {
        updates.notes = creatorNote.trim() || null;
      } else {
        updates.counterparty_notes = counterpartyNote.trim() || null;
      }

      const { error: updateError } = await supabase
        .from('debts')
        .update(updates)
        .eq('id', debt.id);

      if (updateError) throw updateError;

      // Log note update in activity log for audit transparency
      await supabase.from('activity_log').insert({
        user_id: currentUserId,
        debt_id: debt.id,
        action: isCreator ? 'creator_note_updated' : 'counterparty_note_updated',
        details: {
          note_type: isCreator ? 'creator' : 'counterparty',
          content: isCreator ? creatorNote.trim() : counterpartyNote.trim(),
        },
      });

      window.dispatchEvent(new CustomEvent('debtsync:refresh'));
      onNoteUpdated?.();
      onClose();
    } catch (err: any) {
      console.error('Error updating note:', err);
      setError(err.message || 'Failed to update note');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Transaction Notes"
      subtitle="Transparent 2-sided notes for both lender & borrower"
      maxWidth="max-w-lg"
    >
      <form onSubmit={handleSave} className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-[var(--error)] text-sm border border-[var(--error)]/20">
            {error}
          </div>
        )}

        {/* Side 1: Creator Note */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[15px] text-[var(--primary)]">
                edit_note
              </span>
              <span>Creator's Note</span>
              {isCreator && (
                <span className="text-[10px] text-[var(--primary)] bg-[var(--primary)]/10 px-1.5 py-0.5 rounded font-mono">
                  You
                </span>
              )}
            </label>
          </div>

          {isCreator ? (
            <textarea
              value={creatorNote}
              onChange={(e) => setCreatorNote(e.target.value)}
              rows={3}
              placeholder="e.g. Dinner split, loan for textbooks, Uber ride..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)]"
            />
          ) : (
            <div className="p-3 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/20 text-xs text-[var(--on-surface)] italic">
              {debt.notes ? `"${debt.notes}"` : <span className="text-[var(--outline)] not-italic">No note added by creator.</span>}
            </div>
          )}
        </div>

        {/* Side 2: Counterparty Note */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[15px] text-[var(--secondary)]">
                quick_reference_all
              </span>
              <span>Counterparty's Note</span>
              {!isCreator && (
                <span className="text-[10px] text-[var(--secondary)] bg-[var(--secondary)]/10 px-1.5 py-0.5 rounded font-mono">
                  You
                </span>
              )}
            </label>
          </div>

          {!isCreator ? (
            <textarea
              value={counterpartyNote}
              onChange={(e) => setCounterpartyNote(e.target.value)}
              rows={3}
              placeholder="e.g. Paid via GPay ref #849102, Trip share settled partly..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--secondary)]"
            />
          ) : (
            <div className="p-3 rounded-xl bg-[var(--surface-container-low)] border border-[var(--outline-variant)]/20 text-xs text-[var(--on-surface)] italic">
              {debt.counterparty_notes ? (
                `"${debt.counterparty_notes}"`
              ) : (
                <span className="text-[var(--outline)] not-italic">
                  No note added by counterparty yet.
                </span>
              )}
            </div>
          )}
        </div>

        <div className="pt-3 border-t border-[var(--outline-variant)]/20 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-xl border border-[var(--outline-variant)]/40 font-mono text-xs font-semibold text-[var(--on-surface)] hover:bg-[var(--surface-container)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-2.5 px-4 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">save</span>
            <span>{loading ? 'Saving...' : 'Save Note'}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}
