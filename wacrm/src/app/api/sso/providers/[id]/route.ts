import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { encrypt } from '@/lib/whatsapp/encryption';

export const runtime = 'nodejs';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const body = await req.json().catch(() => ({}));
    const {
      name,
      active,
      issuer,
      client_id,
      client_secret,
      redirect_uri,
      scopes,
    } = body as Record<string, unknown>;

    const { data: existing, error: findErr } = await ctx.supabase
      .from('sso_providers')
      .select('id')
      .eq('id', (await params).id)
      .eq('account_id', ctx.accountId)
      .single();
    if (findErr || !existing) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    const update: Record<string, unknown> = {};
    if (typeof name === 'string') update.name = name;
    if (typeof active === 'boolean') update.active = active;
    if (typeof issuer === 'string') update.issuer = issuer;
    if (typeof client_id === 'string') update.client_id = client_id;
    if (typeof redirect_uri === 'string') update.redirect_uri = redirect_uri;
    if (typeof scopes === 'string') update.scopes = scopes;
    if (typeof client_secret === 'string' && client_secret.length > 0) {
      update.client_secret = encrypt(client_secret);
    }

    const { data, error } = await ctx.supabase
      .from('sso_providers')
      .update(update)
      .eq('id', (await params).id)
      .eq('account_id', ctx.accountId)
      .select('id, name, idp_type, active, issuer, client_id, redirect_uri, scopes, created_at')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ provider: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const { error } = await ctx.supabase
      .from('sso_providers')
      .delete()
      .eq('id', (await params).id)
      .eq('account_id', ctx.accountId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
