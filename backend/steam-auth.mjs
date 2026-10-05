import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
const STEAM_ID_PREFIX = "https://steamcommunity.com/openid/id/";
const DEFAULT_LOGIN_TTL_MS = 5 * 60_000;
const DEFAULT_CODE_TTL_MS = 60_000;
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60_000;
const DEFAULT_NONCE_MAX_AGE_MS = 10 * 60_000;

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function sha256(value) {
  return createHash("sha256").update(value).digest();
}

function hashToken(value) {
  return b64url(sha256(value));
}

function safeEqual(a, b) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function parseSteamId(identity) {
  if (typeof identity !== "string" || !identity.startsWith(STEAM_ID_PREFIX)) {
    throw new Error("invalid Steam identity");
  }
  const steamId = identity.slice(STEAM_ID_PREFIX.length);
  if (!/^\d{17}$/.test(steamId)) throw new Error("invalid SteamID");
  return steamId;
}

function parseStrictQuery(rawQuery) {
  const text = rawQuery.startsWith("?") ? rawQuery.slice(1) : rawQuery;
  const params = new URLSearchParams(text);
  const seen = new Set();
  const out = new Map();
  for (const [key, value] of params.entries()) {
    if (seen.has(key)) throw new Error(`duplicate parameter: ${key}`);
    seen.add(key);
    out.set(key, value);
  }
  return out;
}

function requireParam(params, key) {
  const value = params.get(key);
  if (!value) throw new Error(`missing parameter: ${key}`);
  return value;
}

function assertRealmBinding(returnTo, realm) {
  const callback = new URL(returnTo);
  const allowed = new URL(realm);
  if (callback.protocol !== allowed.protocol || callback.host !== allowed.host) {
    throw new Error("return_to outside realm");
  }
  const realmPath = allowed.pathname.endsWith("/") ? allowed.pathname : `${allowed.pathname}/`;
  if (!callback.pathname.startsWith(realmPath) && callback.pathname !== allowed.pathname) {
    throw new Error("return_to outside realm");
  }
}

function nonceTimestamp(nonce) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/.exec(nonce);
  if (!match) throw new Error("invalid response nonce");
  const value = Date.parse(match[1]);
  if (!Number.isFinite(value)) throw new Error("invalid response nonce");
  return value;
}

export function challengeForVerifier(verifier) {
  if (typeof verifier !== "string" || verifier.length < 16) throw new Error("invalid verifier");
  return b64url(sha256(verifier));
}

export function createMemoryAuthStorage() {
  const login = new Map();
  const nonces = new Set();
  const codes = new Map();
  const sessions = new Map();

  return {
    async putLogin(tx) { login.set(tx.state, structuredClone(tx)); },
    async consumeLogin(state) {
      const tx = login.get(state);
      if (!tx || tx.consumed) return null;
      tx.consumed = true;
      login.set(state, tx);
      return structuredClone(tx);
    },
    async consumeNonce(nonce) {
      if (nonces.has(nonce)) return false;
      nonces.add(nonce);
      return true;
    },
    async putCode(record) { codes.set(record.code, structuredClone(record)); },
    async consumeCode(code) {
      const record = codes.get(code);
      if (!record || record.consumed) return null;
      record.consumed = true;
      codes.set(code, record);
      return structuredClone(record);
    },
    async putSession(record) { sessions.set(record.tokenHash, structuredClone(record)); },
    async getSession(tokenHash) {
      const value = sessions.get(tokenHash);
      return value ? structuredClone(value) : null;
    },
    async revokeSession(tokenHash) {
      const value = sessions.get(tokenHash);
      if (!value) return false;
      value.revokedAt = value.revokedAt ?? Date.now();
      sessions.set(tokenHash, value);
      return true;
    }
  };
}

export function createSteamAuthService({
  storage,
  http,
  now = () => Date.now(),
  random = (size) => randomBytes(size),
  loginTtlMs = DEFAULT_LOGIN_TTL_MS,
  codeTtlMs = DEFAULT_CODE_TTL_MS,
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
  nonceMaxAgeMs = DEFAULT_NONCE_MAX_AGE_MS
}) {
  if (!storage) throw new Error("storage is required");
  if (!http?.checkAuthentication) throw new Error("http.checkAuthentication is required");

  function randomToken(bytes = 32) {
    return b64url(random(bytes));
  }

  return {
    async beginLogin({ returnTo, realm, verifierChallenge, state = null, clientReturnTo = null }) {
      assertRealmBinding(returnTo, realm);
      if (typeof verifierChallenge !== "string" || verifierChallenge.length < 20) {
        throw new Error("invalid verifier challenge");
      }
      const actualState = state ?? randomToken(24);
      if (typeof actualState !== "string" || actualState.length < 24 || !/^[A-Za-z0-9_-]+$/.test(actualState)) {
        throw new Error("invalid state");
      }
      if (clientReturnTo !== null) {
        const callback = new URL(clientReturnTo);
        if (callback.protocol !== "https:" || !callback.hostname.endsWith(".chromiumapp.org")) {
          throw new Error("invalid client return_to");
        }
      }
      const createdAt = now();
      await storage.putLogin({
        state: actualState,
        returnTo,
        realm,
        clientReturnTo,
        verifierChallenge,
        createdAt,
        expiresAt: createdAt + loginTtlMs,
        consumed: false
      });
      return { state: actualState, expiresAt: createdAt + loginTtlMs };
    },

    async verifyCallback(rawQuery) {
      const params = parseStrictQuery(rawQuery);
      const state = requireParam(params, "state");
      const tx = await storage.consumeLogin(state);
      if (!tx) throw new Error("invalid or replayed state");
      if (tx.expiresAt <= now()) throw new Error("expired login transaction");

      const mode = requireParam(params, "openid.mode");
      const provider = requireParam(params, "openid.op_endpoint");
      const returnTo = requireParam(params, "openid.return_to");
      const identity = requireParam(params, "openid.identity");
      const claimedId = requireParam(params, "openid.claimed_id");
      const nonce = requireParam(params, "openid.response_nonce");
      const signed = requireParam(params, "openid.signed");

      if (mode !== "id_res") throw new Error("unexpected OpenID mode");
      if (provider !== STEAM_OPENID_ENDPOINT) throw new Error("unexpected OpenID provider");
      if (returnTo !== tx.returnTo) throw new Error("return_to mismatch");
      assertRealmBinding(returnTo, tx.realm);
      if (identity !== claimedId) throw new Error("identity mismatch");

      const steamId = parseSteamId(identity);
      const requiredSigned = ["op_endpoint", "claimed_id", "identity", "return_to", "response_nonce"];
      const signedFields = new Set(signed.split(",").map((v) => v.trim()).filter(Boolean));
      for (const field of requiredSigned) {
        if (!signedFields.has(field)) throw new Error(`missing signed field: ${field}`);
      }

      const nonceAt = nonceTimestamp(nonce);
      const age = now() - nonceAt;
      if (age < -60_000 || age > nonceMaxAgeMs) throw new Error("expired response nonce");
      if (!(await storage.consumeNonce(nonce))) throw new Error("replayed response nonce");

      const verified = await http.checkAuthentication(Object.fromEntries(params));
      if (verified !== true) throw new Error("Steam assertion rejected");

      const code = randomToken(32);
      await storage.putCode({
        code,
        steamId,
        verifierChallenge: tx.verifierChallenge,
        createdAt: now(),
        expiresAt: now() + codeTtlMs,
        consumed: false
      });
      return { steamId, code, clientReturnTo: tx.clientReturnTo ?? null, expiresAt: now() + codeTtlMs };
    },

    async exchangeCode({ code, verifier }) {
      const record = await storage.consumeCode(code);
      if (!record) throw new Error("invalid or replayed exchange code");
      if (record.expiresAt <= now()) throw new Error("expired exchange code");
      const actualChallenge = challengeForVerifier(verifier);
      if (!safeEqual(actualChallenge, record.verifierChallenge)) {
        throw new Error("verifier challenge mismatch");
      }

      const token = randomToken(32);
      const tokenHash = hashToken(token);
      const issuedAt = now();
      await storage.putSession({
        tokenHash,
        steamId: record.steamId,
        issuedAt,
        expiresAt: issuedAt + sessionTtlMs,
        revokedAt: null
      });
      return { token, steamId: record.steamId, expiresAt: issuedAt + sessionTtlMs };
    },

    async authenticate(token) {
      if (typeof token !== "string" || !token) throw new Error("invalid session token");
      const record = await storage.getSession(hashToken(token));
      if (!record) throw new Error("unknown session");
      if (record.revokedAt) throw new Error("revoked session");
      if (record.expiresAt <= now()) throw new Error("expired session");
      return { steamId: record.steamId, expiresAt: record.expiresAt };
    },

    async authorizeUser(token, steamId) {
      const session = await this.authenticate(token);
      if (session.steamId !== steamId) throw new Error("cross-user access denied");
      return session;
    },

    async logout(token) {
      return storage.revokeSession(hashToken(token));
    }
  };
}
