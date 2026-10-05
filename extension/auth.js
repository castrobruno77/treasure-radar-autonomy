function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomVerifier() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

export async function challengeForVerifier(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export async function loginSteam(endpoint) {
  const verifier = randomVerifier();
  const verifierChallenge = await challengeForVerifier(verifier);
  const clientReturnTo = chrome.identity.getRedirectURL("steam");

  const started = await fetch(new URL("/v1/auth/steam/start", endpoint), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verifier_challenge: verifierChallenge, client_return_to: clientReturnTo })
  });
  if (!started.ok) throw new Error(`STEAM_LOGIN_START_${started.status}`);
  const { login_url: loginUrl } = await started.json();

  const finalUrl = await chrome.identity.launchWebAuthFlow({ url: loginUrl, interactive: true });
  if (!finalUrl) throw new Error("STEAM_LOGIN_CANCELLED");
  const callback = new URL(finalUrl);
  if (callback.origin !== new URL(clientReturnTo).origin || callback.pathname !== new URL(clientReturnTo).pathname) {
    throw new Error("STEAM_CALLBACK_MISMATCH");
  }
  const code = callback.searchParams.get("code");
  if (!code) throw new Error("STEAM_CODE_MISSING");

  const exchanged = await fetch(new URL("/v1/auth/steam/exchange", endpoint), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, verifier })
  });
  if (!exchanged.ok) throw new Error(`STEAM_EXCHANGE_${exchanged.status}`);
  const session = await exchanged.json();
  await chrome.storage.session.set({ tsrSessionToken: session.token, tsrSessionExpiresAt: session.expires_at });
  return session;
}

export async function logoutSteam(endpoint) {
  const { tsrSessionToken } = await chrome.storage.session.get(["tsrSessionToken"]);
  if (tsrSessionToken) {
    await fetch(new URL("/v1/auth/logout", endpoint), {
      method: "POST",
      headers: { Authorization: `Bearer ${tsrSessionToken}` }
    }).catch(() => {});
  }
  await chrome.storage.session.remove(["tsrSessionToken", "tsrSessionExpiresAt"]);
}
