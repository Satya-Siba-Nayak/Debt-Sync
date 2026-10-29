import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isInternalApiAuthorized } from '@/lib/server/internal-api-auth';

function getReminderSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function processDueDateReminders() {
  const supabase = getReminderSupabaseClient();
  if (!supabase) {
    return {
      success: false,
      error:
        'Due-date reminder job is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.',
    };
  }

  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc('check_and_send_due_date_reminders');
    if (!rpcError && rpcData?.success) {
      return {
        success: true,
        method: 'rpc',
        ...rpcData,
      };
    }

    return {
      success: false,
      method: 'rpc',
      error: rpcError?.message || rpcData?.error || 'Due-date reminder RPC did not succeed.',
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Due-date reminder RPC failed.';
    return { success: false, error: message };
  }
}

export async function POST(request: NextRequest) {
  if (!isInternalApiAuthorized(request)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Unauthorized. Use a scheduled job with DEBTSYNC_INTERNAL_API_SECRET.',
      },
      { status: 401 }
    );
  }

  const result = await processDueDateReminders();
  const status = result.success ? 200 : 503;
  return NextResponse.json(result, { status });
}
