import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { RadarApiError } from "../extension/api.js";
import { createPopupController } from "../extension/popup.js";

class FakeElement {
  constructor() {
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.listeners = new Map();
  }
  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }
  replaceChildren() {
    this.textContent = "";
  }
}

function createDocument() {
  const elements = Object.fromEntries(
    ["status", "opportunities", "auth-required", "steam-login", "auth-message"]
      .map((id) => [id, new FakeElement()])
  );
  return {
    elements,
    getElementById(id) {
      return elements[id];
    }
  };
}

function createChrome({ endpoint = "https://radar.test", token = null } = {}) {
  const localData = {
    tsrApiEndpoint: endpoint,
    tsrStaleAfterSeconds: 300
  };
  const sessionData = token ? { tsrSessionToken: token } : {};

  const pick = (data, keys) => Object.fromEntries(
    keys.filter((key) => Object.prototype.hasOwnProperty.call(data, key))
      .map((key) => [key, data[key]])
  );

  return {
    data: { localData, sessionData },
    storage: {
      local: {
        async get(keys) { return pick(localData, keys); },
        async set(values) { Object.assign(localData, values); }
      },
      session: {
        async get(keys) { return pick(sessionData, keys); },
        async set(values) { Object.assign(sessionData, values); },
        async remove(keys) { for (const key of keys) delete sessionData[key]; }
      }
    }
  };
}

function healthyPayload(freshness = 15) {
  return {
    status: "OK",
    generated_at: "2026-10-07T12:00:00.000Z",
    freshness_seconds: freshness,
    items: []
  };
}

test("popup contract exposes direct Steam CTA", async () => {
  const html = await readFile(new URL("../extension/popup.html", import.meta.url), "utf8");
  assert.match(html, /id="auth-required"/);
  assert.match(html, /id="steam-login"[^>]*>Entrar com Steam<\/button>/);
});

test("logged out -> LOGIN_REQUIRED -> login -> READY -> logout -> LOGIN_REQUIRED", async () => {
  const documentRef = createDocument();
  const chromeApi = createChrome();
  let fetchCalls = 0;
  const renders = [];

  const controller = createPopupController({
    documentRef,
    chromeApi,
    fetchOpportunitiesFn: async ({ token }) => {
      fetchCalls++;
      assert.equal(token, "session-token");
      return healthyPayload();
    },
    loginSteamFn: async (endpoint) => {
      assert.equal(endpoint, "https://radar.test");
      await chromeApi.storage.session.set({ tsrSessionToken: "session-token" });
    },
    renderOpportunitiesFn: (_container, payload, options) => {
      renders.push({ payload, options });
    },
    logger: { error() {} },
    now: () => "2026-10-07T12:00:15.000Z"
  });

  const loggedOut = await controller.boot();
  assert.equal(loggedOut.state, "LOGIN_REQUIRED");
  assert.equal(documentRef.elements["auth-required"].hidden, false);
  assert.equal(fetchCalls, 0);
  assert.equal(renders.length, 0);

  assert.equal(await controller.login(), true);
  assert.equal(documentRef.elements.status.dataset.state, "READY");
  assert.equal(documentRef.elements["auth-required"].hidden, true);
  assert.equal(fetchCalls, 1);
  assert.equal(renders.length, 1);
  assert.equal(renders[0].options.stale, false);

  await chromeApi.storage.session.remove(["tsrSessionToken"]);
  const afterLogout = await controller.boot();
  assert.equal(afterLogout.state, "LOGIN_REQUIRED");
  assert.equal(documentRef.elements["auth-required"].hidden, false);
  assert.equal(fetchCalls, 1);
});

test("STALE, LOGIN_REQUIRED and ERROR remain behaviorally distinct", async () => {
  const documentRef = createDocument();
  const chromeApi = createChrome({ token: "session-token" });
  const renders = [];
  let mode = "stale";

  const controller = createPopupController({
    documentRef,
    chromeApi,
    fetchOpportunitiesFn: async () => {
      if (mode === "stale") return { ...healthyPayload(301), status: "STALE" };
      if (mode === "auth") throw new RadarApiError(401);
      throw new RadarApiError(503);
    },
    loginSteamFn: async () => {},
    renderOpportunitiesFn: (_container, payload, options) => renders.push({ payload, options }),
    logger: { error() {} }
  });

  const stale = await controller.boot();
  assert.equal(stale.state, "STALE");
  assert.equal(documentRef.elements["auth-required"].hidden, true);
  assert.equal(renders.at(-1).options.stale, true);

  mode = "auth";
  const auth = await controller.boot();
  assert.equal(auth.state, "LOGIN_REQUIRED");
  assert.equal(documentRef.elements["auth-required"].hidden, false);
  assert.match(documentRef.elements["auth-message"].textContent, /sessão expirou/i);

  mode = "error";
  const error = await controller.boot();
  assert.equal(error.state, "ERROR");
  assert.equal(documentRef.elements["auth-required"].hidden, true);
  assert.match(documentRef.elements.opportunities.textContent, /não foi possível atualizar/i);
});
