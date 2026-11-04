function originalCards(cards = []) {
  return cards.filter((card) => card.origin === 'vault' && card.id);
}
async function fingerprint(card) {
  const bytes = new TextEncoder().encode(JSON.stringify([card.path || card.id, card.title || '', card.body || '']));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('');
}
export async function workspaceBackupSource(identity, cards) {
  if (typeof identity !== 'string' || !identity) return {};
  const entries = await Promise.all(originalCards(cards).map(async (card) => [card.id, await fingerprint(card)]));
  return { sourceIdentity: identity, originalFingerprints: Object.fromEntries(entries) };
}
export async function matchingBackupOriginals(plan, identity, cards) {
  const allowed = new Set();
  if (!identity || plan.sourceIdentity !== identity) return allowed;
  for (const card of originalCards(cards)) {
    if (plan.originalFingerprints?.[card.id] === (await fingerprint(card))) allowed.add(card.id);
  }
  return allowed;
}
