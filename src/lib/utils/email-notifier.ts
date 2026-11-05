export interface EmailBreakdownItem {
  debt_id?: string;
  label?: string;
  principal?: number;
  allocated?: number;
  remaining?: number;
  cleared?: boolean;
  rate?: number;
}

export interface EmailNotificationPayload {
  type: 'ghost_account_invite' | 'payment_request' | 'debt_recorded' | 'split_bill_request';
  recipientEmail: string;
  recipientName?: string;
  senderName: string;
  amount: number;
  currency: string;
  notes?: string;
  debtId?: string;
  strategy?: string;
  breakdown?: EmailBreakdownItem[];
}

export async function sendNotificationEmail(payload: EmailNotificationPayload) {
  // In DebtSync v2.5+, email notifications are triggered server-side by PostgreSQL
  // database triggers calling the Brevo SMTP Edge Function directly.
  // This client helper remains as a safe non-blocking no-op for backward compatibility.
  void payload;
  return { success: true, serverTriggered: true };
}
