type DiscordWebhookPurpose = 'bug' | 'contact';

function pickFirstDefined(env: Record<string, string | undefined>, keys: string[]): string | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return null;
}

/** Resolve Discord webhook from server-only env vars (never NEXT_PUBLIC_). */
export function resolveDiscordWebhookUrl(
  env: Record<string, string | undefined>,
  purpose: DiscordWebhookPurpose
): string | null {
  const contactKeys = ['DISCORD_CONTACT_WEBHOOK_URL', 'DISCORD_CONTACT_WEBHOOK_URI'];
  const bugKeys = ['DISCORD_BUG_WEBHOOK_URL', 'DISCORD_BUG_WEBHOOK_URI'];
  const sharedKeys = [
    'DISCORD_WEBHOOK_URL',
    'DISCORD_WEBHOOK_URI',
    'DISCORD_WEBHOOK',
    'WEBHOOK_URL',
  ];

  const order =
    purpose === 'contact'
      ? [...contactKeys, ...bugKeys, ...sharedKeys]
      : [...bugKeys, ...contactKeys, ...sharedKeys];

  const explicit = pickFirstDefined(env, order);
  if (explicit) return explicit;

  for (const val of Object.values(env)) {
    if (typeof val === 'string' && val.trim().startsWith('https://discord.com/api/webhooks/')) {
      return val.trim();
    }
  }

  return null;
}

export function resolveDiscordWebhookFromProcess(purpose: DiscordWebhookPurpose): string | null {
  return resolveDiscordWebhookUrl(process.env as Record<string, string | undefined>, purpose);
}
