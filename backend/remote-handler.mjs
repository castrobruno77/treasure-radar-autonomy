import { randomBytes } from 'node:crypto';
import { createHandler } from './handler.mjs';
import { createSteamAuthService } from './steam-auth.mjs';
import { SupabaseAuthStorage } from './supabase-auth-storage.mjs';
import { createSteamOpenIdHttp, buildSteamLoginUrl } from './steam-openid-http.mjs';

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
function randomState() {
  return randomBytes(24).toString('base64url');
}
function bearer(request) {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] || null;
}
async function bodyJson(request) {
  const text = await request.text();
  if (text.length > 8192) throw new Error('REQUEST_TOO_LARGE');
  return text ? JSON.parse(text) : {};
}

export function createRemoteHandler({ store, env = process.env, fetcher = fetch, now = Date.now } = {}) {
  const enabled = env.TSR_AUTH_ENABLED === 'true';
  const publicOrigin = env.TSR_PUBLIC_ORIGIN ? new URL(env.TSR_PUBLIC_ORIGIN).origin : null;
  const extensionId = env.TSR_EXTENSION_ID || null;
  const extensionOrigin = extensionId ? `chrome-extension://${extensionId}` : null;
  const clientReturnTo = extensionId ? `https://${extensionId}.chromiumapp.org/steam` : null;
  const configured = Boolean(enabled && publicOrigin && extensionId && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);

  const localHandler = createHandler(store, { now });
  const auth = configured ? createSteamAuthService({
    storage: new SupabaseAuthStorage({
      url: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      fetcher,
      now
    }),
    http: createSteamOpenIdHttp({ fetcher }),
    now
  }) : null;

  function cors(request) {
    const origin = request.headers.get('origin');
    if (!origin) return {};
    if (origin !== extensionOrigin) throw new Error('ORIGIN_DENIED');
    return {
      'Access-Control-Allow-Origin': extensionOrigin,
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Vary': 'Origin'
    };
  }

  return async function handle(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return json({ ok: true, service: 'treasure-radar', mode: 'REMOTE', auth: configured ? 'ENABLED' : 'NOT_CONFIGURED' });
    }

    if (request.method === 'OPTIONS') {
      try { return new Response(null, { status: 204, headers: cors(request) }); }
      catch { return new Response(null, { status: 403 }); }
    }

    if (url.pathname === '/v1/auth/steam/callback') {
      if (!configured || request.method !== 'GET') return json({ error: 'STEAM_AUTH_NOT_CONFIGURED' }, 503);
      try {
        const result = await auth.verifyCallback(url.search);
        const redirect = new URL(result.clientReturnTo);
        redirect.searchParams.set('code', result.code);
        return new Response(null, { status: 302, headers: { Location: redirect.href, 'Cache-Control': 'no-store' } });
      } catch {
        return json({ error: 'STEAM_ASSERTION_REJECTED' }, 401);
      }
    }

    let corsHeaders;
    try { corsHeaders = cors(request); }
    catch { return json({ error: 'ORIGIN_DENIED' }, 403); }

    if (!configured) return json({ error: 'STEAM_AUTH_NOT_CONFIGURED' }, 503, corsHeaders);

    if (url.pathname === '/v1/auth/steam/start' && request.method === 'POST') {
      try {
        const payload = await bodyJson(request);
        if (payload.client_return_to !== clientReturnTo) return json({ error: 'CALLBACK_MISMATCH' }, 400, corsHeaders);
        const state = randomState();
        const returnTo = new URL('/v1/auth/steam/callback', publicOrigin);
        returnTo.searchParams.set('state', state);
        const tx = await auth.beginLogin({
          state,
          returnTo: returnTo.href,
          realm: `${publicOrigin}/`,
          clientReturnTo,
          verifierChallenge: payload.verifier_challenge
        });
        return json({ login_url: buildSteamLoginUrl({ returnTo: returnTo.href, realm: `${publicOrigin}/` }), expires_at: tx.expiresAt }, 200, corsHeaders);
      } catch {
        return json({ error: 'LOGIN_START_REJECTED' }, 400, corsHeaders);
      }
    }

    if (url.pathname === '/v1/auth/steam/exchange' && request.method === 'POST') {
      try {
        const payload = await bodyJson(request);
        const session = await auth.exchangeCode({ code: payload.code, verifier: payload.verifier });
        return json({ token: session.token, expires_at: session.expiresAt }, 200, corsHeaders);
      } catch {
        return json({ error: 'EXCHANGE_REJECTED' }, 401, corsHeaders);
      }
    }

    if (url.pathname === '/v1/auth/logout' && request.method === 'POST') {
      const token = bearer(request);
      if (!token) return json({ error: 'UNAUTHORIZED' }, 401, corsHeaders);
      await auth.logout(token).catch(() => false);
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === '/v1/opportunities') {
      const token = bearer(request);
      if (!token) return json({ error: 'UNAUTHORIZED' }, 401, corsHeaders);
      try { await auth.authenticate(token); }
      catch { return json({ error: 'UNAUTHORIZED' }, 401, corsHeaders); }
      const response = await localHandler(request);
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
      return new Response(response.body, { status: response.status, headers });
    }

    return json({ error: 'NOT_FOUND' }, 404, corsHeaders);
  };
}
