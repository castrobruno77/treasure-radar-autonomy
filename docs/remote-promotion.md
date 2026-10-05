# Gate #16 — authenticated remote promotion

Status: authorized by Bruno; remote-ready code is prepared; production enablement is still fail-closed.

## Fixed extension identity

Manifest public key fixes Chromium extension ID:

`jlnahdgkmannagapaakmgbcahoholpmg`

Expected Chrome Identity callback:

`https://jlnahdgkmannagapaakmgbcahoholpmg.chromiumapp.org/steam`

No private key is retained or required by the runtime.

## Remote runtime contract

Required server-side environment names:

- `TSR_AUTH_ENABLED` — keep `false` until smoke-ready.
- `TSR_PUBLIC_ORIGIN` — exact HTTPS origin of isolated Radar API.
- `TSR_EXTENSION_ID` — fixed value above.
- `SUPABASE_URL` — existing project URL.
- `SUPABASE_SERVICE_ROLE_KEY` — existing server-only credential; never expose to extension/source/chat.

When configuration is incomplete, auth and feed fail closed. When enabled, extension-origin requests must match the fixed extension ID, Steam OpenID assertions are verified server-side, exchange codes are one-use, session tokens are opaque and stored only as hashes server-side, and the opportunities feed requires a valid session.

## Deployment target

Do not overwrite `scale-runtime-market`. It is deliberately suspended and contains unrelated market configuration. Use a dedicated `treasure-radar-api` service in the existing SCALE Railway project. Prefer staged configuration before first live deployment. Confirm no incremental paid resource before activation.

## Rollback

Disable `TSR_AUTH_ENABLED`, remove/revert the Radar service deployment, and preserve auth/session rows for audit. Existing SCALE services and market credentials are not modified.
