interface Env {
  DISCORD_BUG_WEBHOOK_URL?: string;
  NEXT_PUBLIC_DISCORD_BUG_WEBHOOK_URL?: string;
}

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  try {
    const body: any = await context.request.json();
    const { category, description, errorMessage, route, device, userName, userEmail } = body;

    if (!description?.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: 'Please provide a brief description of what happened.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const webhookUrl =
      context.env.DISCORD_BUG_WEBHOOK_URL ||
      context.env.NEXT_PUBLIC_DISCORD_BUG_WEBHOOK_URL ||
      'https://discord.com/api/webhooks/1558604580080586932/j9kPe21iWJaDvVWm_BDlY0q8Xxkxp60DVfNIg94bjUjHRPYS2YolpYtim_2-qfdZH-cz';

    if (!webhookUrl) {
      return new Response(
        JSON.stringify({ success: false, error: 'DISCORD_BUG_WEBHOOK_URL not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let color = 0xed4245;
    let title = '🐛 New Bug Report';
    if (category === 'ui') {
      color = 0xe67e22;
      title = '🎨 UI / Visual Glitch Report';
    } else if (category === 'idea') {
      color = 0x1abc9c;
      title = '💡 Feature Idea / Suggestion';
    }

    const fields = [
      {
        name: '👤 Reporter',
        value: userName ? `${userName} (${userEmail || 'No email'})` : userEmail || 'Anonymous User',
        inline: true,
      },
      {
        name: '📍 Page Route',
        value: route ? `\`${route}\`` : '`Unknown`',
        inline: true,
      },
      {
        name: '📱 Client & Device',
        value: device
          ? `${device.isMobile ? '📱 Mobile' : '💻 Desktop'} • ${device.os || 'Unknown OS'} • ${device.browser || 'Unknown Browser'}`
          : 'Not captured',
        inline: false,
      },
    ];

    if (errorMessage) {
      const truncated = errorMessage.length > 950 ? errorMessage.substring(0, 950) + '...' : errorMessage;
      fields.push({
        name: '⚠️ Captured Error Message',
        value: `\`\`\`${truncated}\`\`\``,
        inline: false,
      });
    }

    const embed = {
      title,
      color,
      description: description.trim(),
      fields,
      footer: {
        text: 'DebtSync Cloudflare Edge • Frictionless Reporting',
      },
      timestamp: new Date().toISOString(),
    };

    const discordRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'DebtSync Bug Reporter',
        embeds: [embed],
      }),
    });

    if (!discordRes.ok) {
      const errText = await discordRes.text();
      return new Response(
        JSON.stringify({ success: false, error: `Discord rejected webhook: ${discordRes.status}` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
