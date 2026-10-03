import assert from "node:assert/strict";
import { normalizeEndpoint } from '../extension/endpoint.js';

assert.equal(
  normalizeEndpoint("https://example.supabase.co/"),
  "https://example.supabase.co"
);

assert.throws(
  () => normalizeEndpoint("http://example.com"),
  /HTTPS_REQUIRED/
);

console.log("Options endpoint validation: PASS");
assert.equal(normalizeEndpoint('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787');
assert.throws(() => normalizeEndpoint('https://user:password@example.com'), /ORIGIN_REQUIRED/);
assert.throws(() => normalizeEndpoint('https://example.com/functions/v1/api'), /ORIGIN_REQUIRED/);
assert.throws(() => normalizeEndpoint('http://127.0.0.1.evil.com'), /HTTPS_REQUIRED/);
