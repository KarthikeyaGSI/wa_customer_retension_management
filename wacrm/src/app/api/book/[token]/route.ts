// ============================================================
// Public booking API — /api/book/[token]
//
// No auth. Validates the booking-link token, returns the link's
// availability + free slots, and accepts a new booking. Uses the
// service-role client and scopes every query by the resolved
// account_id (the token is unguessable, so this is safe).
// ============================================================

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { computeFreeSlots } from '@/lib/appointments/slots';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const { searchParams } = new URL(request.url);
    const days = Math.min(parseInt(searchParams.get('days') ?? '14', 10) || 14, 60);
    const tz = searchParams.get('tz');

    const db = supabaseAdmin();

    const { data: link, error: linkErr } = await db
      .from('booking_links')
      .select('id, account_id, title, description, active, contact_id')
      .eq('token', token)
      .maybeSingle();
    if (linkErr || !link || !link.active) {
      return NextResponse.json({ error: 'Booking link not found' }, { status: 404 });
    }

    const accountId = link.account_id;

    const { data: windows } = await db
      .from('appointment_availability')
      .select('*')
      .eq('account_id', accountId);

    if (!windows?.length) {
      return NextResponse.json({
        data: {
          link: { title: link.title, description: link.description },
          timezone: 'UTC',
          slots: [],
        },
      });
    }

    const timezone = tz || windows[0].timezone;
    const now = new Date();
    const from = now.toISOString();
    const to = new Date(now.getTime() + days * 86_400_000).toISOString();

    const { data: taken } = await db
      .from('appointments')
      .select('scheduled_at, duration_minutes')
      .eq('account_id', accountId)
      .neq('status', 'cancelled')
      .gte('scheduled_at', from)
      .lte('scheduled_at', to);

    const slots = computeFreeSlots(
      windows as never,
      (taken ?? []) as never,
      from,
      to,
    );

    return NextResponse.json({
      data: {
        link: { title: link.title, description: link.description },
        timezone,
        slots,
      },
    });
  } catch (err) {
    console.error('[GET /api/book/[token]]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const db = supabaseAdmin();

    const { data: link, error: linkErr } = await db
      .from('booking_links')
      .select('id, account_id, contact_id, active')
      .eq('token', token)
      .maybeSingle();
    if (linkErr || !link || !link.active) {
      return NextResponse.json({ error: 'Booking link not found' }, { status: 404 });
    }
    const accountId = link.account_id;

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body?.scheduled_at || typeof body.scheduled_at !== 'string') {
      return NextResponse.json({ error: 'scheduled_at required' }, { status: 400 });
    }

    const customerName =
      typeof body.customer_name === 'string' ? body.customer_name.trim() : '';
    const rawPhone =
      typeof body.customer_phone === 'string' ? body.customer_phone.trim() : '';
    const phone = rawPhone ? sanitizePhoneForMeta(rawPhone) : null;
    if (rawPhone && !isValidE164(phone ?? '')) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    }

    // Resolve or create the contact so the booking shows in the inbox
    // thread. Attribute to the link's linked contact's account.
    let contactId = link.contact_id;
    if (!contactId && phone) {
      const { data: existing } = await db
        .from('contacts')
        .select('id')
        .eq('account_id', accountId)
        .eq('phone', phone)
        .maybeSingle();
      if (existing) {
        contactId = existing.id;
      } else {
        const { data: created } = await db
          .from('contacts')
          .insert({
            account_id: accountId,
            user_id: (await db.auth.getUser())?.data?.user?.id ?? null,
            phone,
            name: customerName || phone,
          })
          .select('id')
          .single();
        contactId = created?.id ?? null;
      }
    }

    const { data: appt, error: insertErr } = await db
      .from('appointments')
      .insert({
        account_id: accountId,
        booking_link_id: link.id,
        booking_token:
          globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
        contact_id: contactId,
        customer_name: customerName || null,
        customer_phone: phone,
        scheduled_at: body.scheduled_at,
        duration_minutes: Number(body.duration_minutes ?? 30),
        status: 'confirmed',
        notes: typeof body.notes === 'string' ? body.notes : null,
      })
      .select()
      .single();

    if (insertErr || !appt) {
      console.error('[POST /api/book/[token]] insert', insertErr);
      return NextResponse.json({ error: 'Failed to book' }, { status: 500 });
    }

    return NextResponse.json({ data: appt }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/book/[token]]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
