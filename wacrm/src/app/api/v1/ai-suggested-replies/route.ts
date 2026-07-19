import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');

    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversation_id');
    const messageId = searchParams.get('message_id');
    const status = searchParams.get('status'); // 'pending' | 'accepted' | 'edited' | 'dismissed'
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    if (!conversationId && !messageId) {
      return fail('bad_request', 'conversation_id or message_id required', 400);
    }

    let query = supabaseAdmin()
      .from('ai_suggested_replies')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (conversationId) query = query.eq('conversation_id', conversationId);
    if (messageId) query = query.eq('message_id', messageId);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;

    if (error) {
      console.error('[api/v1/ai-suggested-replies] list error:', error);
      return fail('internal', 'Failed to fetch suggestions', 500);
    }

    return okList(
      (data ?? []).map((row) => ({
        id: row.id,
        conversation_id: row.conversation_id,
        message_id: row.message_id,
        contact_id: row.contact_id,
        suggestion_text: row.suggestion_text,
        model: row.model,
        tokens_used: row.tokens_used,
        confidence: row.confidence,
        status: row.status,
        accepted_text: row.accepted_text,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })),
      offset + limit < (data?.length ?? 0) ? String(offset + limit) : null
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');

    const body = await request.json().catch(() => null) as {
      id: string;
      status: 'accepted' | 'edited' | 'dismissed';
      accepted_text?: string;
    } | null;

    if (!body?.id || !body?.status) {
      return fail('bad_request', 'id and status required', 400);
    }

    if (!['accepted', 'edited', 'dismissed'].includes(body.status)) {
      return fail('bad_request', 'Invalid status', 400);
    }

    const db = supabaseAdmin();

    const { data: suggestion, error: fetchError } = await db
      .from('ai_suggested_replies')
      .select('*')
      .eq('id', body.id)
      .eq('account_id', ctx.accountId)
      .single();

    if (fetchError || !suggestion) {
      return fail('not_found', 'Suggestion not found', 404);
    }

    const updates: Record<string, unknown> = {
      status: body.status,
      updated_at: new Date().toISOString(),
    };

    if (body.status === 'edited' && body.accepted_text) {
      updates.accepted_text = body.accepted_text;
    } else if (body.status === 'accepted') {
      updates.accepted_text = suggestion.suggestion_text;
    }

    const { error: updateError } = await db
      .from('ai_suggested_replies')
      .update(updates)
      .eq('id', body.id);

    if (updateError) {
      return fail('internal', 'Failed to update suggestion', 500);
    }

    return ok({ id: body.id, status: body.status });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}