'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Debt, Payment } from '@/lib/types/database';
import { calculateDebtBalance } from '@/lib/utils/interest';
import { formatCurrency } from '@/lib/utils/currency';
import { PersonCard, PersonSummary } from '@/components/directory/PersonCard';
import { AddPersonModal } from '@/components/directory/AddPersonModal';
import { RecordDebtModal } from '@/components/debts/RecordDebtModal';

export default function PeopleDirectoryPage() {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState('inr');
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'active' | 'settled'>('all');

  // Modal states
  const [isAddPersonOpen, setIsAddPersonOpen] = useState(false);
  const [selectedPersonForDebt, setSelectedPersonForDebt] = useState<string | null>(null);

  const fetchDirectoryData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Settings
      const { data: settings } = await supabase
        .from('user_settings')
        .select('default_currency')
        .eq('user_id', user.id)
        .single();
      if (settings?.default_currency) setCurrency(settings.default_currency);

      // Contacts
      const { data: contactRows } = await supabase
        .from('contacts')
        .select(`
          contact_id, nickname,
          profile:profiles!contacts_contact_id_fkey(id, email, full_name, phone, is_shadow)
        `)
        .eq('owner_id', user.id);

      // Debts involving user
      const { data: debtRows } = await supabase
        .from('debts')
        .select(`
          *,
          lender:profiles!debts_lender_id_fkey(id, email, full_name, phone, is_shadow),
          borrower:profiles!debts_borrower_id_fkey(id, email, full_name, phone, is_shadow)
        `)
        .or(`lender_id.eq.${user.id},borrower_id.eq.${user.id}`);

      // Payments
      const { data: paymentRows } = await supabase
        .from('payments')
        .select('*');

      const allDebts: Debt[] = (debtRows as any) || [];
      const allPayments: Payment[] = (paymentRows as any) || [];

      // Collect all counterparties (from contacts + from debts)
      const peopleMap = new Map<string, PersonSummary>();

      // Initialize from contacts
      if (contactRows) {
        for (const c of contactRows as any[]) {
          if (!c.profile) continue;
          peopleMap.set(c.contact_id, {
            id: c.contact_id,
            name: c.nickname || c.profile.full_name || c.profile.email,
            email: c.profile.email,
            phone: c.profile.phone,
            netBalance: 0,
            lentAmount: 0,
            owedAmount: 0,
            status: c.profile.is_shadow ? 'pending' : 'settled',
            isShadow: c.profile.is_shadow,
          });
        }
      }

      // Add counterparties from debts and calculate balances
      for (const d of allDebts) {
        const isLender = d.lender_id === user.id;
        const otherParty = isLender ? d.borrower : d.lender;
        if (!otherParty) continue;

        if (!peopleMap.has(otherParty.id)) {
          peopleMap.set(otherParty.id, {
            id: otherParty.id,
            name: otherParty.full_name || otherParty.email,
            email: otherParty.email,
            phone: otherParty.phone,
            netBalance: 0,
            lentAmount: 0,
            owedAmount: 0,
            status: otherParty.is_shadow ? 'pending' : 'settled',
            isShadow: otherParty.is_shadow,
          });
        }

        const person = peopleMap.get(otherParty.id)!;
        const debtPayments = allPayments.filter((p) => p.debt_id === d.id);
        const calc = calculateDebtBalance(d, debtPayments);

        if (d.status === 'pending') {
          person.status = 'pending';
        } else if (d.status === 'active' && calc.currentBalance > 0) {
          person.status = 'active';
        }

        if (isLender) {
          // User lent to person -> person owes user
          person.lentAmount += calc.currentBalance;
          person.netBalance += calc.currentBalance;
        } else {
          // User borrowed from person -> user owes person
          person.owedAmount += calc.currentBalance;
          person.netBalance -= calc.currentBalance;
        }
      }

      setPeople(Array.from(peopleMap.values()));
    } catch (err) {
      console.error('Error loading directory:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchDirectoryData();
  }, [fetchDirectoryData]);

  // Aggregate stats across contacts
  const totalContacts = people.length;
  const activeDebtsCount = people.filter((p) => p.status === 'active').length;
  const totalOwedToYou = people.reduce((sum, p) => sum + (p.netBalance > 0 ? p.netBalance : 0), 0);
  const totalYouOwe = people.reduce((sum, p) => sum + (p.netBalance < 0 ? Math.abs(p.netBalance) : 0), 0);

  // Filter & Search
  const filteredPeople = people
    .filter((p) => {
      if (filterTab === 'active') return p.status === 'active';
      if (filterTab === 'settled') return p.status === 'settled';
      return true;
    })
    .filter((p) => {
      const q = searchQuery.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        (p.phone && p.phone.includes(q))
      );
    })
    .sort((a, b) => Math.abs(b.netBalance) - Math.abs(a.netBalance));

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Page Title */}
      <div>
        <h1 className="font-heading text-2xl md:text-3xl font-bold text-[var(--on-surface)]">
          People Directory
        </h1>
        <p className="font-mono text-xs text-[var(--on-surface-variant)] mt-1">
          Manage your contacts and track combined net balances across all ledgers
        </p>
      </div>

      {/* Top Stats Bento Row */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-5 border border-[var(--outline-variant)]/30">
          <span className="font-mono text-xs text-[var(--on-surface-variant)] uppercase tracking-wider font-semibold">
            Total Contacts
          </span>
          <div className="font-heading text-2xl md:text-3xl font-bold text-[var(--on-surface)] mt-2">
            {totalContacts}
          </div>
        </div>

        <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-5 border border-[var(--outline-variant)]/30">
          <span className="font-mono text-xs text-[var(--on-surface-variant)] uppercase tracking-wider font-semibold">
            Active Debt
          </span>
          <div className="font-heading text-2xl md:text-3xl font-bold text-[var(--on-surface)] mt-2">
            {activeDebtsCount}
          </div>
        </div>

        <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-5 border border-[var(--outline-variant)]/30">
          <span className="font-mono text-xs text-[var(--on-surface-variant)] uppercase tracking-wider font-semibold">
            Total Owed To You
          </span>
          <div className="font-heading text-2xl md:text-3xl font-bold text-[var(--secondary)] mt-2">
            {formatCurrency(totalOwedToYou, currency, { showDecimals: true })}
          </div>
        </div>

        <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-5 border border-[var(--outline-variant)]/30">
          <span className="font-mono text-xs text-[var(--on-surface-variant)] uppercase tracking-wider font-semibold">
            Total You Owe
          </span>
          <div className="font-heading text-2xl md:text-3xl font-bold text-[var(--error)] mt-2">
            {formatCurrency(totalYouOwe, currency, { showDecimals: true })}
          </div>
        </div>
      </section>

      {/* Search & Tabs Toolbar */}
      <section className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        {/* Tabs */}
        <div className="flex bg-[var(--surface-container)] p-1 rounded-xl border border-[var(--outline-variant)]/20 self-start">
          {(['all', 'active', 'settled'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilterTab(tab)}
              className={`px-4 py-1.5 font-mono text-xs font-bold rounded-lg uppercase tracking-wider transition-all ${
                filterTab === tab
                  ? 'bg-[var(--surface-container-lowest)] text-[var(--primary)] shadow-sm'
                  : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[20px] text-[var(--outline)]">
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search names, emails, or phone..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[var(--outline-variant)]/30 bg-[var(--surface-container-lowest)] text-[var(--on-surface)] text-sm font-medium outline-none focus:border-[var(--primary)] shadow-sm"
          />
        </div>
      </section>

      {/* Cards Grid */}
      {loading ? (
        <div className="py-20 text-center font-mono text-xs text-[var(--on-surface-variant)]">
          Loading contacts directory...
        </div>
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPeople.map((person) => (
            <PersonCard
              key={person.id}
              person={person}
              currency={currency}
              onRecordDebt={(id) => setSelectedPersonForDebt(id)}
            />
          ))}

          {/* Add New Person Card matching Stitch dashed border mockup */}
          <div
            onClick={() => setIsAddPersonOpen(true)}
            className="rounded-2xl border-2 border-dashed border-[var(--outline-variant)]/50 hover:border-[var(--primary)] p-8 flex flex-col items-center justify-center text-center cursor-pointer group transition-colors min-h-[260px] bg-[var(--surface-container-lowest)]/50 hover:bg-[var(--surface-container-low)]"
          >
            <div className="w-12 h-12 rounded-full bg-[var(--surface-container)] group-hover:bg-[var(--primary-container)] text-[var(--on-surface-variant)] group-hover:text-[var(--on-primary-container)] flex items-center justify-center mb-3 transition-colors">
              <span className="material-symbols-outlined text-2xl">person_add</span>
            </div>
            <div className="font-heading font-bold text-base text-[var(--on-surface)]">
              Add New Person
            </div>
            <p className="text-xs text-[var(--on-surface-variant)] font-mono mt-1 max-w-[200px]">
              Invite a contact by email to start tracking shared expenses
            </p>
          </div>
        </section>
      )}

      {/* Modals */}
      <AddPersonModal
        isOpen={isAddPersonOpen}
        onClose={() => setIsAddPersonOpen(false)}
        onPersonAdded={fetchDirectoryData}
      />

      <RecordDebtModal
        isOpen={!!selectedPersonForDebt}
        preselectedContactId={selectedPersonForDebt || undefined}
        onClose={() => setSelectedPersonForDebt(null)}
        onDebtCreated={fetchDirectoryData}
      />
    </div>
  );
}
