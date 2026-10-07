import { fetchOpportunities } from "./api.js";
import { loginSteam } from "./auth.js";
import { renderOpportunities } from "./render.js";
import {
  DEFAULT_STALE_AFTER_SECONDS,
  deriveHealthState,
  stateLabel
} from "./health-state.js";

export function createPopupController({
  documentRef,
  chromeApi,
  fetchOpportunitiesFn = fetchOpportunities,
  loginSteamFn = loginSteam,
  renderOpportunitiesFn = renderOpportunities,
  logger = console,
  now = () => new Date().toISOString()
}) {
  const statusEl = documentRef.getElementById("status");
  const opportunitiesEl = documentRef.getElementById("opportunities");
  const authRequiredEl = documentRef.getElementById("auth-required");
  const loginButton = documentRef.getElementById("steam-login");
  const authMessageEl = documentRef.getElementById("auth-message");

  function setHealth(health) {
    statusEl.dataset.state = health.state;
    statusEl.textContent = stateLabel(health);
  }

  function hideAuthRequired() {
    authRequiredEl.hidden = true;
    authMessageEl.textContent = "";
  }

  function showLoginRequired(message = "") {
    authRequiredEl.hidden = false;
    authMessageEl.textContent = message;
    opportunitiesEl.replaceChildren();
  }

  async function boot() {
    const stored = await chromeApi.storage.local.get([
      "tsrApiEndpoint",
      "tsrStaleAfterSeconds",
      "tsrLastSuccessfulFetchAt"
    ]);
    const session = await chromeApi.storage.session.get(["tsrSessionToken"]);

    const endpointConfigured = Boolean(stored.tsrApiEndpoint);
    const staleAfterSeconds = Number.isFinite(Number(stored.tsrStaleAfterSeconds))
      ? Number(stored.tsrStaleAfterSeconds)
      : DEFAULT_STALE_AFTER_SECONDS;

    if (!endpointConfigured) {
      const health = deriveHealthState({ endpointConfigured: false });
      setHealth(health);
      hideAuthRequired();
      opportunitiesEl.textContent = "Configure o endpoint do Radar para continuar.";
      return health;
    }

    if (!session.tsrSessionToken) {
      const health = deriveHealthState({ endpointConfigured: true, hasSession: false });
      setHealth(health);
      showLoginRequired();
      return health;
    }

    try {
      const payload = await fetchOpportunitiesFn({
        endpoint: stored.tsrApiEndpoint,
        token: session.tsrSessionToken
      });
      const health = deriveHealthState({
        endpointConfigured: true,
        hasSession: true,
        payload,
        staleAfterSeconds
      });

      setHealth(health);
      hideAuthRequired();

      if (health.state === "READY") {
        await chromeApi.storage.local.set({
          tsrLastSuccessfulFetchAt: now()
        });
      }

      renderOpportunitiesFn(opportunitiesEl, payload, { stale: health.state === "STALE" });
      return health;
    } catch (error) {
      const health = deriveHealthState({
        endpointConfigured: true,
        hasSession: true,
        error
      });
      setHealth(health);

      if (health.state === "LOGIN_REQUIRED") {
        showLoginRequired("Sua sessão expirou. Entre novamente com Steam.");
        return health;
      }

      hideAuthRequired();
      const last = stored.tsrLastSuccessfulFetchAt
        ? ` Última atualização bem-sucedida: ${stored.tsrLastSuccessfulFetchAt}`
        : "";
      opportunitiesEl.textContent = `Não foi possível atualizar as oportunidades agora.${last}`;
      logger.error(error);
      return health;
    }
  }

  async function login() {
    const stored = await chromeApi.storage.local.get(["tsrApiEndpoint"]);
    if (!stored.tsrApiEndpoint) {
      authMessageEl.textContent = "Configure o endpoint do Radar antes de entrar.";
      return false;
    }

    loginButton.disabled = true;
    authMessageEl.textContent = "Abrindo Steam…";
    try {
      await loginSteamFn(stored.tsrApiEndpoint);
      await boot();
      return true;
    } catch (error) {
      const health = deriveHealthState({ endpointConfigured: true, hasSession: false });
      setHealth(health);
      showLoginRequired("Não foi possível concluir o login Steam.");
      logger.error(error);
      return false;
    } finally {
      loginButton.disabled = false;
    }
  }

  loginButton.addEventListener("click", () => {
    void login();
  });

  return { boot, login };
}

if (typeof document !== "undefined" && typeof chrome !== "undefined") {
  const controller = createPopupController({ documentRef: document, chromeApi: chrome });
  void controller.boot();
}
