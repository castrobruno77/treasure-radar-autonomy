# Steam authentication boundary

Status: offline verifier/session contracts implemented and tested; `/v1/auth/*` remains unexposed and no real Steam login or fake Steam session is issued. Local pilot is loopback-only; remote authenticated MVP is not launched.

Steam documents browser OpenID 2.0 for retrieving a verified SteamID. Do not confuse this with game ticket authentication, ownership checks or a requirement to collect a Steam password. Source: https://partner.steamgames.com/doc/features/auth?l=english

## Planned flow

1. Extension creates a random verifier and SHA-256 challenge, requests a short-lived login transaction, then opens the login URL through `chrome.identity.launchWebAuthFlow` (identity permission added only with implementation). Chrome's redirect URL is bound to the installed extension ID: https://developer.chrome.com/docs/extensions/reference/api/identity
2. Backend records a random one-use state, verifier challenge, expiry and exact allowed extension callback. Redirects only to Steam's fixed OpenID endpoint; never accept an arbitrary provider or return origin.
3. HTTPS callback verifies state, exact `return_to`, OP endpoint, identity/claimed-ID match, signed fields, recent response nonce and Steam's server-side `check_authentication` result using a maintained OpenID implementation. Reject duplicate parameters, invalid signatures, expired transactions and nonce replays atomically. Preserve SteamID as a string.
4. Backend returns only a short-lived one-use exchange code to the fixed extension callback. Exchange requires the verifier; do not place a bearer session token in URLs. Store session token hashes and expiry server-side; support revocation/logout and rotation. Keep client tokens in extension session storage, unavailable to content scripts. No secrets in extension bundles.
5. `/v1/opportunities` requires a valid server session in remote mode; entitlements are server-owned. Deny anonymous, expired and revoked sessions. Prefer opaque session tokens; do not invent a signing secret or impersonate a Steam identity.

## Data and gates

Minimum future tables: `tsr_users` (internal ID and unique SteamID), `tsr_login_transactions` (state/challenge/expiry/consumed), `tsr_sessions` (token hash/user/expiry/revoked). No inventory, email, name or profile enrichment required. RLS and no anonymous/authenticated direct access; API enforces ownership. Retention must be bounded and documented before deployment.

Basic OpenID identity verification does not inherently require a Steam Web API key. The actual prerequisites here are an approved HTTPS deployment/callback origin, stable Chrome/Edge extension IDs, durable authorized session storage and any runtime access unavailable in this environment. A key is a gate only if a selected optional Steam API actually needs it. Never ask for passwords or secrets in chat.

Acceptance: mocked signed assertion success and failure; exact host/realm/return-to matching; duplicate fields; state/nonce/code replay; expired state and sessions; attacker redirect; cross-user access; logout; verified callback on real Steam with the user in control. Until then, keep remote feed closed. Rollback: disable auth routes/revert release while retaining audit/session records; revoke affected sessions.


## Offline contract implementation

`backend/steam-auth.mjs` implements injected-storage/injected-HTTP primitives only. It is not wired to production routes. Coverage includes strict provider/return_to/realm/identity validation, duplicate parameter rejection, signed-field requirements, state and nonce replay protection, one-use verifier-bound exchange codes, session expiry, cross-user denial and revocation. `tests/steam-auth.test.mjs` exercises these paths without contacting Steam.

The injected `http.checkAuthentication` boundary represents Steam OpenID server-side verification; production wiring remains gated by the authenticated remote deployment decision (#16). No Steam password, API key, signing secret or production session store is introduced by this offline contract layer.
