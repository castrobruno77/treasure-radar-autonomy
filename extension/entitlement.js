export function validateEntitlement(entitlement) {
  if (!entitlement || typeof entitlement !== "object") throw new Error("RADAR_ENTITLEMENT_INVALID");
  if (!["FREE", "PRO"].includes(entitlement.plan)) throw new Error("RADAR_ENTITLEMENT_INVALID");
  if (!Number.isInteger(entitlement.locked_opportunity_count) || entitlement.locked_opportunity_count < 0) {
    throw new Error("RADAR_ENTITLEMENT_INVALID");
  }
  return entitlement;
}

export function renderLockedOpportunityCount(container, entitlement) {
  if (!entitlement) return;
  const value = validateEntitlement(entitlement).locked_opportunity_count;
  if (value === 0) return;
  const notice = document.createElement("p");
  notice.className = "locked-opportunities";
  notice.textContent = `${value} oportunidade(s) adicional(is) bloqueada(s) pelo plano atual.`;
  container.appendChild(notice);
}
