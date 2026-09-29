'use client';

import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';
import { RecordDebtModal } from '../debts/RecordDebtModal';
import { PWAInstallPrompt } from '../ui/PWAInstallPrompt';
import { createClient } from '@/lib/supabase/client';

import { useRouter } from 'next/navigation';
import { getLocalRecentAvatars } from '@/lib/utils/avatar-storage';
import {
  getCurrentUserFast,
  getCachedUserProfile,
  setCachedUserProfile,
  clearAuthSessionData,
  CachedProfile,
} from '@/lib/utils/auth-session';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
  // Instant frame-0 hydration from local cache
  const [userProfile, setUserProfile] = useState<CachedProfile | null>(() => getCachedUserProfile());
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    async function loadUser() {
      // 0ms lookup from persistent session cookie / storage
      const user = await getCurrentUserFast(supabase);
      if (!user) {
        clearAuthSessionData();
        router.replace('/login');
        return;
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
    <div className="flex h-screen overflow-hidden bg-[var(--background)] text-[var(--on-background)] font-body-md">
      {/* Desktop Sidebar */}
      <Sidebar
        isAdmin={userProfile?.is_admin}
        onNewTransaction={() => setIsRecordModalOpen(true)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:ml-60 h-screen overflow-y-auto pb-24 md:pb-8">
        <TopBar
          userId={userProfile?.id}
          userName={userProfile?.full_name}
          userEmail={userProfile?.email}
          avatarUrl={userProfile?.avatar_url}
          recentCustomAvatars={userProfile?.recent_custom_avatars}
          isAdmin={userProfile?.is_admin}
          onNewTransaction={() => setIsRecordModalOpen(true)}
        />

        <main className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <BottomNav
        isAdmin={userProfile?.is_admin}
        onNewTransaction={() => setIsRecordModalOpen(true)}
      />

      {/* Global Record New Debt Modal */}
      <RecordDebtModal
        isOpen={isRecordModalOpen}
        onClose={() => setIsRecordModalOpen(false)}
        onDebtCreated={() => {
          // Trigger page reload or custom event
          window.dispatchEvent(new CustomEvent('debtsync:refresh'));
        }}
      />
      {/* PWA Install Prompt */}
      <PWAInstallPrompt />
    </div>
  );
}
