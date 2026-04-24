export interface UserSettings {
  username: string;
  platform: 'ubi' | 'psn' | 'xbl';
  guid: string;
  avatarUrl: string;
}

export const DEFAULT_SETTINGS: UserSettings = {
  username: '',
  platform: 'ubi',
  guid: '',
  avatarUrl: '',
};

export const PLATFORMS: Record<string, string> = {
  ubi: 'PC (Ubisoft)',
  psn: 'PlayStation',
  xbl: 'Xbox',
};

export type Message =
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; payload: Partial<UserSettings> }
  | { type: 'SET_AVATAR'; payload: { username: string; avatarUrl: string } }
  | { type: 'SELECT_PROFILE_FROM_TAB' }
  | { type: 'EXTRACT_PROFILE_FROM_PAGE' };

export type SelectProfileResponse =
  | { ok: true; settings: UserSettings }
  | { ok: false; reason: 'not_supported' | 'no_guid' | 'no_active_tab' };

export interface ExtractedProfile {
  username: string;
  platform: 'ubi' | 'psn' | 'xbl';
  guid: string | null;
}
