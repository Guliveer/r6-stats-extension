import type { PlayerRank, RankedStats } from './types';
import { parseRankSlug } from './statscc-rank';

// stats.cc serves its own frontend from this public JSON API: no key, no account, and
// `Access-Control-Allow-Origin: *`. It returns the same data we used to dig out of the
// __NUXT_DATA__ payload, but as named fields — which is why it's the primary source now.
const API_BASE = 'https://api.stats.cc/siege/v2';
const TIMEOUT_MS = 8_000;

interface Slugs {
  currentSeason: string;
  rankedMode: string;
  unrankedRank: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

async function fetchJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { credentials: 'omit', signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// `/config` carries the live season slug ("split-fire"), so we no longer have to scan the
// Nuxt array for a siegeConfig object whose position moves between builds. It changes
// once per season, so the promise is cached for the worker's lifetime.
let slugsPromise: Promise<Slugs | null> | null = null;

function getSlugs(): Promise<Slugs | null> {
  if (!slugsPromise) {
    slugsPromise = (async () => {
      const json = await fetchJson(`${API_BASE}/config`);
      const slugs = isRecord(json) && isRecord(json.constants) && isRecord(json.constants.slugs)
        ? json.constants.slugs
        : null;
      if (!slugs) return null;
      const currentSeason = asString(slugs.current_season);
      const rankedMode = asString(slugs.ranked_bomb_mode);
      if (!currentSeason || !rankedMode) return null;
      return {
        currentSeason,
        rankedMode,
        unrankedRank: asString(slugs.unranked_rank) ?? 'v7-unranked',
      };
    })().then((value) => {
      // Don't cache a failure — the next refresh gets a fresh attempt.
      if (!value) slugsPromise = null;
      return value;
    });
  }
  return slugsPromise;
}

function seasonEntry(container: unknown, season: string): Record<string, unknown> | null {
  if (!isRecord(container)) return null;
  const entry = container[season];
  return isRecord(entry) ? entry : null;
}

function readRankedStats(profile: Record<string, unknown>, slugs: Slugs): RankedStats | undefined {
  const seasonModes = seasonEntry(profile.season_mode_records, slugs.currentSeason);
  const rankedMode = seasonModes ? seasonEntry(seasonModes, slugs.rankedMode) : null;
  const kd = rankedMode ? asNumber(rankedMode.kd) : null;

  // RP lives on the season record itself, next to the rank slug.
  const record = seasonEntry(profile.ranked_season_records, slugs.currentSeason);
  const mmr = record ? asNumber(record.rank_points) : null;

  if (kd == null && mmr == null) return undefined;
  return { kd: kd ?? 0, mmr: mmr ?? undefined };
}

export interface StatsccApiResult {
  rank: PlayerRank;
  rankedStats?: RankedStats;
}

// Returns null for anything unusable so callers fall back to parsing the page's SSR
// payload — an API change degrades to the old behaviour instead of losing rank data.
export async function fetchRankFromStatsccApi(guid: string): Promise<StatsccApiResult | null> {
  if (!guid) return null;

  const [slugs, profile] = await Promise.all([
    getSlugs(),
    fetchJson(`${API_BASE}/profiles/${encodeURIComponent(guid)}`),
  ]);
  if (!slugs || !isRecord(profile)) return null;

  // A profile with no records block at all is not trustworthy input — treat it as a
  // failure rather than reporting the player as unranked.
  if (!isRecord(profile.ranked_season_records)) return null;

  const rankedStats = readRankedStats(profile, slugs);
  const record = seasonEntry(profile.ranked_season_records, slugs.currentSeason);
  const slug = record ? asString(record.rank) : null;

  // No record for the live season means they haven't placed this season.
  if (!slug) {
    return {
      rank: { tier: 'No rank', slug: slugs.unrankedRank, fetchedAt: Date.now() },
      rankedStats,
    };
  }

  const parsed = parseRankSlug(slug);
  if (!parsed) return null;

  // Same art-direction rule as the HTML path: the legacy `unranked` slug renders the old
  // artwork, so always use the current-generation icon for it.
  const iconSlug = parsed.tier === 'No rank' ? slugs.unrankedRank : slug;

  return {
    rank: { ...parsed, slug: iconSlug, fetchedAt: Date.now() },
    rankedStats,
  };
}
