export type Platform = 'ubi' | 'psn' | 'xbl';

export interface PlayerRank {
  tier: string;
  division?: string | null;
  // Raw stats.cc slug (e.g. "diamond-ii", "v7-gold-iv", "v7-unranked"). Kept so the
  // popup can re-render with the user's current iconSet preference without re-fetching.
  slug?: string;
  // Legacy: previously the rendered icon URL. New code paths should use slug + iconSet,
  // but we keep this for backwards compatibility with already-stored pinned data.
  iconUrl?: string;
  fetchedAt: number;
}

export interface RankedStats {
  kd: number;
  mmr?: number;
}

export type IconSet = 'auto' | 'new' | 'old';

export interface UserPreferences {
  iconSet: IconSet;
  pinnedAutoRefresh: {
    enabled: boolean;
    intervalMinutes: number;
  };
  // How many pinned players fit in the popup before the list starts scrolling.
  visiblePinnedCount: number;
}

export const MIN_REFRESH_MINUTES = 30;
export const DEFAULT_REFRESH_MINUTES = 180;
export const MIN_VISIBLE_PINNED = 1;
export const MAX_VISIBLE_PINNED = 10;
export const DEFAULT_VISIBLE_PINNED = 3;

export const DEFAULT_PREFERENCES: UserPreferences = {
  iconSet: 'auto',
  pinnedAutoRefresh: {
    enabled: true,
    intervalMinutes: DEFAULT_REFRESH_MINUTES,
  },
  visiblePinnedCount: DEFAULT_VISIBLE_PINNED,
};

export interface UserSettings {
  username: string;
  platform: Platform;
  guid: string;
  avatarUrl: string;
  rank?: PlayerRank;
  rankedStats?: RankedStats;
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
  rank?: PlayerRank;
  rankedStats?: RankedStats;
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
  | { type: 'EXTRACT_RANK_FROM_PAGE' }
  | { type: 'REFRESH_RANK_IF_PINNED'; payload: { guid: string } }
  | { type: 'UNPIN_PLAYER'; payload: { username: string; platform: Platform } }
  | { type: 'REORDER_PINNED_PLAYERS'; payload: Array<{ username: string; platform: Platform }> }
  | { type: 'SET_PLAYER_RANK'; payload: { guid: string; rank: PlayerRank; rankedStats?: RankedStats } }
  | { type: 'GET_PREFERENCES' }
  | { type: 'SAVE_PREFERENCES'; payload: Partial<UserPreferences> };

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

export interface ExtractedRankFromPage {
  rank: PlayerRank;
  rankedStats?: RankedStats;
}
