import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { processWebhookDeliveryQueue } from '@/lib/webhooks/retry-queue';

export async function GET(request: Request) {
  const expected = process.env.WEBHOOK_DELIVERY_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'webhook delivery cron not configured' }, { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret');
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const processed = await processWebhookDeliveryQueue(supabaseAdmin());
    return NextResponse.json({ processed });
  } catch (err) {
    console.error('[webhook-delivery-cron] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}