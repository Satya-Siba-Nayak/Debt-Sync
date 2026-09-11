import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { action, identifier, clientSessionId } = body;

    if (!action || typeof action !== 'string') {
      return NextResponse.json(
        { allowed: false, message: 'Invalid rate limit action specified' },
        { status: 400 }
      );
    }

    // 1. Extract real client IP
    const forwarded = request.headers.get('x-forwarded-for');
    let ip = '127.0.0.1';
    if (forwarded) {
      ip = forwarded.split(',')[0].trim();
    } else {
      ip =
        request.headers.get('x-real-ip') ||
        request.headers.get('cf-connecting-ip') ||
        '127.0.0.1';
    }

    // 2. Extract or establish persistent browser session ID
    let sessionId = request.cookies.get('debtsync_session_id')?.value;
    let isNewSession = false;

    if (!sessionId || sessionId.length < 8) {
      sessionId =
        typeof clientSessionId === 'string' && clientSessionId.length >= 8
          ? clientSessionId
          : crypto.randomUUID();
      isNewSession = true;
    }

    // 3. Call Supabase RPC rate-limit check
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('check_and_record_rate_limit', {
      p_action: action,
      p_identifier: identifier ? String(identifier).trim() : null,
      p_ip_address: ip,
      p_session_id: sessionId,
    });

    if (error) {
      console.warn('Rate limit RPC error (falling back to allowed):', error.message);
      // Fail-open for legitimate users if migration is not yet applied
      const res = NextResponse.json({ allowed: true, sessionId });
      if (isNewSession) {
        res.cookies.set('debtsync_session_id', sessionId, {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          maxAge: 60 * 60 * 24 * 365,
        });
      }
      return res;
    }

    const isAllowed = data?.allowed !== false;
    const statusCode = isAllowed ? 200 : 429;

    const response = NextResponse.json(
      {
        allowed: isAllowed,
        message: data?.message,
        reason: data?.reason,
        sessionId,
      },
      { status: statusCode }
    );

    if (isNewSession) {
      response.cookies.set('debtsync_session_id', sessionId, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 365, // 1 year persistence
      });
    }

    return response;
  } catch (err: any) {
    console.error('Unhandled rate limit error:', err);
    return NextResponse.json({ allowed: true });
  }
}
