// Strip both active-state and disabled-state modifiers when cloning a template tab —
// otherwise our injected tab inherits whichever state the template happened to be in.
const STATEFUL_KEYWORDS = /active|selected|current|disabled/i;

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
  // When true, append an external-link icon next to the label. Use for cross-site
  // navigation tabs (e.g. our injected "Tracker.gg" tab on stats.cc nav) so the
  // visual cue matches sibling external links like the "Report" tab.
  externalIcon?: boolean;
  // Where to drop the new tab inside the nav.
  //   'end'         — default; append after the last sibling
  //   'after-first' — insert right after the first existing tab
  //   'start'       — insert before the first existing tab (use when the nav uses
  //                   flex-wrap and tabs at the end wrap to a clipped second row)
  insertPosition?: 'end' | 'after-first' | 'start';
}

function createExternalLinkIcon(): SVGSVGElement {
  // 24x24 outline arrow exiting a square — matches the convention used by stats.cc /
  // tracker.gg / most icon libraries for "opens in a new tab". Uses currentColor so it
  // inherits the surrounding link/tab colour automatically.
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.style.flexShrink = '0';
  // Box with corner cut out
  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute('d', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6');
  // Top-right corner
  const corner = document.createElementNS(svgNS, 'polyline');
  corner.setAttribute('points', '15 3 21 3 21 9');
  // Diagonal arrow
  const arrow = document.createElementNS(svgNS, 'line');
  arrow.setAttribute('x1', '10');
  arrow.setAttribute('y1', '14');
  arrow.setAttribute('x2', '21');
  arrow.setAttribute('y2', '3');
  svg.append(path, corner, arrow);
  return svg;
}

export function appendClonedTab(nav: HTMLElement, template: Element, opts: ClonedTabOptions): void {
  // Always create an <a> so we can hand the user an external link, but copy the template's
  // visual attributes (className, data-v-*) so the new tab matches site styling. Works
  // whether the template is itself an <a> (stats.cc) or a <div> (tracker.gg match drawer).
  const link = document.createElement('a');

  for (const attr of Array.from(template.attributes)) {
    if (/^(href|target|rel|aria-current|aria-selected|data-active)$/i.test(attr.name)) continue;
    link.setAttribute(attr.name, attr.value);
  }

  const cleanedClasses = String(template.className || '')
    .split(/\s+/)
    .filter(c => c && !STATEFUL_KEYWORDS.test(c))
    .join(' ');
  link.className = cleanedClasses ? `${cleanedClasses} ${opts.markerClassName}` : opts.markerClassName;
  link.href = opts.href;
  link.target = '_blank';
  link.rel = 'noopener';
  link.title = opts.title;

  if (opts.externalIcon) {
    // Wrap label in a <span> so the icon sits cleanly next to it (parent template's
    // class includes `gap-2` flex-gap, so we get the spacing for free on stats.cc).
    const labelSpan = document.createElement('span');
    labelSpan.textContent = opts.label;
    link.append(labelSpan, createExternalLinkIcon());
  } else {
    link.textContent = opts.label;
  }

  const templateWrapper = template.parentElement;
  const wrapperIsListItem = templateWrapper?.tagName === 'LI';

  if (wrapperIsListItem) {
    const list = templateWrapper!.parentElement!;
    const li = templateWrapper!.cloneNode(false) as HTMLElement;
    li.appendChild(link);
    if (opts.insertPosition === 'after-first' && list.firstElementChild) {
      list.firstElementChild.after(li);
    } else if (opts.insertPosition === 'start') {
      list.prepend(li);
    } else {
      list.appendChild(li);
    }
  } else if (opts.insertPosition === 'after-first' && nav.firstElementChild) {
    nav.firstElementChild.after(link);
  } else if (opts.insertPosition === 'start') {
    nav.prepend(link);
  } else {
    nav.appendChild(link);
  }
}
