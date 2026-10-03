import { fetchOpportunities } from "./api.js";
import { renderOpportunities } from "./render.js";

const statusEl = document.getElementById("status");
const opportunitiesEl = document.getElementById("opportunities");

async function boot() {
  const stored = await chrome.storage.local.get(["tsrApiEndpoint"]);
  const payload = await fetchOpportunities({ endpoint: stored.tsrApiEndpoint });

  if (payload.status === "NOT_CONFIGURED") {
    statusEl.textContent = "Motor Radar ainda não conectado";
  } else {
    const freshness = Number.isFinite(Number(payload.freshness_seconds))
      ? `${payload.freshness_seconds}s`
      : "N/D";
    statusEl.textContent = `Radar online • freshness ${freshness}`;
  }

  renderOpportunities(opportunitiesEl, payload);
}

boot().catch((error) => {
  statusEl.textContent = "Radar indisponível";
  opportunitiesEl.textContent = "Não foi possível atualizar as oportunidades agora.";
  console.error(error);
});
