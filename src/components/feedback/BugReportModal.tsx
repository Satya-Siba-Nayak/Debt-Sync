'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Modal } from '../ui/Modal';
import { createClient } from '@/lib/supabase/client';
import { getCurrentUserFast } from '@/lib/utils/auth-session';
import { getDeviceContext, DeviceContext } from '@/lib/utils/device-info';

export type ReportCategory = 'bug' | 'ui' | 'idea';

interface AttachedMedia {
  file: File;
  id: string;
  previewUrl: string;
  name: string;
  size: number;
  isVideo: boolean;
  isImage: boolean;
}

interface BugReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialError?: string | null;
  initialCategory?: ReportCategory;
}

const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MB Discord limit
const MAX_FILE_COUNT = 5;
const DEFAULT_DISCORD_WEBHOOK =
  'https://discord.com/api/webhooks/1558604580080586932/j9kPe21iWJaDvVWm_BDlY0q8Xxkxp60DVfNIg94bjUjHRPYS2YolpYtim_2-qfdZH-cz';

export function BugReportModal({
  isOpen,
  onClose,
  initialError = null,
  initialCategory = 'bug',
}: BugReportModalProps) {
  const [category, setCategory] = useState<ReportCategory>(initialCategory);
  const [description, setDescription] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(initialError);
  const [currentRoute, setCurrentRoute] = useState('');
  const [device, setDevice] = useState<DeviceContext | null>(null);
  const [attachments, setAttachments] = useState<AttachedMedia[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [userProfile, setUserProfile] = useState<{ id?: string; email?: string; name?: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabase = useMemo(() => createClient(), []);

  // Compute total size of all attached files
  const totalAttachmentBytes = useMemo(() => {
    return attachments.reduce((sum, a) => sum + a.size, 0);
  }, [attachments]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Reset & load context on modal open
  useEffect(() => {
    if (!isOpen) return;

    setCategory(initialCategory);
    setErrorMessage(initialError || null);
    setDescription('');
    setAttachments([]);
    setSuccess(false);
    setError('');
    setShowDiagnostics(false);

    if (typeof window !== 'undefined') {
      setCurrentRoute(window.location.pathname + window.location.search);
      setDevice(getDeviceContext());
    }

    async function loadUser() {
      try {
        const u = await getCurrentUserFast(supabase);
        if (u) {
          setUserProfile({
            id: u.id,
            email: u.email,
            name: u.user_metadata?.full_name || u.email?.split('@')[0],
          });
        }
      } catch (_) {}
    }
    loadUser();
  }, [isOpen, initialError, initialCategory, supabase]);

  // Clean up object URLs on unmount or when attachments change
  useEffect(() => {
    return () => {
      attachments.forEach((a) => {
        if (a.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(a.previewUrl);
        }
      });
    };
  }, [attachments]);

  // Handle adding files with size and count validation
  const handleAddFiles = (files: FileList | File[]) => {
    setError('');
    const fileArray = Array.from(files);

    if (attachments.length + fileArray.length > MAX_FILE_COUNT) {
      setError(`You can attach a maximum of ${MAX_FILE_COUNT} files per report.`);
      return;
    }

    const newAttachments: AttachedMedia[] = [];
    let accumulatedBytes = totalAttachmentBytes;

    for (const file of fileArray) {
      // Validate supported format: image or video
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');

      if (!isImage && !isVideo) {
        setError(`"${file.name}" is not a supported image or video file.`);
        continue;
      }

      if (accumulatedBytes + file.size > MAX_TOTAL_BYTES) {
        setError('Total attachments exceed Discord\'s 25MB limit. Please attach smaller clips or photos.');
        break;
      }

      accumulatedBytes += file.size;
      const previewUrl = URL.createObjectURL(file);
      newAttachments.push({
        file,
        id: crypto.randomUUID(),
        previewUrl,
        name: file.name,
        size: file.size,
        isImage,
        isVideo,
      });
    }

    if (newAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...newAttachments]);
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => {
      const match = prev.find((a) => a.id === id);
      if (match?.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(match.previewUrl);
      }
      return prev.filter((a) => a.id !== id);
    });
  };

  // Clipboard Paste Support (Ctrl+V / Cmd+V screenshot paste)
  useEffect(() => {
    if (!isOpen) return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const pastedFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            const ext = item.type.split('/')[1] || 'png';
            const filename = `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;
            const file = new File([blob], filename, { type: blob.type });
            pastedFiles.push(file);
          }
        }
      }

      if (pastedFiles.length > 0) {
        e.preventDefault();
        handleAddFiles(pastedFiles);
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isOpen, attachments, totalAttachmentBytes]);

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      handleAddFiles(e.dataTransfer.files);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      setError('Please add a note describing what happened or your idea.');
      return;
    }

    if (totalAttachmentBytes > MAX_TOTAL_BYTES) {
      setError('Total file size exceeds Discord\'s 25MB limit. Please remove or compress some attachments.');
      return;
    }

    setLoading(true);
    setError('');

    const payloadData = {
      category,
      description: description.trim(),
      errorMessage: errorMessage?.trim() || null,
      route: currentRoute,
      device: device || undefined,
      userName: userProfile?.name,
      userEmail: userProfile?.email,
      userId: userProfile?.id,
    };

    try {
      let isSuccess = false;

      // 1. Primary: Server / Cloudflare Function API route with FormData
      try {
        const formData = new FormData();
        formData.append('payload_json', JSON.stringify(payloadData));

        attachments.forEach((att, idx) => {
          formData.append(`files[${idx}]`, att.file, att.name);
        });

        const res = await fetch('/api/bug-report', {
          method: 'POST',
          body: formData,
        });

        if (res.ok) {
          const data = await res.json().catch(() => ({ success: true }));
          if (data.success !== false) {
            isSuccess = true;
          }
        }
      } catch (_) {
        // Fall through to direct webhook fallback
      }

      // 2. Direct Webhook Fallback (if hosted as pure static export)
      if (!isSuccess) {
        const targetWebhookUrl =
          process.env.NEXT_PUBLIC_DISCORD_BUG_WEBHOOK_URL ||
          DEFAULT_DISCORD_WEBHOOK;

        if (targetWebhookUrl) {
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
              value: userProfile?.name
                ? `**${userProfile.name}**\n${userProfile.email || 'No email'}`
                : userProfile?.email
                ? `**${userProfile.email}**`
                : 'Anonymous User',
              inline: true,
            },
            {
              name: '📍 Page Route',
              value: currentRoute ? `\`${currentRoute}\`` : '`Unknown`',
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

          if (errorMessage) {
            const truncated = errorMessage.length > 950 ? errorMessage.substring(0, 950) + '...' : errorMessage;
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

          if (attachments.length > 0) {
            const fileSummary = attachments
              .map((a, i) => `#${i + 1} **${a.name}** (${formatFileSize(a.size)} • ${a.isVideo ? 'video' : 'image'})`)
              .join('\n');
            fields.push({
              name: `📎 Attached Media (${attachments.length} file${attachments.length > 1 ? 's' : ''})`,
              value: fileSummary.slice(0, 1000),
              inline: false,
            });
          }

          // Primary embedded image attachment
          const firstImage = attachments.find((a) => a.isImage);
          const embed: any = {
            title,
            color,
            description: `### User Note\n${description.trim()}`,
            fields,
            footer: { text: 'DebtSync User Feedback • Live Telemetry' },
            timestamp: new Date().toISOString(),
          };

          if (firstImage) {
            embed.image = { url: `attachment://${firstImage.name}` };
          }

          const discordPayload = {
            username: 'DebtSync Telemetry',
            avatar_url: 'https://raw.githubusercontent.com/Satya-Siba-Nayak/Debt-Sync/main/public/icon.svg',
            embeds: [embed],
          };

          let directRes: Response;

          if (attachments.length > 0) {
            const directFormData = new FormData();
            directFormData.append('payload_json', JSON.stringify(discordPayload));

            attachments.forEach((a, idx) => {
              directFormData.append(`files[${idx}]`, a.file, a.name);
            });

            directRes = await fetch(targetWebhookUrl, {
              method: 'POST',
              body: directFormData,
            });
          } else {
            directRes = await fetch(targetWebhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(discordPayload),
            });
          }

          if (directRes.ok || directRes.status === 204) {
            isSuccess = true;
          }
        }
      }

      if (!isSuccess) {
        throw new Error('Could not deliver report to Discord. Please check your network connection.');
      }

      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 2200);
    } catch (err: any) {
      console.error('Error submitting bug report:', err);
      setError(err.message || 'Could not send report. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Report an Issue or Feedback"
      subtitle="Help us improve DebtSync — auto-captures diagnostics and attaches media"
      maxWidth="max-w-xl"
    >
      {success ? (
        <div className="py-8 px-4 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 mx-auto flex items-center justify-center">
            <span className="material-symbols-outlined text-[28px]">check_circle</span>
          </div>
          <h3 className="font-heading text-lg font-bold text-[var(--on-surface)]">
            Report &amp; Media Sent to Discord!
          </h3>
          <p className="font-mono text-xs text-[var(--on-surface-variant)] max-w-sm mx-auto">
            Your feedback, diagnostics, and media attachments were delivered directly to the team. Thank you!
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 font-mono text-xs flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px] shrink-0">error</span>
              <span>{error}</span>
            </div>
          )}

          {/* 1. Category Chips */}
          <div className="space-y-1.5">
            <label className="font-mono text-xs uppercase tracking-wider text-[var(--on-surface-variant)] font-semibold block">
              Category
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'bug' as ReportCategory, label: 'Bug / Error', icon: 'pest_control' },
                { id: 'ui' as ReportCategory, label: 'UI Glitch', icon: 'palette' },
                { id: 'idea' as ReportCategory, label: 'Feature Idea', icon: 'lightbulb' },
              ].map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id)}
                  className={`py-2 px-2.5 rounded-xl border font-mono text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    category === c.id
                      ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)] shadow-xs'
                      : 'border-[var(--outline-variant)]/30 bg-[var(--surface-container)] hover:border-[var(--outline-variant)]/60 text-[var(--on-surface-variant)]'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">{c.icon}</span>
                  <span className="truncate">{c.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 2. In-Error Banner (if triggered from error modal) */}
          {errorMessage && (
            <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/25 text-[var(--error)] text-xs font-mono flex items-start gap-2">
              <span className="material-symbols-outlined text-[15px] shrink-0 mt-0.5">warning</span>
              <div className="min-w-0 flex-1">
                <span className="font-bold block text-[10px] uppercase text-red-500">Captured Error:</span>
                <span className="line-clamp-2">{errorMessage}</span>
              </div>
            </div>
          )}

          {/* 3. Description Textarea */}
          <div className="space-y-1.5">
            <label className="font-mono text-xs uppercase tracking-wider text-[var(--on-surface-variant)] font-semibold block">
              What happened? <span className="text-[var(--error)]">*</span>
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                category === 'bug'
                  ? 'Describe what happened or the steps to reproduce...'
                  : category === 'ui'
                  ? 'Describe what looked out of place or broken on your screen...'
                  : 'Describe the feature, improvement, or design you would like to see...'
              }
              className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--outline-variant)]/40 bg-[var(--surface)] text-[var(--on-surface)] text-base md:text-sm font-body-md outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/30 transition-all resize-none"
            />
          </div>

          {/* 4. Media & Video Attachments (Up to 25MB Discord limit) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-mono text-xs uppercase tracking-wider text-[var(--on-surface-variant)] font-semibold flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[15px]">attach_file</span>
                <span>Screenshots &amp; Screen Recordings</span>
              </label>
              <span className="font-mono text-[10px] text-[var(--on-surface-variant)]/70">
                {attachments.length}/{MAX_FILE_COUNT} files &bull; {formatFileSize(totalAttachmentBytes)} / 25MB
              </span>
            </div>

            {/* Hidden native file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/mp4,video/webm,video/quicktime"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleAddFiles(e.target.files);
                e.target.value = '';
              }}
            />

            {/* Drag & Drop Upload Zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`p-3.5 rounded-xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center gap-1 text-center ${
                isDraggingOver
                  ? 'border-[var(--primary)] bg-[var(--primary)]/10 scale-[1.01]'
                  : 'border-[var(--outline-variant)]/40 hover:border-[var(--primary)]/60 bg-[var(--surface-container)]/40'
              }`}
            >
              <div className="flex items-center gap-2 text-[var(--on-surface-variant)]">
                <span className="material-symbols-outlined text-[20px] text-[var(--primary)]">add_photo_alternate</span>
                <span className="font-mono text-xs font-semibold text-[var(--on-surface)]">
                  Click to browse, drag &amp; drop, or press <kbd className="px-1 py-0.5 rounded bg-[var(--surface-container-highest)] border border-[var(--outline-variant)]/40 text-[10px]">Ctrl+V</kbd> to paste
                </span>
              </div>
              <p className="font-mono text-[10px] text-[var(--on-surface-variant)]/70">
                Supports PNG, JPG, WebP, GIF, MP4, WebM clips (Max 25MB total)
              </p>
            </div>

            {/* Attachment Thumbnails Grid */}
            {attachments.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className="relative group rounded-xl border border-[var(--outline-variant)]/30 bg-[var(--surface-container-lowest)] p-1.5 flex items-center gap-2 overflow-hidden shadow-xs"
                  >
                    {/* Media Thumbnail */}
                    <div className="w-11 h-11 rounded-lg overflow-hidden bg-black/10 shrink-0 flex items-center justify-center relative">
                      {att.isImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={att.previewUrl}
                          alt={att.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-slate-900 text-white flex flex-col items-center justify-center">
                          <span className="material-symbols-outlined text-[18px]">videocam</span>
                          <span className="text-[8px] font-mono uppercase">VIDEO</span>
                        </div>
                      )}
                    </div>

                    {/* File Meta */}
                    <div className="min-w-0 flex-1 pr-5">
                      <p className="font-mono text-[11px] font-semibold text-[var(--on-surface)] truncate" title={att.name}>
                        {att.name}
                      </p>
                      <p className="font-mono text-[10px] text-[var(--on-surface-variant)]/80">
                        {formatFileSize(att.size)}
                      </p>
                    </div>

                    {/* Delete button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveAttachment(att.id);
                      }}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 hover:bg-red-600 text-white flex items-center justify-center transition-colors cursor-pointer"
                      title="Remove file"
                    >
                      <span className="material-symbols-outlined text-[13px]">close</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 5. Auto-Captured Environment Context & Diagnostics */}
          <div className="rounded-xl bg-[var(--surface-container)]/60 border border-[var(--outline-variant)]/20 overflow-hidden text-[11px] font-mono text-[var(--on-surface-variant)]">
            <button
              type="button"
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              className="w-full p-2.5 flex items-center justify-between text-left hover:bg-[var(--surface-container-high)]/40 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-1.5 truncate">
                <span className="material-symbols-outlined text-[15px] text-[var(--on-surface-variant)]/70 shrink-0">
                  {showDiagnostics ? 'expand_less' : 'expand_more'}
                </span>
                <span className="truncate">
                  Auto-attaching: <span className="font-semibold text-[var(--on-surface)]">{currentRoute || '/'}</span>
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {device && (
                  <span className="text-[10px] text-[var(--on-surface-variant)]/70">
                    {device.isMobile ? 'Mobile' : 'Desktop'} &bull; {device.network}
                  </span>
                )}
                <span className="text-[10px] text-[var(--primary)] underline">
                  {showDiagnostics ? 'Hide' : 'Inspect'}
                </span>
              </div>
            </button>

            {/* Collapsible Full Diagnostic Specifications */}
            {showDiagnostics && device && (
              <div className="p-3 pt-1 border-t border-[var(--outline-variant)]/20 bg-[var(--surface-container-lowest)]/50 space-y-2 text-[10px]">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  <div>
                    <span className="text-[var(--outline)] block">Device &amp; OS:</span>
                    <span className="font-semibold text-[var(--on-surface)]">{device.os} ({device.browser})</span>
                  </div>
                  <div>
                    <span className="text-[var(--outline)] block">Display Specs:</span>
                    <span className="font-semibold text-[var(--on-surface)]">{device.screenResolution} ({device.viewportSize}, {device.pixelRatio})</span>
                  </div>
                  <div>
                    <span className="text-[var(--outline)] block">Network &amp; Speed:</span>
                    <span className="font-semibold text-[var(--on-surface)]">{device.network}</span>
                  </div>
                  <div>
                    <span className="text-[var(--outline)] block">Timezone &amp; Local:</span>
                    <span className="font-semibold text-[var(--on-surface)]">{device.timezone} ({device.localTime})</span>
                  </div>
                  <div>
                    <span className="text-[var(--outline)] block">Theme &amp; Mode:</span>
                    <span className="font-semibold text-[var(--on-surface)]">{device.theme} {device.isPWA ? '• PWA Standalone' : ''}</span>
                  </div>
                  <div>
                    <span className="text-[var(--outline)] block">Hardware:</span>
                    <span className="font-semibold text-[var(--on-surface)]">{device.cores || 'N/A'} {device.memory ? `• ${device.memory}` : ''}</span>
                  </div>
                </div>

                {device.recentErrors && device.recentErrors.length > 0 && (
                  <div className="pt-1.5 border-t border-[var(--outline-variant)]/20">
                    <span className="text-[var(--error)] font-bold block mb-1">Captured Client Exceptions:</span>
                    <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[var(--error)] max-h-24 overflow-y-auto font-mono text-[9px] space-y-1">
                      {device.recentErrors.map((errStr, idx) => (
                        <div key={idx} className="truncate">{errStr}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 6. Form Footer Actions */}
          <div className="pt-2 border-t border-[var(--outline-variant)]/20 flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] text-[var(--on-surface-variant)]/70 truncate hidden sm:inline">
              Sends encrypted webhook embed to Discord
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="py-2.5 px-4 rounded-xl border border-[var(--outline-variant)]/30 font-mono text-xs font-bold text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container)] transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !description.trim() || totalAttachmentBytes > MAX_TOTAL_BYTES}
                className="py-2.5 px-5 rounded-xl bg-[var(--primary)] text-[var(--on-primary)] font-mono text-xs font-bold hover:opacity-95 shadow-md active:scale-[0.98] transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-[16px]">
                  {loading ? 'progress_activity' : 'send'}
                </span>
                <span>
                  {loading
                    ? 'Delivering to Discord...'
                    : attachments.length > 0
                    ? `Send to Discord (${attachments.length} file${attachments.length > 1 ? 's' : ''})`
                    : 'Send to Discord'}
                </span>
              </button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
