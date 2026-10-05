import { createHash } from 'node:crypto';

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}
function hashLookup(value) {
  return b64url(createHash('sha256').update(value).digest());
}
function iso(ms) {
  return new Date(ms).toISOString();
}
function ms(value) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('INVALID_AUTH_TIME');
  return parsed;
}
function trimSlash(value) {
  return value.replace(/\/+$/, '');
}

export class SupabaseAuthStorage {
  constructor({ url, serviceRoleKey, fetcher = fetch, now = () => Date.now() }) {
    if (!url || !serviceRoleKey) throw new Error('SUPABASE_AUTH_CONFIG_REQUIRED');
    this.url = trimSlash(url);
    this.serviceRoleKey = serviceRoleKey;
    this.fetcher = fetcher;
    this.now = now;
  }

  headers(extra = {}) {
    return {
      apikey: this.serviceRoleKey,
      Authorization: `Bearer ${this.serviceRoleKey}`,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extra
    };
  }

  async request(path, options = {}) {
    const response = await this.fetcher(`${this.url}/rest/v1/${path}`, {
      redirect: 'error',
      ...options,
      headers: this.headers(options.headers)
    });
    return response;
  }

  async putLogin(tx) {
    const response = await this.request('tsr_login_transactions', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        state_hash: hashLookup(tx.state),
        return_to: tx.returnTo,
        realm: tx.realm,
        client_return_to: tx.clientReturnTo,
        verifier_challenge: tx.verifierChallenge,
        created_at: iso(tx.createdAt),
        expires_at: iso(tx.expiresAt)
      })
    });
    if (!response.ok) throw new Error(`TSR_LOGIN_INSERT_${response.status}`);
  }

  async consumeLogin(state) {
    const response = await this.request(
      `tsr_login_transactions?state_hash=eq.${encodeURIComponent(hashLookup(state))}&consumed_at=is.null&select=return_to,realm,client_return_to,verifier_challenge,created_at,expires_at`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ consumed_at: new Date(this.now()).toISOString() })
      }
    );
    if (!response.ok) throw new Error(`TSR_LOGIN_CONSUME_${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1) return null;
    const row = rows[0];
    return {
      state,
      returnTo: row.return_to,
      realm: row.realm,
      clientReturnTo: row.client_return_to,
      verifierChallenge: row.verifier_challenge,
      createdAt: ms(row.created_at),
      expiresAt: ms(row.expires_at),
      consumed: true
    };
  }

  async consumeNonce(nonce) {
    const response = await this.request('tsr_openid_nonces', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ nonce_hash: hashLookup(nonce), consumed_at: new Date(this.now()).toISOString() })
    });
    if (response.status === 409) return false;
    if (!response.ok) throw new Error(`TSR_NONCE_INSERT_${response.status}`);
    return true;
  }

  async putCode(record) {
    const response = await this.request('tsr_exchange_codes', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        code_hash: hashLookup(record.code),
        steam_id: record.steamId,
        verifier_challenge: record.verifierChallenge,
        created_at: iso(record.createdAt),
        expires_at: iso(record.expiresAt)
      })
    });
    if (!response.ok) throw new Error(`TSR_CODE_INSERT_${response.status}`);
  }

  async consumeCode(code) {
    const response = await this.request(
      `tsr_exchange_codes?code_hash=eq.${encodeURIComponent(hashLookup(code))}&consumed_at=is.null&select=steam_id,verifier_challenge,created_at,expires_at`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ consumed_at: new Date(this.now()).toISOString() })
      }
    );
    if (!response.ok) throw new Error(`TSR_CODE_CONSUME_${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1) return null;
    const row = rows[0];
    return {
      code,
      steamId: row.steam_id,
      verifierChallenge: row.verifier_challenge,
      createdAt: ms(row.created_at),
      expiresAt: ms(row.expires_at),
      consumed: true
    };
  }

  async putSession(record) {
    const user = await this.request('tsr_users?on_conflict=steam_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ steam_id: record.steamId })
    });
    if (!user.ok) throw new Error(`TSR_USER_UPSERT_${user.status}`);

    const response = await this.request('tsr_sessions', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        token_hash: record.tokenHash,
        steam_id: record.steamId,
        issued_at: iso(record.issuedAt),
        expires_at: iso(record.expiresAt),
        revoked_at: record.revokedAt ? iso(record.revokedAt) : null
      })
    });
    if (!response.ok) throw new Error(`TSR_SESSION_INSERT_${response.status}`);
  }

  async getSession(tokenHash) {
    const response = await this.request(
      `tsr_sessions?token_hash=eq.${encodeURIComponent(tokenHash)}&select=steam_id,issued_at,expires_at,revoked_at&limit=1`,
      { method: 'GET' }
    );
    if (!response.ok) throw new Error(`TSR_SESSION_SELECT_${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const row = rows[0];
    return {
      tokenHash,
      steamId: row.steam_id,
      issuedAt: ms(row.issued_at),
      expiresAt: ms(row.expires_at),
      revokedAt: row.revoked_at ? ms(row.revoked_at) : null
    };
  }

  async revokeSession(tokenHash) {
    const response = await this.request(
      `tsr_sessions?token_hash=eq.${encodeURIComponent(tokenHash)}&revoked_at=is.null&select=token_hash`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ revoked_at: new Date(this.now()).toISOString() })
      }
    );
    if (!response.ok) throw new Error(`TSR_SESSION_REVOKE_${response.status}`);
    const rows = await response.json();
    return Array.isArray(rows) && rows.length === 1;
  }
}
