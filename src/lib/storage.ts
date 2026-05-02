import { type UserSettings, type PinnedPlayer, type Platform, DEFAULT_SETTINGS } from './types';

const KEY = 'r6_settings';
const PINNED_KEY = 'r6_pinned_players';

export async function getSettings(): Promise<UserSettings> {
  const result = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_SETTINGS, ...(result[KEY] as Partial<UserSettings> | undefined) };
}

export async function saveSettings(partial: Partial<UserSettings>): Promise<UserSettings> {
  const current = await getSettings();
  const merged = { ...current, ...partial };
  await chrome.storage.local.set({ [KEY]: merged });
  return merged;
}

export async function getPinnedPlayers(): Promise<PinnedPlayer[]> {
  const result = await chrome.storage.local.get(PINNED_KEY);
  const raw = result[PINNED_KEY];
  return Array.isArray(raw) ? (raw as PinnedPlayer[]) : [];
}

function sameIdentity(a: { username: string; platform: Platform }, b: { username: string; platform: Platform }): boolean {
  return a.platform === b.platform && a.username.toLowerCase() === b.username.toLowerCase();
}

export async function addPinnedPlayer(player: PinnedPlayer): Promise<{ added: boolean; list: PinnedPlayer[] }> {
  const list = await getPinnedPlayers();
  if (list.some(p => sameIdentity(p, player))) return { added: false, list };
  const next = [...list, player];
  await chrome.storage.local.set({ [PINNED_KEY]: next });
  return { added: true, list: next };
}

export async function removePinnedPlayer(username: string, platform: Platform): Promise<PinnedPlayer[]> {
  const list = await getPinnedPlayers();
  const next = list.filter(p => !sameIdentity(p, { username, platform }));
  if (next.length === list.length) return list;
  await chrome.storage.local.set({ [PINNED_KEY]: next });
  return next;
}

// Reorders the stored list to match the given identity order. Entries missing from `order`
// are appended at the end to keep concurrent add-then-reorder flows non-destructive.
export async function reorderPinnedPlayers(
  order: Array<{ username: string; platform: Platform }>,
): Promise<PinnedPlayer[]> {
  const list = await getPinnedPlayers();
  const reordered: PinnedPlayer[] = [];
  const used = new Set<number>();

  for (const key of order) {
    const idx = list.findIndex((p, i) => !used.has(i) && sameIdentity(p, key));
    if (idx !== -1) {
      reordered.push(list[idx]);
      used.add(idx);
    }
  }
  for (let i = 0; i < list.length; i++) {
    if (!used.has(i)) reordered.push(list[i]);
  }

  await chrome.storage.local.set({ [PINNED_KEY]: reordered });
  return reordered;
}
