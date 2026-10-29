export function getInternalApiSecret(env: Record<string, string | undefined>): string | null {
  const secret =
    env.DEBTSYNC_INTERNAL_API_SECRET?.trim() ||
    env.CRON_SECRET?.trim();
  return secret || null;
}

export function isInternalApiAuthorized(
  request: Request,
  env: Record<string, string | undefined>
): boolean {
  const secret = getInternalApiSecret(env);
  if (!secret) return false;

  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${secret}`) return true;

  const headerSecret = request.headers.get('x-debtsync-internal-secret');
  if (headerSecret === secret) return true;

  return false;
}
