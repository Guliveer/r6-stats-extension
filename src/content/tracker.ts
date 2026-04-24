import { BRAND, GUID_RE, parseTrackerProfilePath } from '../lib/patterns';
import { appendClonedTab, findInactiveTab } from './_shared';

function waitForMatchRows(timeout = 8_000): Promise<boolean> {
  return new Promise((resolve) => {
    // Already present?
    if (document.querySelectorAll('.v3-match-row').length > 0) return resolve(true);

    const observer = new MutationObserver(() => {
      if (document.querySelectorAll('.v3-match-row').length > 0) {
        observer.disconnect();
        resolve(true);
      }
    });
    // Only observe the main content area, not the entire body
    const root = document.querySelector('.content, main, #app') ?? document.body;
    observer.observe(root, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(false); }, timeout);
  });
}

function isMatchesPage(): boolean {
  return location.pathname.includes('/matches');
}

function injectRpBalances(): void {
  // Clean previous injections
  document.querySelectorAll('.r6ext-rp-daily, .r6ext-rp-banner').forEach((el) => el.remove());

  const allMatchRows = document.querySelectorAll('.v3-match-row');
  if (allMatchRows.length === 0) return;

  const compact = !isMatchesPage();

  // --- Per-day RP badges in existing headers ---
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

    // Inject badge into header
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

  // Limit to 5 sessions max in banner
  const cappedDays = dayTotals.slice(0, 5);

  const totalRp = cappedDays.reduce((s, d) => s + d.rp, 0);
  const totalMatches = cappedDays.reduce((s, d) => s + d.count, 0);
  const totalWins = cappedDays.reduce((s, d) => s + d.wins, 0);
  const totalLosses = cappedDays.reduce((s, d) => s + d.losses, 0);

  const banner = document.createElement('div');
  banner.className = 'r6ext-rp-banner';

  if (compact) {
    const totalSign = totalRp >= 0 ? '+' : '';
    const rpColor = totalRp >= 0 ? '#4ade80' : '#f87171';

    banner.style.cssText = `
      grid-column: 1 / -1;
      margin: 8px 0; padding: 10px 14px;
      background: rgba(26, 26, 46, 0.8);
      border: 1px solid #2a2a4a; border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #e0e0e0; max-width: 300px;
    `;

    const row1 = document.createElement('div');
    row1.style.cssText = 'display: flex; align-items: baseline; gap: 8px; margin-bottom: 2px;';

    const label = document.createElement('span');
    label.textContent = 'Session RP';
    label.style.cssText = 'font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #666; font-weight: 600;';

    const rpEl = document.createElement('span');
    rpEl.textContent = `${totalSign}${totalRp} RP`;
    rpEl.style.cssText = `font-size: 16px; font-weight: 700; color: ${rpColor};`;

    const statsEl = document.createElement('span');
    statsEl.textContent = `${totalMatches} matches \u2022 ${totalWins}W/${totalLosses}L`;
    statsEl.style.cssText = 'font-size: 10px; color: #555; margin-left: auto;';

    row1.append(label, rpEl, statsEl);
    banner.appendChild(row1);

    const noteRow = document.createElement('div');
    noteRow.style.cssText = 'display: flex; align-items: center; gap: 6px; margin-top: 2px;';

    const note = document.createElement('span');
    note.textContent = `Based on ${totalMatches} visible matches`;
    note.style.cssText = 'font-size: 9px; color: #555;';
    noteRow.appendChild(note);

    const matchesUrl = location.href.replace(/\/overview.*$/, '/matches');
    const link = document.createElement('a');
    link.href = matchesUrl;
    link.textContent = 'Full session \u2192';
    link.style.cssText = 'font-size: 9px; color: #f97316; text-decoration: none; font-weight: 600;';
    link.onmouseenter = () => { link.style.textDecoration = 'underline'; };
    link.onmouseleave = () => { link.style.textDecoration = 'none'; };
    noteRow.appendChild(link);
    banner.appendChild(noteRow);

    if (cappedDays.length > 1) {
      const row2 = document.createElement('div');
      row2.style.cssText = 'display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap;';
      cappedDays.forEach((day) => {
        const chip = document.createElement('span');
        const s = day.rp >= 0 ? '+' : '';
        chip.textContent = `${day.label}: ${s}${day.rp}`;
        chip.style.cssText = `
          font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 999px;
          color: ${day.rp >= 0 ? '#4ade80' : '#f87171'};
          background: ${day.rp >= 0 ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)'};
        `;
        row2.appendChild(chip);
      });
      banner.appendChild(row2);
    }

  } else {
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
    totalBadge.textContent = `${totalSign}${totalRp} RP total \u2022 ${totalMatches} matches \u2022 ${totalWins}W/${totalLosses}L`;
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
      meta.textContent = `${day.count} match${day.count === 1 ? '' : 'es'} \u2022 ${day.wins}W/${day.losses}L`;
      meta.style.cssText = 'font-size: 11px; color: #888; margin-top: 4px;';
      card.appendChild(meta);

      grid.appendChild(card);
    });

    banner.appendChild(grid);
  }

  const firstGroup = dayGroups[0];
  firstGroup?.parentElement?.insertBefore(banner, firstGroup);
}

// --- Avatar extraction ---

function extractAndSendAvatar(): void {
  // Get username from URL
  const match = location.pathname.match(/\/r6siege\/profile\/(ubi|psn|xbl)\/([^/]+)/);
  if (!match) return;
  const username = decodeURIComponent(match[2]);

  // Find avatar image
  const images = document.querySelectorAll<HTMLImageElement>('img');
  for (const img of images) {
    const src = img.src ?? '';
    if (src.includes('avatar') || (src.includes('trackercdn') && src.includes('/r6') && img.width >= 40)) {
      chrome.runtime.sendMessage({ type: 'SET_AVATAR', payload: { username, avatarUrl: src } });
      return;
    }
  }
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

function findTrackerProfileNav(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.v3-tabs');
}

function injectStatsccProfileButton(): void {
  if (document.querySelector('.r6ext-statscc-profile')) return;

  const profile = parseTrackerProfilePath(location.pathname);
  if (!profile) return;

  const guid = extractGuidFromPage();
  if (!guid) return;

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

// --- Main ---

async function main(): Promise<void> {
  const found = await waitForMatchRows();
  if (found) {
    injectRpBalances();
  }
  extractAndSendAvatar();
  injectStatsccProfileButton();
}

main();

const PROFILE_OBSERVER_DEBOUNCE_MS = 150;
const profileRoot = document.querySelector('.content, main, #app') ?? document.body;
let profileDebounce: ReturnType<typeof setTimeout> | null = null;

const profileObserver = new MutationObserver(() => {
  if (document.querySelector('.r6ext-statscc-profile')) return;
  if (profileDebounce) return;
  profileDebounce = setTimeout(() => {
    profileDebounce = null;
    injectStatsccProfileButton();
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

// "Load More" detection: re-inject when new match rows appear
let lastMatchCount = document.querySelectorAll('.v3-match-row').length;
let loadMoreDebounce: ReturnType<typeof setTimeout> | null = null;

const loadMoreObserver = new MutationObserver(() => {
  const currentCount = document.querySelectorAll('.v3-match-row').length;
  if (currentCount > lastMatchCount) {
    lastMatchCount = currentCount;
    if (loadMoreDebounce) clearTimeout(loadMoreDebounce);
    loadMoreDebounce = setTimeout(() => injectRpBalances(), 500);
  }
});

const matchContainer = document.querySelector('.content, main, #app') ?? document.body;
loadMoreObserver.observe(matchContainer, { childList: true, subtree: true });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'EXTRACT_PROFILE_FROM_PAGE') return false;

  const profile = parseTrackerProfilePath(location.pathname);
  if (!profile) {
    sendResponse(null);
    return false;
  }

  sendResponse({ ...profile, guid: extractGuidFromPage() });
  return false;
});

export {};
