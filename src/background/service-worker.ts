import type { Message, SelectProfileResponse, PinResponse, ExtractedProfile, PinnedPlayer, PlayerRank, RankedStats, UserPreferences } from '../lib/types';
import { parseStatsccProfileUrl, parseTrackerProfileUrl, GUID_RE } from '../lib/patterns';
import { getSettings, saveSettings, getPinnedPlayers, addPinnedPlayer, removePinnedPlayer, reorderPinnedPlayers, setPinnedPlayerRank, getPreferences, savePreferences } from '../lib/storage';
import { extractRankFromStatsccHtml } from '../lib/statscc-rank';
import { fetchRankFromStatsccApi } from '../lib/statscc-api';

const FULL_GUID_RE = new RegExp(`^${GUID_RE.source}$`, 'i');

function isGuidSlug(slug: string): boolean {
  return FULL_GUID_RE.test(slug);
}

const PROFILE_EXTRACT_TIMEOUT_MS = 2000;

chrome.runtime.onMessage.addListener(
  (message: Message, _sender, sendResponse) => {
    handleMessage(message).then(sendResponse);
    return true;
  }
);

async function handleMessage(msg: Message): Promise<unknown> {
  switch (msg.type) {
    case 'GET_SETTINGS':
      return await getSettings();
    case 'SAVE_SETTINGS':
      await saveSettings(msg.payload);
      return { ok: true };
    case 'SET_AVATAR': {
      const settings = await getSettings();
      const { username, avatarUrl } = msg.payload;
      const isOwnProfile =
        !!settings.username &&
        (username.toLowerCase() === settings.username.toLowerCase() ||
          username.toLowerCase() === settings.guid.toLowerCase());
      if (isOwnProfile) await saveSettings({ avatarUrl });
      return { ok: true };
    }
    case 'SELECT_PROFILE_FROM_TAB':
      return await selectProfileFromActiveTab();
    case 'GET_PINNED_PLAYERS':
      return await getPinnedPlayers();
    case 'PIN_CURRENT_TAB':
      return await pinCurrentTab();
    case 'UNPIN_PLAYER':
      return await removePinnedPlayer(msg.payload.username, msg.payload.platform);
    case 'REORDER_PINNED_PLAYERS':
      return await reorderPinnedPlayers(msg.payload);
    case 'SET_PLAYER_RANK': {
      const { guid, rank, rankedStats } = msg.payload;
      const settings = await getSettings();
      if (settings.guid === guid) await saveSettings({ rank, rankedStats });
      return await setPinnedPlayerRank(guid, rank, rankedStats);
    }
    case 'REFRESH_RANK_IF_PINNED':
      return await refreshRankIfTracked(msg.payload.guid);
    case 'GET_PREFERENCES':
      return await getPreferences();
    case 'SAVE_PREFERENCES': {
      const next = await savePreferences(msg.payload);
      await syncRefreshAlarm();
      return next;
    }
    default:
      return null;
  }
}

// --- Background rank refresh ---

const REFRESH_ALARM = 'refresh-pinned-ranks';

// Reconcile the chrome.alarms registration with the current preferences. Called on
// install, startup, and every time SAVE_PREFERENCES lands. Treats `enabled: false` as
// "no alarm at all" so disabled users don't pay any background cost.
async function syncRefreshAlarm(): Promise<void> {
  const prefs = await getPreferences();
  if (!prefs.pinnedAutoRefresh.enabled) {
    await chrome.alarms.clear(REFRESH_ALARM);
    return;
  }
  const periodInMinutes = prefs.pinnedAutoRefresh.intervalMinutes;
  const existing = await chrome.alarms.get(REFRESH_ALARM);
  if (existing && existing.periodInMinutes === periodInMinutes) return;
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes, when: Date.now() + 60_000 });
}

chrome.runtime.onInstalled.addListener(() => { syncRefreshAlarm(); });
chrome.runtime.onStartup.addListener(() => { syncRefreshAlarm(); });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) refreshAllPinnedRanks();
});

// Triggered when a content script notices the user has visited a profile page (e.g.
// tracker.gg) for someone we already track. Skips the alarm's TTL gate so the user sees
// fresh data right after visiting — but bails fast if the rank was just refreshed (≤ 5 min)
// to avoid double-fetching when the user reloads.
const VISIT_REFRESH_DEBOUNCE_MS = 5 * 60 * 1000;

async function refreshRankIfTracked(guid: string): Promise<{ refreshed: boolean }> {
  const list = await getPinnedPlayers();
  const settings = await getSettings();

  const isTracked = list.some(p => p.guid === guid) || settings.guid === guid;
  if (!isTracked) return { refreshed: false };

  const existing = list.find(p => p.guid === guid)?.rank
    ?? (settings.guid === guid ? settings.rank : undefined);
  if (existing && Date.now() - existing.fetchedAt < VISIT_REFRESH_DEBOUNCE_MS) {
    return { refreshed: false };
  }

  const fresh = await fetchRankFromStatscc(guid);
  if (!fresh) return { refreshed: false };
  if (settings.guid === guid) await saveSettings({ rank: fresh.rank, rankedStats: fresh.rankedStats });
  await setPinnedPlayerRank(guid, fresh.rank, fresh.rankedStats);
  return { refreshed: true };
}

async function refreshAllPinnedRanks(): Promise<void> {
  const list = await getPinnedPlayers();
  const settings = await getSettings();
  const prefs = await getPreferences();
  const now = Date.now();

  // Skip-if-fresh window matches the user-configured cadence: if they set a 30-minute
  // interval they want each rank no older than 30 minutes; halve the interval for the
  // skip threshold so a rank just refreshed by an alarm doesn't get re-fetched on the
  // very next tick.
  const skipIfFresherThanMs = (prefs.pinnedAutoRefresh.intervalMinutes * 60 * 1000) / 2;

  // Own profile gets refreshed alongside pinned players, even if not pinned itself.
  type Target = { username: string; guid: string };
  const targets: Target[] = [...list];
  if (settings.guid && settings.username && !list.some(p => p.guid === settings.guid)) {
    targets.push({ username: settings.username, guid: settings.guid });
  }

  for (const p of targets) {
    const existingRank = list.find(x => x.guid === p.guid)?.rank
      ?? (settings.guid === p.guid ? settings.rank : undefined);
    if (existingRank && now - existingRank.fetchedAt < skipIfFresherThanMs) continue;
    const fresh = await fetchRankFromStatscc(p.guid);
    if (!fresh) continue;
    if (settings.guid === p.guid) await saveSettings({ rank: fresh.rank, rankedStats: fresh.rankedStats });
    await setPinnedPlayerRank(p.guid, fresh.rank, fresh.rankedStats);
  }
}

async function fetchRankFromStatscc(guid: string): Promise<{ rank: PlayerRank; rankedStats?: RankedStats } | null> {
  // Primary: stats.cc's own JSON API. Fallback (below): parse the SSR payload out of the
  // rendered page, which needs no second request and no extra parsing agreement.
  const viaApi = await fetchRankFromStatsccApi(guid);
  if (viaApi) return viaApi;

  try {
    // stats.cc requires the GUID. Username omitted — GUID-only URL is canonical.
    const url = `https://stats.cc/siege/${guid}`;
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return null;
    const html = await res.text();
    const data = extractRankFromStatsccHtml(html, guid);
    if (!data) return null;
    return {
      rank: { ...data.rank, fetchedAt: Date.now() },
      rankedStats: data.rankedStats,
    };
  } catch {
    return null;
  }
}

async function selectProfileFromActiveTab(): Promise<SelectProfileResponse> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !tab.id) return { ok: false, reason: 'no_active_tab' };

  const statscc = parseStatsccProfileUrl(tab.url);
  if (statscc) {
    // stats.cc URL has no platform; default to ubi (stats.cc is PC-first).
    const settings = await saveSettings({ ...statscc, platform: 'ubi' });
    return { ok: true, settings };
  }

  const tracker = parseTrackerProfileUrl(tab.url);
  if (tracker) {
    const extracted = await askContentScriptForProfile(tab.id);
    if (!extracted?.guid) return { ok: false, reason: 'no_guid' };

    const username = resolveDisplayUsername(tracker.username, extracted.displayName);
    const settings = await saveSettings({ ...tracker, username, guid: extracted.guid });
    return { ok: true, settings };
  }

  return { ok: false, reason: 'not_supported' };
}

// tracker.gg URLs may use a GUID slug instead of the display name (e.g.
// `/ubi/{guid}/overview`). Trust the display name from the page DOM in that case.
function resolveDisplayUsername(slugUsername: string, displayName: string | null): string {
  if (isGuidSlug(slugUsername) && displayName) return displayName;
  return slugUsername;
}

async function pinCurrentTab(): Promise<PinResponse> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !tab.id) return { ok: false, reason: 'no_active_tab' };

  let candidate: PinnedPlayer | null = null;
  let preFetchedRank: { rank: PlayerRank; rankedStats?: RankedStats } | null = null;

  const statscc = parseStatsccProfileUrl(tab.url);
  if (statscc) {
    candidate = { username: statscc.username, platform: 'ubi', guid: statscc.guid };
    // The active tab IS a stats.cc profile — its content script can hand us rank/stats
    // without an extra fetch.
    preFetchedRank = await askContentScriptForRank(tab.id);
  } else {
    const tracker = parseTrackerProfileUrl(tab.url);
    if (tracker) {
      const extracted = await askContentScriptForProfile(tab.id);
      if (!extracted?.guid) return { ok: false, reason: 'no_guid' };
      const username = resolveDisplayUsername(tracker.username, extracted.displayName);
      candidate = { username, platform: tracker.platform, guid: extracted.guid };
    }
  }

  if (!candidate) return { ok: false, reason: 'not_supported' };

  // No rank from active tab → fetch from stats.cc directly so the user sees the rank
  // immediately (instead of waiting up to 6h for the next alarm tick).
  if (!preFetchedRank) {
    preFetchedRank = await fetchRankFromStatscc(candidate.guid);
  }
  if (preFetchedRank) {
    candidate = { ...candidate, rank: preFetchedRank.rank, rankedStats: preFetchedRank.rankedStats };
  }

  const { added, list } = await addPinnedPlayer(candidate);
  if (!added) return { ok: false, reason: 'already_pinned' };
  return { ok: true, player: candidate, list };
}

function askContentScriptForRank(tabId: number): Promise<{ rank: PlayerRank; rankedStats?: RankedStats } | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), PROFILE_EXTRACT_TIMEOUT_MS);
    try {
      chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_RANK_FROM_PAGE' }, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError || !response) return resolve(null);
        resolve(response as { rank: PlayerRank; rankedStats?: RankedStats });
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

function askContentScriptForProfile(tabId: number): Promise<ExtractedProfile | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), PROFILE_EXTRACT_TIMEOUT_MS);
    try {
      chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PROFILE_FROM_PAGE' }, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError || !response) {
          resolve(null);
          return;
        }
        resolve(response as ExtractedProfile);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}
