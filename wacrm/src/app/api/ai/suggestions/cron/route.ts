import { supabaseAdmin } from '@/lib/automations/admin-client';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import { loadAiConfig } from '@/lib/ai/config';

export async function generateAiSuggestions(): Promise<number> {
  const db = supabaseAdmin();

  // Get accounts with active AI config and auto-reply enabled
  const { data: configs, error } = await db
    .from('ai_configs')
    .select('account_id, user_id, provider, model, auto_reply_enabled, auto_reply_max_per_conversation')
    .eq('is_active', true)
    .eq('auto_reply_enabled', true);

  if (error || !configs?.length) return 0;

  let generated = 0;

  for (const config of configs) {
    // Find recent inbound messages without suggestions
    const { data: messages } = await db
      .from('messages')
      .select(`
        id,
        conversation_id,
        content_text,
        created_at,
        conversations!inner (
          id,
          account_id,
          contact_id,
          assigned_agent_id,
          ai_autoreply_disabled
        )
      `)
      .eq('sender_type', 'customer')
      .eq('conversations.account_id', config.account_id)
      .eq('conversations.ai_autoreply_disabled', false)
      .is('conversations.assigned_agent_id', null)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(50);

    if (!messages?.length) continue;

    for (const msg of messages) {
      const conv = Array.isArray(msg.conversations) ? msg.conversations[0] : msg.conversations;
      if (!conv) continue;

      // Check if suggestion already exists
      const { data: existing } = await supabaseAdmin()
        .from('ai_suggested_replies')
        .select('id')
        .eq('message_id', msg.id)
        .single();

      if (existing) continue;

      // Check reply count for this conversation
      const { data: replyCount } = await supabaseAdmin()
        .from('ai_suggested_replies')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conv.id);

      if ((replyCount ?? 0) >= config.auto_reply_max_per_conversation) continue;

      // Generate suggestion using the same logic as auto-reply but draft-only
      try {
        const result = await dispatchInboundToAiReply({
          accountId: config.account_id,
          conversationId: conv.id,
          contactId: conv.contact_id,
          configOwnerUserId: config.user_id,
          draftOnly: true,
        });

        if (result?.draft_reply) {
          await supabaseAdmin().from('ai_suggested_replies').insert({
            account_id: config.account_id,
            conversation_id: conv.id,
            message_id: msg.id,
            contact_id: conv.contact_id,
            suggestion_text: result.draft_reply,
            model: config.model,
            tokens_used: result.tokens_used,
            status: 'pending',
          });
          generated++;
        }
      } catch (err) {
        console.error('[ai-suggestions] Failed to generate for message', msg.id, err);
      }
    }
  }

  return generated;
}

// Cron endpoint
export async function GET(request: Request): Promise<Response> {
  const expected = process.env.AI_SUGGESTIONS_CRON_SECRET;
  if (!expected) {
    return new Response(JSON.stringify({ error: 'not configured' }), { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret');
  if (supplied !== expected) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const count = await generateAiSuggestions();
    return Response.json({ generated: count });
  } catch (err) {
    console.error('[ai-suggestions-cron] Error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}