import { supabaseAdmin } from '@/lib/automations/admin-client';

interface SLAPolicy {
  id: string;
  account_id: string;
  first_response_hours: number;
  resolution_hours: number;
  business_hours_only: boolean;
  timezone: string;
}

export async function checkSLAForConversation(
  conversationId: string,
  event: 'message_received' | 'message_sent' | 'conversation_resolved'
): Promise<void> {
  const db = supabaseAdmin();

  const { data: conv } = await db
    .from('conversations')
    .select('id, account_id, created_at, first_response_at, resolved_at, status, sla_breached, sla_breach_type')
    .eq('id', conversationId)
    .single();

  if (!conv) return;

  const { data: policy } = await supabaseAdmin()
    .from('sla_policies')
    .select('*')
    .eq('account_id', conv.account_id)
    .eq('is_default', true)
    .single();

  if (!policy) return;

  const now = new Date();

  // First response SLA
  if (event === 'message_received' && !conv.first_response_at && !conv.sla_breached) {
    const deadline = new Date(conv.created_at);
    deadline.setHours(deadline.getHours() + policy.first_response_hours);

    if (now > deadline) {
      await markSLABreach(conv.id, conv.account_id, 'first_response', deadline);
    }
  }

  // Resolution SLA
  if (event === 'conversation_resolved' || (event === 'message_sent' && !conv.resolved_at)) {
    if (!conv.resolved_at && !conv.sla_breached) {
      const deadline = new Date(conv.created_at);
      deadline.setHours(deadline.getHours() + policy.resolution_hours);

      if (now > deadline) {
        await markSLABreach(conv.id, conv.account_id, 'resolution', deadline);
      }
    }
  }
}

async function markSLABreach(
  conversationId: string,
  accountId: string,
  breachType: 'first_response' | 'resolution',
  expectedAt: Date
): Promise<void> {
  const db = supabaseAdmin();

  // Update conversation
  await db
    .from('conversations')
    .update({ sla_breached: true, sla_breach_type: breachType })
    .eq('id', conversationId);

  // Log breach
  await db.from('sla_breaches').insert({
    account_id: accountId,
    conversation_id: conversationId,
    breach_type: breachType,
    expected_at: expectedAt.toISOString(),
  });
}

export async function checkAllSLAs(): Promise<number> {
  const db = supabaseAdmin();
  let breached = 0;

  // Get all accounts with default SLA policies
  const { data: policies } = await db
    .from('sla_policies')
    .select('*')
    .eq('is_default', true);

  if (!policies?.length) return 0;

  for (const policy of policies) {
    // First response breaches
    const { data: noResponseConvs } = await db
      .from('conversations')
      .select('id, account_id, created_at')
      .eq('account_id', policy.account_id)
      .is('first_response_at', null)
      .eq('sla_breached', false)
      .neq('status', 'closed')
      .lte('created_at', new Date(Date.now() - policy.first_response_hours * 60 * 60 * 1000).toISOString());

    for (const conv of noResponseConvs ?? []) {
      await markSLABreach(conv.id, conv.account_id, 'first_response', new Date(conv.created_at));
      breached++;
    }

    // Resolution breaches
    const { data: unresolvedConvs } = await db
      .from('conversations')
      .select('id, account_id, created_at')
      .eq('account_id', policy.account_id)
      .is('resolved_at', null)
      .eq('sla_breached', false)
      .neq('status', 'closed')
      .lte('created_at', new Date(Date.now() - policy.resolution_hours * 60 * 60 * 1000).toISOString());

    for (const conv of unresolvedConvs ?? []) {
      await markSLABreach(conv.id, conv.account_id, 'resolution', new Date(conv.created_at));
      breached++;
    }
  }

  return breached;
}

// Cron endpoint
export async function GET(request: Request): Promise<Response> {
  const expected = process.env.SLA_CRON_SECRET;
  if (!expected) {
    return new Response(JSON.stringify({ error: 'not configured' }), { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret');
  if (supplied !== expected) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const breached = await checkAllSLAs();
    return Response.json({ breached });
  } catch (err) {
    console.error('[sla-cron] Error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}