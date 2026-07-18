import {
  type UserSettings,
  type PinnedPlayer,
  type Platform,
  type PlayerRank,
  type RankedStats,
  type UserPreferences,
  DEFAULT_SETTINGS,
  DEFAULT_PREFERENCES,
  MIN_REFRESH_MINUTES,
} from './types';

const KEY = 'r6_settings';
const PINNED_KEY = 'r6_pinned_players';
const PREFS_KEY = 'r6_preferences';

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

export async function setPinnedPlayerRank(
  guid: string,
  rank: PlayerRank,
  rankedStats?: RankedStats,
): Promise<PinnedPlayer[]> {
  const list = await getPinnedPlayers();
  let changed = false;
  const next = list.map((p) => {
    if (p.guid !== guid) return p;
    changed = true;
    // Don't drop existing stats when caller only ships rank — but always overwrite when
    // a fresh stats object is supplied (even an empty one means "we looked, nothing there").
    return { ...p, rank, rankedStats: rankedStats !== undefined ? rankedStats : p.rankedStats };
  });
  if (!changed) return list;
  await chrome.storage.local.set({ [PINNED_KEY]: next });
  return next;
}

export async function getPreferences(): Promise<UserPreferences> {
  const result = await chrome.storage.local.get(PREFS_KEY);
  const raw = (result[PREFS_KEY] as Partial<UserPreferences> | undefined) ?? {};
  return {
    ...DEFAULT_PREFERENCES,
    ...raw,
    pinnedAutoRefresh: { ...DEFAULT_PREFERENCES.pinnedAutoRefresh, ...(raw.pinnedAutoRefresh ?? {}) },
  };
}

export async function savePreferences(partial: Partial<UserPreferences>): Promise<UserPreferences> {
  const current = await getPreferences();
  const merged: UserPreferences = {
    ...current,
    ...partial,
    pinnedAutoRefresh: { ...current.pinnedAutoRefresh, ...(partial.pinnedAutoRefresh ?? {}) },
  };
  // Clamp at the storage layer so neither the popup nor a stale message can persist
  // out-of-range values that would cause Chrome to reject the alarm.
  merged.pinnedAutoRefresh.intervalMinutes = Math.max(
    MIN_REFRESH_MINUTES,
    Math.round(merged.pinnedAutoRefresh.intervalMinutes),
  );
  await chrome.storage.local.set({ [PREFS_KEY]: merged });
  return merged;
}
