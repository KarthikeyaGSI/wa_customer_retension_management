import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { discover, generatePkce, buildAuthorizationUrl } from '@/lib/sso/oidc';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const origin = new URL(req.url).origin;

  const { data: provider, error } = await supabaseAdmin()
    .from('sso_providers')
    .select(
      'id, account_id, name, issuer, client_id, client_secret, redirect_uri, scopes',
    )
    .eq('id', id)
    .eq('idp_type', 'oidc')
    .eq('active', true)
    .single();

  if (error || !provider) {
    return NextResponse.redirect(`${origin}/login?sso_error=provider_not_found`);
  }

  let disco;
  try {
    disco = await discover(provider.issuer);
  } catch {
    return NextResponse.redirect(`${origin}/login?sso_error=discovery_failed`);
  }

  const pkce = generatePkce();
  const redirectUri = provider.redirect_uri || `${origin}/api/sso/${id}/callback`;
  const secret = provider.client_secret ? decrypt(provider.client_secret) : undefined;

  const authUrl = buildAuthorizationUrl(disco, {
    issuer: provider.issuer,
    clientId: provider.client_id,
    clientSecret: secret,
    redirectUri,
    scopes: provider.scopes || 'openid email profile',
  }, pkce);

  const cookieName = `sso_${id}`;
  const cookieValue = JSON.stringify({
    codeVerifier: pkce.codeVerifier,
    state: pkce.state,
    accountId: provider.account_id,
    redirectUri,
  });

  const res = NextResponse.redirect(authUrl);
  res.cookies.set(cookieName, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return res;
}
