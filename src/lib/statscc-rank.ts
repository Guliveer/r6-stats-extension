import { derefNumber, derefString, unwrapTyped } from './nuxt-payload';
import type { IconSet, RankedStats } from './types';

export interface RawRank {
  tier: string;
  division?: string;
}

const RANK_SLUG_RE = /^(?:v\d+-)?(copper|bronze|silver|gold|platinum|emerald|diamond|champion|legend|unranked)(?:-(i{1,3}|iv|v|star))?$/i;

// stats.cc rank slugs look like "diamond-ii", "v7-gold-i", "unranked", "champion",
// "champion-star" (legacy Champion icon from older seasons). Returns null if the slug
// doesn't match — callers fall back to the regex extractor.
export function parseRankSlug(slug: string): RawRank | null {
  const m = RANK_SLUG_RE.exec(slug);
  if (!m) return null;
  const tier = m[1].toLowerCase();
  if (tier === 'unranked') return { tier: 'No rank' };
  const tierTitle = tier.charAt(0).toUpperCase() + tier.slice(1);
  // "star" is a Champion-only icon variant, not a real division — drop it from display.
  const div = m[2]?.toUpperCase();
  return { tier: tierTitle, division: div === 'STAR' ? undefined : div };
}

// Locate the profile object in the Nuxt array by GUID. The GUID appears as a standalone
// string, and the profile object references it via `id` and `user_id`. Returns the
// object's own index so callers can walk its fields.
function findProfileObject(arr: unknown[], guid: string): Record<string, unknown> | null {
  let guidIdx = -1;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === guid) { guidIdx = i; break; }
  }
  if (guidIdx < 0) return null;

  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const obj = v as Record<string, unknown>;
    if ((obj.id === guidIdx || obj.user_id === guidIdx) && 'ranked_season_records' in obj) {
      return obj;
    }
  }
  return null;
}

// Walk arr[idx] possibly through typed wrappers ["ShallowReactive", n] until reaching a
// concrete object. Returns null if we don't land on one.
function followToObject(arr: unknown[], idx: unknown, maxHops = 5): Record<string, unknown> | null {
  let current: unknown = idx;
  for (let i = 0; i < maxHops; i++) {
    if (typeof current === 'number') {
      current = arr[current];
    } else {
      current = unwrapTyped(arr, current);
    }
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      return current as Record<string, unknown>;
    }
    if (current === undefined || current === null) return null;
  }
  return null;
}

// siegeConfig holds {currentSeason, seasons, ranks, ...} — its position in the array
// is not stable across Nuxt builds (we've seen it at index 4 and at index 1628).
// Scan the whole array for any object matching that shape.
function findCurrentSeasonSlug(arr: unknown[]): string | null {
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const obj = v as Record<string, unknown>;
    if ('currentSeason' in obj && 'seasons' in obj && 'ranks' in obj) {
      const slug = derefString(arr, obj.currentSeason);
      if (slug) return slug;
    }
  }
  return null;
}

export interface RawRankWithSlug extends RawRank {
  slug?: string;
}

// Use the v7 (current-generation) unranked icon — the older `unranked` is the legacy
// art and looks out of place next to the new tier icons.
const NO_RANK_SLUG = 'v7-unranked';

export function extractRankFromNuxt(arr: unknown[], guid: string): RawRankWithSlug | null {
  const profile = findProfileObject(arr, guid);
  if (!profile) return null;

  const records = followToObject(arr, profile.ranked_season_records);
  if (!records) return { tier: 'No rank', slug: NO_RANK_SLUG };

  const currentSlug = findCurrentSeasonSlug(arr);
  if (!currentSlug || !(currentSlug in records)) {
    return { tier: 'No rank', slug: NO_RANK_SLUG };
  }

  const record = followToObject(arr, records[currentSlug]);
  if (!record) return { tier: 'No rank', slug: NO_RANK_SLUG };

  const slug = derefString(arr, record.rank);
  if (!slug) return { tier: 'No rank', slug: NO_RANK_SLUG };

  const parsed = parseRankSlug(slug);
  if (!parsed) return null;
  // Force the v7 unranked icon even if the record references the legacy `unranked` slug —
  // it's an "art-direction" decision, not a data correction.
  const iconSlug = parsed.tier === 'No rank' ? NO_RANK_SLUG : slug;
  return { ...parsed, slug: iconSlug };
}

export function extractRankedStatsFromNuxt(arr: unknown[], guid: string): RankedStats | null {
  const profile = findProfileObject(arr, guid);
  if (!profile) return null;

  const currentSlug = findCurrentSeasonSlug(arr);
  if (!currentSlug) return null;

  // MMR/RP: present on the ranked season record itself.
  const mmr = readCurrentSeasonRankPoints(arr, profile, currentSlug);

  // K/D: lives under season_mode_records[currentSeason]["ranked-bomb"].
  const modeRecords = followToObject(arr, profile.season_mode_records);
  const seasonModes = modeRecords ? followToObject(arr, modeRecords[currentSlug]) : null;
  const rankedMode = seasonModes ? followToObject(arr, seasonModes['ranked-bomb']) : null;
  const kd = rankedMode ? derefNumber(arr, rankedMode.kd) : null;

  if (kd == null && mmr == null) return null;
  return { kd: kd ?? 0, mmr: mmr ?? undefined };
}

function readCurrentSeasonRankPoints(
  arr: unknown[],
  profile: Record<string, unknown>,
  currentSlug: string,
): number | null {
  const records = followToObject(arr, profile.ranked_season_records);
  if (!records || !(currentSlug in records)) return null;
  const record = followToObject(arr, records[currentSlug]);
  if (!record) return null;
  return derefNumber(arr, record.rank_points);
}

// We bundle rank icons locally (public/icons/ranks/{slug}-small.webp), so we no longer
// need to pull URLs out of the page. Just record the slug — the popup turns it into a
// chrome.runtime.getURL at render time. The iconSet preference is applied at render time
// in the popup (so users can flip the setting without re-fetching every pinned profile).
export function findRankIconInHtml(_html: string, slug?: string): string | undefined {
  if (!slug) return undefined;
  return `icons/ranks/${slug}-small.webp`;
}

// Each site uses its own URL convention, so we keep two parsers side-by-side. Both
// normalize to the same canonical slug — kebab-case + roman division — which is what the
// rest of the codebase (storage, popup, scraper, manifest paths) speaks.

const TIER_TOKEN = '(?:copper|bronze|silver|gold|platinum|emerald|diamond|champion|legend|unranked)';

// Stats.cc:
//   /diamond-ii-small.webp
//   /v7-gold-iv-small.webp
//   /champion-star-small.webp
//   /v7-unranked-small.webp
const STATSCC_URL_RE = new RegExp(
  `/((?:v\\d+-)?${TIER_TOKEN}(?:-(?:i{1,3}|iv|v|star))?)` +
    `(?:-(?:small|large|big|medium|xs))?\\.(?:webp|png|svg|jpg)`,
  'i',
);

// Tracker.gg: numeric divisions, often nested under a path version directory
// (e.g. /ranks/3.0/medium/gold-2.png?v=5) and wrapped via imgsvc.trackercdn.com with
// the real URL percent-encoded.
//   /3.0/medium/gold-2.png            → gold-ii
//   /s28/small/unranked.png           → unranked
//   /3.0/medium/champion.png          → champion
//   /ranks/champion-ranks/513.png     → champion (the number is the user's leaderboard
//                                       rank, not a division — we collapse all
//                                       champion-ranks variants to a plain `champion`
//                                       slug so resolveIconSlug treats them uniformly)
const TRACKER_URL_RE = new RegExp(
  `/(${TIER_TOKEN})(?:-([1-5]))?\\.(?:webp|png|svg|jpg)`,
  'i',
);
const TRACKER_CHAMPION_RANKS_RE = /\/champion-ranks\/\d+\.(?:webp|png|svg|jpg)/i;

const NUMERIC_TO_ROMAN: Record<string, string> = { '1': 'i', '2': 'ii', '3': 'iii', '4': 'iv', '5': 'v' };

function extractStatsccSlug(url: string): string | null {
  const m = STATSCC_URL_RE.exec(url);
  return m ? m[1].toLowerCase() : null;
}

function extractTrackerSlug(url: string): string | null {
  // tracker.gg wraps icons through imgsvc with the real URL percent-encoded — decode
  // first so the inner slug is reachable.
  let candidate: string;
  try { candidate = decodeURIComponent(url); } catch { candidate = url; }

  // `/ranks/champion-ranks/{leaderboardN}.png` — tracker.gg bakes the user's leaderboard
  // position into the PNG. We collapse to plain `champion` so resolveIconSlug routes it
  // by mode; the leaderboard number is recovered separately via extractTrackerChampionRank.
  if (TRACKER_CHAMPION_RANKS_RE.test(candidate)) return 'champion';

  const m = TRACKER_URL_RE.exec(candidate);
  if (!m) return null;
  const tier = m[1].toLowerCase();
  return m[2] ? `${tier}-${NUMERIC_TO_ROMAN[m[2]]}` : tier;
}

// Pull the leaderboard rank number out of a tracker.gg champion-ranks URL. Returns null
// for URLs that aren't champion-ranks. Used by the icon-swap canvas composer to render
// the user-facing number on top of our bundled Champion artwork.
const CHAMPION_RANK_NUMBER_RE = /\/champion-ranks\/(\d+)\.(?:webp|png|svg|jpg)/i;

export function extractTrackerChampionRank(url: string): number | null {
  let candidate: string;
  try { candidate = decodeURIComponent(url); } catch { candidate = url; }
  const m = CHAMPION_RANK_NUMBER_RE.exec(candidate);
  return m ? parseInt(m[1], 10) : null;
}

// Public API: try the site-specific parser first, then the other as a fallback. Order
// reflects which convention is more likely on a given page; both are safe to run because
// they require disjoint URL shapes (numeric vs roman division).
export function extractSlugFromUrl(url: string, site?: 'tracker.gg' | 'stats.cc'): string | null {
  if (site === 'tracker.gg') return extractTrackerSlug(url) ?? extractStatsccSlug(url);
  if (site === 'stats.cc') return extractStatsccSlug(url) ?? extractTrackerSlug(url);
  return extractStatsccSlug(url) ?? extractTrackerSlug(url);
}

// Champion divisions can be roman (`champion-iv`), missing (`champion`), or — for the
// special legacy variant on stats.cc — the literal `star` token (`champion-star`).
// All three count as "a Champion icon" for routing purposes.
const LEGACY_CHAMPION_RE = /^champion(?:-(?:i{1,3}|iv|v|star))?$/i;
const V7_CHAMPION_RE = /^v7-champion(?:-(?:i{1,3}|iv|v|star))?$/i;
const ANY_CHAMPION_RE = /^(?:v\d+-)?champion(?:-(?:i{1,3}|iv|v|star))?$/i;
const V7_PREFIX_RE = /^v\d+-/i;

// Map a stats.cc rank slug to the bundled icon filename, honoring the user's iconSet pref.
//
// auto:  legacy champion (no v7-) → `champion-star` (numbered top-N badges replaced by a
//        clean star). Everything else as-is.
// new:   legacy champion → `v7-champion-i` (single new-style stand-in, since the legacy
//        champion-V..champion-I divisions encode leaderboard rank, not real divisions).
//        Other legacy slugs (gold-iv etc.) get the `v7-` variant of the new artwork.
// old:   every champion (legacy or v7) → `champion-star`. Other v7- slugs strip the prefix
//        to fall back to the older artwork.
export function resolveIconSlug(slug: string, iconSet: IconSet = 'auto'): string {
  if (iconSet === 'old') {
    if (ANY_CHAMPION_RE.test(slug)) return 'champion-star';
    return slug.replace(V7_PREFIX_RE, '');
  }
  if (iconSet === 'new') {
    if (LEGACY_CHAMPION_RE.test(slug)) return 'v7-champion-i';
    if (V7_CHAMPION_RE.test(slug) || V7_PREFIX_RE.test(slug)) return slug;
    return `v7-${slug}`;
  }
  // auto
  if (LEGACY_CHAMPION_RE.test(slug)) return 'champion-star';
  return slug;
}

// Convenience: parse HTML, extract rank + ranked stats. Returns null when neither the
// Nuxt payload nor a usable profile object can be found — caller should fall back.
export interface ExtractedProfileData {
  // `slug` is the raw stats.cc rank slug — the popup applies iconSet at render time.
  // `iconUrl` is kept as a fallback path for already-pinned profiles whose data was
  // stored before we tracked slug separately.
  rank: RawRank & { slug?: string; iconUrl?: string };
  rankedStats?: RankedStats;
}

export function extractRankFromStatsccHtml(html: string, guid: string): ExtractedProfileData | null {
  const match = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
  if (!match) return null;
  let arr: unknown;
  try {
    arr = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;

  const raw = extractRankFromNuxt(arr, guid);
  if (!raw) return null;

  const { slug, ...rest } = raw;
  const iconUrl = slug ? findRankIconInHtml(html, slug) : undefined;
  const rankedStats = extractRankedStatsFromNuxt(arr, guid) ?? undefined;
  return { rank: { ...rest, slug, iconUrl }, rankedStats };
}
