import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { encrypt } from '@/lib/whatsapp/encryption';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('viewer');
    const { data, error } = await ctx.supabase
    .from('sso_providers')
    .select(
      'id, name, idp_type, active, issuer, client_id, redirect_uri, scopes, created_at',
    )
    .eq('account_id', ctx.accountId)
    .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ providers: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('admin');

  const body = await req.json().catch(() => ({}));
  const {
    name,
    idp_type = 'oidc',
    active = true,
    issuer,
    client_id,
    client_secret,
    redirect_uri,
    scopes = 'openid email profile',
  } = body as Record<string, unknown>;

  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (idp_type !== 'oidc' && idp_type !== 'saml') {
    return NextResponse.json({ error: 'invalid idp_type' }, { status: 400 });
  }
  if (idp_type === 'oidc' && (!issuer || !client_id)) {
    return NextResponse.json(
      { error: 'issuer and client_id are required for OIDC' },
      { status: 400 },
    );
  }

  const insert: Record<string, unknown> = {
    account_id: ctx.accountId,
    created_by: ctx.userId,
    name,
    idp_type,
    active,
    scopes,
  };
  if (idp_type === 'oidc') {
    insert.issuer = issuer;
    insert.client_id = client_id;
    insert.client_secret = client_secret ? encrypt(String(client_secret)) : null;
    insert.redirect_uri = redirect_uri ?? null;
  }

  const { data, error } = await ctx.supabase
    .from('sso_providers')
    .insert(insert)
    .select('id, name, idp_type, active, issuer, client_id, redirect_uri, scopes, created_at')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ provider: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
