import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  discover,
  exchangeCode,
  fetchUserInfo,
} from '@/lib/sso/oidc';

export const runtime = 'nodejs';

function verifyState(stored: string | undefined, returned: string | null): boolean {
  if (!stored || !returned) return false;
  try {
    const parsed = JSON.parse(stored);
    return parsed.state === returned;
  } catch {
    return false;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const origin = new URL(req.url).origin;
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  const cookieName = `sso_${id}`;
  const stored = req.cookies.get(cookieName)?.value;

  if (errorParam) {
    return NextResponse.redirect(`${origin}/login?sso_error=idp_denied`);
  }
  if (!code || !stored || !verifyState(stored, returnedState)) {
    return NextResponse.redirect(`${origin}/login?sso_error=bad_state`);
  }

  const { codeVerifier, redirectUri } = JSON.parse(stored) as {
    codeVerifier: string;
    accountId: string;
    redirectUri: string;
  };

  const { data: provider, error } = await supabaseAdmin()
    .from('sso_providers')
    .select('id, issuer, client_id, client_secret, scopes')
    .eq('id', id)
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

  const secret = provider.client_secret ? decrypt(provider.client_secret) : undefined;

  let tokens;
  try {
    tokens = await exchangeCode(
      disco,
      {
        issuer: provider.issuer,
        clientId: provider.client_id,
        clientSecret: secret,
        redirectUri,
        scopes: provider.scopes || 'openid email profile',
      },
      code,
      codeVerifier,
    );
  } catch {
    return NextResponse.redirect(`${origin}/login?sso_error=token_failed`);
  }

  let info;
  try {
    info = await fetchUserInfo(disco, tokens);
  } catch {
    return NextResponse.redirect(`${origin}/login?sso_error=userinfo_failed`);
  }

  const email = info.email;
  if (!email) {
    return NextResponse.redirect(`${origin}/login?sso_error=no_email`);
  }

  const fullName =
    info.name ||
    [info.given_name, info.family_name].filter(Boolean).join(' ') ||
    email.split('@')[0];

  // Find or create the Supabase user for this identity.
  const admin = supabaseAdmin().auth.admin;
  let user;
  const list = await admin.listUsers();
  user = list.data.users.find((u) => u.email === email);

  if (!user) {
    const created = await admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName, sso_provider_id: id },
    });
    if (created.error || !created.data.user) {
      return NextResponse.redirect(`${origin}/login?sso_error=create_failed`);
    }
    user = created.data.user;
  }

  // Issue a magic-link session and let Supabase set the cookies.
  const link = await admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (link.error || !link.data.properties?.hashed_token) {
    return NextResponse.redirect(`${origin}/login?sso_error=link_failed`);
  }

  const verifyUrl =
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/verify` +
    `?token=${encodeURIComponent(link.data.properties.hashed_token)}` +
    `&type=magiclink` +
    `&redirect_to=${encodeURIComponent(`${origin}/dashboard`)}`;

  const redirect = NextResponse.redirect(verifyUrl);
  redirect.cookies.delete(cookieName);
  return redirect;
}
