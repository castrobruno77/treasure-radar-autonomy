import { normalizeEndpoint } from './endpoint.js';
import { loginSteam, logoutSteam } from './auth.js';
const form = document.getElementById("settings-form");
const input = document.getElementById("api-endpoint");
const message = document.getElementById("message");
const loginButton = document.getElementById("steam-login");
const logoutButton = document.getElementById("steam-logout");

async function load() {
  const stored = await chrome.storage.local.get(["tsrApiEndpoint"]);
  input.value = stored.tsrApiEndpoint || "";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const endpoint = normalizeEndpoint(input.value);
    const granted = await chrome.permissions.request({ origins: [`${endpoint}/*`] });
    if (!granted) throw new Error('PERMISSION_REQUIRED');
    await chrome.storage.local.set({ tsrApiEndpoint: endpoint });
    input.value = endpoint;
    message.textContent = "Endpoint salvo.";
  } catch {
    message.textContent = "Informe a origem HTTPS da API ou http://127.0.0.1:8787 para o piloto local e permita o acesso.";
  }
});

loginButton.addEventListener("click", async () => {
  try {
    const endpoint = normalizeEndpoint(input.value);
    if (!endpoint.startsWith("https://")) throw new Error("REMOTE_HTTPS_REQUIRED");
    await loginSteam(endpoint);
    message.textContent = "Sessão Steam ativa nesta sessão do navegador.";
  } catch {
    message.textContent = "Não foi possível concluir o login Steam.";
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    const endpoint = normalizeEndpoint(input.value);
    await logoutSteam(endpoint);
  } finally {
    message.textContent = "Sessão Steam encerrada.";
  }
});

load().catch(() => {
  message.textContent = "Não foi possível carregar as configurações.";
});

export { normalizeEndpoint };
