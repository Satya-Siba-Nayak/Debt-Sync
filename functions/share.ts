interface Env {
  ASSETS?: {
    fetch: (request: Request | string) => Promise<Response>;
  };
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
}

const DEFAULT_SUPABASE_URL = 'https://bqnqtnpeyxruriiwjxbi.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxbnF0bnBleXhydXJpaXdqeGJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMjM4NjUsImV4cCI6MjEwNDY5OTg2NX0.TuqQEfoHbQ800oJ9JcjjHaTjUAMZ69BMsUTYQn7U3rU';
const SYSTEM_PURGED_USER_ID = '00000000-0000-0000-0000-000000000001';

const CURRENCY_MAP: Record<string, { symbol: string; locale: string }> = {
  inr: { symbol: '₹', locale: 'en-IN' },
  usd: { symbol: '$', locale: 'en-US' },
  eur: { symbol: '€', locale: 'de-DE' },
  gbp: { symbol: '£', locale: 'en-GB' },
  jpy: { symbol: '¥', locale: 'ja-JP' },
  aud: { symbol: 'A$', locale: 'en-AU' },
  cad: { symbol: 'C$', locale: 'en-CA' },
  sgd: { symbol: 'S$', locale: 'en-SG' },
  aed: { symbol: 'AED ', locale: 'en-AE' },
};

function round2(val: number): number {
  return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
}

function formatCurrencyEdge(amount: number, currencyCode = 'inr'): string {
  const code = (currencyCode || 'inr').toLowerCase();
  const cfg = CURRENCY_MAP[code] || CURRENCY_MAP.inr;
  const isZeroDecimal = code === 'jpy';
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  try {
    const formatted = new Intl.NumberFormat(cfg.locale, {
      minimumFractionDigits: isZeroDecimal ? 0 : 2,
      maximumFractionDigits: isZeroDecimal ? 0 : 2,
    }).format(safeAmount);
    return `${cfg.symbol}${formatted}`;
  } catch {
    return `${cfg.symbol}${safeAmount.toFixed(isZeroDecimal ? 0 : 2)}`;
  }
}

function maskEmail(email?: string | null): string {
  if (!email || !email.includes('@')) return 'Participant';
  const [local, domain] = email.trim().split('@');
  if (!local || local.length <= 1) return `${local?.[0] || '*'}***@${domain}`;
  return `${local[0]}***${local.slice(-1)}@${domain}`;
}

function formatSafeDisplayName(name?: string | null, email?: string | null): string {
  const trimmedName = (name || '').trim();
  if (trimmedName) {
    if (trimmedName.includes('@')) return maskEmail(trimmedName);
    return trimmedName;
  }
  if (email && email.includes('@')) {
    return maskEmail(email);
  }
  return 'Participant';
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function findStructuredTagRange(
  text: string,
  tagPrefix: '[SPLIT:' | '[SHARE:'
): { startIdx: number; endIdx: number } | null {
  const startIdx = text.indexOf(tagPrefix);
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === '[') {
        depth++;
      } else if (ch === ']') {
        depth--;
        if (depth === 0) {
          return { startIdx, endIdx: i };
        }
      }
    }
  }
  return null;
}

function parseTagJson<T = any>(notes: string | null | undefined, prefix: '[SPLIT:' | '[SHARE:'): T | null {
  if (!notes || typeof notes !== 'string' || !notes.includes(prefix)) return null;
  try {
    const range = findStructuredTagRange(notes, prefix);
    if (!range) return null;
    const jsonStr = notes.slice(range.startIdx + prefix.length, range.endIdx);
    const parsed = JSON.parse(jsonStr);
    return parsed && typeof parsed === 'object' ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function computeSnapshotBalance(debt: any, payments: any[] = []) {
  const principal = round2(Number(debt.principal) || 0);
  const verifiedPayments = payments.filter((p) => p && p.is_verified !== false);
  const totalPaid = round2(
    verifiedPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
  );

  const isPurged =
    debt.status === 'purged' ||
    debt.lender_id === SYSTEM_PURGED_USER_ID ||
    debt.borrower_id === SYSTEM_PURGED_USER_ID ||
    (typeof debt.notes === 'string' &&
      (debt.notes.includes('[TRANSACTION PURGED BY ADMIN') ||
        debt.notes.includes('[ADMIN_PURGED:')));

  if (debt.status === 'declined' || isPurged) {
    return { principal, totalAccruedInterest: 0, totalPaid, currentBalance: 0, isPurged };
  }

  if (debt.status === 'settled') {
    const interestPaid = Math.max(0, round2(totalPaid - principal));
    return {
      principal,
      totalAccruedInterest: interestPaid,
      totalPaid,
      currentBalance: 0,
      isPurged: false,
    };
  }

  const rate = Number(debt.interest_rate) || 0;
  if (!debt.interest_type || debt.interest_type === 'none' || rate <= 0) {
    let currentBalance = Math.max(0, round2(principal - totalPaid));
    if (currentBalance < 0.01) currentBalance = 0;
    return {
      principal,
      totalAccruedInterest: 0,
      totalPaid,
      currentBalance,
      isPurged: false,
    };
  }

  const startDate = new Date(debt.created_at || Date.now());
  const diffDays = Math.max(0, (Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const annualRate = rate / 100;
  let totalWithInterest = principal;

  if (debt.interest_type === 'simple') {
    totalWithInterest = principal * (1 + annualRate * (diffDays / 365));
  } else if (debt.interest_type === 'compound') {
    const freq = debt.compound_freq || 'monthly';
    const n = freq === 'daily' ? 365 : freq === 'weekly' ? 52 : freq === 'yearly' ? 1 : 12;
    totalWithInterest = principal * Math.pow(1 + annualRate / n, n * (diffDays / 365));
  }

  const roundedInterest = round2(Math.max(0, totalWithInterest - principal));
  const effectiveInterest = roundedInterest >= 0.01 ? roundedInterest : 0;
  let currentBalance = Math.max(0, round2(principal + effectiveInterest - totalPaid));
  if (currentBalance < 0.01) currentBalance = 0;

  return {
    principal,
    totalAccruedInterest: effectiveInterest,
    totalPaid,
    currentBalance,
    isPurged: false,
  };
}

function injectPreviewMetaTags(
  html: string,
  meta: {
    title: string;
    description: string;
    url: string;
    imageUrl: string;
    themeColor: string;
    siteName: string;
  }
): string {
  const safeTitle = escapeHtml(meta.title);
  const safeDesc = escapeHtml(meta.description);
  const safeUrl = escapeHtml(meta.url);
  const safeImage = escapeHtml(meta.imageUrl);
  const safeSiteName = escapeHtml(meta.siteName);
  const safeTheme = escapeHtml(meta.themeColor);

  // Strip default static OpenGraph, Twitter, description, and title tags so crawlers read the injected ones first
  let updated = html
    .replace(/<title>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta\s+[^>]*name=["']description["'][^>]*>/gi, '')
    .replace(/<meta\s+[^>]*property=["']og:[^"']+["'][^>]*>/gi, '')
    .replace(/<meta\s+[^>]*name=["']twitter:[^"']+["'][^>]*>/gi, '')
    .replace(/<meta\s+[^>]*name=["']theme-color["'][^>]*>/gi, '');

  const previewTags = [
    `<title>${safeTitle}</title>`,
    `<meta name="description" content="${safeDesc}" />`,
    `<meta name="theme-color" content="${safeTheme}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${safeSiteName}" />`,
    `<meta property="og:title" content="${safeTitle}" />`,
    `<meta property="og:description" content="${safeDesc}" />`,
    `<meta property="og:url" content="${safeUrl}" />`,
    `<meta property="og:image" content="${safeImage}" />`,
    `<meta property="og:image:secure_url" content="${safeImage}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="192" />`,
    `<meta property="og:image:height" content="192" />`,
    `<meta property="og:image:alt" content="DebtSync Ledger Preview" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${safeTitle}" />`,
    `<meta name="twitter:description" content="${safeDesc}" />`,
    `<meta name="twitter:image" content="${safeImage}" />`,
  ].join('\n    ');

  if (updated.includes('<head>')) {
    updated = updated.replace('<head>', `<head>\n    ${previewTags}`);
  } else if (updated.includes('<head ')) {
    updated = updated.replace(/<head([^>]*)>/i, `<head$1>\n    ${previewTags}`);
  } else {
    updated = `${previewTags}\n${updated}`;
  }

  return updated;
}

export const onRequest = async (context: {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
}) => {
  const { request, env } = context;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return context.next();
  }

  try {
    const url = new URL(request.url);

    // Extract debtId with support for standard query params, amp-escaped params, and aliases
    let debtId = (
      url.searchParams.get('id') ||
      url.searchParams.get('amp;id') ||
      url.searchParams.get('debt') ||
      url.searchParams.get('amp;debt') ||
      url.searchParams.get('debt_id') ||
      url.searchParams.get('amp;debt_id') ||
      url.searchParams.get('debtId') ||
      url.searchParams.get('amp;debtId') ||
      url.searchParams.get('transaction_id') ||
      url.searchParams.get('amp;transaction_id') ||
      url.searchParams.get('transaction') ||
      ''
    ).trim();

    // Extract token with support for standard query params and amp-escaped params
    let token = (
      url.searchParams.get('token') ||
      url.searchParams.get('amp;token') ||
      url.searchParams.get('key') ||
      url.searchParams.get('amp;key') ||
      ''
    ).trim();

    // Fallback: search regex across raw url search & href
    if (!debtId || !token) {
      try {
        const rawSearch = decodeURIComponent(url.search || '');
        if (!debtId) {
          const idMatch = rawSearch.match(/(?:[?&]|(?:&amp;))(?:id|debt|debt_id|debtId|transaction_id)=([0-9a-f-]{36}|[a-zA-Z0-9_-]+)/i);
          if (idMatch) debtId = idMatch[1].trim();
        }
        if (!token) {
          const tokMatch = rawSearch.match(/(?:[?&]|(?:&amp;))(?:token|key)=([a-zA-Z0-9_-]+)/i);
          if (tokMatch) token = tokMatch[1].trim();
        }
      } catch (_) {}
    }

    // If token is a UUID and debtId is empty, token was passed as the debt ID
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!debtId && UUID_REGEX.test(token)) {
      debtId = token;
      token = '';
    }

    // Also check pathname for UUID fallback: e.g. /share/uuid
    const pathMatch = url.pathname.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    );
    if (!debtId && pathMatch) {
      debtId = pathMatch[0];
    }

    // If request arrived at pathname /share/<uuid>, 302 redirect to canonical /share?id=<uuid>
    // so Next.js static client router receives the canonical query route
    if (pathMatch && url.pathname.startsWith('/share/')) {
      const sp = new URLSearchParams(url.search);
      sp.set('id', pathMatch[0]);
      if (token && !sp.has('token')) {
        sp.set('token', token);
      }
      return Response.redirect(`${url.origin}/share?${sp.toString()}`, 302);
    }

    const iconUrl = `${url.origin}/icons/icon-192.png`;

    // Fetch the underlying static /share.html asset from Cloudflare Pages ASSETS
    let baseResponse: Response;
    try {
      if (env.ASSETS) {
        baseResponse = await env.ASSETS.fetch(new Request(`${url.origin}/share.html${url.search}`));
        if (!baseResponse.ok) {
          baseResponse = await env.ASSETS.fetch(new Request(`${url.origin}/share.html`));
        }
        if (!baseResponse.ok) {
          baseResponse = await env.ASSETS.fetch(request);
        }
      } else {
        baseResponse = await context.next();
      }
    } catch {
      return context.next();
    }

    const contentType = baseResponse.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return baseResponse;
    }

    const rawHtml = await baseResponse.text();

    // Default preview (when no ID is provided)
    let previewTitle = 'Shared Transaction Ledger — DebtSync';
    let previewDescription =
      'Peer-to-peer ledger record with verified repayment tracking and cryptographic audit history.';
    let themeColor = '#6366f1';
    let siteName = 'DebtSync • Peer-to-Peer Ledger';

    if (debtId && !token) {
      // Participants-Only Private Link: Never expose amounts or status in public link previews
      previewTitle = '🔒 Protected Ledger Agreement — DebtSync';
      previewDescription =
        'Private peer-to-peer transaction link. Restricted to verified participating members.';
      themeColor = '#6366f1';
    } else if (debtId && token) {
      // Public Global Share Link: Verify token against live Supabase debt record
      const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL;
      const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2200);

        const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/get_debt_for_acceptance`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${supabaseAnonKey}`,
          },
          body: JSON.stringify({ p_debt_id: debtId }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (rpcRes.ok) {
          const rows = await rpcRes.json();
          const debt = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

          if (!debt) {
            previewTitle = 'Transaction Not Found — DebtSync';
            previewDescription = 'This shared transaction record does not exist or has been removed.';
            themeColor = '#64748b';
          } else {
            const shareMeta = parseTagJson<{
              globalEnabled?: boolean;
              globalToken?: string | null;
              snapshot?: { payments?: any[] };
            }>(debt.notes, '[SHARE:');

            const isGlobalValid = Boolean(
              debt.status !== 'declined' &&
                shareMeta?.globalEnabled === true &&
                shareMeta?.globalToken &&
                shareMeta.globalToken === token
            );

            if (!isGlobalValid) {
              previewTitle = '🔒 Public Link Disabled — DebtSync';
              previewDescription =
                'Global public sharing is turned off for this transaction. Only participating members can view it.';
              themeColor = '#64748b';
            } else {
              const splitMeta = parseTagJson<{
                title?: string;
                totalAmount?: number;
                participants?: any[];
              }>(debt.notes, '[SPLIT:');

              const snapshotPayments = Array.isArray(shareMeta?.snapshot?.payments)
                ? shareMeta.snapshot!.payments!
                : [];

              const calc = computeSnapshotBalance(debt, snapshotPayments);
              const currency = debt.currency || 'inr';
              const formattedPrincipal = formatCurrencyEdge(calc.principal, currency);
              const formattedBalance = formatCurrencyEdge(calc.currentBalance, currency);

              const lenderDisplay =
                debt.lender_id === SYSTEM_PURGED_USER_ID
                  ? 'Purged Account'
                  : formatSafeDisplayName(debt.lender_name, debt.lender_email);
              const borrowerDisplay =
                debt.borrower_id === SYSTEM_PURGED_USER_ID
                  ? 'Purged Account'
                  : formatSafeDisplayName(debt.borrower_name, debt.borrower_email);

              const splitPrefix = splitMeta?.title ? `[Split: ${splitMeta.title}] ` : '';
              const interestTag =
                debt.interest_type && debt.interest_type !== 'none' && Number(debt.interest_rate) > 0
                  ? ` • ${debt.interest_rate}% ${debt.interest_type}`
                  : '';
              const paidTag =
                calc.totalPaid > 0
                  ? ` • Paid: ${formatCurrencyEdge(calc.totalPaid, currency)}`
                  : '';

              if (calc.isPurged) {
                previewTitle = `${formattedPrincipal} • 🛡️ Purged by Admin — DebtSync`;
                previewDescription = `${splitPrefix}${lenderDisplay} → ${borrowerDisplay} • (Transaction purged by admin) • Support: support@satya-nayak.dev`;
                themeColor = '#ef4444';
                siteName = 'DebtSync • Purged Ledger Record';
              } else if (debt.status === 'settled' || calc.currentBalance <= 0) {
                previewTitle = `${formattedPrincipal} • 🟢 Settled — DebtSync`;
                previewDescription = `${splitPrefix}${lenderDisplay} → ${borrowerDisplay} • Balance: ${formatCurrencyEdge(0, currency)} (Fully Settled) • Verified Read-Only Ledger`;
                themeColor = '#10b981';
                siteName = 'DebtSync • Settled Agreement';
              } else if (debt.status === 'pending') {
                previewTitle = `${formattedPrincipal} • ⏳ Pending Acceptance — DebtSync`;
                previewDescription = `${splitPrefix}${lenderDisplay} → ${borrowerDisplay} • Principal: ${formattedPrincipal}${interestTag} • Awaiting Counterparty Acceptance`;
                themeColor = '#f59e0b';
                siteName = 'DebtSync • Pending Agreement';
              } else {
                const amountHeadline =
                  Math.abs(calc.currentBalance - calc.principal) >= 0.01
                    ? `${formattedBalance} Due (of ${formattedPrincipal})`
                    : formattedPrincipal;
                previewTitle = `${amountHeadline} • ⚡ Active — DebtSync`;
                previewDescription = `${splitPrefix}${lenderDisplay} → ${borrowerDisplay} • Remaining: ${formattedBalance}${paidTag}${interestTag} • Public Read-Only Ledger`;
                themeColor = '#6366f1';
                siteName = 'DebtSync • Active Agreement';
              }
            }
          }
        }
      } catch {
        // Fallback gracefully if edge fetch times out
        previewTitle = 'Shared Transaction Summary — DebtSync';
        previewDescription =
          'Open this link to view the live debt amount, settlement status, and verified audit trail on DebtSync.';
      }
    }

    const cleanShareUrl = debtId
      ? `${url.origin}/share?id=${encodeURIComponent(debtId)}${token ? `&token=${encodeURIComponent(token)}` : ''}`
      : `${url.origin}/share`;

    const enrichedHtml = injectPreviewMetaTags(rawHtml, {
      title: previewTitle,
      description: previewDescription,
      url: cleanShareUrl,
      imageUrl: iconUrl,
      themeColor,
      siteName,
    });

    const headers = new Headers();
    // Copy safe headers from baseResponse avoiding immutable header errors
    for (const [key, value] of baseResponse.headers.entries()) {
      const k = key.toLowerCase();
      if (k !== 'content-encoding' && k !== 'content-length' && k !== 'etag' && k !== 'location') {
        headers.set(key, value);
      }
    }
    headers.set('Content-Type', 'text/html; charset=utf-8');
    headers.set('Cache-Control', 'public, max-age=0, must-revalidate');

    return new Response(request.method === 'HEAD' ? null : enrichedHtml, {
      status: 200,
      headers,
    });
  } catch (_) {
    // If anything fails in edge function, fall back directly to static asset so the page always renders!
    return context.next();
  }
};
