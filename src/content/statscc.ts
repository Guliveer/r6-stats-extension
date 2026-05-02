import { BRAND, GUID_RE, parseStatsccProfilePath } from '../lib/patterns';
import { appendClonedTab, findInactiveTab, watchAndSendAvatar } from './_shared';

const NAV_OBSERVER_DEBOUNCE_MS = 150;
const PROFILE_NAV_GUID_RE = new RegExp(`/siege/[^/]+/${GUID_RE.source}`, 'i');

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
  const tables = document.querySelectorAll('.siege-matches-scoreboard-table');
  for (const table of tables) {
    const playerLinks = table.querySelectorAll<HTMLAnchorElement>('td a[href*="/siege/"]');
    for (const playerLink of playerLinks) {
      if (playerLink.querySelector('.r6ext-player-tracker')) continue;
      if (playerLink.parentElement?.querySelector('.r6ext-player-tracker')) continue;

      const href = playerLink.getAttribute('href') || '';
      const match = href.match(/\/siege\/([^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (!match) continue;

      playerLink.appendChild(createPlayerTrackerIcon(decodeURIComponent(match[1]), match[2]));
    }
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

let keepAliveDebounce: ReturnType<typeof setTimeout> | null = null;

const keepAlive = new MutationObserver(() => {
  if (!parseStatsccProfilePath(location.pathname)) return;
  if (keepAliveDebounce) return;

  keepAliveDebounce = setTimeout(() => {
    keepAliveDebounce = null;
    if (!document.querySelector('.r6ext-tracker-link') && findProfileNav()) {
      injectProfileButton();
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
  injectProfileButton();
  injectPlayerTrackerIcons();
  extractAndSendAvatar();
  startObserving();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

let lastPath = location.pathname;
setInterval(() => {
  if (location.pathname === lastPath) return;
  lastPath = location.pathname;
  document.querySelector('.r6ext-tracker-link')?.remove();
  document.querySelectorAll('.r6ext-player-tracker').forEach(el => el.remove());
  extractAndSendAvatar();
}, 300);

export {};
