import { NextRequest } from 'next/server';

/** Server-only secret for cron / internal routes (never NEXT_PUBLIC_). */
export function getInternalApiSecret(): string | null {
  const secret =
    process.env.DEBTSYNC_INTERNAL_API_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim();
  return secret || null;
}

export function isInternalApiAuthorized(request: NextRequest): boolean {
  const secret = getInternalApiSecret();
  if (!secret) return false;

  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${secret}`) return true;

  const headerSecret = request.headers.get('x-debtsync-internal-secret');
  if (headerSecret === secret) return true;

  return false;
}

export function internalApiAuthHeaders(): Record<string, string> {
  const secret = getInternalApiSecret();
  if (!secret) return {};
  return {
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/json',
  };
}
