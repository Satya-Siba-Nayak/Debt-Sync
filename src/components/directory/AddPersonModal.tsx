'use client';

import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { createClient } from '@/lib/supabase/client';
import { findProfileByIdentifier } from '@/lib/utils/profile-lookup';

interface AddPersonModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPersonAdded?: () => void;
}

export function AddPersonModal({
  isOpen,
  onClose,
  onPersonAdded,
}: AddPersonModalProps) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not logged in');

      const targetEmail = email.trim().toLowerCase();
      if (!targetEmail) throw new Error('Email is required');

      // Check if user already exists across primary email, secondary emails, or phone
      const existingProfile = await findProfileByIdentifier(targetEmail) || (phone.trim() ? await findProfileByIdentifier(phone.trim()) : null);

      let contactId = existingProfile?.id;

      if (!contactId) {
        // Create shadow profile
        contactId = crypto.randomUUID();
        const { error: profileError } = await supabase.from('profiles').insert({
          id: contactId,
          email: targetEmail,
          full_name: fullName.trim() || targetEmail.split('@')[0],
          phone: phone.trim() || null,
          is_shadow: true,
        });

        if (profileError) throw profileError;
      }

      // Add contact entry
      const { error: contactError } = await supabase.from('contacts').insert({
        owner_id: user.id,
        contact_id: contactId,
        nickname: nickname.trim() || fullName.trim() || null,
      });

      if (contactError) {
        if (contactError.code === '23505') {
          throw new Error('This person is already in your contacts');
        }
        throw contactError;
      }

      setFullName('');
      setEmail('');
      setPhone('');
      setNickname('');
      onPersonAdded?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to add person');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add New Person"
      subtitle="Invite a new contact to start tracking shared peer expenses"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-[var(--error)] text-sm border border-[var(--error)]/20">
            {error}
          </div>
        )}

        <div>
          <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] block mb-1.5">
            Full Name
          </label>
          <input
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Sarah Jenkins"
            className="w-full px-4 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)]"
          />
        </div>

        <div>
          <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] block mb-1.5">
            Email Address
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="e.g. sarah@example.com"
            className="w-full px-4 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)]"
          />
        </div>

        <div>
          <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] block mb-1.5">
            Phone Number <span className="normal-case text-[var(--outline)]">(optional, for record)</span>
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98765 43210"
            className="w-full px-4 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)]"
          />
        </div>

        <div>
          <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] block mb-1.5">
            Nickname / Tag <span className="normal-case text-[var(--outline)]">(optional)</span>
          </label>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="e.g. Roommate, Project Partner"
            className="w-full px-4 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-sm outline-none focus:border-[var(--primary)]"
          />
        </div>

        <div className="pt-4 border-t border-[var(--outline-variant)]/20 flex gap-3">
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
            className="flex-1 py-2.5 px-4 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-95 disabled:opacity-50"
          >
            {loading ? 'Adding...' : 'Add Person'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
