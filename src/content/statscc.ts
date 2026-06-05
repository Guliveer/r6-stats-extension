import { BRAND, GUID_RE, parseStatsccMatchPath, parseStatsccProfilePath } from '../lib/patterns';
import { appendClonedTab, findInactiveTab, watchAndSendAvatar } from './_shared';
import { extractRankFromStatsccHtml } from '../lib/statscc-rank';
import { startIconSwapObserver } from '../lib/icon-swap';
import { DEFAULT_PREFERENCES } from '../lib/types';

const NAV_OBSERVER_DEBOUNCE_MS = 150;
const PROFILE_NAV_GUID_RE = new RegExp(`/siege/[^/]+/${GUID_RE.source}`, 'i');
// Player-link href: exactly /siege/{username}/{playerGuid} with no trailing segments — the
// profile nav (overview/stats/matches tabs) extends this base with another /segment, so we
// must anchor the regex end to avoid matching those. `(?!matches/)` blocks match-route URLs.
const PLAYER_LINK_HREF_RE = new RegExp(`^/siege/(?!matches/)([^/]+)/(${GUID_RE.source})(?:[?#]|$)`, 'i');

function findProfileNav(): HTMLElement | null {
  // First <nav> is the global site nav — the profile nav is the one whose links contain a GUID.
  for (const nav of document.querySelectorAll<HTMLElement>('nav')) {
    let matches = 0;
    for (const a of nav.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      if (!PROFILE_NAV_GUID_RE.test(a.getAttribute('href') || '')) continue;
      if (++matches >= 2) return nav;
    }
  }
  return null;
}

function createPlayerTrackerIcon(username: string, guid: string): HTMLAnchorElement {
  const link = document.createElement('a');
  // Use GUID as the tracker.gg identifier — stable across username changes.
  link.href = `https://r6.tracker.network/r6siege/profile/ubi/${encodeURIComponent(guid)}/overview`;
  link.target = '_blank';
  link.rel = 'noopener';
  link.className = 'r6ext-player-tracker';
  link.title = `${username} on Tracker.gg`;
  link.style.cssText = `
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; border-radius: 3px; flex-shrink: 0;
    background: ${BRAND.tracker}1f; color: ${BRAND.tracker};
    font-size: 7px; font-weight: 800; line-height: 1;
    text-decoration: none; cursor: pointer; transition: all 0.15s ease;
  `;
  link.onmouseenter = () => { link.style.background = `${BRAND.tracker}4d`; };
  link.onmouseleave = () => { link.style.background = `${BRAND.tracker}1f`; };
  link.textContent = 'TN';
  link.addEventListener('click', (e) => e.stopPropagation());
  return link;
}

function injectPlayerTrackerIcons(): void {
  // Global sweep over every <a> whose href looks like a player profile. Covers the scoreboard
  // on profile/match-history pages, team lists on match summary, and per-round entries on
  // timeline — all three share the /siege/{user}/{guid} href format.
  const playerLinks = document.querySelectorAll<HTMLAnchorElement>('a[href*="/siege/"]');
  for (const playerLink of playerLinks) {
    if (playerLink.querySelector('.r6ext-player-tracker')) continue;
    // Skip profile tab nav ("Home" button linking to the profile itself) — we already render
    // a dedicated "Tracker.gg" tab there, a TN icon would duplicate it.
    if (playerLink.closest('nav')) continue;

    const href = playerLink.getAttribute('href') || '';
    const match = PLAYER_LINK_HREF_RE.exec(href);
    if (!match) continue;

    playerLink.appendChild(createPlayerTrackerIcon(decodeURIComponent(match[1]), match[2]));
  }
}

function injectProfileButton(): void {
  if (document.querySelector('.r6ext-tracker-link')) return;

  const profile = parseStatsccProfilePath(location.pathname);
  if (!profile) return;

  const nav = findProfileNav();
  if (!nav) return;

  const template = findInactiveTab(nav);
  if (!template) return;

  // stats.cc URLs don't encode platform; default to ubi (stats.cc is PC-first).
  // Use GUID as the tracker.gg identifier — stable across username changes.
  // Stats.cc nav uses `flex-wrap: wrap` inside an `overflow-y-clip` parent — without
  // this override, an appended tab wraps to a clipped second row. Forcing nowrap keeps
  // every tab on the first row; horizontal overflow is allowed by the parent's
  // `overflow-x: visible`, so the user just sees the full row at full width.
  const list = template.closest('ul');
  if (list) (list as HTMLElement).style.flexWrap = 'nowrap';

  appendClonedTab(nav, template, {
    href: `https://r6.tracker.network/r6siege/profile/ubi/${encodeURIComponent(profile.guid)}/overview`,
    label: 'Tracker.gg',
    title: `Open ${profile.username} on Tracker.gg`,
    markerClassName: 'r6ext-tracker-link',
    externalIcon: true,
  });
}

// The match tab nav (Summary / Scoreboard / Rounds) is a flat `ul` — look for one whose
// children link to the current match page.
function findMatchNav(matchGuid: string): HTMLElement | null {
  const matchPath = `/siege/matches/${matchGuid}`;
  for (const ul of document.querySelectorAll<HTMLElement>('ul')) {
    const links = ul.querySelectorAll<HTMLAnchorElement>('a[href]');
    if (links.length < 2) continue;
    let hits = 0;
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      if (href === matchPath || href.startsWith(`${matchPath}/`)) hits++;
      if (hits >= 2) return ul;
    }
  }
  return null;
}

function injectMatchTrackerButton(): void {
  if (document.querySelector('.r6ext-match-tracker-link')) return;

  const match = parseStatsccMatchPath(location.pathname);
  if (!match) return;

  const nav = findMatchNav(match.matchGuid);
  if (!nav) return;

  const template = findInactiveTab(nav);
  if (!template) return;

  appendClonedTab(nav, template, {
    href: `https://r6.tracker.network/r6siege/matches/${encodeURIComponent(match.matchGuid)}`,
    label: 'Tracker.gg',
    title: 'Open match on Tracker.gg',
    markerClassName: 'r6ext-match-tracker-link',
  });
}

let keepAliveDebounce: ReturnType<typeof setTimeout> | null = null;

const keepAlive = new MutationObserver(() => {
  const onProfile = !!parseStatsccProfilePath(location.pathname);
  const onMatch = !!parseStatsccMatchPath(location.pathname);
  if (!onProfile && !onMatch) return;
  if (keepAliveDebounce) return;

  keepAliveDebounce = setTimeout(() => {
    keepAliveDebounce = null;
    if (onProfile && !document.querySelector('.r6ext-tracker-link') && findProfileNav()) {
      injectProfileButton();
    }
    if (onMatch && !document.querySelector('.r6ext-match-tracker-link')) {
      injectMatchTrackerButton();
    }
    injectPlayerTrackerIcons();
  }, NAV_OBSERVER_DEBOUNCE_MS);
});

function startObserving(): void {
  const root = document.querySelector('main, #app') ?? document.body;
  keepAlive.observe(root, { childList: true, subtree: true });
}

function extractAndSendAvatar(): void {
  const profile = parseStatsccProfilePath(location.pathname);
  if (!profile) return;
  // stats.cc may render a profile without an avatar element at all — don't wipe a good value
  // previously saved from tracker.gg just because the stats.cc layout changed.
  watchAndSendAvatar({ platform: 'statscc', username: profile.username, clearOnTimeout: false });
}

const RANK_TIER_GLOBAL_RE = /\b(Legend|Champion|Diamond|Emerald|Platinum|Gold|Silver|Bronze|Copper)(?:\s+(V|IV|III|II|I))?\b/gi;
const RANK_UNRANKED_RE = /\b(?:no\s*rank|unranked)\b/i;
const RANK_MMR_NEAR_RE = /(\d{3,5})\s*(?:MMR|RP)\b/i;
const RANK_EXTRACTION_TIMEOUT_MS = 8_000;
const RANK_POLL_MS = 500;

const TOP_KEYWORDS = /\b(top|peak|max|best|highest|rekord|all[\s-]*time)\b/i;
const CURRENT_KEYWORDS = /\b(current|season|now|live|aktualn)\b/i;

interface RankCandidate {
  tier: string;
  division?: string;
  index: number;
  score: number;
}

// Stats.cc surfaces both the live season rank and a "Top Rank" tile. Score every tier
// match by surrounding text: prefer "current"/"season" context, penalize "top"/"peak".
// First match by score wins; ties resolved by document order (live rank usually appears
// near the top of the profile card, before historical tiles).
function scoreRankCandidate(text: string, idx: number): number {
  const before = text.slice(Math.max(0, idx - 80), idx);
  const after = text.slice(idx, Math.min(text.length, idx + 60));
  const window = `${before} ${after}`;
  let score = 0;
  if (CURRENT_KEYWORDS.test(window)) score += 10;
  if (TOP_KEYWORDS.test(window)) score -= 15;
  return score;
}

// Find the DOM node containing a piece of text, then walk up to a parent that also
// contains a rank icon img. Used to anchor the icon to the chosen tier text.
function findRankIconNear(tierText: string, divisionText?: string): string | null {
  const needle = divisionText ? `${tierText} ${divisionText}` : tierText;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let textNode: Text | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.textContent && new RegExp(`\\b${needle}\\b`, 'i').test(node.textContent)) {
      textNode = node;
      break;
    }
  }
  if (!textNode) return null;

  // Walk up to 5 levels — far enough to find a sibling icon, close enough to avoid
  // grabbing the unrelated profile avatar.
  let parent: HTMLElement | null = textNode.parentElement;
  for (let i = 0; i < 5 && parent; i++, parent = parent.parentElement) {
    const img = parent.querySelector<HTMLImageElement>(
      'img[src*="rank"], img[src*="badge"], img[alt*="rank" i], img[alt*="' + tierText + '" i]'
    );
    if (img?.src) return img.src;
  }
  return null;
}

function extractRankFromDom(): { tier: string; division?: string; mmr?: number; iconUrl?: string } | null {
  const text = document.body?.innerText ?? '';

  const candidates: RankCandidate[] = [];
  RANK_TIER_GLOBAL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RANK_TIER_GLOBAL_RE.exec(text)) !== null) {
    candidates.push({
      tier: m[1],
      division: m[2]?.toUpperCase(),
      index: m.index,
      score: scoreRankCandidate(text, m.index),
    });
  }

  if (candidates.length === 0) {
    if (RANK_UNRANKED_RE.test(text)) return { tier: 'No rank' };
    return null;
  }

  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  const best = candidates[0];

  // MMR appears near the rank label — search the 200-char window around the chosen match
  // rather than the first MMR globally (which would otherwise leak from a stat tile).
  const window = text.slice(Math.max(0, best.index - 100), best.index + 200);
  const mmrMatch = RANK_MMR_NEAR_RE.exec(window);

  const iconUrl = findRankIconNear(best.tier, best.division) ?? undefined;

  return {
    tier: best.tier,
    division: best.division,
    mmr: mmrMatch ? parseInt(mmrMatch[1], 10) : undefined,
    iconUrl,
  };
}

function extractAndSendRank(): void {
  const profile = parseStatsccProfilePath(location.pathname);
  if (!profile) return;

  const start = Date.now();
  const tryOnce = (): boolean => {
    // Primary path: stats.cc embeds the SSR Nuxt payload in <script id="__NUXT_DATA__">.
    // Parsing it gives us the player's profile object deterministically — current-season
    // rank, RP, and ranked K/D, no regex over rendered text.
    const data = extractRankFromStatsccHtml(document.documentElement.outerHTML, profile.guid);
    if (data) {
      chrome.runtime.sendMessage({
        type: 'SET_PLAYER_RANK',
        payload: {
          guid: profile.guid,
          rank: { ...data.rank, fetchedAt: Date.now() },
          rankedStats: data.rankedStats,
        },
      });
      return true;
    }
    // Fallback: regex over rendered text (only triggers if SSR script is missing).
    const rank = extractRankFromDom();
    if (!rank) return false;
    chrome.runtime.sendMessage({
      type: 'SET_PLAYER_RANK',
      payload: { guid: profile.guid, rank: { ...rank, fetchedAt: Date.now() } },
    });
    return true;
  };

  if (tryOnce()) return;
  const interval = setInterval(() => {
    if (tryOnce() || Date.now() - start > RANK_EXTRACTION_TIMEOUT_MS) clearInterval(interval);
  }, RANK_POLL_MS);
}

// Synchronous rank extraction for callers (e.g. service-worker pinning the current tab)
// who need the data right now and have decided this tab is on a stats.cc profile.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'EXTRACT_RANK_FROM_PAGE') return false;

  const profile = parseStatsccProfilePath(location.pathname);
  if (!profile) {
    sendResponse(null);
    return false;
  }

  const data = extractRankFromStatsccHtml(document.documentElement.outerHTML, profile.guid);
  if (!data) {
    sendResponse(null);
    return false;
  }
  sendResponse({
    rank: { ...data.rank, fetchedAt: Date.now() },
    rankedStats: data.rankedStats,
  });
  return false;
});

function init(): void {
  if (parseStatsccProfilePath(location.pathname)) {
    injectProfileButton();
    extractAndSendAvatar();
    extractAndSendRank();
  }
  if (parseStatsccMatchPath(location.pathname)) {
    injectMatchTrackerButton();
  }
  injectPlayerTrackerIcons();
}

function initWithObserver(): void {
  init();
  startObserving();
  startRankIconSwapper();
}

// Pull the user's iconSet pref from storage and start the cross-site icon swapper.
// `auto` on stats.cc keeps the page's chosen artwork (with the legacy-Champion override
// handled by resolveIconSlug); `new`/`old` rewrite every rank img unconditionally.
async function startRankIconSwapper(): Promise<void> {
  const result = await chrome.storage.local.get('r6_preferences');
  const prefs = (result['r6_preferences'] as { iconSet?: typeof DEFAULT_PREFERENCES.iconSet } | undefined) ?? {};
  const iconSet = prefs.iconSet ?? DEFAULT_PREFERENCES.iconSet;
  startIconSwapObserver(iconSet, 'stats.cc');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWithObserver);
} else {
  initWithObserver();
}

// BFCache restore: Chrome revives the page from memory, so MutationObserver never fires
// (DOM didn't change) and the pathname-polling loop below sees the same value it saw
// before the navigation away. Re-run init to restore injected UI.
window.addEventListener('pageshow', (e) => {
  if (e.persisted) init();
});

let lastPath = location.pathname;
setInterval(() => {
  if (location.pathname === lastPath) return;
  lastPath = location.pathname;
  document.querySelector('.r6ext-tracker-link')?.remove();
  document.querySelector('.r6ext-match-tracker-link')?.remove();
  document.querySelectorAll('.r6ext-player-tracker').forEach(el => el.remove());
  init();
}, 300);

export {};
