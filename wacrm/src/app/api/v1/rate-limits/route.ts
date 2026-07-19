import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');

    const { searchParams } = new URL(request.url);
    const contactId = searchParams.get('contact_id');
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100);

    const db = supabaseAdmin();

    // If contact_id provided, get specific contact's rate limit
    if (contactId) {
      const { data: contact, error } = await db
        .from('contacts')
        .select('id, phone, name')
        .eq('id', contactId)
        .eq('account_id', ctx.accountId)
        .single();

      if (error || !contact) {
        return fail('not_found', 'Contact not found', 404);
      }

      // Get rate limit blocks
      const { data: blocks } = await db
        .from('contact_rate_limit_blocks')
        .select('*')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(limit);

      // Get recent message count
      const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count: recentCount } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('contact_id', contactId)
        .eq('sender_type', 'agent')
        .gte('created_at', windowStart);

      return ok({
        contact: { id: contact.id, phone: contact.phone, name: contact.name },
        recent_messages_1h: recentCount ?? 0,
        max_per_hour: 5,
        blocks: blocks ?? [],
      });
    }

    // Get all blocked contacts for account
    const { data: blocks } = await db
      .from('contact_rate_limit_blocks')
      .select('*, contact:contacts(id, phone, name)')
      .eq('contacts.account_id', ctx.accountId)
      .gt('blocked_until', new Date().toISOString())
      .order('blocked_until', { ascending: true })
      .limit(limit);

    return ok({
      active_blocks: blocks ?? [],
      total_blocked: blocks?.length ?? 0,
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:write');

    const body = await request.json().catch(() => null) as {
      contact_id: string;
    } | null;

    if (!body?.contact_id) {
      return fail('bad_request', 'contact_id required', 400);
    }

    const db = supabaseAdmin();

    // Verify contact belongs to account
    const { data: contact } = await db
      .from('contacts')
      .select('id')
      .eq('id', body.contact_id)
      .eq('account_id', ctx.accountId)
      .single();

    if (!contact) {
      return fail('not_found', 'Contact not found', 404);
    }

    const { error } = await db
      .from('contact_rate_limit_blocks')
      .delete()
      .eq('contact_id', body.contact_id);

    if (error) return fail('internal', 'Failed to remove block', 500);

    return ok({ unblocked: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}