import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');

    const body = await request.json().catch(() => null) as {
      conversation_id: string;
      message_text: string;
      contact_id: string;
    } | null;

    if (!body?.conversation_id || !body?.message_text || !body?.contact_id) {
      return fail('bad_request', 'conversation_id, message_text, and contact_id are required', 400);
    }

    const db = supabaseAdmin();

    // Verify conversation belongs to account
    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('id, account_id')
      .eq('id', body.conversation_id)
      .eq('account_id', ctx.accountId)
      .single();

    if (convErr || !conv) {
      return fail('not_found', 'Conversation not found', 404);
    }

    // Get AI config for the account
    const { data: aiConfig } = await db
      .from('ai_configs')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('is_active', true)
      .single();

    if (!aiConfig) {
      return fail('ai_not_configured', 'AI assistant not configured for this account', 400);
    }

    // Run the AI reply draft (without sending)
    const result = await dispatchInboundToAiReply({
      accountId: ctx.accountId,
      conversationId: body.conversation_id,
      contactId: body.contact_id,
      configOwnerUserId: aiConfig.user_id,
      draftOnly: true, // Don't actually send, just return the draft
      testMessage: body.message_text,
    });

    return ok({
      draft: result?.draft_reply ?? null,
      model: aiConfig.provider,
      tokens_used: result?.tokens_used,
      would_send: result?.draft_reply ? true : false,
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}