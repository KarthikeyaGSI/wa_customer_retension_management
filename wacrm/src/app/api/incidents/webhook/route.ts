import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { incident_id, account_id, incident_type, severity, summary, payload: incidentPayload, root_cause, action_taken } = body;

    if (!incident_id || !account_id || !incident_type || !summary) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const db = supabaseAdmin();

    // Get configured incident webhooks for this account
    const { data: endpoints, error } = await db
      .from('incident_webhooks')
      .select('*')
      .eq('account_id', account_id)
      .eq('is_active', true);

    if (error || !endpoints || endpoints.length === 0) {
      return NextResponse.json({ sent: 0, skipped: true, reason: 'No incident webhooks configured' });
    }

    const webhookPayload = {
      id: incident_id,
      incident_type,
      severity,
      summary,
      root_cause,
      action_taken,
      account_id,
      occurred_at: new Date().toISOString(),
      data: incidentPayload,
    };

    let sent = 0;
    for (const endpoint of endpoints) {
      try {
        let secret: string;
        try {
          const { decrypt } = await import('@/lib/whatsapp/encryption');
          secret = decrypt(endpoint.secret);
        } catch {
          console.error('[incident-webhook] Failed to decrypt secret for', endpoint.id);
          continue;
        }

        const rawBody = JSON.stringify(webhookPayload);
        const tsSeconds = Math.floor(Date.now() / 1000);
        const { buildSignatureHeader } = await import('@/lib/webhooks/sign');
        const signature = buildSignatureHeader(rawBody, secret, tsSeconds);

        const res = await fetch(endpoint.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Incident-Event': incident_type,
            'X-Incident-Id': incident_id,
            'X-Incident-Signature': signature,
          },
          body: rawBody,
          signal: AbortSignal.timeout(5000),
        });

        if (res.ok) {
          sent++;
          await db.from('incident_webhooks').update({
            last_sent_at: new Date().toISOString(),
            failure_count: 0,
          }).eq('id', endpoint.id);
        } else {
          await db.from('incident_webhooks').update({
            failure_count: (endpoint.failure_count ?? 0) + 1,
            last_error: `HTTP ${res.status}`,
          }).eq('id', endpoint.id);
        }
      } catch (err) {
        console.error('[incident-webhook] Delivery failed:', err);
        await db.from('incident_webhooks').update({
          failure_count: (endpoint.failure_count ?? 0) + 1,
          last_error: err instanceof Error ? err.message : String(err),
        }).eq('id', endpoint.id);
      }
    }

    return NextResponse.json({ sent, total: endpoints.length });
  } catch (err) {
    console.error('[incident-webhook] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}