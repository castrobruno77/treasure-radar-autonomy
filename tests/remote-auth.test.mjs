import test from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteHandler } from '../backend/remote-handler.mjs';

const env = {
  TSR_AUTH_ENABLED: 'false',
  TSR_PUBLIC_ORIGIN: 'https://radar.example.test',
  TSR_EXTENSION_ID: 'jlnahdgkmannagapaakmgbcahoholpmg'
};

test('remote handler is fail-closed until auth + Supabase config are complete', async () => {
  const handler = createRemoteHandler({ store: { read: async () => null }, env });
  const health = await (await handler(new Request('https://radar.example.test/health'))).json();
  assert.equal(health.auth, 'NOT_CONFIGURED');

  const feed = await handler(new Request('https://radar.example.test/v1/opportunities', {
    headers: { origin: 'chrome-extension://jlnahdgkmannagapaakmgbcahoholpmg' }
  }));
  assert.equal(feed.status, 503);
});

test('remote handler rejects non-extension origins before auth work', async () => {
  const handler = createRemoteHandler({ store: { read: async () => null }, env: { ...env, TSR_AUTH_ENABLED: 'true' } });
  const response = await handler(new Request('https://radar.example.test/v1/auth/steam/start', {
    method: 'POST',
    headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
    body: '{}'
  }));
  assert.equal(response.status, 403);
});
