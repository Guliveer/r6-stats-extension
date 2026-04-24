const ACTIVE_KEYWORDS = /active|selected|current/i;

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
