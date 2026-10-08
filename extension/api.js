export class RadarApiError extends Error {
  constructor(status) {
    super(`RADAR_API_HTTP_${status}`);
    this.name = "RadarApiError";
    this.status = status;
    this.code = `RADAR_API_HTTP_${status}`;
  }
}

export function validateOpportunityPayload(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.items)) {
    throw new Error("RADAR_API_INVALID_PAYLOAD");
  }

  for (const item of payload.items) {
    if (!item || typeof item !== "object") throw new Error("RADAR_API_INVALID_PAYLOAD");
    if (!["CERTIFIED", "REJECTED", "INSUFFICIENT"].includes(item.status)) {
      throw new Error("RADAR_API_INVALID_PAYLOAD");
    }
    if (typeof item.id !== "string" || typeof item.source !== "string" ||
        typeof item.collection !== "string" || typeof item.rarity !== "string" ||
        typeof item.market_hash_name !== "string" || !Number.isFinite(item.price_usd) ||
        item.price_usd <= 0 || typeof item.captured_at !== "string" || !Number.isFinite(Date.parse(item.captured_at))) {
      throw new Error("RADAR_API_INVALID_PAYLOAD");
    }
    for (const score of [item.quality_score, item.economic_action_score]) {
      if (score !== undefined && score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) {
        throw new Error("RADAR_API_INVALID_PAYLOAD");
      }
    }
    if (item.scoring_version !== undefined && typeof item.scoring_version !== "string") {
      throw new Error("RADAR_API_INVALID_PAYLOAD");
    }
    if (item.action_tier !== undefined && !["DIAMOND","TREASURE","WATCH","BLOCKED"].includes(item.action_tier)) {
      throw new Error("RADAR_API_INVALID_PAYLOAD");
    }
    if (["DIAMOND","TREASURE"].includes(item.action_tier) &&
        (item.status !== "CERTIFIED" || !Number.isFinite(item.economic_action_score))) {
      throw new Error("RADAR_API_INVALID_PAYLOAD");
    }
  }
  return payload;
}

export function certifiedOpportunities(payload) {
  validateOpportunityPayload(payload);
  return payload.items.filter((item) => item.status === "CERTIFIED");
}

export async function fetchOpportunities({ endpoint, limit = 20, since, token = null } = {}) {
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

  const headers = { "Accept": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) throw new RadarApiError(response.status);
  return validateOpportunityPayload(await response.json());
}
