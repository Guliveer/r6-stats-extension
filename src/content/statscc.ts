import { BRAND, GUID_RE, parseStatsccMatchPath, parseStatsccProfilePath } from '../lib/patterns';
import { appendClonedTab, findInactiveTab, watchAndSendAvatar } from './_shared';

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
  appendClonedTab(nav, template, {
    href: `https://r6.tracker.network/r6siege/profile/ubi/${encodeURIComponent(profile.guid)}/overview`,
    label: 'Tracker.gg',
    title: `Open ${profile.username} on Tracker.gg`,
    markerClassName: 'r6ext-tracker-link',
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

function init(): void {
  if (parseStatsccProfilePath(location.pathname)) {
    injectProfileButton();
    extractAndSendAvatar();
  }
  if (parseStatsccMatchPath(location.pathname)) {
    injectMatchTrackerButton();
  }
  injectPlayerTrackerIcons();
}

function initWithObserver(): void {
  init();
  startObserving();
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
