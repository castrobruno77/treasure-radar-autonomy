import assert from "node:assert/strict";

function normalizeEndpoint(value) {
  const url = new URL(value.trim());
  if (url.protocol !== "https:") throw new Error("HTTPS_REQUIRED");
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

assert.equal(
  normalizeEndpoint("https://example.supabase.co/"),
  "https://example.supabase.co"
);

assert.throws(
  () => normalizeEndpoint("http://example.com"),
  /HTTPS_REQUIRED/
);

console.log("Options endpoint validation: PASS");
