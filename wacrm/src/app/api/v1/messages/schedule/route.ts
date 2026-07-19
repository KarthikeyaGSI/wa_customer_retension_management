import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { sendMessageToConversation } from '@/lib/whatsapp/send-message';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');

    const body = await request.json().catch(() => null) as {
      conversation_id?: string;
      contact_id?: string;
      message_type: string;
      content_text?: string;
      media_url?: string;
      template_name?: string;
      template_language?: string;
      template_params?: string[];
      send_at?: string; // ISO date for scheduling
    } | null;

    if (!body) return fail('bad_request', 'Request body required', 400);

    if (!body.conversation_id && !body.contact_id) {
      return fail('bad_request', 'conversation_id or contact_id required', 400);
    }

    if (!body.message_type) {
      return fail('bad_request', 'message_type required', 400);
    }

    if (body.send_at) {
      const sendAt = new Date(body.send_at);
      if (isNaN(sendAt.getTime())) {
        return fail('bad_request', 'Invalid send_at date', 400);
      }
      if (sendAt <= new Date()) {
        return fail('bad_request', 'send_at must be in the future', 400);
      }
    }

    const db = supabaseAdmin();

    // Resolve conversation_id
    let conversationId = body.conversation_id;
    if (!conversationId && body.contact_id) {
      const { data: conv } = await db
        .from('conversations')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('contact_id', body.contact_id)
        .single();

      if (!conv) return fail('not_found', 'Conversation not found for contact', 404);
      conversationId = conv.id;
    }

    // If scheduled, store for later processing
    if (body.send_at) {
      const { data: scheduled, error } = await db
        .from('scheduled_messages')
        .insert({
          account_id: ctx.accountId,
          conversation_id: conversationId!,
          message_type: body.message_type,
          content_text: body.content_text ?? null,
          media_url: body.media_url ?? null,
          template_name: body.template_name ?? null,
          template_language: body.template_language ?? null,
          template_params: body.template_params ?? null,
          send_at: body.send_at,
          status: 'pending',
        })
        .select()
        .single();

      if (error) return fail('internal', 'Failed to schedule message', 500);

      return ok({ scheduled: true, scheduled_message_id: scheduled?.id }, 201);
    }

    // Send immediately
    const result = await sendMessageToConversation(db, ctx.accountId, {
      conversationId: conversationId!,
      messageType: body.message_type,
      contentText: body.content_text,
      mediaUrl: body.media_url,
      templateName: body.template_name,
      templateLanguage: body.template_language,
      templateParams: body.template_params,
    });

    return ok(result, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}