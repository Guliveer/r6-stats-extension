import { type UserSettings, DEFAULT_SETTINGS } from './types';

const KEY = 'r6_settings';

export async function getSettings(): Promise<UserSettings> {
  const result = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_SETTINGS, ...(result[KEY] as Partial<UserSettings> | undefined) };
}

export async function saveSettings(partial: Partial<UserSettings>): Promise<void> {
  const current = await getSettings();
  await chrome.storage.local.set({ [KEY]: { ...current, ...partial } });
}
