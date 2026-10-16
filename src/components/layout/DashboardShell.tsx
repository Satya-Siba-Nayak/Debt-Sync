'use client';

import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';
import { RecordDebtModal } from '../debts/RecordDebtModal';
import { SplitBillModal } from '../debts/SplitBillModal';
import { BugReportModal, ReportCategory } from '../feedback/BugReportModal';
import { PWAInstallPrompt } from '../ui/PWAInstallPrompt';
import { createClient } from '@/lib/supabase/client';

import { useRouter } from 'next/navigation';
import { getLocalRecentAvatars } from '@/lib/utils/avatar-storage';
import { initErrorTracker } from '@/lib/utils/error-tracker';
import {
  getCurrentUserFast,
  getCachedUserProfile,
  setCachedUserProfile,
  clearAuthSessionData,
  CachedProfile,
} from '@/lib/utils/auth-session';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);
  const [isBugReportOpen, setIsBugReportOpen] = useState(false);
  const [bugReportParams, setBugReportParams] = useState<{
    error?: string | null;
    category?: ReportCategory;
  } | null>(null);
  const [recordModalParams, setRecordModalParams] = useState<{
    contactId?: string;
    person?: any;
  } | null>(null);
  // Instant frame-0 hydration from local cache
  const [userProfile, setUserProfile] = useState<CachedProfile | null>(() => getCachedUserProfile());
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    initErrorTracker();

    const handleOpenRecordModal = (e: any) => {
      setRecordModalParams(e.detail || null);
      setIsSplitModalOpen(false);
      setIsRecordModalOpen(true);
    };

    const handleOpenSplitModal = () => {
      setIsRecordModalOpen(false);
      setIsSplitModalOpen(true);
    };

    const handleOpenBugReport = (e: any) => {
      setBugReportParams(e.detail || null);
      setIsBugReportOpen(true);
    };

    window.addEventListener('debtsync:open_record_modal', handleOpenRecordModal);
    window.addEventListener('debtsync:open_split_modal', handleOpenSplitModal);
    window.addEventListener('debtsync:open_bug_report', handleOpenBugReport);

    return () => {
      window.removeEventListener('debtsync:open_record_modal', handleOpenRecordModal);
      window.removeEventListener('debtsync:open_split_modal', handleOpenSplitModal);
      window.removeEventListener('debtsync:open_bug_report', handleOpenBugReport);
    };
  }, []);

  useEffect(() => {
    async function loadUser() {
      // 0ms lookup from persistent session cookie / storage
      const user = await getCurrentUserFast(supabase);
      if (!user) {
        clearAuthSessionData();
        const currentPath = typeof window !== 'undefined'
          ? window.location.pathname + window.location.search
          : '';
        const nextQuery = currentPath && currentPath !== '/'
          ? `?next=${encodeURIComponent(currentPath)}`
          : '';
        router.replace(`/login${nextQuery}`);
        return;
      }

      // Cached profile belongs to another account on this device -> discard it right away
      const cached = getCachedUserProfile();
      if (cached && cached.id !== user.id) {
        clearAuthSessionData();
        setUserProfile({ id: user.id, email: user.email, is_admin: false });
      }

      let profile: any = null;
      const { data: p1, error: p1Err } = await supabase
        .from('profiles')
        .select('id, full_name, email, avatar_url, recent_custom_avatars, is_admin')
        .eq('id', user.id)
        .single();

      if (!p1Err && p1) {
        profile = p1;
      } else {
        const { data: p2 } = await supabase
          .from('profiles')
          .select('id, full_name, email, avatar_url')
          .eq('id', user.id)
          .single();
        profile = p2;
      }

      const recentFromDb = Array.isArray(profile?.recent_custom_avatars)
        ? profile.recent_custom_avatars
        : getLocalRecentAvatars(user.id);

      const resolved: CachedProfile = {
        id: user.id,
        full_name: profile?.full_name || user.user_metadata?.full_name,
        email: user.email,
        avatar_url: profile?.avatar_url || null,
        recent_custom_avatars: recentFromDb,
        is_admin: Boolean(profile?.is_admin),
      };

      setUserProfile(resolved);
      setCachedUserProfile(resolved);
    }
    loadUser();

    // Listen for avatar / name updates from settings
    const handleUserUpdated = (e: any) => {
      const detail = e.detail;
      setUserProfile((prev) => {
        const updated: CachedProfile = {
          id: prev?.id || '',
          full_name: detail.fullName !== undefined ? detail.fullName : prev?.full_name,
          email: prev?.email,
          avatar_url: detail.avatarUrl !== undefined ? detail.avatarUrl : prev?.avatar_url,
          recent_custom_avatars: detail.recentCustomAvatars !== undefined ? detail.recentCustomAvatars : prev?.recent_custom_avatars,
          is_admin: detail.isAdmin !== undefined ? detail.isAdmin : prev?.is_admin,
        };
        setCachedUserProfile(updated);
        return updated;
      });
    };
    window.addEventListener('debtsync:user_updated', handleUserUpdated);
    return () => window.removeEventListener('debtsync:user_updated', handleUserUpdated);
  }, [router]);

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] w-full max-w-full overflow-hidden bg-[var(--background)] text-[var(--on-background)] font-body-md">
      {/* Desktop Sidebar */}
      <Sidebar
        isAdmin={userProfile?.is_admin}
        onNewTransaction={() => {
          setRecordModalParams(null);
          setIsRecordModalOpen(true);
        }}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:ml-60 h-[100dvh] max-h-[100dvh] overflow-y-auto overflow-x-hidden min-w-0 max-w-full pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] md:pb-8">
        <TopBar
          userId={userProfile?.id}
          userName={userProfile?.full_name}
          userEmail={userProfile?.email}
          avatarUrl={userProfile?.avatar_url}
          recentCustomAvatars={userProfile?.recent_custom_avatars}
          isAdmin={userProfile?.is_admin}
          onNewTransaction={() => {
            setRecordModalParams(null);
            setIsRecordModalOpen(true);
          }}
        />

        <main className="flex-1 p-3.5 sm:p-4 md:p-8 max-w-7xl mx-auto w-full min-w-0">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <BottomNav
        isAdmin={userProfile?.is_admin}
        onNewTransaction={() => {
          setRecordModalParams(null);
          setIsRecordModalOpen(true);
        }}
      />

      {/* Global Record New Debt Modal */}
      <RecordDebtModal
        isOpen={isRecordModalOpen}
        preselectedContactId={recordModalParams?.contactId}
        preselectedPerson={recordModalParams?.person}
        onClose={() => {
          setIsRecordModalOpen(false);
          setRecordModalParams(null);
        }}
        onSwitchToSplit={() => {
          setIsRecordModalOpen(false);
          setIsSplitModalOpen(true);
        }}
        onDebtCreated={() => {
          window.dispatchEvent(new CustomEvent('debtsync:refresh'));
        }}
      />

      {/* Global Split Bill & Group Expenses Modal */}
      <SplitBillModal
        isOpen={isSplitModalOpen}
        onClose={() => setIsSplitModalOpen(false)}
        onSwitchToSingle={() => {
          setIsSplitModalOpen(false);
          setRecordModalParams(null);
          setIsRecordModalOpen(true);
        }}
        onSplitCreated={() => {
          window.dispatchEvent(new CustomEvent('debtsync:refresh'));
        }}
      />

      {/* Global Bug & Feedback Modal */}
      <BugReportModal
        isOpen={isBugReportOpen}
        onClose={() => {
          setIsBugReportOpen(false);
          setBugReportParams(null);
        }}
        initialError={bugReportParams?.error}
        initialCategory={bugReportParams?.category}
      />

      {/* PWA Install Prompt */}
      <PWAInstallPrompt />
    </div>
  );
}
