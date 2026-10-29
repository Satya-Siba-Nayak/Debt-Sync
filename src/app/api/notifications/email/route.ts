import { NextRequest, NextResponse } from 'next/server';
import { isInternalApiAuthorized } from '@/lib/server/internal-api-auth';

interface EmailPayload {
  type: 'ghost_account_invite' | 'payment_request' | 'debt_recorded' | 'split_bill_request' | 'payment_reminder' | 'due_date_reminder';
  recipientEmail: string;
  recipientName?: string;
  senderName: string;
  amount: number;
  currency: string;
  notes?: string;
  debtId?: string;
  dueDate?: string;
}

// In-memory rate limiting map: recipientEmail:type -> timestamp
const rateLimitMap = new Map<string, number>();

// Clean up entries older than 2 hours periodically
const CLEANUP_INTERVAL = 2 * 60 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupRateLimits() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, timestamp] of rateLimitMap.entries()) {
    if (now - timestamp > CLEANUP_INTERVAL) {
      rateLimitMap.delete(key);
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isInternalApiAuthorized(request)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized. This endpoint is for server-side delivery only.',
        },
        { status: 401 }
      );
    }

    cleanupRateLimits();

    const body: EmailPayload = await request.json();
    const { type, recipientEmail, recipientName, senderName, amount, currency, notes } = body;

    if (!recipientEmail || !type || !senderName) {
      return NextResponse.json(
        { success: false, error: 'Missing required email notification fields.' },
        { status: 400 }
      );
    }

    const cleanEmail = recipientEmail.trim().toLowerCase();
    // Do not attempt to send email to internal local fallback addresses
    if (cleanEmail.endsWith('@phone.debtsync.local')) {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: 'Internal phone-only identifier; email skipped.',
      });
    }

    // Determine Cooldown
    const cooldownMs =
      type === 'ghost_account_invite'
        ? 60 * 60 * 1000 // 1 hour for ghost account creation
        : type === 'payment_reminder'
        ? 30 * 60 * 1000 // 30 minutes cooldown between manual payment reminders
        : 15 * 60 * 1000; // 15 minutes for payment/debt updates

    const rateKey = body.debtId ? `${cleanEmail}:${type}:${body.debtId}` : `${cleanEmail}:${type}`;
    const lastSent = rateLimitMap.get(rateKey);
    const now = Date.now();

    if (lastSent && now - lastSent < cooldownMs) {
      const remainingMinutes = Math.ceil((cooldownMs - (now - lastSent)) / 60000);
      return NextResponse.json(
        {
          success: false,
          rateLimited: true,
          error: `Rate limit active: An email was already sent to this recipient recently. Please wait ${remainingMinutes} minute(s).`,
        },
        { status: 429 }
      );
    }

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://debtsync.com').replace(/\/$/, '');
    const targetNext = body.debtId ? `/transactions?debt=${body.debtId}` : '/transactions';
    const signupUrl = `${appUrl}/signup?email=${encodeURIComponent(cleanEmail)}&next=${encodeURIComponent(targetNext)}`;
    const loginUrl = `${appUrl}/login?email=${encodeURIComponent(cleanEmail)}&next=${encodeURIComponent(targetNext)}`;
    let ctaUrl = body.debtId ? `${appUrl}/transactions?debt=${body.debtId}` : `${appUrl}/transactions`;

    // Build subject and HTML template
    const formattedAmount = `${currency.toUpperCase()} ${Number(amount).toLocaleString()}`;
    let subject = '';
    let headline = '';
    let description = '';
    let ctaText = 'Open DebtSync Ledger';

    if (type === 'ghost_account_invite') {
      subject = `${senderName} logged a transaction of ${formattedAmount} with you on DebtSync`;
      headline = 'New Peer Ledger Agreement Recorded';
      description = `<strong>${senderName}</strong> recorded a transaction agreement of <strong>${formattedAmount}</strong> with you. A ledger profile has been reserved for you to review, track live interest, and verify payments.`;
      ctaText = 'Sign Up to Review & Accept';
      ctaUrl = signupUrl;
    } else if (type === 'payment_request') {
      subject = `Repayment of ${formattedAmount} reported by ${senderName}`;
      headline = 'Payment Verification Request';
      description = `<strong>${senderName}</strong> has reported a repayment of <strong>${formattedAmount}</strong> on your shared ledger. Please review and verify the receipt.`;
      ctaText = 'Verify Repayment Receipt';
    } else if (type === 'split_bill_request') {
      subject = `${senderName} split an expense with you: ${formattedAmount}`;
      headline = 'Group Expense Split Request';
      description = `<strong>${senderName}</strong> recorded a group expense split on DebtSync. Your share is <strong>${formattedAmount}</strong>.`;
      ctaText = 'Review & Accept Split';
    } else if (type === 'payment_reminder') {
      subject = `Payment Reminder: ${formattedAmount} due to ${senderName}`;
      headline = 'Friendly Payment Reminder';
      description = `<strong>${senderName}</strong> sent a reminder regarding the outstanding balance of <strong>${formattedAmount}</strong> on your shared ledger. Please review and arrange repayment.`;
      ctaText = 'View Debt & Repay';
    } else if (type === 'due_date_reminder') {
      const dueStr = body.dueDate
        ? new Date(body.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        : 'tomorrow';
      subject = `Payment Due Tomorrow: ${formattedAmount} to ${senderName}`;
      headline = 'Upcoming Payment Due Tomorrow';
      description = `Friendly reminder that your payment of <strong>${formattedAmount}</strong> to <strong>${senderName}</strong> is due tomorrow (${dueStr}). Please review your ledger and submit your repayment receipt.`;
      ctaText = 'View & Submit Repayment';
    } else {
      subject = `Ledger update of ${formattedAmount} from ${senderName}`;
      headline = 'Ledger Agreement Update';
      description = `<strong>${senderName}</strong> updated a shared transaction agreement for <strong>${formattedAmount}</strong>.`;
    }

    const htmlBody = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta name="color-scheme" content="dark only">
          <meta name="supported-color-schemes" content="dark only">
          <style>
            :root {
              color-scheme: dark only;
              supported-color-schemes: dark only;
            }
            body { margin: 0; padding: 28px 10px; background-color: #080e18; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #dae3f4; -webkit-font-smoothing: antialiased; }
            .container { max-width: 520px; margin: 0 auto; background-color: #111927; border-radius: 18px; border: 1px solid #1f2d42; overflow: hidden; box-shadow: 0 12px 36px rgba(0,0,0,0.5); }
            .header { background: linear-gradient(135deg, #002a2e 0%, #004349 55%, #006067 100%); background-color: #004349; padding: 24px 20px; text-align: center; border-bottom: 1px solid #005a63; }
            .content { padding: 28px 24px; text-align: left; }
            .card { background-color: #162234; border: 1px solid #253750; border-radius: 14px; padding: 18px 20px; margin: 20px 0; }
            .btn { display: inline-block; background: linear-gradient(135deg, #00818d 0%, #009aa8 100%); background-color: #00818d; color: #ffffff !important; text-decoration: none; font-weight: 700; font-size: 14px; padding: 13px 30px; border-radius: 12px; margin-top: 15px; box-shadow: 0 4px 16px rgba(0,129,141,0.4); }
            .footer { padding: 20px 24px; font-size: 11px; color: #7e8b9d; text-align: center; border-top: 1px solid #1c283a; background-color: #0a101b; line-height: 1.65; }
          </style>
        </head>
        <body style="background-color:#080e18; margin:0; padding:28px 10px; color:#dae3f4;">
          <div class="container" style="max-width:520px; margin:0 auto; background-color:#111927; border-radius:18px; border:1px solid #1f2d42; overflow:hidden;">
            <div class="header" style="background:linear-gradient(135deg,#002a2e 0%,#004349 55%,#006067 100%); padding:24px 20px; text-align:center; border-bottom:1px solid #005a63;">
              <h2 style="margin:0; font-size:22px; font-weight:800; letter-spacing:0.8px; color:#ffffff;">DebtSync</h2>
              <p style="margin:5px 0 0; font-size:11px; color:#67e8f9; text-transform:uppercase; letter-spacing:1.5px; font-weight:700;">Trust &amp; Precision Peer Ledgers</p>
            </div>
            <div class="content" style="padding:28px 24px;">
              <h3 style="margin-top:0; font-size:19px; font-weight:700; color:#22d3ee; line-height:1.35;">${headline}</h3>
              <p style="font-size:14px; line-height:1.65; color:#f1f5f9;">Hello ${recipientName || 'there'},</p>
              <p style="font-size:14px; line-height:1.65; color:#cbd5e1;">${description}</p>
              
              <div class="card" style="background-color:#162234; border:1px solid #253750; border-radius:14px; padding:18px 20px; margin:20px 0;">
                <div style="font-size:11px; text-transform:uppercase; color:#94a3b8; font-weight:700; letter-spacing:1px; margin-bottom:4px;">Transaction Amount</div>
                <div style="font-size:26px; font-weight:800; color:#22d3ee;">${formattedAmount}</div>
                ${notes ? `<div style="margin-top:10px; font-size:12px; color:#94a3b8; font-style:italic;">"${notes}"</div>` : ''}
              </div>

              ${
                type === 'ghost_account_invite'
                  ? `<div style="background-color:#101a28;border:1px solid #00818d;border-radius:14px;padding:20px;margin:20px 0;text-align:left;">
                <div style="font-size:14px;font-weight:700;color:#67e8f9;margin-bottom:10px;">
                  ⚡ Action Required: Create Free Account to Accept
                </div>
                <p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#cbd5e1;">
                  You don&apos;t have an active DebtSync account yet. This transaction agreement is securely held for <strong style="color:#ffffff;background-color:#070d17;padding:2px 8px;border-radius:6px;border:1px solid #1f2d42;font-family:monospace;">${cleanEmail}</strong>.
                </p>
                <div style="background-color:#070d17;border-radius:10px;padding:12px 14px;margin-bottom:14px;border:1px solid #1c283a;font-size:13px;line-height:1.6;color:#e2e8f0;">
                  <strong style="color:#ffffff;">How to claim and accept this agreement:</strong>
                  <ol style="margin:6px 0 0;padding-left:20px;color:#94a3b8;">
                    <li style="margin-bottom:4px;"><strong style="color:#ffffff;">Sign up</strong> with this exact email (<span style="color:#22d3ee;">${cleanEmail}</span>).</li>
                    <li style="margin-bottom:0;"><strong style="color:#ffffff;">Log in</strong> to view your shared ledger and tap <strong style="color:#34d399;">Accept Agreement</strong>.</li>
                  </ol>
                </div>
                <div style="text-align:center;margin-top:14px;">
                  <a href="${signupUrl}" style="display:inline-block;background:linear-gradient(135deg,#00818d 0%,#009aa8 100%);background-color:#00818d;color:#ffffff !important;text-decoration:none;font-weight:700;font-size:13px;padding:11px 24px;border-radius:10px;box-shadow:0 4px 12px rgba(0,129,141,0.35);">
                    Sign Up with ${cleanEmail} &rarr;
                  </a>
                  <div style="margin-top:10px;font-size:12px;color:#94a3b8;">
                    Already registered? <a href="${loginUrl}" style="color:#38bdf8;text-decoration:underline;font-weight:600;">Log in to accept agreement</a>
                  </div>
                </div>
              </div>`
                  : ''
              }

              <div style="text-align: center; margin: 26px 0 10px;">
                <a href="${ctaUrl}" class="btn" style="color:#ffffff !important;">${ctaText} &rarr;</a>
              </div>
            </div>
            <div class="footer" style="padding:20px 24px; font-size:11px; color:#7e8b9d; text-align:center; border-top:1px solid #1c283a; background-color:#0a101b;">
              This automated notification was generated by DebtSync upon transaction activity. To conserve email quota, enable instant OS Background Push in Settings.
            </div>
          </div>
        </body>
      </html>
    `;

    // Dispatch via Resend if API key is provided
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM || 'DebtSync <notifications@debtsync.com>',
            to: [cleanEmail],
            subject,
            html: htmlBody,
          }),
        });

        if (!resendRes.ok) {
          const errData = await resendRes.json();
          console.warn('[DebtSync Email] Resend API error:', errData);
        } else {
          rateLimitMap.set(rateKey, now);
          return NextResponse.json({ success: true, delivered: true });
        }
      } catch (sendErr) {
        console.warn('[DebtSync Email] Delivery attempt error:', sendErr);
      }
    }

    // Simulated / fallback dispatch (logging for audit & seamless non-blocking operation)
    rateLimitMap.set(rateKey, now);
    console.log(`[DebtSync Email Notification (Simulated)]: Type=${type}, To=${cleanEmail}, Sender=${senderName}, Amount=${formattedAmount}`);

    return NextResponse.json({
      success: true,
      delivered: false,
      simulated: true,
      message: 'Email notification logged (configure RESEND_API_KEY for external delivery)',
    });
  } catch (err: any) {
    console.error('Failed to process email notification:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
