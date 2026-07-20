import crypto from 'crypto';

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes: string;
}

export interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  end_session_endpoint?: string;
}

export interface OidcTokens {
  access_token: string;
  id_token?: string;
  token_type: string;
  expires_in?: number;
}

export interface OidcUserInfo {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  preferred_username?: string;
  picture?: string;
}

const discoveryCache = new Map<string, { doc: OidcDiscovery; at: number }>();
const DISCOVERY_TTL = 10 * 60 * 1000;

export async function discover(issuer: string): Promise<OidcDiscovery> {
  const key = issuer.replace(/\/$/, '');
  const cached = discoveryCache.get(key);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL) return cached.doc;

  const wellKnown = `${key}/.well-known/openid-configuration`;
  const res = await fetch(wellKnown, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`OIDC discovery failed (${res.status}) for ${wellKnown}`);
  }
  const doc = (await res.json()) as OidcDiscovery;
  discoveryCache.set(key, { doc, at: Date.now() });
  return doc;
}

export interface Pkce {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

export function generatePkce(): Pkce {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');
  return { codeVerifier, codeChallenge, state };
}

export function buildAuthorizationUrl(
  discovery: OidcDiscovery,
  cfg: OidcConfig,
  pkce: Pkce,
): string {
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('scope', cfg.scopes);
  url.searchParams.set('state', pkce.state);
  url.searchParams.set('code_challenge', pkce.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export async function exchangeCode(
  discovery: OidcDiscovery,
  cfg: OidcConfig,
  code: string,
  codeVerifier: string,
): Promise<OidcTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    code_verifier: codeVerifier,
  });
  if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret);

  const res = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OIDC token exchange failed (${res.status}): ${text}`);
  }
  return (await res.json()) as OidcTokens;
}

export async function fetchUserInfo(
  discovery: OidcDiscovery,
  tokens: OidcTokens,
): Promise<OidcUserInfo> {
  const res = await fetch(discovery.userinfo_endpoint, {
    headers: { Authorization: `${tokens.token_type} ${tokens.access_token}` },
  });
  if (!res.ok) {
    throw new Error(`OIDC userinfo failed (${res.status})`);
  }
  return (await res.json()) as OidcUserInfo;
}
