export function renderOpportunities(container, payload) {
  container.replaceChildren();

  if (!payload.items.length) {
    const empty = document.createElement("p");
    empty.textContent = "Nenhuma oportunidade certificada disponível agora.";
    container.appendChild(empty);
    return;
  }

  for (const item of payload.items) {
    const card = document.createElement("article");
    card.className = "opportunity";

    const title = document.createElement("strong");
    title.textContent = item.market_hash_name;

    const meta = document.createElement("p");
    const gap = Number.isFinite(Number(item.robust_gap_pct))
      ? ` • gap ${Number(item.robust_gap_pct).toFixed(1)}%`
      : "";
    meta.textContent = `${item.source} • US$${Number(item.price_usd).toFixed(2)}${gap}`;

    card.append(title, meta);

    if (item.listing_url) {
      const link = document.createElement("a");
      link.href = item.listing_url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Abrir listing";
      card.appendChild(link);
    }

    container.appendChild(card);
  }
}
