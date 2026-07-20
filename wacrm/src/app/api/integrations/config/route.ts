// ============================================================
// GET/POST /api/integrations/config
// Read + upsert the account's third-party integration settings.
// Admin-only writes. Secrets (Slack URL, Resend key) are encrypted
// at rest; GET never returns them — only `has_*` flags.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';

export async function GET() {
  try {
    const ctx = await requireRole('viewer');
    const { data, error } = await ctx.supabase
      .from('integrations_config')
      .select(
        'slack_enabled, slack_webhook_url, email_enabled, email_provider, email_from, email_api_key',
      )
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) {
      console.error('[GET /api/integrations/config]', error);
      return NextResponse.json({ error: 'Failed to load config' }, { status: 500 });
    }
    return NextResponse.json({
      data: data
        ? {
            slack_enabled: data.slack_enabled,
            has_slack_webhook: !!data.slack_webhook_url,
            has_email: !!data.email_api_key,
            email_enabled: data.email_enabled,
            email_provider: data.email_provider,
            email_from: data.email_from,
          }
        : {
            slack_enabled: false,
            has_slack_webhook: false,
            has_email: false,
            email_enabled: false,
            email_provider: 'resend',
            email_from: null,
          },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const limit = await checkRateLimit(
      `integrations:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

    const { data: existing, error: readErr } = await ctx.supabase
      .from('integrations_config')
      .select('id, slack_webhook_url, email_api_key')
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (readErr) {
      console.error('[POST /api/integrations/config] read', readErr);
      return NextResponse.json({ error: 'Failed to load config' }, { status: 500 });
    }

    // Slack webhook: encrypt only when a fresh value was provided.
    let slackUrlEnc: string | null = null;
    if (typeof body.slack_webhook_url === 'string' && body.slack_webhook_url.trim()) {
      slackUrlEnc = encrypt(body.slack_webhook_url.trim());
    } else if (existing?.slack_webhook_url) {
      // Preserve the existing encrypted value when left blank.
      slackUrlEnc = existing.slack_webhook_url;
    }

    // Resend key: encrypt only when a fresh value was provided.
    let emailKeyEnc: string | null = null;
    if (typeof body.email_api_key === 'string' && body.email_api_key.trim()) {
      emailKeyEnc = encrypt(body.email_api_key.trim());
    } else if (existing?.email_api_key) {
      emailKeyEnc = existing.email_api_key;
    }

    const payload = {
      slack_enabled: body.slack_enabled === true,
      slack_webhook_url: slackUrlEnc,
      email_enabled: body.email_enabled === true,
      email_provider: 'resend',
      email_api_key: emailKeyEnc,
      email_from: typeof body.email_from === 'string' ? body.email_from : null,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      const { error } = await ctx.supabase
        .from('integrations_config')
        .update(payload)
        .eq('account_id', ctx.accountId);
      if (error) {
        console.error('[POST /api/integrations/config] update', error);
        return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
      }
    } else {
      const { error } = await ctx.supabase
        .from('integrations_config')
        .insert({ ...payload, account_id: ctx.accountId, created_by: ctx.userId });
      if (error) {
        console.error('[POST /api/integrations/config] insert', error);
        return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
