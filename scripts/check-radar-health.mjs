const url = process.env.RADAR_HEALTH_URL;
const expected = process.env.EXPECTED_REVISION;

if (!url || !expected) {
  throw new Error("RADAR_HEALTH_CONFIGURATION_MISSING");
}

const response = await fetch(url, {
  headers: { "accept": "application/json" },
  signal: AbortSignal.timeout(10000)
});

if (!response.ok) {
  throw new Error(`RADAR_HEALTH_HTTP_${response.status}`);
}

const text = await response.text();
if (!text.includes(expected)) {
  throw new Error(`RADAR_REVISION_MISMATCH expected=${expected} body=${text.slice(0, 500)}`);
}

console.log(JSON.stringify({
  status: "PASS",
  checked_at: new Date().toISOString(),
  expected_revision: expected
}));
