export type Platform = 'ubi' | 'psn' | 'xbl';

export interface UserSettings {
  username: string;
  platform: Platform;
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

export interface PinnedPlayer {
  username: string;
  platform: Platform;
  guid: string;
}

export type PinFailReason = 'not_supported' | 'no_guid' | 'no_active_tab' | 'already_pinned';

export type Message =
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; payload: Partial<UserSettings> }
  | { type: 'SET_AVATAR'; payload: { username: string; avatarUrl: string } }
  | { type: 'SELECT_PROFILE_FROM_TAB' }
  | { type: 'EXTRACT_PROFILE_FROM_PAGE' }
  | { type: 'GET_PINNED_PLAYERS' }
  | { type: 'PIN_CURRENT_TAB' }
  | { type: 'UNPIN_PLAYER'; payload: { username: string; platform: Platform } }
  | { type: 'REORDER_PINNED_PLAYERS'; payload: Array<{ username: string; platform: Platform }> };

export type SelectProfileResponse =
  | { ok: true; settings: UserSettings }
  | { ok: false; reason: 'not_supported' | 'no_guid' | 'no_active_tab' };

export type PinResponse =
  | { ok: true; player: PinnedPlayer; list: PinnedPlayer[] }
  | { ok: false; reason: PinFailReason };

export interface ExtractedProfile {
  username: string;
  platform: Platform;
  guid: string | null;
  displayName: string | null;
}
