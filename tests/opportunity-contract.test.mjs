import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { certifiedOpportunities, validateOpportunityPayload } from "../extension/api.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/opportunities.json", import.meta.url), "utf8"));
assert.equal(validateOpportunityPayload(fixture), fixture);
assert.deepEqual(certifiedOpportunities(fixture).map((item) => item.id), ["cert-1"]);

for (const malformed of [
  null,
  {},
  { items: {} },
  { items: [{ status: "CERTIFIED" }] },
  { items: [{ id:"x", source:"s", collection:"c", rarity:"r", market_hash_name:"m", price_usd:1, captured_at:"2026-10-03T00:00:00Z", status:"UNKNOWN" }] },
  { items: [{ id:"x", source:"s", collection:"c", rarity:"r", market_hash_name:"m", price_usd:1, captured_at:"2026-10-03T00:00:00Z", status:"CERTIFIED", quality_score:101 }] },
  { items: [{ id:"x", source:"s", collection:"c", rarity:"r", market_hash_name:"m", price_usd:1, captured_at:"2026-10-03T00:00:00Z", status:"CERTIFIED", action_tier:"TREASURE", economic_action_score:null }] }
]) {
  assert.throws(() => validateOpportunityPayload(malformed), /RADAR_API_INVALID_PAYLOAD/);
}
console.log("Opportunity contract tests: PASS");
