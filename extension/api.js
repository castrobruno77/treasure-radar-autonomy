export async function fetchOpportunities({ endpoint, limit = 20, since } = {}) {
  if (!endpoint) {
    return {
      status: "NOT_CONFIGURED",
      generated_at: new Date().toISOString(),
      freshness_seconds: null,
      items: []
    };
  }

  const url = new URL("/v1/opportunities", endpoint);
  url.searchParams.set("status", "CERTIFIED");
  url.searchParams.set("limit", String(limit));
  if (since) url.searchParams.set("since", since);

  const response = await fetch(url, {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(`RADAR_API_HTTP_${response.status}`);
  }

  const payload = await response.json();
  if (!payload || !Array.isArray(payload.items)) {
    throw new Error("RADAR_API_INVALID_PAYLOAD");
  }

  return payload;
}
