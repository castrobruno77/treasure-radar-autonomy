const form = document.getElementById("settings-form");
const input = document.getElementById("api-endpoint");
const message = document.getElementById("message");

function normalizeEndpoint(value) {
  const url = new URL(value.trim());
  if (url.protocol !== "https:") {
    throw new Error("HTTPS_REQUIRED");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function load() {
  const stored = await chrome.storage.local.get(["tsrApiEndpoint"]);
  input.value = stored.tsrApiEndpoint || "";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const endpoint = normalizeEndpoint(input.value);
    await chrome.storage.local.set({ tsrApiEndpoint: endpoint });
    input.value = endpoint;
    message.textContent = "Endpoint salvo.";
  } catch {
    message.textContent = "Informe um endpoint HTTPS válido.";
  }
});

load().catch(() => {
  message.textContent = "Não foi possível carregar as configurações.";
});

export { normalizeEndpoint };
