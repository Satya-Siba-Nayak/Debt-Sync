'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { createClient } from '@/lib/supabase/client';
import { getCurrentUserFast } from '@/lib/utils/auth-session';
import { getDeviceContext, formatDeviceSummary, DeviceContext } from '@/lib/utils/device-info';

export type ReportCategory = 'bug' | 'ui' | 'idea';

interface BugReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialError?: string | null;
  initialCategory?: ReportCategory;
}

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
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [userProfile, setUserProfile] = useState<{ email?: string; name?: string } | null>(null);

  const supabase = React.useMemo(() => createClient(), []);

  useEffect(() => {
    if (!isOpen) return;

    setCategory(initialCategory);
    setErrorMessage(initialError || null);
    setDescription('');
    setSuccess(false);
    setError('');

    if (typeof window !== 'undefined') {
      setCurrentRoute(window.location.pathname + window.location.search);
      setDevice(getDeviceContext());
    }

    async function loadUser() {
      try {
        const u = await getCurrentUserFast(supabase);
        if (u) {
          setUserProfile({
            email: u.email,
            name: u.user_metadata?.full_name || u.email?.split('@')[0],
          });
        }
      } catch (_) {}
    }
    loadUser();
  }, [isOpen, initialError, initialCategory, supabase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      setError('Please add a short note describing what happened.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      let isSuccess = false;

      // 1. Primary: Server / Cloudflare Function API route
      try {
        const res = await fetch('/api/bug-report', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            category,
            description: description.trim(),
            errorMessage: errorMessage?.trim() || null,
            route: currentRoute,
            device: device || undefined,
            userName: userProfile?.name,
            userEmail: userProfile?.email,
          }),
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

      // 2. Direct Webhook Fallback (if hosted as pure static export on Cloudflare Pages)
      if (!isSuccess) {
        const directWebhookUrl =
          process.env.NEXT_PUBLIC_DISCORD_BUG_WEBHOOK_URL ||
          'https://discord.com/api/webhooks/1558604580080586932/j9kPe21iWJaDvVWm_BDlY0q8Xxkxp60DVfNIg94bjUjHRPYS2YolpYtim_2-qfdZH-cz';
        if (directWebhookUrl) {
          let color = 0xed4245;
          let title = '🐛 New Bug Report';
          if (category === 'ui') {
            color = 0xe67e22;
            title = '🎨 UI / Visual Glitch Report';
          } else if (category === 'idea') {
            color = 0x1abc9c;
            title = '💡 Feature Idea / Suggestion';
          }

          const fields: Array<{ name: string; value: string; inline?: boolean }> = [
            {
              name: '👤 Reporter',
              value: userProfile?.name
                ? `${userProfile.name} (${userProfile.email || 'No email'})`
                : userProfile?.email || 'Anonymous User',
              inline: true,
            },
            {
              name: '📍 Page Route',
              value: currentRoute ? `\`${currentRoute}\`` : '`Unknown`',
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

          const directRes = await fetch(directWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: 'DebtSync Bug Reporter',
              embeds: [
                {
                  title,
                  color,
                  description: description.trim(),
                  fields,
                  footer: { text: 'DebtSync Frictionless Reporting' },
                  timestamp: new Date().toISOString(),
                },
              ],
            }),
          });

          if (directRes.ok || directRes.status === 204) {
            isSuccess = true;
          }
        }
      }

      if (!isSuccess) {
        throw new Error('Could not deliver report. Please verify webhook configuration.');
      }

      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err: any) {
      console.error('Error sending bug report:', err);
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
      subtitle="Help us improve DebtSync — auto-captures page & device details"
      maxWidth="max-w-lg"
    >
      {success ? (
        <div className="py-8 px-4 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 mx-auto flex items-center justify-center">
            <span className="material-symbols-outlined text-[28px]">check_circle</span>
          </div>
          <h3 className="font-heading text-lg font-bold text-on-surface">
            Report Sent to Discord!
          </h3>
          <p className="font-mono text-xs text-on-surface-variant max-w-sm mx-auto">
            Your report was delivered to the development team. Thank you for making DebtSync better!
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 font-mono text-xs flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">error</span>
              <span>{error}</span>
            </div>
          )}

          {/* Category Chips */}
          <div className="space-y-1.5">
            <label className="font-mono text-xs uppercase tracking-wider text-on-surface-variant font-semibold block">
              What kind of issue is this?
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
                      ? 'border-primary bg-primary/10 text-primary shadow-xs'
                      : 'border-outline-variant/30 bg-surface-container hover:border-outline-variant/60 text-on-surface-variant'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">{c.icon}</span>
                  <span className="truncate">{c.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Captured Error Snippet (if available) */}
          {errorMessage && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 space-y-1 relative">
              <div className="flex justify-between items-center text-[10px] font-mono text-red-500 font-bold uppercase tracking-wider">
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">bug_report</span>
                  Captured Error
                </span>
                <button
                  type="button"
                  onClick={() => setErrorMessage(null)}
                  className="hover:underline text-[10px] text-red-400"
                >
                  Remove
                </button>
              </div>
              <p className="font-mono text-xs text-red-600 dark:text-red-400 break-words line-clamp-3">
                {errorMessage}
              </p>
            </div>
          )}

          {/* Description Textarea */}
          <div className="space-y-1.5">
            <label className="font-mono text-xs uppercase tracking-wider text-on-surface-variant font-semibold block">
              Description <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                category === 'bug'
                  ? 'Describe what happened or what you were doing...'
                  : category === 'ui'
                  ? 'Describe what looked out of place or broken on your screen...'
                  : 'Describe the feature or improvement you would like to see...'
              }
              className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/40 bg-surface text-on-surface text-base md:text-sm font-body-md outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all resize-none"
            />
          </div>

          {/* Auto-Captured Environment Context Card */}
          <div className="p-2.5 rounded-xl bg-surface-container border border-outline-variant/20 flex items-center justify-between gap-2 text-[11px] font-mono text-on-surface-variant">
            <div className="flex items-center gap-1.5 truncate">
              <span className="material-symbols-outlined text-[15px] text-primary shrink-0">info</span>
              <span className="truncate">
                Auto-attaching: <span className="font-bold text-on-surface">{currentRoute || '/'}</span>
              </span>
            </div>
            {device && (
              <span className="shrink-0 text-[10px] text-on-surface-variant/80">
                {device.isMobile ? 'Mobile' : 'Desktop'}
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="pt-2 border-t border-outline-variant/20 flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="py-2.5 px-4 rounded-xl border border-outline-variant/30 font-mono text-xs font-bold text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !description.trim()}
              className="py-2.5 px-5 rounded-xl bg-primary text-on-primary font-mono text-xs font-bold hover:opacity-95 shadow-md active:scale-[0.98] transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[16px]">
                {loading ? 'sync' : 'send'}
              </span>
              <span>{loading ? 'Sending...' : 'Send to Discord'}</span>
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
