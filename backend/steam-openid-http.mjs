import { STEAM_OPENID_ENDPOINT } from './steam-auth.mjs';

export function createSteamOpenIdHttp({ fetcher = fetch } = {}) {
  return {
    async checkAuthentication(params) {
      const body = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (key.startsWith('openid.')) body.set(key, value);
      }
      body.set('openid.mode', 'check_authentication');
      const response = await fetcher(STEAM_OPENID_ENDPOINT, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) return false;
      const text = await response.text();
      return /^is_valid\s*:\s*true\s*$/mi.test(text);
    }
  };
}

export function buildSteamLoginUrl({ returnTo, realm }) {
  const url = new URL(STEAM_OPENID_ENDPOINT);
  const fields = {
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': realm,
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select'
  };
  for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, value);
  return url.href;
}
