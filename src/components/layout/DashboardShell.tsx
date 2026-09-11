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

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
  const [userProfile, setUserProfile] = useState<{
    id?: string;
    full_name?: string;
    email?: string;
    avatar_url?: string | null;
    recent_custom_avatars?: string[];
  } | null>(null);
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    async function loadUser() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login');
        return;
      }

      let profile: any = null;
      const { data: p1, error: p1Err } = await supabase
        .from('profiles')
        .select('id, full_name, email, avatar_url, recent_custom_avatars')
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

      setUserProfile({
        id: user.id,
        full_name: profile?.full_name || user.user_metadata?.full_name,
        email: user.email,
        avatar_url: profile?.avatar_url || null,
        recent_custom_avatars: recentFromDb,
      });
    }
    loadUser();

    // Listen for avatar / name updates from settings
    const handleUserUpdated = (e: any) => {
      const detail = e.detail;
      setUserProfile((prev) => ({
        ...prev,
        full_name: detail.fullName !== undefined ? detail.fullName : prev?.full_name,
        avatar_url: detail.avatarUrl !== undefined ? detail.avatarUrl : prev?.avatar_url,
        recent_custom_avatars: detail.recentCustomAvatars !== undefined ? detail.recentCustomAvatars : prev?.recent_custom_avatars,
      }));
    };
    window.addEventListener('debtsync:user_updated', handleUserUpdated);
    return () => window.removeEventListener('debtsync:user_updated', handleUserUpdated);
  }, [router, supabase]);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--background)] text-[var(--on-background)] font-body-md">
      {/* Desktop Sidebar */}
      <Sidebar onNewTransaction={() => setIsRecordModalOpen(true)} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:ml-60 h-screen overflow-y-auto pb-24 md:pb-8">
        <TopBar
          userId={userProfile?.id}
          userName={userProfile?.full_name}
          userEmail={userProfile?.email}
          avatarUrl={userProfile?.avatar_url}
          recentCustomAvatars={userProfile?.recent_custom_avatars}
          onNewTransaction={() => setIsRecordModalOpen(true)}
        />

        <main className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <BottomNav onNewTransaction={() => setIsRecordModalOpen(true)} />

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
