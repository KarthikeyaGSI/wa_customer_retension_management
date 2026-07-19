import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');

    const db = ctx.supabase;

    const [
      { data: convs, error: convErr },
      { data: msgs, error: msgErr },
      { data: contacts, error: contactErr },
      { data: broadcasts, error: broadcastErr },
      { data: webhooks, error: webhookErr },
      { data: automations, error: autoErr },
    ] = await Promise.all([
      db.from('conversations').select('id, status, unread_count, last_message_at').eq('account_id', ctx.accountId),
      db.from('messages').select('id, status, direction, created_at, conversation_id').eq('account_id', ctx.accountId),
      db.from('contacts').select('id, created_at').eq('account_id', ctx.accountId),
      db.from('broadcasts').select('id, status, total_recipients, sent_count, delivered_count, read_count, failed_count, created_at').eq('account_id', ctx.accountId),
      db.from('webhook_endpoints').select('id, is_active, failure_count, last_delivery_at').eq('account_id', ctx.accountId),
      db.from('automations').select('id, is_active, execution_count, last_executed_at').eq('account_id', ctx.accountId),
    ]);

    if (convErr || msgErr || contactErr || broadcastErr || webhookErr || autoErr) {
      console.error('[api/v1/dashboard/stats] query errors:', { convErr, msgErr, contactErr, broadcastErr, webhookErr, autoErr });
      return fail('internal', 'Failed to fetch dashboard stats', 500);
    }

    // Conversation stats
    const totalConversations = convs?.length ?? 0;
    const openConversations = convs?.filter(c => c.status === 'open').length ?? 0;
    const pendingConversations = convs?.filter(c => c.status === 'pending').length ?? 0;
    const closedConversations = convs?.filter(c => c.status === 'closed').length ?? 0;
    const totalUnread = convs?.reduce((sum, c) => sum + (c.unread_count ?? 0), 0) ?? 0;

    // Message stats (last 24h)
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const recentMsgs = msgs?.filter(m => m.created_at >= dayAgo) ?? [];
    const inbound24h = recentMsgs.filter(m => m.direction === 'inbound').length;
    const outbound24h = recentMsgs.filter(m => m.direction === 'outbound').length;
    const failed24h = recentMsgs.filter(m => m.status === 'failed').length;

    // Response time (avg time from inbound to first outbound in same conversation, last 24h)
    let avgResponseTimeMs: number | null = null;
    if (recentMsgs.length > 0) {
      const convMsgMap = new Map<string, { inbound: string[]; outbound: string[] }>();
      for (const msg of recentMsgs) {
        if (!convMsgMap.has(msg.conversation_id)) convMsgMap.set(msg.conversation_id, { inbound: [], outbound: [] });
        const entry = convMsgMap.get(msg.conversation_id)!;
        if (msg.direction === 'inbound') entry.inbound.push(msg.created_at);
        else entry.outbound.push(msg.created_at);
      }
      const responseTimes: number[] = [];
      for (const { inbound, outbound } of convMsgMap.values()) {
        for (const inboundTime of inbound) {
          const nextOutbound = outbound.find(o => o > inboundTime);
          if (nextOutbound) {
            responseTimes.push(new Date(nextOutbound).getTime() - new Date(inboundTime).getTime());
          }
        }
      }
      if (responseTimes.length > 0) {
        avgResponseTimeMs = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      }
    }

    // Contact stats
    const totalContacts = contacts?.length ?? 0;
    const newContacts24h = contacts?.filter(c => c.created_at >= dayAgo).length ?? 0;

    // Broadcast stats
    const totalBroadcasts = broadcasts?.length ?? 0;
    const activeBroadcasts = broadcasts?.filter(b => b.status === 'sending').length ?? 0;
    const totalRecipients = broadcasts?.reduce((sum, b) => sum + (b.total_recipients ?? 0), 0) ?? 0;
    const totalDelivered = broadcasts?.reduce((sum, b) => sum + (b.delivered_count ?? 0), 0) ?? 0;
    const totalRead = broadcasts?.reduce((sum, b) => sum + (b.read_count ?? 0), 0) ?? 0;
    const totalFailed = broadcasts?.reduce((sum, b) => sum + (b.failed_count ?? 0), 0) ?? 0;

    // Webhook stats
    const totalWebhooks = webhooks?.length ?? 0;
    const activeWebhooks = webhooks?.filter(w => w.is_active).length ?? 0;
    const failingWebhooks = webhooks?.filter(w => w.failure_count > 5).length ?? 0;

    // Automation stats
    const totalAutomations = automations?.length ?? 0;
    const activeAutomations = automations?.filter(a => a.is_active).length ?? 0;
    const totalExecutions = automations?.reduce((sum, a) => sum + (a.execution_count ?? 0), 0) ?? 0;

    return ok({
      conversations: {
        total: totalConversations,
        open: openConversations,
        pending: pendingConversations,
        closed: closedConversations,
        unread: totalUnread,
      },
      messages: {
        inbound_24h: inbound24h,
        outbound_24h: outbound24h,
        failed_24h: failed24h,
        avg_response_time_ms: avgResponseTimeMs,
      },
      contacts: {
        total: totalContacts,
        new_24h: newContacts24h,
      },
      broadcasts: {
        total: totalBroadcasts,
        active: activeBroadcasts,
        total_recipients: totalRecipients,
        total_delivered: totalDelivered,
        total_read: totalRead,
        total_failed: totalFailed,
        delivery_rate: totalRecipients > 0 ? totalDelivered / totalRecipients : 0,
        read_rate: totalDelivered > 0 ? totalRead / totalDelivered : 0,
      },
      webhooks: {
        total: totalWebhooks,
        active: activeWebhooks,
        failing: failingWebhooks,
      },
      automations: {
        total: totalAutomations,
        active: activeAutomations,
        total_executions: totalExecutions,
      },
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}