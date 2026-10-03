const statusEl = document.getElementById("status");
const opportunitiesEl = document.getElementById("opportunities");

async function boot() {
  const stored = await chrome.storage.local.get(["tsrStatus"]);
  statusEl.textContent = stored.tsrStatus || "Aguardando conexão com o motor Radar";
  opportunitiesEl.innerHTML = "";
}

boot().catch((error) => {
  statusEl.textContent = "Erro de inicialização";
  console.error(error);
});
