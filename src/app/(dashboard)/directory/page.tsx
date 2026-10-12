'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Debt, Payment } from '@/lib/types/database';
import { calculateDebtBalance } from '@/lib/utils/interest';
import { formatCurrency } from '@/lib/utils/currency';
import { PersonCard, PersonSummary } from '@/components/directory/PersonCard';
import { AddPersonModal } from '@/components/directory/AddPersonModal';
import { RecordDebtModal } from '@/components/debts/RecordDebtModal';
import { isSameEmail } from '@/lib/utils/email-normalize';
import { claimUserProfile } from '@/lib/utils/claim-profile';
import { getCurrentUserFast } from '@/lib/utils/auth-session';
import { getLedgerCache, setLedgerCache } from '@/lib/stores/ledger-store';
import { SkeletonDirectoryGrid } from '@/components/ui/Skeleton';
import { calculateTrustScore } from '@/lib/utils/trust-score';
import { getCleanDebtNotes, parseSplitDetails } from '@/lib/utils/split-bills';

type SortOption = 'recent' | 'alpha_asc' | 'alpha_desc' | 'balance_desc' | 'trust_score';

export default function PeopleDirectoryPage() {
  const supabase = createClient();

  const initialCache = getLedgerCache();
  const [loading, setLoading] = useState(!initialCache?.people);
  const [currency, setCurrency] = useState(initialCache?.currency || 'inr');
  const [people, setPeople] = useState<PersonSummary[]>(initialCache?.people || []);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'active' | 'settled'>('all');
  const [sortBy, setSortBy] = useState<SortOption>('recent');

  // Modal states
  const [isAddPersonOpen, setIsAddPersonOpen] = useState(false);
  const [selectedPersonForDebt, setSelectedPersonForDebt] = useState<string | null>(null);

  const fetchDirectoryData = useCallback(async () => {
    try {
      const user = await getCurrentUserFast(supabase);
      if (!user) return;

      await claimUserProfile(user);

      // Fetch settings, contacts, and debts concurrently
      const [settingsRes, contactRowsRes, debtRowsRes] = await Promise.all([
        supabase
          .from('user_settings')
          .select('default_currency')
          .eq('user_id', user.id)
          .single(),
        supabase
          .from('contacts')
          .select(`
            contact_id, nickname,
            profile:profiles!contacts_contact_id_fkey(id, email, full_name, phone, is_shadow, secondary_emails, avatar_url)
          `)
          .eq('owner_id', user.id),
        supabase
          .from('debts')
          .select(`
            *,
            lender:profiles!debts_lender_id_fkey(id, email, full_name, phone, is_shadow, secondary_emails, avatar_url),
            borrower:profiles!debts_borrower_id_fkey(id, email, full_name, phone, is_shadow, secondary_emails, avatar_url)
          `)
          .or(`lender_id.eq.${user.id},borrower_id.eq.${user.id}`),
      ]);

      if (settingsRes.data?.default_currency) setCurrency(settingsRes.data.default_currency);

      const contactRows = contactRowsRes.data;
      const allDebts: Debt[] = (debtRowsRes.data as any) || [];
      const debtIds = allDebts.map((d) => d.id);
      let allPayments: Payment[] = [];

      if (debtIds.length > 0) {
        const { data: paymentRows } = await supabase
          .from('payments')
          .select('*')
          .in('debt_id', debtIds);
        allPayments = (paymentRows as any) || [];
      }

      // Collect all counterparties (from contacts + from debts)
      const peopleMap = new Map<string, PersonSummary>();

      // Initialize from contacts
      if (contactRows) {
        for (const c of contactRows as any[]) {
          if (!c.profile) continue;
          const contactCreated = c.created_at ? new Date(c.created_at).getTime() : 0;
          peopleMap.set(c.contact_id, {
            id: c.contact_id,
            name: c.nickname || c.profile.full_name || c.profile.email,
            email: c.profile.email,
            phone: c.profile.phone,
            avatarUrl: c.profile.avatar_url || null,
            secondaryEmails: c.profile.secondary_emails || [],
            netBalance: 0,
            lentAmount: 0,
            owedAmount: 0,
            status: c.profile.is_shadow ? 'pending' : 'settled',
            isShadow: c.profile.is_shadow,
            notes: [],
            lastInteractionAt: contactCreated,
          });
        }
      }

      // Add counterparties from debts and calculate balances
      for (const d of allDebts) {
        // Privacy: Declined requests must NEVER add counterparties to directory
        if (d.status === 'declined') {
          continue;
        }

        const isLender = d.lender_id === user.id;
        const otherParty = isLender ? d.borrower : d.lender;
        if (!otherParty) continue;

        if (!peopleMap.has(otherParty.id)) {
          peopleMap.set(otherParty.id, {
            id: otherParty.id,
            name: otherParty.full_name || otherParty.email,
            email: otherParty.email,
            phone: otherParty.phone,
            avatarUrl: (otherParty as any).avatar_url || null,
            upiId: (otherParty as any).upi_id || null,
            secondaryEmails: (otherParty as any).secondary_emails || [],
            netBalance: 0,
            lentAmount: 0,
            owedAmount: 0,
            status: otherParty.is_shadow ? 'pending' : 'settled',
            isShadow: otherParty.is_shadow,
            notes: [],
            lastInteractionAt: 0,
          });
        }

        const person = peopleMap.get(otherParty.id)!;

        // Calculate most recent interaction timestamp
        const debtCreatedTime = d.created_at ? new Date(d.created_at).getTime() : 0;
        const debtAcceptedTime = d.accepted_at ? new Date(d.accepted_at).getTime() : 0;
        const debtSettledTime = d.settled_at ? new Date(d.settled_at).getTime() : 0;
        const maxDebtTime = Math.max(debtCreatedTime, debtAcceptedTime, debtSettledTime);
        if (maxDebtTime > (person.lastInteractionAt || 0)) {
          person.lastInteractionAt = maxDebtTime;
        }

        // Collect two-sided notes for instant directory searchability
        const splitInfo = parseSplitDetails(d);
        const cleanNote = getCleanDebtNotes(d.notes);
        const searchableNote = splitInfo?.title
          ? (cleanNote ? `Split: ${splitInfo.title} - ${cleanNote}` : `Split: ${splitInfo.title}`)
          : cleanNote;
        if (searchableNote && !person.notes?.includes(searchableNote)) {
          person.notes = person.notes ? [...person.notes, searchableNote] : [searchableNote];
        }
        if (d.counterparty_notes && !person.notes?.includes(d.counterparty_notes)) {
          person.notes = person.notes ? [...person.notes, d.counterparty_notes] : [d.counterparty_notes];
        }

        const debtPayments = allPayments.filter((p) => p.debt_id === d.id);
        for (const pm of debtPayments) {
          const pmTime = pm.created_at ? new Date(pm.created_at).getTime() : 0;
          if (pmTime > (person.lastInteractionAt || 0)) {
            person.lastInteractionAt = pmTime;
          }
        }
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

      const updatedPeople = Array.from(peopleMap.values());
      for (const p of updatedPeople) {
        const personDebts = allDebts.filter((d) => d.lender_id === p.id || d.borrower_id === p.id);
        const personDebtIds = new Set(personDebts.map((d) => d.id));
        const personPayments = allPayments.filter((pm) => personDebtIds.has(pm.debt_id));
        const trust = calculateTrustScore(personDebts, personPayments, p.id);
        p.trustScore = trust.score;
        p.trustRating = trust.rating;
      }
      setPeople(updatedPeople);

      const activeCurrency = settingsRes.data?.default_currency || currency;
      setLedgerCache({
        userId: user.id,
        debts: allDebts,
        payments: allPayments,
        people: updatedPeople,
        currency: activeCurrency,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error('Error loading directory:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase, currency]);

  useEffect(() => {
    fetchDirectoryData();

    const handleRefresh = () => fetchDirectoryData();
    window.addEventListener('debtsync:refresh', handleRefresh);

    const channel = supabase
      .channel('directory-realtime-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'debts' }, () => {
        fetchDirectoryData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        fetchDirectoryData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' }, () => {
        fetchDirectoryData();
      })
      .subscribe();

    return () => {
      window.removeEventListener('debtsync:refresh', handleRefresh);
      supabase.removeChannel(channel);
    };
  }, [fetchDirectoryData, supabase]);

  // Aggregate stats across contacts
  const totalContacts = people.length;
  const activeDebtsCount = people.filter((p) => p.status === 'active').length;
  const totalOwedToYou = people.reduce((sum, p) => sum + (p.netBalance > 0 ? p.netBalance : 0), 0);
  const totalYouOwe = people.reduce((sum, p) => sum + (p.netBalance < 0 ? Math.abs(p.netBalance) : 0), 0);

  // Filter & Search
  const filteredPeople = people
    .map((p) => {
      const q = searchQuery.toLowerCase().trim();
      if (!q) return { ...p, matchingNote: undefined };

      const foundNote = p.notes?.find((n) => n.toLowerCase().includes(q));
      return {
        ...p,
        matchingNote: foundNote,
      };
    })
    .filter((p) => {
      if (filterTab === 'active') return p.status === 'active';
      if (filterTab === 'settled') return p.status === 'settled';
      return true;
    })
    .filter((p) => {
      const q = searchQuery.toLowerCase().trim();
      if (!q) return true;

      const qDigits = q.replace(/[^\d]/g, '');
      const phoneDigits = p.phone ? p.phone.replace(/[^\d]/g, '') : '';
      const phoneMatches = Boolean(
        (p.phone && p.phone.toLowerCase().includes(q)) ||
        (qDigits.length >= 3 && (
          phoneDigits.includes(qDigits) ||
          qDigits.includes(phoneDigits) ||
          (qDigits.length >= 10 && phoneDigits.length >= 10 && qDigits.slice(-10) === phoneDigits.slice(-10))
        ))
      );

      const emailMatches = Boolean(
        (p.email && p.email.toLowerCase().includes(q)) ||
        (q.includes('@') && p.email && isSameEmail(p.email, q))
      );
      const secondaryMatches = Boolean(
        p.secondaryEmails && p.secondaryEmails.some((sec) =>
          (sec && sec.toLowerCase().includes(q)) || (q.includes('@') && sec && isSameEmail(sec, q))
        )
      );

      const noteMatches = Boolean(p.matchingNote);

      return (
        (p.name || '').toLowerCase().includes(q) ||
        emailMatches ||
        secondaryMatches ||
        phoneMatches ||
        noteMatches
      );
    })
    .sort((a, b) => {
      if (sortBy === 'recent') {
        const timeA = a.lastInteractionAt || 0;
        const timeB = b.lastInteractionAt || 0;
        if (timeA !== timeB) return timeB - timeA;
        return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
      }
      if (sortBy === 'alpha_asc') {
        return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
      }
      if (sortBy === 'alpha_desc') {
        return (b.name || '').localeCompare(a.name || '', undefined, { sensitivity: 'base' });
      }
      if (sortBy === 'balance_desc') {
        return Math.abs(b.netBalance) - Math.abs(a.netBalance);
      }
      if (sortBy === 'trust_score') {
        return (b.trustScore ?? -1) - (a.trustScore ?? -1);
      }
      return 0;
    });

  return (
    <div className="page-enter space-y-6 md:space-y-8">
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

      {/* Search, Sort & Tabs Toolbar */}
      <section className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3.5">
        {/* Left: Filter Tabs & Sort Selector */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Tabs */}
          <div className="flex bg-[var(--surface-container)] p-1 rounded-xl border border-[var(--outline-variant)]/20">
            {(['all', 'active', 'settled'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilterTab(tab)}
                className={`px-3.5 py-1.5 font-mono text-xs font-bold rounded-lg uppercase tracking-wider transition-all cursor-pointer ${
                  filterTab === tab
                    ? 'bg-[var(--surface-container-lowest)] text-[var(--primary)] shadow-sm'
                    : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Sort Selector Dropdown */}
          <div className="relative">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-[var(--primary)] pointer-events-none">
              swap_vert
            </span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="pl-8 pr-7 py-1.5 rounded-xl border border-[var(--outline-variant)]/30 bg-[var(--surface-container-lowest)] text-xs font-mono font-bold text-[var(--on-surface)] outline-none focus:border-[var(--primary)] cursor-pointer shadow-2xs appearance-none min-h-[36px]"
              aria-label="Sort contacts"
            >
              <option value="recent">Sort: Recently Interacted</option>
              <option value="alpha_asc">Sort: Name (A → Z)</option>
              <option value="alpha_desc">Sort: Name (Z → A)</option>
              <option value="balance_desc">Sort: Highest Balance</option>
              <option value="trust_score">Sort: Trust Score</option>
            </select>
            <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-[15px] text-[var(--outline)] pointer-events-none">
              expand_more
            </span>
          </div>
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
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-[var(--outline-variant)]/30 bg-[var(--surface-container-lowest)] text-[var(--on-surface)] text-sm font-medium outline-none focus:border-[var(--primary)] shadow-sm"
          />
        </div>
      </section>

      {/* Cards Grid */}
      {loading && people.length === 0 ? (
        <SkeletonDirectoryGrid cards={6} />
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
        preselectedPerson={
          selectedPersonForDebt
            ? (() => {
                const p = people.find((item) => item.id === selectedPersonForDebt);
                return p
                  ? {
                      id: p.id,
                      name: p.name,
                      email: p.email,
                      phone: p.phone,
                      avatar_url: p.avatarUrl,
                      trustScore: p.trustScore,
                      trustRating: p.trustRating,
                      isPlatformUser: !p.isShadow,
                    }
                  : null;
              })()
            : null
        }
        onClose={() => setSelectedPersonForDebt(null)}
        onDebtCreated={fetchDirectoryData}
      />
    </div>
  );
}
