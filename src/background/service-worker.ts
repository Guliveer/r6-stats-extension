import type { Message, SelectProfileResponse, ExtractedProfile } from '../lib/types';
import { parseStatsccProfileUrl, parseTrackerProfileUrl } from '../lib/patterns';
import { getSettings, saveSettings } from '../lib/storage';

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
        settings.username &&
        (username.toLowerCase() === settings.username.toLowerCase() ||
          username.toLowerCase() === settings.guid.toLowerCase());
      if (isOwnProfile) await saveSettings({ avatarUrl });
      return { ok: true };
    }
    case 'SELECT_PROFILE_FROM_TAB':
      return await selectProfileFromActiveTab();
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

    const settings = await saveSettings({ ...tracker, guid: extracted.guid });
    return { ok: true, settings };
  }

  return { ok: false, reason: 'not_supported' };
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
