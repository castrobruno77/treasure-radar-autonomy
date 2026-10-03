import { certifiedOpportunities } from "./api.js";

export function renderOpportunities(container, payload, { stale = false } = {}) {
  container.replaceChildren();
  if (payload.pilot_notice) {
    const notice = document.createElement('p');
    notice.textContent = payload.pilot_notice;
    container.appendChild(notice);
  }
  const items = certifiedOpportunities(payload);

  if (!items.length) {
    const empty = document.createElement("p");
    empty.textContent = stale
      ? "Sem oportunidade certificada fresca; dados atuais estão marcados como antigos."
      : "Nenhuma oportunidade certificada disponível agora.";
    container.appendChild(empty);
    return;
  }

  for (const item of items) {
    const card = document.createElement("article");
    card.className = stale ? "opportunity stale" : "opportunity";

    const title = document.createElement("strong");
    title.textContent = item.market_hash_name;

    const meta = document.createElement("p");
    const gap = Number.isFinite(Number(item.robust_gap_pct))
      ? ` • gap ${Number(item.robust_gap_pct).toFixed(1)}%`
      : "";
    meta.textContent = `${item.source} • US$${Number(item.price_usd).toFixed(2)}${gap}`;
    card.append(title, meta);

    if (stale) {
      const staleLabel = document.createElement("p");
      staleLabel.className = "stale-label";
      staleLabel.textContent = "Dados antigos — confirme a listagem antes de agir.";
      card.appendChild(staleLabel);
    }

    let safeListing = null;
    try {
      const url = new URL(item.listing_url);
      if (url.protocol === 'https:' && !url.username && !url.password) safeListing = url.href;
    } catch { /* Absent/invalid URLs have no action. */ }
    if (safeListing) {
      const link = document.createElement("a");
      link.href = safeListing;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Abrir listing";
      card.appendChild(link);
    }
    container.appendChild(card);
  }
}
