import type { Message, SelectProfileResponse, PinResponse, ExtractedProfile, PinnedPlayer } from '../lib/types';
import { parseStatsccProfileUrl, parseTrackerProfileUrl, GUID_RE } from '../lib/patterns';
import { getSettings, saveSettings, getPinnedPlayers, addPinnedPlayer, removePinnedPlayer, reorderPinnedPlayers } from '../lib/storage';

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
    default:
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

  const statscc = parseStatsccProfileUrl(tab.url);
  if (statscc) {
    candidate = { username: statscc.username, platform: 'ubi', guid: statscc.guid };
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

  const { added, list } = await addPinnedPlayer(candidate);
  if (!added) return { ok: false, reason: 'already_pinned' };
  return { ok: true, player: candidate, list };
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
