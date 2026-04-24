export const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const TRACKER_URL_RE = /^https:\/\/(?:r6\.tracker\.network|tracker\.gg)\/r6siege\/profile\/(ubi|psn|xbl)\/([^/?#]+)/;
const TRACKER_PATH_RE = /\/r6siege\/profile\/(ubi|psn|xbl)\/([^/?#]+)/;
const STATSCC_URL_RE = new RegExp(`^https://stats\\.cc/siege/([^/?#]+)/(${GUID_RE.source})`, 'i');
const STATSCC_PATH_RE = /\/siege\/([^/]+)\/([^/]+)/;

export type Platform = 'ubi' | 'psn' | 'xbl';

export interface TrackerProfile {
  platform: Platform;
  username: string;
}

export interface StatsccProfile {
  username: string;
  guid: string;
}

export function parseTrackerProfileUrl(url: string): TrackerProfile | null {
  const m = TRACKER_URL_RE.exec(url);
  return m ? { platform: m[1] as Platform, username: decodeURIComponent(m[2]) } : null;
}

export function parseTrackerProfilePath(pathname: string): TrackerProfile | null {
  const m = TRACKER_PATH_RE.exec(pathname);
  return m ? { platform: m[1] as Platform, username: decodeURIComponent(m[2]) } : null;
}

export function parseStatsccProfileUrl(url: string): StatsccProfile | null {
  const m = STATSCC_URL_RE.exec(url);
  return m ? { username: decodeURIComponent(m[1]), guid: m[2] } : null;
}

export function parseStatsccProfilePath(pathname: string): StatsccProfile | null {
  const m = STATSCC_PATH_RE.exec(pathname);
  return m ? { username: decodeURIComponent(m[1]), guid: decodeURIComponent(m[2]) } : null;
}

export const BRAND = {
  tracker: '#FF3D2C',
  statscc: 'hsl(37,52%,69%)',
} as const;
