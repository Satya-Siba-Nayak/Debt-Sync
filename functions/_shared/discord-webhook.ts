type DiscordWebhookPurpose = 'bug' | 'contact';

function pickFirstDefined(env: Record<string, string | undefined>, keys: string[]): string | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return null;
}

export function resolveDiscordWebhookUrl(
  env: Record<string, string | undefined>,
  purpose: DiscordWebhookPurpose
): string | null {
  const contactKeys = ['DISCORD_CONTACT_WEBHOOK_URL', 'DISCORD_CONTACT_WEBHOOK_URI'];
  const bugKeys = ['DISCORD_BUG_WEBHOOK_URL', 'DISCORD_BUG_WEBHOOK_URI'];
  const sharedKeys = ['DISCORD_WEBHOOK_URL', 'DISCORD_WEBHOOK_URI'];

  const order =
    purpose === 'contact'
      ? [...contactKeys, ...bugKeys, ...sharedKeys]
      : [...bugKeys, ...contactKeys, ...sharedKeys];

  return pickFirstDefined(env, order);
}
