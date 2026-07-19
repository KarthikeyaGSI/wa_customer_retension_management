import { supabaseAdmin } from '@/lib/automations/admin-client';
import { sendMessageToConversation } from '@/lib/whatsapp/send-message';

export async function processScheduledMessages(): Promise<number> {
  const db = supabaseAdmin();
  const now = new Date().toISOString();

  const { data: messages, error } = await db
    .from('scheduled_messages')
    .select('*')
    .eq('status', 'pending')
    .lte('send_at', now)
    .order('send_at', { ascending: true })
    .limit(100);

  if (error || !messages?.length) return 0;

  let sent = 0;
  for (const msg of messages) {
    try {
      await sendMessageToConversation(supabaseAdmin(), msg.account_id, {
        conversationId: msg.conversation_id,
        messageType: msg.message_type,
        contentText: msg.content_text,
        mediaUrl: msg.media_url,
        templateName: msg.template_name,
        templateLanguage: msg.template_language,
        templateParams: msg.template_params as string[] | undefined,
      });

      await db
        .from('scheduled_messages')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', msg.id);

      sent++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await db
        .from('scheduled_messages')
        .update({ status: 'failed', error_message: errorMsg })
        .eq('id', msg.id);
    }
  }

  return sent;
}

// Cron endpoint
export async function GET(request: Request): Promise<Response> {
  const expected = process.env.SCHEDULED_MESSAGES_CRON_SECRET;
  if (!expected) {
    return new Response(JSON.stringify({ error: 'not configured' }), { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret');
  if (supplied !== expected) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const sent = await processScheduledMessages();
    return Response.json({ sent });
  } catch (err) {
    console.error('[scheduled-messages-cron] Error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}