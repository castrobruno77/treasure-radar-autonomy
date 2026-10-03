export const DEFAULT_STALE_AFTER_SECONDS = 300;

export function deriveHealthState({
  endpointConfigured,
  payload,
  error,
  staleAfterSeconds = DEFAULT_STALE_AFTER_SECONDS
}) {
  if (!endpointConfigured) return { state: "NOT_CONFIGURED", freshnessSeconds: null };
  if (error) return { state: "ERROR", freshnessSeconds: null };

  const freshness = Number(payload?.freshness_seconds);
  if (!Number.isFinite(freshness)) {
    return { state: "STALE", freshnessSeconds: null };
  }

  if (freshness > staleAfterSeconds) {
    return { state: "STALE", freshnessSeconds: freshness };
  }

  return { state: "ONLINE", freshnessSeconds: freshness };
}

export function stateLabel({ state, freshnessSeconds }) {
  if (state === "NOT_CONFIGURED") return "Motor Radar ainda não conectado";
  if (state === "ERROR") return "Radar indisponível";
  if (state === "STALE") {
    return Number.isFinite(freshnessSeconds)
      ? `Radar com dados antigos • freshness ${freshnessSeconds}s`
      : "Radar com dados antigos";
  }
  return `Radar online • freshness ${freshnessSeconds}s`;
}
