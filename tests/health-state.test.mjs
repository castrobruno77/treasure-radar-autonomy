import assert from "node:assert/strict";
import { deriveHealthState, isLoginRequiredError, stateLabel } from "../extension/health-state.js";

assert.deepEqual(
  deriveHealthState({ endpointConfigured: false }),
  { state: "NOT_CONFIGURED", freshnessSeconds: null }
);

assert.equal(
  deriveHealthState({ endpointConfigured: true, hasSession: false }).state,
  "LOGIN_REQUIRED"
);

assert.equal(
  deriveHealthState({ endpointConfigured: true, hasSession: true, error: { status: 401 } }).state,
  "LOGIN_REQUIRED"
);

assert.equal(isLoginRequiredError(new Error("RADAR_API_HTTP_401")), true);

assert.equal(
  deriveHealthState({ endpointConfigured: true, hasSession: true, error: new Error("x") }).state,
  "ERROR"
);

assert.equal(
  deriveHealthState({
    endpointConfigured: true,
    hasSession: true,
    payload: { freshness_seconds: 30 },
    staleAfterSeconds: 60
  }).state,
  "READY"
);

assert.equal(
  deriveHealthState({
    endpointConfigured: true,
    hasSession: true,
    payload: { status: "STALE", freshness_seconds: 30 },
    staleAfterSeconds: 60
  }).state,
  "STALE"
);

assert.equal(
  deriveHealthState({
    endpointConfigured: true,
    hasSession: true,
    payload: { freshness_seconds: 120 },
    staleAfterSeconds: 60
  }).state,
  "STALE"
);

assert.match(
  stateLabel({ state: "STALE", freshnessSeconds: 120 }),
  /dados antigos/i
);
assert.match(
  stateLabel({ state: "LOGIN_REQUIRED", freshnessSeconds: null }),
  /login steam/i
);

console.log("Health state tests: PASS");
