// ============================================================
// Public customer portal — /api/portal/[token]
//
// No auth. A portal link maps an unguessable token to one contact.
// Returns read-only data for that contact: profile, appointments,
// and recent conversations with their messages. Service-role
// client; all reads scoped by the resolved account_id + contact_id.
// ============================================================

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const db = supabaseAdmin();

    const { data: link, error } = await db
      .from('portal_links')
      .select('id, account_id, contact_id, title, active')
      .eq('token', token)
      .maybeSingle();
    if (error || !link || !link.active) {
      return NextResponse.json({ error: 'Portal not found' }, { status: 404 });
    }
    const accountId = link.account_id;
    const contactId = link.contact_id;

    const [{ data: contact }, { data: appointments }, { data: conversations }] =
      await Promise.all([
        db
          .from('contacts')
          .select('id, name, phone, email, company')
          .eq('id', contactId)
          .maybeSingle(),
        db
          .from('appointments')
          .select('id, scheduled_at, duration_minutes, status, notes')
          .eq('account_id', accountId)
          .eq('contact_id', contactId)
          .neq('status', 'cancelled')
          .order('scheduled_at', { ascending: true })
          .limit(50),
        db
          .from('conversations')
          .select('id, status, last_message_text, last_message_at, created_at')
          .eq('account_id', accountId)
          .eq('contact_id', contactId)
          .order('last_message_at', { ascending: false })
          .limit(20),
      ]);

    // Fetch messages for the returned conversations.
    const convIds = (conversations ?? []).map((c: { id: string }) => c.id);
    const { data: messages } = convIds.length
      ? await db
          .from('messages')
          .select('id, conversation_id, direction, text, created_at')
          .eq('account_id', accountId)
          .in('conversation_id', convIds)
          .order('created_at', { ascending: true })
          .limit(500)
      : { data: [] as unknown[] };

    return NextResponse.json({
      data: {
        title: link.title,
        contact,
        appointments: appointments ?? [],
        conversations: (conversations ?? []).map(
          (c: { id: string }) => ({
            ...c,
            messages: (messages ?? []).filter(
              (m: unknown) =>
                (m as { conversation_id: string }).conversation_id === c.id,
            ),
          }),
        ),
      },
    });
  } catch (err) {
    console.error('[GET /api/portal/[token]]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
