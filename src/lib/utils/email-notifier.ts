export interface EmailNotificationPayload {
  type: 'ghost_account_invite' | 'payment_request' | 'debt_recorded' | 'split_bill_request';
  recipientEmail: string;
  recipientName?: string;
  senderName: string;
  amount: number;
  currency: string;
  notes?: string;
  debtId?: string;
}

export async function sendNotificationEmail(payload: EmailNotificationPayload) {
  if (!payload.recipientEmail || payload.recipientEmail.endsWith('@phone.debtsync.local')) {
    return { success: true, skipped: true };
  }

  try {
    const res = await fetch('/api/notifications/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (err) {
    console.warn('Email notification dispatch skipped or failed:', err);
    return null;
  }
}
