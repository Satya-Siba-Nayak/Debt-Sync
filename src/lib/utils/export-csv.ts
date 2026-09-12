import { SupabaseClient } from '@supabase/supabase-js';
import { calculateDebtBalance } from './interest';

function escapeCSV(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Exports complete user financial ledger and directory to an RFC-4180 compliant CSV file
 * and triggers immediate browser download.
 */
export async function exportUserDataToCSV(
  supabase: SupabaseClient,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Fetch user profile & settings
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    const { data: settings } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    // 2. Fetch debts where user is lender or borrower
    const { data: debts, error: debtsErr } = await supabase
      .from('debts')
      .select(`
        *,
        lender:profiles!debts_lender_id_fkey(id, email, full_name, phone),
        borrower:profiles!debts_borrower_id_fkey(id, email, full_name, phone)
      `)
      .or(`lender_id.eq.${userId},borrower_id.eq.${userId}`)
      .order('created_at', { ascending: false });

    if (debtsErr) throw debtsErr;

    // 3. Fetch all payments related to these debts
    const debtIds = (debts || []).map((d: any) => d.id);
    let payments: any[] = [];
    if (debtIds.length > 0) {
      const { data: paymentData } = await supabase
        .from('payments')
        .select('*')
        .in('debt_id', debtIds)
        .order('created_at', { ascending: false });
      payments = paymentData || [];
    }

    // 4. Fetch user contacts
    const { data: contacts } = await supabase
      .from('contacts')
      .select(`
        contact_id, nickname, created_at,
        profile:profiles!contacts_contact_id_fkey(id, email, full_name, phone)
      `)
      .eq('owner_id', userId);

    // Build CSV content
    const lines: string[] = [];

    // Header & Meta
    lines.push('# DEBTSYNC FINANCIAL ARCHIVE');
    lines.push(`# Export Timestamp: ${new Date().toISOString()}`);
    lines.push(
      `# Account Holder: ${profile?.full_name || 'User'} (${profile?.email || 'N/A'}, Phone: ${profile?.phone || 'N/A'})`
    );
    lines.push(`# Default Currency: ${(settings?.default_currency || 'inr').toUpperCase()}`);
    lines.push('');

    // SECTION 1: DEBTS & LEDGERS
    lines.push('# --- SECTION 1: DEBTS & OBLIGATIONS ---');
    lines.push(
      [
        'Debt ID',
        'Origination Date',
        'Role',
        'Direction',
        'Counterparty Name',
        'Counterparty Email',
        'Counterparty Phone',
        'Principal',
        'Currency',
        'Interest Engine',
        'APR (%)',
        'Compound Freq',
        'Accrued Interest',
        'Total Paid',
        'Current Balance',
        'Status',
        'Due Date',
        'Notes',
      ]
        .map(escapeCSV)
        .join(',')
    );

    for (const d of debts || []) {
      const isLender = d.lender_id === userId;
      const counterparty = isLender ? d.borrower : d.lender;
      const debtPayments = payments.filter((p: any) => p.debt_id === d.id);
      const calc = calculateDebtBalance(d, debtPayments);

      lines.push(
        [
          d.id,
          d.created_at ? new Date(d.created_at).toISOString().split('T')[0] : '',
          isLender ? 'Lender' : 'Borrower',
          isLender ? 'Lent' : 'Borrowed',
          counterparty?.full_name || 'Counterparty',
          counterparty?.email || '',
          counterparty?.phone || '',
          d.principal,
          (d.currency || 'inr').toUpperCase(),
          d.interest_type || 'none',
          d.interest_rate || '0',
          d.compound_freq || 'N/A',
          calc.totalAccruedInterest,
          calc.totalPaid,
          calc.currentBalance,
          d.status,
          d.due_date ? new Date(d.due_date).toISOString().split('T')[0] : '',
          d.notes || '',
        ]
          .map(escapeCSV)
          .join(',')
      );
    }

    lines.push('');

    // SECTION 2: PAYMENTS & TRANSACTIONS
    lines.push('# --- SECTION 2: PAYMENT & REPAYMENT LOGS ---');
    lines.push(
      [
        'Payment ID',
        'Debt ID',
        'Payment Date',
        'Paid By',
        'Amount',
        'Currency',
        'Verification Status',
        'Verified At',
        'Note',
      ]
        .map(escapeCSV)
        .join(',')
    );

    for (const p of payments) {
      lines.push(
        [
          p.id,
          p.debt_id,
          p.created_at ? new Date(p.created_at).toISOString().split('T')[0] : '',
          p.paid_by === userId ? 'You' : 'Counterparty',
          p.amount,
          (p.currency || 'inr').toUpperCase(),
          p.is_verified === false ? 'Pending Verification' : 'Verified',
          p.verified_at ? new Date(p.verified_at).toISOString() : '',
          p.note || '',
        ]
          .map(escapeCSV)
          .join(',')
      );
    }

    lines.push('');

    // SECTION 3: CONTACT DIRECTORY
    lines.push('# --- SECTION 3: CONTACT DIRECTORY ---');
    lines.push(
      ['Contact ID', 'Full Name', 'Email', 'Phone', 'Nickname', 'Added Date']
        .map(escapeCSV)
        .join(',')
    );

    for (const c of contacts || []) {
      lines.push(
        [
          c.contact_id,
          (c as any).profile?.full_name || '',
          (c as any).profile?.email || '',
          (c as any).profile?.phone || '',
          c.nickname || '',
          c.created_at ? new Date(c.created_at).toISOString().split('T')[0] : '',
        ]
          .map(escapeCSV)
          .join(',')
      );
    }

    const csvContent = lines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const dateStr = new Date().toISOString().split('T')[0];
    link.setAttribute('download', `debtsync_financial_archive_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return { success: true };
  } catch (err: any) {
    console.error('CSV Export Error:', err);
    return { success: false, error: err.message || 'Failed to export CSV' };
  }
}
