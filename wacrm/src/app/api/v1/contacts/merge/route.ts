import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { findExistingContact } from '@/lib/contacts/dedupe';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:write');

    const body = await request.json().catch(() => null) as {
      primary_contact_id: string;
      duplicate_contact_ids: string[];
    } | null;

    if (!body?.primary_contact_id || !body?.duplicate_contact_ids?.length) {
      return fail('bad_request', 'primary_contact_id and duplicate_contact_ids[] required', 400);
    }

    const db = supabaseAdmin();

    // Verify all contacts belong to this account
    const { data: contacts, error: fetchError } = await db
      .from('contacts')
      .select('id, phone, name, email, company')
      .eq('account_id', ctx.accountId)
      .in('id', [body.primary_contact_id, ...body.duplicate_contact_ids]);

    if (fetchError || !contacts || contacts.length !== 1 + body.duplicate_contact_ids.length) {
      return fail('not_found', 'One or more contacts not found in this account', 404);
    }

    const primary = contacts.find(c => c.id === body.primary_contact_id);
    const duplicates = contacts.filter(c => c.id !== body.primary_contact_id);

    if (!primary) {
      return fail('bad_request', 'Primary contact not found', 400);
    }

    // Merge data: prefer primary, fill gaps from duplicates
    const merged = { ...primary };
    for (const dup of duplicates) {
      if (!merged.name && dup.name) merged.name = dup.name;
      if (!merged.email && dup.email) merged.email = dup.email;
      if (!merged.company && dup.company) merged.company = dup.company;
    }

    // Update primary with merged data
    const { error: updateError } = await db
      .from('contacts')
      .update({
        name: merged.name,
        email: merged.email,
        company: merged.company,
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.primary_contact_id);

    if (updateError) {
      return fail('internal', 'Failed to merge contact data', 500);
    }

    // Reassign related records to primary contact
    const duplicateIds = duplicates.map(d => d.id);

    await Promise.all([
      // Messages
      db.from('messages').update({ contact_id: body.primary_contact_id }).in('contact_id', duplicateIds),
      // Conversations
      db.from('conversations').update({ contact_id: body.primary_contact_id }).in('contact_id', duplicateIds),
      // Broadcast recipients
      db.from('broadcast_recipients').update({ contact_id: body.primary_contact_id }).in('contact_id', duplicateIds),
      // Deals
      db.from('deals').update({ contact_id: body.primary_contact_id }).in('contact_id', duplicateIds),
      // Contact tags
      db.from('contact_tags').update({ contact_id: body.primary_contact_id }).in('contact_id', duplicateIds),
      // Contact custom values
      db.from('contact_custom_values').update({ contact_id: body.primary_contact_id }).in('contact_id', duplicateIds),
      // Contact notes
      db.from('contact_notes').update({ contact_id: body.primary_contact_id }).in('contact_id', duplicateIds),
    ]);

    // Delete duplicate contacts
    const { error: deleteError } = await db
      .from('contacts')
      .delete()
      .in('id', duplicateIds);

    if (deleteError) {
      console.error('[contacts/merge] Delete error:', deleteError);
    }

    return ok({
      primary_contact_id: body.primary_contact_id,
      merged_count: duplicates.length,
      merged_fields: Object.keys(merged).filter(k => merged[k as keyof typeof merged]),
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:read');

    const { searchParams } = new URL(request.url);
    const phone = searchParams.get('phone');
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '10', 10), 50);

    if (!phone) {
      return fail('bad_request', 'phone parameter required', 400);
    }

    const db = supabaseAdmin();
    const existing = await findExistingContact(db, ctx.accountId, phone);

    if (!existing) {
      return ok({ duplicates: [] });
    }

    // Find other contacts with same normalized phone
    const { data: duplicates } = await db
      .from('contacts')
      .select('id, phone, name, email, company, created_at')
      .eq('account_id', ctx.accountId)
      .neq('id', existing.id)
      .like('phone', `%${phone.replace(/\D/g, '').slice(-8)}%`);

    return ok({ primary: existing, duplicates: duplicates ?? [] });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}