function extractProfileFromUrl(): { username: string; guid: string } | null {
  const match = location.pathname.match(/\/siege\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  return { username: decodeURIComponent(match[1]), guid: decodeURIComponent(match[2]) };
}

function findPlatformBar(): Element | null {
  const aside = document.querySelector('aside');
  return aside?.firstElementChild ?? null;
}

function createProfileTrackerLink(username: string): HTMLAnchorElement {
  const trackerUrl = `https://r6.tracker.network/r6siege/profile/ubi/${encodeURIComponent(username)}/overview`;

  const link = document.createElement('a');
  link.href = trackerUrl;
  link.target = '_blank';
  link.rel = 'noopener';
  link.className = 'r6ext-tracker-link';
  link.title = `Open ${username} on Tracker.gg`;
  link.style.cssText = `
    display: flex; align-items: center; justify-content: center; gap: 6px;
    padding: 6px 12px; margin-bottom: 6px; border-radius: 6px;
    background: rgba(255, 61, 44, 0.08); border: 1px solid rgba(255, 61, 44, 0.2);
    color: #FF3D2C; font-size: 13px; font-weight: 600;
    text-decoration: none; cursor: pointer; transition: all 0.15s ease;
  `;

  link.onmouseenter = () => {
    link.style.background = 'rgba(255, 61, 44, 0.15)';
    link.style.borderColor = 'rgba(255, 61, 44, 0.4)';
  };
  link.onmouseleave = () => {
    link.style.background = 'rgba(255, 61, 44, 0.08)';
    link.style.borderColor = 'rgba(255, 61, 44, 0.2)';
  };

  const icon = document.createElement('span');
  icon.textContent = 'TN';
  icon.style.cssText = `
    display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; border-radius: 4px;
    background: rgba(255, 61, 44, 0.15); color: #FF3D2C;
    font-size: 9px; font-weight: 800; line-height: 1;
  `;

  const label = document.createElement('span');
  label.textContent = 'View on Tracker.gg';

  link.append(icon, label);
  return link;
}

function createPlayerTrackerIcon(username: string): HTMLAnchorElement {
  const trackerUrl = `https://r6.tracker.network/r6siege/profile/ubi/${encodeURIComponent(username)}/overview`;

  const link = document.createElement('a');
  link.href = trackerUrl;
  link.target = '_blank';
  link.rel = 'noopener';
  link.className = 'r6ext-player-tracker';
  link.title = `${username} on Tracker.gg`;
  link.style.cssText = `
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; border-radius: 3px; flex-shrink: 0;
    background: rgba(255, 61, 44, 0.12); color: #FF3D2C;
    font-size: 7px; font-weight: 800; line-height: 1;
    text-decoration: none; cursor: pointer; transition: all 0.15s ease;
  `;

  link.onmouseenter = () => {
    link.style.background = 'rgba(255, 61, 44, 0.3)';
  };
  link.onmouseleave = () => {
    link.style.background = 'rgba(255, 61, 44, 0.12)';
  };

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
      const match = href.match(/\/siege\/([^/]+)\/[0-9a-f]{8}-/);
      if (!match) continue;

      const username = decodeURIComponent(match[1]);
      const icon = createPlayerTrackerIcon(username);
      playerLink.appendChild(icon);
    }
  }
}

function injectProfileButton(): void {
  if (document.querySelector('.r6ext-tracker-link')) return;

  const profile = extractProfileFromUrl();
  if (!profile) return;

  const platformBar = findPlatformBar();
  if (!platformBar) return;

  const link = createProfileTrackerLink(profile.username);
  platformBar.before(link);
}

const keepAlive = new MutationObserver(() => {
  if (!extractProfileFromUrl()) return;

  if (!document.querySelector('.r6ext-tracker-link') && findPlatformBar()) {
    injectProfileButton();
  }

  injectPlayerTrackerIcons();
});

function startObserving(): void {
  const root = document.querySelector('main, #app') ?? document.body;
  keepAlive.observe(root, { childList: true, subtree: true });
}

function init(): void {
  injectProfileButton();
  injectPlayerTrackerIcons();
  startObserving();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

let lastPath = location.pathname;
setInterval(() => {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    document.querySelector('.r6ext-tracker-link')?.remove();
    document.querySelectorAll('.r6ext-player-tracker').forEach(el => el.remove());
  }
}, 300);
