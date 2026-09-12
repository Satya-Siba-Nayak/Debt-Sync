'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { PhoneInput } from '../ui/PhoneInput';
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
  const [successMessage, setSuccessMessage] = useState('');
  const [defaultCountryCode, setDefaultCountryCode] = useState('+91');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('debtsync_default_country_code');
      if (saved) setDefaultCountryCode(saved);
    }
  }, [isOpen]);

  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not logged in');

      const targetEmail = email.trim().toLowerCase();
      if (!targetEmail) throw new Error('Email is required');

      const cleanPhone = phone.trim();
      const phoneDigits = cleanPhone.replace(/[^\d]/g, '');
      if (!cleanPhone || phoneDigits.length < 7) {
        throw new Error('Primary phone number is compulsory for every person/counterparty.');
      }

      if (targetEmail === user.email?.toLowerCase()) {
        throw new Error('You cannot add your own account as a contact');
      }

      // Check if user already exists across primary email, secondary emails, or phone
      const existingProfile = await findProfileByIdentifier(targetEmail) || await findProfileByIdentifier(cleanPhone);

      // If user is already on the platform, send a contact connection request nudge
      if (existingProfile && !existingProfile.is_shadow && existingProfile.id !== user.id) {
        // Check if already in contacts
        const { data: alreadyContact } = await supabase
          .from('contacts')
          .select('id')
          .eq('owner_id', user.id)
          .eq('contact_id', existingProfile.id)
          .maybeSingle();

        if (alreadyContact) {
          throw new Error(`${existingProfile.full_name || 'This user'} is already in your contacts directory`);
        }

        // Send contact request
        const { error: reqErr } = await supabase
          .from('contact_requests')
          .upsert({
            sender_id: user.id,
            receiver_id: existingProfile.id,
            status: 'pending',
          }, { onConflict: 'sender_id,receiver_id' });

        if (reqErr) {
          throw new Error('Connection request could not be sent: ' + reqErr.message);
        }

        setSuccessMessage(
          `Connection request sent to ${existingProfile.full_name || existingProfile.email}! They will receive a notification nudge to connect.`
        );
        setTimeout(() => {
          setFullName('');
          setEmail('');
          setPhone('');
          setNickname('');
          setSuccessMessage('');
          onPersonAdded?.();
          onClose();
        }, 2200);
        return;
      }

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
        {successMessage && (
          <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-mono border border-emerald-500/30">
            {successMessage}
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
          <label className="font-mono text-xs tracking-wider uppercase text-[var(--on-surface-variant)] block mb-1.5 font-semibold">
            Phone Number <span className="normal-case text-[var(--primary)] font-semibold">(compulsory primary contact)</span>
          </label>
          <PhoneInput
            value={phone}
            onChange={setPhone}
            defaultCountryCode={defaultCountryCode}
            required
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
