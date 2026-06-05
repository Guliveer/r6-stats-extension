import { BRAND, GUID_RE, parseTrackerMatchPath, parseTrackerProfilePath } from '../lib/patterns';
import { appendClonedTab, findInactiveTab, watchAndSendAvatar } from './_shared';
import { startIconSwapObserver } from '../lib/icon-swap';
import { DEFAULT_PREFERENCES } from '../lib/types';

// --- RP balances (matches page only) ---

function waitForMatchRows(timeout = 8_000): Promise<boolean> {
  return new Promise((resolve) => {
    if (document.querySelectorAll('.v3-match-row').length > 0) return resolve(true);
    const observer = new MutationObserver(() => {
      if (document.querySelectorAll('.v3-match-row').length > 0) {
        observer.disconnect();
        resolve(true);
      }
    });
    const root = document.querySelector('.content, main, #app') ?? document.body;
    observer.observe(root, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(false); }, timeout);
  });
}

function isMatchesPage(): boolean {
  return location.pathname.endsWith('/matches') || location.pathname.includes('/matches/');
}

// Inject per-day RP totals into the existing day-group headers + a session summary
// banner above the match list. ONLY runs on /matches — overview gets nothing.
function injectRpBalances(): void {
  if (!isMatchesPage()) return;

  document.querySelectorAll('.r6ext-rp-daily, .r6ext-rp-banner').forEach((el) => el.remove());

  const allMatchRows = document.querySelectorAll('.v3-match-row');
  if (allMatchRows.length === 0) return;

  const dayGroups = document.querySelectorAll('.col-span-full.grid');
  const dayTotals: { label: string; rp: number; wins: number; losses: number; count: number }[] = [];

  dayGroups.forEach((group) => {
    const header = group.querySelector('header');
    if (!header) return;

    const matchRows = group.querySelectorAll('.v3-match-row');
    if (matchRows.length === 0) return;

    const dateEl = header.querySelector('.text-18');
    const dateLabel = dateEl?.textContent?.trim() ?? '?';

    let dayRp = 0;
    let wins = 0;
    let losses = 0;
    matchRows.forEach((row) => {
      const text = row.textContent ?? '';
      const rpMatch = text.match(/RP[\d,]+\s*([+-]\d+)/);
      if (rpMatch) dayRp += parseInt(rpMatch[1], 10);

      const cls = (typeof row.className === 'string' ? row.className : '').toLowerCase();
      if (cls.includes('--win')) wins++;
      if (cls.includes('--loss')) losses++;
    });

    dayTotals.push({ label: dateLabel, rp: dayRp, wins, losses, count: matchRows.length });

    const rpSign = dayRp >= 0 ? '+' : '';
    const rpColor = dayRp >= 0 ? '#4ade80' : '#f87171';
    const bgColor = dayRp >= 0 ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)';
    const borderColor = dayRp >= 0 ? 'rgba(74, 222, 128, 0.2)' : 'rgba(248, 113, 113, 0.2)';

    const badge = document.createElement('div');
    badge.className = 'r6ext-rp-daily';
    badge.style.cssText = `
      display: inline-flex; align-items: center; padding: 2px 10px;
      background: ${bgColor}; border: 1px solid ${borderColor}; border-radius: 4px;
      font-size: 13px; font-weight: 700; color: ${rpColor};
      white-space: nowrap; margin-left: 8px;
    `;
    badge.textContent = `${rpSign}${dayRp} RP`;
    header.appendChild(badge);
  });

  if (dayTotals.length === 0) return;

  const cappedDays = dayTotals.slice(0, 5);
  const totalRp = cappedDays.reduce((s, d) => s + d.rp, 0);
  const totalMatches = cappedDays.reduce((s, d) => s + d.count, 0);
  const totalWins = cappedDays.reduce((s, d) => s + d.wins, 0);
  const totalLosses = cappedDays.reduce((s, d) => s + d.losses, 0);

  const banner = document.createElement('div');
  banner.className = 'r6ext-rp-banner';
  banner.style.cssText = `
    grid-column: 1 / -1;
    margin: 12px 0; padding: 18px 22px;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border: 1px solid #2a2a4a; border-radius: 12px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #e0e0e0; width: 100%; box-sizing: border-box;
  `;

  const titleRow = document.createElement('div');
  titleRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;';

  const title = document.createElement('div');
  title.textContent = 'RP Session Summary';
  title.style.cssText = 'font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #888; font-weight: 600;';

  const totalBadge = document.createElement('div');
  const totalSign = totalRp >= 0 ? '+' : '';
  totalBadge.textContent = `${totalSign}${totalRp} RP total • ${totalMatches} matches • ${totalWins}W/${totalLosses}L`;
  totalBadge.style.cssText = `font-size: 13px; font-weight: 600; color: ${totalRp >= 0 ? '#4ade80' : '#f87171'};`;

  titleRow.append(title, totalBadge);
  banner.appendChild(titleRow);

  const grid = document.createElement('div');
  grid.style.cssText = 'display: flex; gap: 10px; flex-wrap: wrap;';

  cappedDays.forEach((day) => {
    const card = document.createElement('div');
    card.style.cssText = `
      flex: 1; min-width: 110px; padding: 12px 14px;
      background: rgba(255,255,255,0.04); border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.06);
    `;

    const lbl = document.createElement('div');
    lbl.textContent = day.label;
    lbl.style.cssText = 'font-size: 11px; color: #aaa; margin-bottom: 6px; font-weight: 500;';
    card.appendChild(lbl);

    const rpVal = document.createElement('div');
    const sign = day.rp >= 0 ? '+' : '';
    rpVal.textContent = `${sign}${day.rp} RP`;
    rpVal.style.cssText = `font-size: 22px; font-weight: 700; color: ${day.rp >= 0 ? '#4ade80' : '#f87171'};`;
    card.appendChild(rpVal);

    const meta = document.createElement('div');
    meta.textContent = `${day.count} match${day.count === 1 ? '' : 'es'} • ${day.wins}W/${day.losses}L`;
    meta.style.cssText = 'font-size: 11px; color: #888; margin-top: 4px;';
    card.appendChild(meta);

    grid.appendChild(card);
  });

  banner.appendChild(grid);

  const firstGroup = dayGroups[0];
  firstGroup?.parentElement?.insertBefore(banner, firstGroup);
}

// --- Avatar extraction ---

function extractAndSendAvatar(): void {
  const profile = parseTrackerProfilePath(location.pathname);
  if (!profile) return;
  // Tracker.gg reliably renders an avatar element (even if it's a default) so absence after
  // timeout means "no avatar" — clear any stale value.
  watchAndSendAvatar({ ...profile, clearOnTimeout: true });
}

// --- Stats.cc profile link ---

function extractGuidFromPage(): string | null {
  const imgs = document.querySelectorAll<HTMLImageElement>('img[src*="ubisoft-avatars"]');
  for (const img of imgs) {
    const match = GUID_RE.exec(img.src);
    if (match) return match[0];
  }
  return null;
}

// URLs like `/ubi/{guid}/overview` make the slug useless as a display name. Recover the
// real name from avatar alt (tracker.gg renders it as "{name}'s Avatar") or the profile H1.
function extractDisplayNameFromPage(): string | null {
  const avatar = document.querySelector<HTMLImageElement>('img[src*="ubisoft-avatars"]');
  const alt = avatar?.getAttribute('alt')?.trim();
  if (alt) {
    const m = alt.match(/^(.+?)['’]s\s+Avatar/i);
    if (m) return m[1].trim();
  }

  const h1 = document.querySelector('h1')?.textContent?.trim();
  if (h1) return h1;

  return null;
}

function findTrackerProfileNav(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.v3-tabs');
}

// Track which guids we've already asked the background to refresh in this page-view, so
// the MutationObserver-driven re-runs don't trigger a fetch on every DOM mutation.
const refreshedGuidsThisLoad = new Set<string>();

function injectStatsccProfileButton(): void {
  if (document.querySelector('.r6ext-statscc-profile')) return;

  const profile = parseTrackerProfilePath(location.pathname);
  if (!profile) return;

  const guid = extractGuidFromPage();
  if (!guid) return;

  if (!refreshedGuidsThisLoad.has(guid)) {
    refreshedGuidsThisLoad.add(guid);
    chrome.runtime.sendMessage({ type: 'REFRESH_RANK_IF_PINNED', payload: { guid } });
  }

  const href = `https://stats.cc/siege/${encodeURIComponent(profile.username)}/${guid}`;
  const nav = findTrackerProfileNav();
  const template = nav && findInactiveTab(nav);

  if (nav && template) {
    appendClonedTab(nav, template, {
      href,
      label: 'Stats.cc',
      title: `Open ${profile.username} on Stats.cc`,
      markerClassName: 'r6ext-statscc-profile',
    });
    return;
  }

  const firstCard = document.querySelector('.v3-grid .v3-card');
  if (firstCard) {
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'r6ext-statscc-profile';
    link.title = `Open ${profile.username} on Stats.cc`;
    link.textContent = 'Stats.cc';
    link.style.cssText = `
      display: flex; align-items: center; justify-content: center;
      padding: 6px 12px; margin-bottom: 6px; border-radius: 6px;
      color: ${BRAND.statscc}; font-weight: 600; text-decoration: none;
      border: 1px solid ${BRAND.statscc}33; background: ${BRAND.statscc}14;
    `;
    firstCard.before(link);
  }
}

// --- Stats.cc match link ---

// Match-drawer header lays out summary on the left and a `.trn-match-drawer__header-right`
// container on the right that holds the Share button. We append our Stats.cc button there,
// reusing tracker.gg's `.trn-button.trn-button--transparent` styling so it matches Share
// pixel-for-pixel.
function injectStatsccMatchButton(): void {
  if (document.querySelector('.r6ext-statscc-match')) return;

  const match = parseTrackerMatchPath(location.pathname);
  if (!match) return;

  const headerRight = document.querySelector<HTMLElement>('.trn-match-drawer__header-right');
  if (!headerRight) return;

  const link = document.createElement('a');
  link.href = `https://stats.cc/siege/matches/${encodeURIComponent(match.matchGuid)}`;
  link.target = '_blank';
  link.rel = 'noopener';
  link.title = 'Open match on Stats.cc';
  link.className = 'trn-button trn-button--transparent r6ext-statscc-match';

  // Square SVG matching the size of Share's icon (24×24, drawn inside trn-button__icon).
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('class', 'trn-button__icon');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  // External-link glyph: a square with an arrow leaving its top-right corner.
  const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path1.setAttribute('d', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6');
  const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  path2.setAttribute('points', '15 3 21 3 21 9');
  const path3 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  path3.setAttribute('x1', '10');
  path3.setAttribute('y1', '14');
  path3.setAttribute('x2', '21');
  path3.setAttribute('y2', '3');
  icon.append(path1, path2, path3);

  const label = document.createElement('div');
  label.className = 'trn-button__label';
  label.textContent = 'Stats.cc';

  link.append(icon, label);
  headerRight.appendChild(link);
}

// --- Main ---

async function main(): Promise<void> {
  if (parseTrackerMatchPath(location.pathname)) {
    injectStatsccMatchButton();
    return;
  }
  extractAndSendAvatar();
  injectStatsccProfileButton();

  // RP session summary lives only on /matches. waitForMatchRows debounces against the
  // rest of the page initialization so we don't fight Vue hydration for layout slots.
  if (isMatchesPage() && await waitForMatchRows()) {
    injectRpBalances();
    watchForLoadMore();
  }
}

// "Load More" appends new .v3-match-row nodes; re-run injection so the daily badges and
// banner refresh with the new rows.
function watchForLoadMore(): void {
  let lastCount = document.querySelectorAll('.v3-match-row').length;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver(() => {
    const count = document.querySelectorAll('.v3-match-row').length;
    if (count <= lastCount) return;
    lastCount = count;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => injectRpBalances(), 500);
  });
  const root = document.querySelector('.content, main, #app') ?? document.body;
  observer.observe(root, { childList: true, subtree: true });
}

main();
startRankIconSwapper();

async function startRankIconSwapper(): Promise<void> {
  const result = await chrome.storage.local.get('r6_preferences');
  const prefs = (result['r6_preferences'] as { iconSet?: typeof DEFAULT_PREFERENCES.iconSet } | undefined) ?? {};
  const iconSet = prefs.iconSet ?? DEFAULT_PREFERENCES.iconSet;
  startIconSwapObserver(iconSet, 'tracker.gg');
}

const PROFILE_OBSERVER_DEBOUNCE_MS = 150;
const profileRoot = document.querySelector('.content, main, #app') ?? document.body;
let profileDebounce: ReturnType<typeof setTimeout> | null = null;

const profileObserver = new MutationObserver(() => {
  if (profileDebounce) return;
  profileDebounce = setTimeout(() => {
    profileDebounce = null;
    if (parseTrackerMatchPath(location.pathname)) {
      if (!document.querySelector('.r6ext-statscc-match')) injectStatsccMatchButton();
    } else if (!document.querySelector('.r6ext-statscc-profile')) {
      injectStatsccProfileButton();
    }
  }, PROFILE_OBSERVER_DEBOUNCE_MS);
});
profileObserver.observe(profileRoot, { childList: true, subtree: true });

// SPA navigation: lightweight URL polling
let lastPath = location.pathname;
setInterval(() => {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    setTimeout(main, 800);
  }
}, 300);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'EXTRACT_PROFILE_FROM_PAGE') return false;

  const profile = parseTrackerProfilePath(location.pathname);
  if (!profile) {
    sendResponse(null);
    return false;
  }

  sendResponse({
    ...profile,
    guid: extractGuidFromPage(),
    displayName: extractDisplayNameFromPage(),
  });
  return false;
});

export {};
