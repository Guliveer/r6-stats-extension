const ACTIVE_KEYWORDS = /active|selected|current/i;

// Ubisoft default avatars are served as `.../{guid}/default_{size}.png`; tracker.gg's own
// fallback is `imgsvc.trackercdn.com/.../default-avatar.png`. Both are rejected so we never
// save a placeholder as the user's picture.
export function isPlaceholderAvatar(src: string): boolean {
  return /\/default_\d+x?\d*\.png/i.test(src) || /default-avatar\.png/i.test(src);
}

export type AvatarPlatform = 'ubi' | 'psn' | 'xbl' | 'statscc';

// stats.cc and the ubi-platform variant of tracker.gg both embed the ubisoft-avatars CDN.
// psn/xbl on tracker.gg proxy the avatar through trackercdn, so the selector differs.
export function findAvatarUrl(platform: AvatarPlatform): string | null {
  const selector = platform === 'psn' || platform === 'xbl'
    ? 'img[src*="trackercdn"][src*="/r6"]'
    : 'img[src*="ubisoft-avatars"]';

  for (const img of document.querySelectorAll<HTMLImageElement>(selector)) {
    if (!isPlaceholderAvatar(img.src)) return img.src;
  }
  return null;
}

export interface WatchAvatarOptions {
  platform: AvatarPlatform;
  username: string;
  // When no avatar is found within the timeout, `clearOnTimeout: true` sends an empty string
  // so the service worker clears any previously stored URL. Use on pages where a missing
  // avatar reliably means "the user has no avatar" (tracker.gg). Set `false` on pages where
  // the avatar element may simply not render (stats.cc) — otherwise we'd wipe a good value
  // saved from another source.
  clearOnTimeout: boolean;
  timeoutMs?: number;
}

const DEFAULT_AVATAR_WAIT_MS = 8_000;

export function watchAndSendAvatar(opts: WatchAvatarOptions): void {
  const send = (avatarUrl: string): void => {
    chrome.runtime.sendMessage({
      type: 'SET_AVATAR',
      payload: { username: opts.username, avatarUrl },
    });
  };

  const immediate = findAvatarUrl(opts.platform);
  if (immediate) {
    send(immediate);
    return;
  }

  // Vue hydration / lazy-load: watch for the avatar to appear.
  const root = document.querySelector('main, #app, .content') ?? document.body;
  const observer = new MutationObserver(() => {
    const found = findAvatarUrl(opts.platform);
    if (!found) return;
    observer.disconnect();
    clearTimeout(timer);
    send(found);
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

  const timer = setTimeout(() => {
    observer.disconnect();
    if (opts.clearOnTimeout) send('');
  }, opts.timeoutMs ?? DEFAULT_AVATAR_WAIT_MS);
}

export function findInactiveTab(nav: HTMLElement): HTMLAnchorElement | null {
  const tabs = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a[href]'));
  if (tabs.length === 0) return null;

  const currentPath = location.pathname;
  const inactive = tabs.find(t => {
    const href = t.getAttribute('href') || '';
    return href && href !== currentPath && !t.hasAttribute('aria-current');
  });
  return inactive ?? tabs[0];
}

export interface ClonedTabOptions {
  href: string;
  label: string;
  title: string;
  markerClassName: string;
}

export function appendClonedTab(nav: HTMLElement, template: HTMLAnchorElement, opts: ClonedTabOptions): void {
  // cloneNode(false) copies element + attributes (including Vue's data-v-*) but no children.
  // This preserves site-specific CSS scoping and full Tailwind hover/focus states for free.
  const link = template.cloneNode(false) as HTMLAnchorElement;

  link.removeAttribute('aria-current');
  const cleanedClasses = String(link.className)
    .split(/\s+/)
    .filter(c => c && !ACTIVE_KEYWORDS.test(c))
    .join(' ');
  link.className = cleanedClasses ? `${cleanedClasses} ${opts.markerClassName}` : opts.markerClassName;
  link.href = opts.href;
  link.target = '_blank';
  link.rel = 'noopener';
  link.title = opts.title;
  link.textContent = opts.label;

  const templateWrapper = template.parentElement;
  const wrapperIsListItem = templateWrapper?.tagName === 'LI';

  if (wrapperIsListItem) {
    const li = templateWrapper!.cloneNode(false) as HTMLElement;
    li.appendChild(link);
    templateWrapper!.parentElement!.appendChild(li);
  } else {
    nav.appendChild(link);
  }
}
