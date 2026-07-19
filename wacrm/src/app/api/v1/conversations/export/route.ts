import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { supabaseAdmin } from '@/lib/automations/admin-client';

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');

    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversation_id');
    const format = searchParams.get('format') ?? 'json'; // json | csv

    if (!conversationId) {
      return fail('bad_request', 'conversation_id required', 400);
    }

    const db = supabaseAdmin();

    // Verify conversation belongs to account
    const { data: conv, error: convError } = await db
      .from('conversations')
      .select('id, contact_id, status, created_at, contact:contacts(phone, name, email)')
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId)
      .single();

    if (convError || !conv) {
      return fail('not_found', 'Conversation not found', 404);
    }

    // Get messages
    const { data: messages, error: msgError } = await db
      .from('messages')
      .select('id, sender_type, content_type, content_text, media_url, template_name, status, created_at, whatsapp_message_id')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (msgError) {
      return fail('internal', 'Failed to fetch messages', 500);
    }

    if (format === 'csv') {
      const headers = ['id', 'sender', 'type', 'content', 'media_url', 'template', 'status', 'whatsapp_message_id', 'created_at'];
      const rows = (messages ?? []).map(m => [
        m.id,
        m.sender_type,
        m.content_type,
        m.content_text ?? '',
        m.media_url ?? '',
        m.template_name ?? '',
        m.status,
        m.whatsapp_message_id ?? '',
        m.created_at,
      ].map(escapeCsv).join(','));

      const csv = [headers.join(','), ...rows].join('\n');

      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="conversation-${conversationId}-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    }

    return ok({
      conversation: {
        id: conv.id,
        contact: conv.contact,
        status: conv.status,
        created_at: conv.created_at,
      },
      messages: messages ?? [],
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}