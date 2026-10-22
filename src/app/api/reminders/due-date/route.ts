import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bqnqtnpeyxruriiwjxbi.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxbnF0bnBleXhydXJpaXdqeGJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMjM4NjUsImV4cCI6MjEwNDY5OTg2NX0.TuqQEfoHbQ800oJ9JcjjHaTjUAMZ69BMsUTYQn7U3rU';

async function processDueDateReminders() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Try PostgreSQL RPC first
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc('check_and_send_due_date_reminders');
    if (!rpcError && rpcData?.success) {
      return {
        success: true,
        method: 'rpc',
        ...rpcData,
      };
    }
  } catch (_) {}

  // 2. Direct JavaScript fallback engine
  const { data: debts, error: debtsErr } = await supabase
    .from('debts')
    .select(`
      id,
      principal,
      currency,
      status,
      due_date,
      lender_id,
      borrower_id,
      notes,
      borrower:profiles!debts_borrower_id_fkey(id, email, full_name, is_shadow, notify_email),
      lender:profiles!debts_lender_id_fkey(id, email, full_name)
    `)
    .eq('status', 'active')
    .not('due_date', 'is', null);

  if (debtsErr || !debts) {
    return {
      success: false,
      error: debtsErr?.message || 'Failed to fetch active debts with due dates',
    };
  }

  const now = new Date();
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let sentCount = 0;
  const processedDebts: string[] = [];

  for (const debt of debts) {
    if (!debt.due_date) continue;
    const dueDate = new Date(debt.due_date);
    const dueDay = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
    const diffDays = Math.round((dueDay - nowDay) / (1000 * 60 * 60 * 24));

    // Exactly 1 day away (due tomorrow)
    if (diffDays === 1) {
      // Check if a reminder has already been dispatched for this debt
      const { data: logs } = await supabase
        .from('activity_log')
        .select('id, created_at, details')
        .eq('debt_id', debt.id)
        .eq('action', 'due_date_reminder');

      const alreadySent = (logs || []).some((l: any) => {
        const timeDiff = now.getTime() - new Date(l.created_at).getTime();
        const sentRecently = timeDiff < 48 * 60 * 60 * 1000;
        const matchesDueDate = l.details?.due_date === debt.due_date;
        return sentRecently || matchesDueDate;
      });

      if (!alreadySent) {
        const nowIso = now.toISOString();

        // 1. Insert into activity log
        await supabase.from('activity_log').insert({
          user_id: debt.lender_id,
          debt_id: debt.id,
          action: 'due_date_reminder',
          details: {
            channel: 'both',
            due_date: debt.due_date,
            amount: debt.principal,
            currency: debt.currency,
            borrower_id: debt.borrower_id,
            lender_id: debt.lender_id,
            timestamp: nowIso,
          },
        });

        // 2. Dispatch via notify Edge Function (Push + Brevo Email)
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/notify`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${SUPABASE_KEY}`,
              apikey: SUPABASE_KEY,
            },
            body: JSON.stringify({
              event: 'due_date_reminder',
              debt_id: debt.id,
              actor_id: debt.lender_id,
              details: {
                channel: 'both',
                amount: debt.principal,
                currency: debt.currency,
                due_date: debt.due_date,
                borrower_id: debt.borrower_id,
                lender_id: debt.lender_id,
              },
            }),
          });
        } catch (_) {}

        // 3. Dispatch directly via Next.js Email API (Brevo SMTP fallback)
        const borrowerEmail = (debt.borrower as any)?.email;
        const borrowerName = (debt.borrower as any)?.full_name || 'Borrower';
        const lenderName = (debt.lender as any)?.full_name || 'Lender';
        const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://debtsync.com').replace(/\/$/, '');

        if (borrowerEmail && !borrowerEmail.endsWith('@phone.debtsync.local')) {
          try {
            await fetch(`${appUrl}/api/notifications/email`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'due_date_reminder',
                recipientEmail: borrowerEmail,
                recipientName: borrowerName,
                senderName: lenderName,
                amount: debt.principal,
                currency: debt.currency,
                debtId: debt.id,
                dueDate: debt.due_date,
                notes: debt.notes || undefined,
              }),
            });
          } catch (_) {}
        }

        sentCount++;
        processedDebts.push(debt.id);
      }
    }
  }

  return {
    success: true,
    method: 'fallback_engine',
    total_active_with_due_dates: debts.length,
    reminders_sent: sentCount,
    debt_ids_notified: processedDebts,
    checked_at: now.toISOString(),
  };
}

export async function POST() {
  const result = await processDueDateReminders();
  return NextResponse.json(result);
}
