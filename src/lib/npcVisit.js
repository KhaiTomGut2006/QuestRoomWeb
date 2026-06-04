export const NPC_VISIT_ACTIONS = {
  chest: "__chest__",
  gamble: "__gamble__",
  hint: "__hint__"
};

export function assertActiveNpcVisit(member, visitId) {
  const normalizedVisitId = String(visitId || "");
  const memberId = String(member?.discord_id || member?.discordId || "");
  const activeVisit = memberId ? globalThis.__questRoomActiveNpcVisits?.get(memberId) : null;
  const activeVisitId = String(activeVisit?.visitId || "");
  const persistedVisitId = String(member?.npcCycle?.pendingNpc?.visitId || "");
  if (!normalizedVisitId || (activeVisitId !== normalizedVisitId && persistedVisitId !== normalizedVisitId)) {
    throw new Error("npc_visit_expired");
  }
  return normalizedVisitId;
}

export function getNpcVisitPurchases(member, visitId) {
  if (String(member?.npcVisitId || "") !== String(visitId || "")) return [];
  return Array.isArray(member?.npcVisitPurchases) ? member.npcVisitPurchases.map(String) : [];
}

export function hasNpcVisitAction(member, visitId, action) {
  return getNpcVisitPurchases(member, visitId).includes(String(action || ""));
}

export function markNpcVisitAction(member, visitId, action) {
  const normalizedVisitId = assertActiveNpcVisit(member, visitId);
  const normalizedAction = String(action || "");
  const purchases = getNpcVisitPurchases(member, normalizedVisitId);
  member.npcVisitId = normalizedVisitId;
  member.npcVisitPurchases = purchases.includes(normalizedAction)
    ? purchases
    : [...purchases, normalizedAction];
}
