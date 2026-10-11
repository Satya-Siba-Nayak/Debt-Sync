interface Env {
  DISCORD_BUG_WEBHOOK_URL?: string;
  NEXT_PUBLIC_DISCORD_BUG_WEBHOOK_URL?: string;
}

const DEFAULT_WEBHOOK_URL =
  'https://discord.com/api/webhooks/1558604580080586932/j9kPe21iWJaDvVWm_BDlY0q8Xxkxp60DVfNIg94bjUjHRPYS2YolpYtim_2-qfdZH-cz';

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  try {
    const contentType = context.request.headers.get('content-type') || '';
    let reportData: any;
    const uploadedFiles: File[] = [];

    if (contentType.includes('multipart/form-data')) {
      const formData = await context.request.formData();
      const payloadRaw = formData.get('payload_json');

      if (payloadRaw && typeof payloadRaw === 'string') {
        reportData = JSON.parse(payloadRaw);
      } else {
        const category = formData.get('category') || 'bug';
        const description = formData.get('description') || '';
        const errorMessage = formData.get('errorMessage') || null;
        const route = formData.get('route') || '';
        const userName = formData.get('userName') || '';
        const userEmail = formData.get('userEmail') || '';
        const userId = formData.get('userId') || '';
        let device: any;
        try {
          const deviceRaw = formData.get('device');
          if (deviceRaw && typeof deviceRaw === 'string') device = JSON.parse(deviceRaw);
        } catch (_) {}

        reportData = { category, description, errorMessage, route, device, userName, userEmail, userId };
      }

      for (const [key, value] of formData.entries()) {
        if (value instanceof File && key.startsWith('files')) {
          uploadedFiles.push(value);
        }
      }
    } else {
      reportData = await context.request.json();
    }

    const { category, description, errorMessage, route, device, userName, userEmail } = reportData;

    if (!description?.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: 'Please provide a brief description of what happened.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const webhookUrl =
      context.env.DISCORD_BUG_WEBHOOK_URL ||
      context.env.NEXT_PUBLIC_DISCORD_BUG_WEBHOOK_URL ||
      DEFAULT_WEBHOOK_URL;

    let color = 0xed4245;
    let title = '🐛 Bug Report';
    if (category === 'ui') {
      color = 0xe67e22;
      title = '🎨 UI / Visual Glitch';
    } else if (category === 'idea') {
      color = 0x1abc9c;
      title = '💡 Feature Idea & Feedback';
    }

    const fields: Array<{ name: string; value: string; inline?: boolean }> = [
      {
        name: '👤 Reporter',
        value: userName ? `**${userName}**\n${userEmail || 'No email'}` : userEmail ? `**${userEmail}**` : 'Anonymous User',
        inline: true,
      },
      {
        name: '📍 Page Route',
        value: route ? `\`${route}\`` : '`Unknown`',
        inline: true,
      },
    ];

    if (device) {
      const typeLabel = device.isTablet ? '📱 Tablet' : device.isMobile ? '📱 Mobile' : '💻 Desktop';
      const specs = [
        `${typeLabel} • ${device.os || 'Unknown OS'} • ${device.browser || 'Unknown Browser'}`,
        `Screen: ${device.screenResolution || 'N/A'} | Viewport: ${device.viewportSize || 'N/A'} (${device.pixelRatio || '1x'})`,
        `Network: ${device.network || 'Online'} | Theme: ${device.theme || 'Dark'}`,
        device.timezone ? `Timezone: ${device.timezone} • ${device.localTime || ''}` : '',
        [device.cores, device.memory].filter(Boolean).join(' • '),
        device.isPWA ? '⚡ Installed PWA Mode' : '',
      ]
        .filter(Boolean)
        .join('\n');

      fields.push({
        name: '🖥️ System & Environment Diagnostics',
        value: specs.length > 1000 ? specs.slice(0, 1000) + '...' : specs,
        inline: false,
      });
    }

    if (errorMessage?.trim()) {
      const truncated = errorMessage.length > 950 ? errorMessage.slice(0, 950) + '...' : errorMessage;
      fields.push({
        name: '⚠️ In-Error Banner Message',
        value: `\`\`\`${truncated}\`\`\``,
        inline: false,
      });
    }

    if (device?.recentErrors && device.recentErrors.length > 0) {
      const errorDump = device.recentErrors.join('\n').slice(0, 950);
      fields.push({
        name: '📜 Recent Runtime JavaScript Errors',
        value: `\`\`\`${errorDump}\`\`\``,
        inline: false,
      });
    }

    if (uploadedFiles.length > 0) {
      const fileSummary = uploadedFiles
        .map((f, i) => `#${i + 1} **${f.name}** (${(f.size / (1024 * 1024)).toFixed(2)} MB • ${f.type || 'file'})`)
        .join('\n');
      fields.push({
        name: `📎 Attached Media (${uploadedFiles.length} file${uploadedFiles.length > 1 ? 's' : ''})`,
        value: fileSummary.slice(0, 1000),
        inline: false,
      });
    }

    let embeddedImageAttachment: string | undefined;
    const firstImageFile = uploadedFiles.find((f) => f.type.startsWith('image/'));
    if (firstImageFile) {
      embeddedImageAttachment = firstImageFile.name;
    }

    const embed: any = {
      title,
      color,
      description: `### User Note\n${description.trim()}`,
      fields,
      footer: {
        text: 'DebtSync Cloudflare Edge • Live Telemetry',
      },
      timestamp: new Date().toISOString(),
    };

    if (embeddedImageAttachment) {
      embed.image = { url: `attachment://${embeddedImageAttachment}` };
    }

    const discordPayload = {
      username: 'DebtSync Telemetry',
      avatar_url: 'https://raw.githubusercontent.com/Satya-Siba-Nayak/Debt-Sync/main/public/icon.svg',
      embeds: [embed],
    };

    let discordRes: Response;

    if (uploadedFiles.length > 0) {
      const discordFormData = new FormData();
      discordFormData.append('payload_json', JSON.stringify(discordPayload));

      for (let i = 0; i < uploadedFiles.length; i++) {
        const file = uploadedFiles[i];
        discordFormData.append(`files[${i}]`, file, file.name);
      }

      discordRes = await fetch(webhookUrl, {
        method: 'POST',
        body: discordFormData,
      });
    } else {
      discordRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(discordPayload),
      });
    }

    if (!discordRes.ok && discordRes.status !== 204) {
      const errText = await discordRes.text();
      return new Response(
        JSON.stringify({ success: false, error: `Discord rejected webhook: ${discordRes.status}` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Delivered to Discord.' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
