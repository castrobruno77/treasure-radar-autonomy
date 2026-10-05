import test from "node:test";
import assert from "node:assert/strict";
import {
  STEAM_OPENID_ENDPOINT,
  challengeForVerifier,
  createMemoryAuthStorage,
  createSteamAuthService
} from "../backend/steam-auth.mjs";

const RETURN_TO = "https://example.test/auth/steam/callback";
const REALM = "https://example.test/auth/steam";
const STEAM_ID = "76561198000000001";
const IDENTITY = `https://steamcommunity.com/openid/id/${STEAM_ID}`;
const VERIFIER = "offline-verifier-1234567890";
const BASE_TIME = Date.parse("2026-10-05T20:00:00Z");


function callbackQuery(state, overrides = {}, extras = []) {
  const values = {
    state,
    "openid.mode": "id_res",
    "openid.op_endpoint": STEAM_OPENID_ENDPOINT,
    "openid.return_to": RETURN_TO,
    "openid.identity": IDENTITY,
    "openid.claimed_id": IDENTITY,
    "openid.response_nonce": "2026-10-05T19:59:30Znonce-1",
    "openid.signed": "op_endpoint,claimed_id,identity,return_to,response_nonce",
    ...overrides
  };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) params.append(key, value);
  for (const [key, value] of extras) params.append(key, value);
  return params.toString();
}

function makeHarness({ nowValue = BASE_TIME, accepted = true } = {}) {
  let clock = nowValue;
  const storage = createMemoryAuthStorage();
  const calls = [];
  let randomCounter = 0;
  const service = createSteamAuthService({
    storage,
    now: () => clock,
    random: (size) => Buffer.alloc(size, (++randomCounter) & 0xff),
    http: {
      async checkAuthentication(payload) {
        calls.push(payload);
        return accepted;
      }
    }
  });
  return {
    storage,
    service,
    calls,
    setNow(value) { clock = value; }
  };
}

async function begin(service) {
  return service.beginLogin({
    returnTo: RETURN_TO,
    realm: REALM,
    verifierChallenge: challengeForVerifier(VERIFIER)
  });
}

test("offline Steam assertion -> exchange -> authenticated session", async () => {
  const h = makeHarness();
  const { state } = await begin(h.service);
  const verified = await h.service.verifyCallback(callbackQuery(state));
  assert.equal(verified.steamId, STEAM_ID);
  assert.equal(h.calls.length, 1);

  const session = await h.service.exchangeCode({ code: verified.code, verifier: VERIFIER });
  assert.equal(session.steamId, STEAM_ID);
  assert.deepEqual(await h.service.authenticate(session.token), {
    steamId: STEAM_ID,
    expiresAt: session.expiresAt
  });
});

test("strict provider, return_to and identity checks reject tampering", async () => {
  for (const overrides of [
    { "openid.op_endpoint": "https://attacker.test/openid" },
    { "openid.return_to": "https://attacker.test/callback" },
    { "openid.claimed_id": "https://steamcommunity.com/openid/id/76561198000000002" }
  ]) {
    const h = makeHarness();
    const { state } = await begin(h.service);
    await assert.rejects(() => h.service.verifyCallback(callbackQuery(state, overrides)));
  }
});

test("beginLogin enforces exact realm binding", async () => {
  const h = makeHarness();
  await assert.rejects(() => h.service.beginLogin({
    returnTo: "https://attacker.test/auth/steam/callback",
    realm: REALM,
    verifierChallenge: challengeForVerifier(VERIFIER)
  }), /realm/);
});

test("duplicate OpenID parameters are rejected before verification", async () => {
  const h = makeHarness();
  const { state } = await begin(h.service);
  await assert.rejects(
    () => h.service.verifyCallback(callbackQuery(state, {}, [["openid.identity", IDENTITY]])),
    /duplicate parameter/
  );
  assert.equal(h.calls.length, 0);
});

test("state replay is rejected atomically", async () => {
  const h = makeHarness();
  const { state } = await begin(h.service);
  await h.service.verifyCallback(callbackQuery(state));
  await assert.rejects(() => h.service.verifyCallback(callbackQuery(state)), /state/);
});

test("nonce replay is rejected across independent login transactions", async () => {
  const h = makeHarness();
  const first = await begin(h.service);
  await h.service.verifyCallback(callbackQuery(first.state));
  const second = await begin(h.service);
  await assert.rejects(() => h.service.verifyCallback(callbackQuery(second.state)), /nonce/);
});

test("expired login transaction and stale nonce are rejected", async () => {
  const h = makeHarness();
  const first = await begin(h.service);
  h.setNow(BASE_TIME + 6 * 60_000);
  await assert.rejects(() => h.service.verifyCallback(callbackQuery(first.state)), /expired login/);

  const h2 = makeHarness({ nowValue: BASE_TIME + 20 * 60_000 });
  const second = await begin(h2.service);
  await assert.rejects(() => h2.service.verifyCallback(callbackQuery(second.state)), /nonce/);
});

test("Steam check_authentication rejection fails closed", async () => {
  const h = makeHarness({ accepted: false });
  const { state } = await begin(h.service);
  await assert.rejects(() => h.service.verifyCallback(callbackQuery(state)), /rejected/);
});

test("exchange code is one-use and bound to verifier challenge", async () => {
  const h = makeHarness();
  const { state } = await begin(h.service);
  const verified = await h.service.verifyCallback(callbackQuery(state));

  await assert.rejects(
    () => h.service.exchangeCode({ code: verified.code, verifier: "wrong-verifier-123456789" }),
    /challenge/
  );
  await assert.rejects(
    () => h.service.exchangeCode({ code: verified.code, verifier: VERIFIER }),
    /replayed exchange code/
  );
});

test("expired exchange code is rejected", async () => {
  const h = makeHarness();
  const { state } = await begin(h.service);
  const verified = await h.service.verifyCallback(callbackQuery(state));
  h.setNow(BASE_TIME + 2 * 60_000);
  await assert.rejects(
    () => h.service.exchangeCode({ code: verified.code, verifier: VERIFIER }),
    /expired exchange/
  );
});

test("session expiry, revocation and cross-user access fail closed", async () => {
  const h = makeHarness();
  const { state } = await begin(h.service);
  const verified = await h.service.verifyCallback(callbackQuery(state));
  const session = await h.service.exchangeCode({ code: verified.code, verifier: VERIFIER });

  await assert.rejects(
    () => h.service.authorizeUser(session.token, "76561198000000002"),
    /cross-user/
  );
  assert.equal(await h.service.logout(session.token), true);
  await assert.rejects(() => h.service.authenticate(session.token), /revoked/);

  const h2 = makeHarness();
  const tx2 = await begin(h2.service);
  const verified2 = await h2.service.verifyCallback(callbackQuery(tx2.state));
  const session2 = await h2.service.exchangeCode({ code: verified2.code, verifier: VERIFIER });
  h2.setNow(BASE_TIME + 25 * 60 * 60_000);
  await assert.rejects(() => h2.service.authenticate(session2.token), /expired session/);
});
