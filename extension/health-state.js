export const DEFAULT_STALE_AFTER_SECONDS = 300;

export function isLoginRequiredError(error) {
  return error?.status === 401 ||
    error?.code === "RADAR_API_HTTP_401" ||
    error?.message === "RADAR_API_HTTP_401";
}

export function deriveHealthState({
  endpointConfigured,
  hasSession,
  payload,
  error,
  staleAfterSeconds = DEFAULT_STALE_AFTER_SECONDS
}) {
  if (!endpointConfigured) return { state: "NOT_CONFIGURED", freshnessSeconds: null };
  if (hasSession === false) return { state: "LOGIN_REQUIRED", freshnessSeconds: null };
  if (error) {
    return isLoginRequiredError(error)
      ? { state: "LOGIN_REQUIRED", freshnessSeconds: null }
      : { state: "ERROR", freshnessSeconds: null };
  }

  const freshness = payload?.freshness_seconds;
  if (!Number.isFinite(freshness) || freshness < 0) {
    return { state: "STALE", freshnessSeconds: null };
  }

  if (payload?.status === "STALE" || freshness > staleAfterSeconds) {
    return { state: "STALE", freshnessSeconds: freshness };
  }

  return { state: "READY", freshnessSeconds: freshness };
}

export function stateLabel({ state, freshnessSeconds }) {
  if (state === "NOT_CONFIGURED") return "Motor Radar ainda não conectado";
  if (state === "LOGIN_REQUIRED") return "Login Steam necessário";
  if (state === "ERROR") return "Radar indisponível";
  if (state === "STALE") {
    return Number.isFinite(freshnessSeconds)
      ? `Radar com dados antigos • freshness ${freshnessSeconds}s`
      : "Radar com dados antigos";
  }
  return `Radar pronto • freshness ${freshnessSeconds}s`;
}
