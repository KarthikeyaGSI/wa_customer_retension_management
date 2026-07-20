// ============================================================
// Public form submission — /api/forms/[token]
//
// No auth. Validates the form token, checks required fields, finds
// or creates the contact, optionally opens a deal in the form's
// pipeline/stage, stores the submission, and fires the
// 'new_contact_created' automations (same call the webhook uses).
// Service-role client; every write scoped by the resolved account.
// ============================================================

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import {
  findOrCreateContact,
  resolveAuditUserId,
  ContactError,
} from '@/lib/api/v1/contacts';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { dispatchIntegrations } from '@/lib/integrations/notify';
import type { Form, FormField } from '@/types';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const db = supabaseAdmin();
    const { data: form, error } = await db
      .from('forms')
      .select('*')
      .eq('token', token)
      .maybeSingle();
    if (error || !form || !form.active) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    }
    const f = form as Form;
    return NextResponse.json({
      data: {
        title: f.title,
        description: f.description,
        fields: f.fields,
      },
    });
  } catch (err) {
    console.error('[GET /api/forms/[token]]', err);
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

    const { data: formRow, error: formErr } = await db
      .from('forms')
      .select('*')
      .eq('token', token)
      .maybeSingle();
    if (formErr || !formRow || !formRow.active) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    }
    const form = formRow as Form;

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid submission' }, { status: 400 });
    }

    // Validate required fields.
    const missing = (form.fields as FormField[])
      .filter((f) => f.required && !body[f.name])
      .map((f) => f.label || f.name);
    if (missing.length) {
      return NextResponse.json(
        { error: `Missing required: ${missing.join(', ')}` },
        { status: 400 },
      );
    }

    const get = (name: string): string | undefined => {
      const v = body[name];
      return typeof v === 'string' && v.trim() ? v.trim() : undefined;
    };

    const phone = get('phone');
    const email = get('email');
    const name = get('name') ?? get('full_name');

    if (!phone && !email) {
      return NextResponse.json(
        { error: 'A phone or email is required' },
        { status: 400 },
      );
    }

    // Resolve audit user + contact.
    const auditUserId = await resolveAuditUserId(db, form.account_id);
    let contactId: string | null = null;
    if (phone) {
      const sanitized = sanitizePhoneForMeta(phone);
      if (!isValidE164(sanitized)) {
        return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
      }
      try {
        const res = await findOrCreateContact(db, form.account_id, auditUserId, {
          phone: sanitized,
          name: name ?? null,
          email: email ?? null,
        });
        contactId = res.id;
      } catch (err) {
        if (err instanceof ContactError) {
          return NextResponse.json({ error: err.message }, { status: err.status });
        }
        throw err;
      }
    } else if (email) {
      // No phone: match or create by email.
      const { data: existing } = await db
        .from('contacts')
        .select('id')
        .eq('account_id', form.account_id)
        .eq('email', email)
        .maybeSingle();
      if (existing) {
        contactId = existing.id;
      } else {
        const { data: created } = await db
          .from('contacts')
          .insert({
            account_id: form.account_id,
            user_id: auditUserId,
            email,
            name: name ?? email,
          })
          .select('id')
          .single();
        contactId = created?.id ?? null;
      }
    }

    // Optionally open a deal.
    if (form.pipeline_id && form.stage_id && contactId) {
      try {
        await db.from('deals').insert({
          account_id: form.account_id,
          user_id: auditUserId,
          pipeline_id: form.pipeline_id,
          stage_id: form.stage_id,
          contact_id: contactId,
          title: name ?? email ?? phone ?? 'New lead',
          status: 'active',
        });
      } catch (err) {
        console.error('[POST /api/forms/[token]] deal create', err);
      }
    }

    // Persist submission (keep form-scoped for audit).
    const { data: submission, error: subErr } = await db
      .from('form_submissions')
      .insert({
        account_id: form.account_id,
        form_id: form.id,
        contact_id: contactId,
        data: body as Record<string, unknown>,
      })
      .select()
      .single();
    if (subErr) {
      console.error('[POST /api/forms/[token]] submission', subErr);
    }

    // Fire automations as if a new contact arrived.
    if (form.trigger_automations && contactId) {
      try {
        await runAutomationsForTrigger({
          accountId: form.account_id,
          triggerType: 'new_contact_created',
          contactId,
        });
      } catch (err) {
        console.error('[POST /api/forms/[token]] automation', err);
      }
    }

    // Notify configured integrations (Slack / email) about the new lead.
    try {
      const who = name ?? email ?? phone ?? 'new contact';
      await dispatchIntegrations({
        accountId: form.account_id,
        text: `New form submission on "${form.title}": ${who}`,
        emailSubject: `New lead: ${form.title}`,
        emailTo: email ?? undefined,
      });
    } catch (err) {
      console.error('[POST /api/forms/[token]] integrations', err);
    }

    return NextResponse.json(
      { data: { id: submission?.id ?? null, contact_id: contactId } },
      { status: 201 },
    );
  } catch (err) {
    console.error('[POST /api/forms/[token]]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
