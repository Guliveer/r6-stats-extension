import { type UserSettings, DEFAULT_SETTINGS } from './types';

const KEY = 'r6_settings';

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
