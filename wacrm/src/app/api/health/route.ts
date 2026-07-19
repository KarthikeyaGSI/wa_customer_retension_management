import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function GET() {
  const start = Date.now();
  const checks: Record<string, { status: 'ok' | 'degraded' | 'down'; latencyMs?: number; error?: string }> = {};

  // Database connectivity
  try {
    const dbStart = Date.now();
    const { error } = await supabaseAdmin().from('accounts').select('id').limit(1);
    checks.database = {
      status: error ? 'down' : 'ok',
      latencyMs: Date.now() - dbStart,
      error: error?.message,
    };
  } catch (e) {
    checks.database = { status: 'down', error: String(e) };
  }

  // WhatsApp config check (at least one account has config)
  try {
    const waStart = Date.now();
    const { data, error } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('id')
      .limit(1);
    checks.whatsapp = {
      status: error ? 'down' : data && data.length > 0 ? 'ok' : 'degraded',
      latencyMs: Date.now() - waStart,
      error: error?.message,
    };
  } catch (e) {
    checks.whatsapp = { status: 'down', error: String(e) };
  }

  // Overall status
  const statuses = Object.values(checks).map(c => c.status);
  const overall = statuses.includes('down') ? 'down' : statuses.includes('degraded') ? 'degraded' : 'ok';

  return NextResponse.json(
    {
      status: overall,
      timestamp: new Date().toISOString(),
      uptimeMs: Date.now() - ((globalThis as any).__START_TIME__ ?? Date.now()),
      version: process.env.npm_package_version ?? 'unknown',
      checks,
    },
    { status: overall === 'down' ? 503 : 200 }
  );
}

if (typeof globalThis !== 'undefined') {
  (globalThis as any).__START_TIME__ = (globalThis as any).__START_TIME__ ?? Date.now();
}