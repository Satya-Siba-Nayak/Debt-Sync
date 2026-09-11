'use client';

import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';
import { RecordDebtModal } from '../debts/RecordDebtModal';
import { createClient } from '@/lib/supabase/client';

import { useRouter } from 'next/navigation';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
  const [userProfile, setUserProfile] = useState<{ full_name?: string; email?: string } | null>(null);
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    async function loadUser() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login');
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', user.id)
        .single();

      setUserProfile({
        full_name: profile?.full_name || user.user_metadata?.full_name,
        email: user.email,
      });
    }
    loadUser();
  }, [router, supabase]);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--background)] text-[var(--on-background)] font-body-md">
      {/* Desktop Sidebar */}
      <Sidebar onNewTransaction={() => setIsRecordModalOpen(true)} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:ml-60 h-screen overflow-y-auto pb-20 md:pb-8">
        <TopBar
          userName={userProfile?.full_name}
          userEmail={userProfile?.email}
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
    </div>
  );
}
