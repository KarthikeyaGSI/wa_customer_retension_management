import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export const runtime = 'nodejs';

// Public list of active SSO providers for the login screen. Returns
// only id + display name — never issuer, client id, or secrets.
export async function GET() {
  const { data, error } = await supabaseAdmin()
    .from('sso_providers')
    .select('id, name')
    .eq('idp_type', 'oidc')
    .eq('active', true)
    .order('name', { ascending: true });

  if (error) {
    return NextResponse.json({ providers: [] });
  }
  return NextResponse.json({ providers: data });
}
