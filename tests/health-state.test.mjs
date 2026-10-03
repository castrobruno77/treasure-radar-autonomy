import assert from "node:assert/strict";
import { deriveHealthState, stateLabel } from "../extension/health-state.js";

assert.deepEqual(
  deriveHealthState({ endpointConfigured: false }),
  { state: "NOT_CONFIGURED", freshnessSeconds: null }
);

assert.equal(
  deriveHealthState({ endpointConfigured: true, error: new Error("x") }).state,
  "ERROR"
);

assert.equal(
  deriveHealthState({
    endpointConfigured: true,
    payload: { freshness_seconds: 30 },
    staleAfterSeconds: 60
  }).state,
  "ONLINE"
);

assert.equal(
  deriveHealthState({
    endpointConfigured: true,
    payload: { freshness_seconds: 120 },
    staleAfterSeconds: 60
  }).state,
  "STALE"
);

assert.match(
  stateLabel({ state: "STALE", freshnessSeconds: 120 }),
  /dados antigos/i
);

console.log("Health state tests: PASS");
