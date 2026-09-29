'use client';

import React from 'react';
import Link from 'next/link';
import { formatCurrency } from '@/lib/utils/currency';
import { Chip } from '../ui/Chip';
import { Avatar } from '../ui/Avatar';
import { detectUPIApp } from '@/lib/utils/upi-link';

export interface PersonSummary {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  avatarUrl?: string | null;
  netBalance: number; // positive = they owe you, negative = you owe them
  lentAmount: number;
  owedAmount: number;
  status: 'active' | 'settled' | 'pending';
  isShadow?: boolean;
  trustScore?: number;
  trustRating?: string;
  upiId?: string | null;
  secondaryEmails?: string[];
  notes?: string[];
  matchingNote?: string;
}

interface PersonCardProps {
  person: PersonSummary;
  currency?: string;
  onRecordDebt?: (personId: string) => void;
}

export function PersonCard({ person, currency = 'inr', onRecordDebt }: PersonCardProps) {
  const isNetPositive = person.netBalance > 0;
  const isNetNegative = person.netBalance < 0;
  const isSettled = person.netBalance === 0;

  return (
    <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-5 border border-[var(--outline-variant)]/30 flex flex-col justify-between hover:shadow-md transition-shadow relative">
      <div>
        {/* Header: Avatar, Name & Status */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <Avatar src={person.avatarUrl} name={person.name} size="md" />
            <div>
              <Link
                href={`/directory/detail?id=${person.id}`}
                className="font-heading font-bold text-base text-[var(--on-surface)] hover:text-[var(--primary)] transition-colors line-clamp-1"
              >
                {person.name}
              </Link>
              <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                <Chip
                  label={
                    person.status === 'active'
                      ? 'Active Debt'
                      : person.status === 'pending'
                      ? 'Pending'
                      : 'Settled'
                  }
                  variant={
                    person.status === 'active'
                      ? 'active'
                      : person.status === 'pending'
                      ? 'pending'
                      : 'settled'
                  }
                />
                {person.trustScore && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--surface-container)] border border-[var(--outline-variant)]/20 font-mono text-[11px] font-bold text-[var(--on-surface)]"
                    title={`Network Trust Score: ${person.trustScore} (${person.trustRating || 'Good'})`}
                  >
                    <span className="material-symbols-outlined text-[13px] text-[var(--primary)]">verified_user</span>
                    <span>{person.trustScore}</span>
                  </span>
                )}
                {person.upiId && (() => {
                  const detected = detectUPIApp(person.upiId);
                  return (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--primary)]/10 border border-[var(--primary)]/20 font-mono text-[10px] font-bold text-[var(--primary)]"
                      title={`UPI ID: ${person.upiId} (${detected.name})`}
                    >
                      <span className="material-symbols-outlined text-[12px]">{detected.icon}</span>
                      <span>{detected.shortName}</span>
                    </span>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>

        {/* Contact Info (phone + email) */}
        <div className="space-y-1 text-xs font-mono text-[var(--on-surface-variant)] mb-5">
          {person.phone && (
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[15px] text-[var(--outline)]">
                call
              </span>
              <span>{person.phone}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[15px] text-[var(--outline)]">
              mail
            </span>
            <span className="truncate">{person.email}</span>
          </div>
          {person.secondaryEmails && person.secondaryEmails.length > 0 && (
            <div className="flex items-center gap-2 text-[11px] text-[var(--outline)] pt-0.5">
              <span className="material-symbols-outlined text-[14px]">school</span>
              <span className="truncate">{person.secondaryEmails.join(', ')}</span>
            </div>
          )}
        </div>

        {person.matchingNote && (
          <div className="mb-4 px-3 py-2 rounded-xl bg-[var(--surface-container)] text-xs text-[var(--on-surface-variant)] flex items-center gap-2 border border-[var(--outline-variant)]/30">
            <span className="material-symbols-outlined text-[15px] text-[var(--primary)] shrink-0">
              sticky_note_2
            </span>
            <span className="truncate italic">"{person.matchingNote}"</span>
          </div>
        )}
      </div>

      {/* Bottom Net Balance Box matching Stitch */}
      <div className="bg-[var(--surface-container-low)] rounded-xl p-3.5 border border-[var(--outline-variant)]/20">
        <div className="flex items-baseline justify-between mb-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--on-surface-variant)] font-semibold">
            {person.status === 'pending' ? 'Proposed Balance' : 'Net Balance'}
          </span>

          <div
            className={`font-mono text-base font-bold flex items-center ${
              isNetPositive
                ? 'text-[var(--secondary)]'
                : isNetNegative
                ? 'text-[var(--error)]'
                : 'text-[var(--on-surface-variant)]'
            }`}
          >
            {isNetPositive && <span className="mr-0.5">+</span>}
            {isNetNegative && <span className="mr-0.5">-</span>}
            {formatCurrency(Math.abs(person.netBalance), currency, { showDecimals: true })}
          </div>
        </div>

        {person.status === 'pending' ? (
          <div className="flex justify-between items-center text-[11px] font-mono text-[var(--on-surface-variant)] pt-2 border-t border-[var(--outline-variant)]/10">
            <span>Awaiting confirmation</span>
            <button
              onClick={() => onRecordDebt?.(person.id)}
              className="text-[var(--primary)] font-bold hover:underline"
            >
              Add Debt
            </button>
          </div>
        ) : isSettled ? (
          <div className="flex justify-between items-center text-[11px] font-mono text-[var(--on-surface-variant)] pt-2 border-t border-[var(--outline-variant)]/10">
            <span>Historical Volume:</span>
            <span className="font-semibold text-[var(--on-surface)]">
              {formatCurrency(person.lentAmount + person.owedAmount, currency)}
            </span>
          </div>
        ) : (
          <div className="flex justify-between items-center text-[11px] font-mono text-[var(--on-surface-variant)] pt-2 border-t border-[var(--outline-variant)]/10">
            <span>Lent: {formatCurrency(person.lentAmount, currency)}</span>
            <span>Owed: {formatCurrency(person.owedAmount, currency)}</span>
          </div>
        )}

        <div className="mt-3 pt-2 border-t border-[var(--outline-variant)]/20 flex gap-2">
          <Link
            href={`/directory/detail?id=${person.id}`}
            className="flex-1 py-1.5 px-2 bg-[var(--surface-container-lowest)] hover:bg-[var(--surface-container)] rounded-lg text-center font-mono text-xs font-semibold text-[var(--on-surface)] transition-colors border border-[var(--outline-variant)]/20"
          >
            Ledger
          </Link>
          <button
            onClick={() => onRecordDebt?.(person.id)}
            className="py-1.5 px-3 bg-[var(--primary)] text-[var(--on-primary)] rounded-lg font-mono text-xs font-bold hover:opacity-90 transition-opacity"
            title="Record Debt with this person"
          >
            + Debt
          </button>
        </div>
      </div>
    </div>
  );
}
