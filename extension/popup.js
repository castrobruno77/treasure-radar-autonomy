import { fetchOpportunities } from "./api.js";
import { renderOpportunities } from "./render.js";
import {
  DEFAULT_STALE_AFTER_SECONDS,
  deriveHealthState,
  stateLabel
} from "./health-state.js";

const statusEl = document.getElementById("status");
const opportunitiesEl = document.getElementById("opportunities");

async function boot() {
  const stored = await chrome.storage.local.get([
    "tsrApiEndpoint",
    "tsrStaleAfterSeconds",
    "tsrLastSuccessfulFetchAt"
  ]);

  const endpointConfigured = Boolean(stored.tsrApiEndpoint);
  const staleAfterSeconds = Number.isFinite(Number(stored.tsrStaleAfterSeconds))
    ? Number(stored.tsrStaleAfterSeconds)
    : DEFAULT_STALE_AFTER_SECONDS;

  if (!endpointConfigured) {
    const health = deriveHealthState({ endpointConfigured: false });
    statusEl.dataset.state = health.state;
    statusEl.textContent = stateLabel(health);
    renderOpportunities(opportunitiesEl, {
      status: "NOT_CONFIGURED",
      generated_at: new Date().toISOString(),
      freshness_seconds: null,
      items: []
    });
    return;
  }

  try {
    const payload = await fetchOpportunities({ endpoint: stored.tsrApiEndpoint });
    const health = deriveHealthState({
      endpointConfigured: true,
      payload,
      staleAfterSeconds
    });

    statusEl.dataset.state = health.state;
    statusEl.textContent = stateLabel(health);

    if (health.state === "ONLINE") {
      await chrome.storage.local.set({
        tsrLastSuccessfulFetchAt: new Date().toISOString()
      });
    }

    renderOpportunities(opportunitiesEl, payload, { stale: health.state === "STALE" });
  } catch (error) {
    const health = deriveHealthState({ endpointConfigured: true, error });
    statusEl.dataset.state = health.state;
    statusEl.textContent = stateLabel(health);

    const last = stored.tsrLastSuccessfulFetchAt
      ? ` Última atualização bem-sucedida: ${stored.tsrLastSuccessfulFetchAt}`
      : "";

    opportunitiesEl.textContent = `Não foi possível atualizar as oportunidades agora.${last}`;
    console.error(error);
  }
}

boot();
