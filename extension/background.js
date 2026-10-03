chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({
    tsrStatus: "Extensão instalada — motor Radar ainda não conectado"
  });
});
