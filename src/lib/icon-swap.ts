import type { IconSet } from './types';
import { extractSlugFromUrl, extractTrackerChampionRank, resolveIconSlug } from './statscc-rank';
import { composeChampionWithRank } from './champion-overlay';

export type SiteContext = 'tracker.gg' | 'stats.cc';

const STAMP_ATTR = 'data-r6ext-icon';
const ORIGINAL_ATTR = 'data-r6ext-icon-original';

function resolveLocalIcon(slug: string, iconSet: IconSet): string {
  return chrome.runtime.getURL(`icons/ranks/${resolveIconSlug(slug, iconSet)}-small.webp`);
}

// In `default` (auto) mode we deliberately don't touch page icons — the user explicitly
// asked for "leave each site's native artwork alone". Toggling back to default after a
// session in new/old must therefore RESTORE the originals we recorded. Restores both
// HTML <img> and SVG <image> elements (defined further down).
function restorePageRankIcons(): void {
  for (const el of document.querySelectorAll(`[${ORIGINAL_ATTR}]`)) {
    const original = el.getAttribute(ORIGINAL_ATTR);
    if (!original) continue;
    if (el.tagName === 'IMG') {
      (el as HTMLImageElement).src = original;
    } else {
      // SVG <image> uses href/xlink:href.
      if (el.hasAttribute('xlink:href')) el.setAttribute('xlink:href', original);
      el.setAttribute('href', original);
    }
    el.removeAttribute(ORIGINAL_ATTR);
    el.removeAttribute(STAMP_ATTR);
  }
  // Stats.cc Champion swap blanks the sibling rank <text> — put it back.
  for (const t of document.querySelectorAll<SVGTextElement>(`text[${HIDDEN_RANK_TEXT_ATTR}]`)) {
    const original = t.getAttribute(HIDDEN_RANK_TEXT_ATTR);
    if (original != null) t.textContent = original;
    t.removeAttribute(HIDDEN_RANK_TEXT_ATTR);
  }
  // ...and unhide the plate <rect>.
  for (const r of document.querySelectorAll<SVGRectElement>(`rect[${HIDDEN_RECT_ATTR}]`)) {
    const originalDisplay = r.getAttribute(HIDDEN_RECT_ATTR) ?? '';
    r.style.display = originalDisplay;
    r.removeAttribute(HIDDEN_RECT_ATTR);
  }
}

// Walk every img on the page and rewrite rank icons to bundled assets. Idempotent —
// re-running with a different iconSet reads from the recorded original (not the already-
// swapped src) before applying the new mapping.
//
// Unranked handling is per-site: on tracker.gg we leave the native placeholder alone
// (it's a neutral grey shield that fits the surrounding UI), but on stats.cc we swap
// it just like any other rank — stats.cc renders unranked inside the same SVG layout
// as ranked icons, so a half-swap looks inconsistent.
const UNRANKED_SLUG_RE = /^(?:v\d+-)?unranked$/i;
const CHAMPION_SLUG_RE = /^(?:v\d+-)?champion(?:-(?:i{1,3}|iv|v|star))?$/i;

function shouldSkipUnranked(site: SiteContext): boolean {
  return site === 'tracker.gg';
}

// Stats.cc renders the Champion icon as three layered SVG elements:
//   <image>  — the rank artwork (we swap this one)
//   <rect>   — a default-black filled rectangle as a backdrop for the number
//   <text>   — the white numeric leaderboard rank
// We point the icon at tracker.gg's per-N artwork (which already has both the plate
// and the number baked in), then hide the rect + blank the text so they don't double
// up on top of the new artwork.
function extractStatsccChampionRank(
  el: Element,
): { rank: number; textNode: SVGTextElement; rectNode: SVGRectElement | null } | null {
  const svg = el.closest('svg');
  if (!svg) return null;
  let textNode: SVGTextElement | null = null;
  let rank = NaN;
  for (const t of svg.querySelectorAll<SVGTextElement>('text')) {
    const txt = (t.textContent || '').trim();
    if (/^\d+$/.test(txt)) { textNode = t; rank = parseInt(txt, 10); break; }
  }
  if (!textNode) return null;
  // The plate-rect is whichever <rect> is a sibling of the <image>. There's only one
  // <rect> in the Champion SVG layout, so first match is correct.
  const rectNode = svg.querySelector<SVGRectElement>('rect');
  return { rank, textNode, rectNode };
}

// tracker.gg's per-N Champion artwork is bundled at build time (see
// scripts/scrape-champion-ranks.mjs + convert-champion-ranks.mjs). We resolve to a
// chrome-extension URL because cross-origin SVG <image href> fetches into stats.cc
// would fail CORS — trackercdn returns no Access-Control-Allow-Origin.
function bundledChampionIconUrl(rank: number): string {
  return chrome.runtime.getURL(`icons/ranks/champion-ranks/${rank}.webp`);
}

const HIDDEN_RANK_TEXT_ATTR = 'data-r6ext-hidden-rank';
const HIDDEN_RECT_ATTR = 'data-r6ext-hidden-rect';

// Swap a single source on an element: HTML <img> uses `src`, SVG <image> uses `href`
// (with `xlink:href` as the legacy fallback). Stats.cc renders rank icons inside SVGs
// (e.g. radial layout for division progression), so we must handle both.
interface IconSource {
  read(el: Element): string | null;
  write(el: Element, value: string): void;
}

const HTML_IMG_SOURCE: IconSource = {
  read: (el) => (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src || null,
  write: (el, v) => { (el as HTMLImageElement).src = v; },
};

const SVG_IMAGE_SOURCE: IconSource = {
  read: (el) => el.getAttribute('href') || el.getAttribute('xlink:href'),
  write: (el, v) => {
    if (el.hasAttribute('xlink:href')) el.setAttribute('xlink:href', v);
    el.setAttribute('href', v);
  },
};

function* iterateIconElements(): Generator<{ el: Element; source: IconSource }> {
  for (const img of document.querySelectorAll('img')) yield { el: img, source: HTML_IMG_SOURCE };
  for (const svgImg of document.querySelectorAll('image')) yield { el: svgImg, source: SVG_IMAGE_SOURCE };
}

export function swapPageRankIcons(iconSet: IconSet, site: SiteContext): void {
  if (iconSet === 'auto') {
    restorePageRankIcons();
    return;
  }
  // Tracker.gg already serves only the post-rework (v7) artwork on its profile pages,
  // so the New mode would be a no-op rewrite — skip the work and leave native srcs in
  // place. Old mode still has work to do (revert v7 artwork to legacy).
  if (iconSet === 'new' && site === 'tracker.gg') {
    restorePageRankIcons();
    return;
  }
  // Toggling between modes (e.g. New → Old) must start from a clean baseline so any
  // hidden plates/texts from the previous mode are restored before we re-apply skip
  // rules for the new mode. Without this, a New-mode hide-rect on stats.cc Champion
  // sticks even after switching to Old (which would skip Champion entirely).
  restorePageRankIcons();
  const skipUnranked = shouldSkipUnranked(site);
  for (const { el, source } of iterateIconElements()) {
    const original = el.getAttribute(ORIGINAL_ATTR) ?? source.read(el);
    if (!original) continue;
    const slug = extractSlugFromUrl(original, site);
    if (!slug) continue;
    if (skipUnranked && UNRANKED_SLUG_RE.test(slug)) continue;

    if (!el.hasAttribute(ORIGINAL_ATTR)) el.setAttribute(ORIGINAL_ATTR, original);

    // Champion handling differs by site and mode:
    //   tracker.gg, Old: render stats.cc-style icon (clean champion-small.webp + black
    //                    plate + N text) via canvas overlay. The native tracker.gg
    //                    artwork is the heavy bitmap with N baked in — swap it to the
    //                    minimalist stats.cc look the user prefers.
    //   tracker.gg, New: handled by the early "tracker.gg + new = no-op" return above.
    //   stats.cc, Old:   SKIP. Stats.cc already renders the cleaner legacy artwork
    //                    natively (image + rect + text), so any swap would be a wash.
    //   stats.cc, New:   swap to bundled tracker.gg/{N}.webp (modern post-rework
    //                    artwork with N baked in), hide native rect + blank text.
    if (CHAMPION_SLUG_RE.test(slug)) {
      if (site === 'stats.cc' && iconSet === 'old') {
        continue;
      }
      type FoundChampion = {
        rank: number;
        textNode?: SVGTextElement | null;
        rectNode?: SVGRectElement | null;
      };
      const found: FoundChampion | null = site === 'tracker.gg'
        ? (() => {
            const r = extractTrackerChampionRank(original);
            return r != null ? { rank: r } : null;
          })()
        : extractStatsccChampionRank(el);

      // No leaderboard rank associated with this Champion (player didn't crack the
      // top-9999 in this season). Fall through to the standard slug → bundled-icon
      // mapping below, which gives `champion-star` on Old and `v7-champion-i` on New.
      if (found && found.rank >= 1) {
        if (site === 'tracker.gg') {
          // Old mode = stats.cc-style minimalist icon. Canvas-composed onto the bundled
          // champion-small base so we render the user's actual N regardless of how high.
          applyChampionOverlay(el, source, found.rank);
          el.setAttribute(STAMP_ATTR, `${slug}#${found.rank}`);
          continue;
        }

        // stats.cc + New: swap to bundled tracker.gg-style artwork (number baked in),
        // hide the native rect+text so the rank doesn't double up.
        if (found.rank <= 9999) {
          source.write(el, bundledChampionIconUrl(found.rank));
          if (found.textNode && !found.textNode.hasAttribute(HIDDEN_RANK_TEXT_ATTR)) {
            found.textNode.setAttribute(HIDDEN_RANK_TEXT_ATTR, found.textNode.textContent ?? '');
            found.textNode.textContent = '';
          }
          if (found.rectNode && !found.rectNode.hasAttribute(HIDDEN_RECT_ATTR)) {
            found.rectNode.setAttribute(HIDDEN_RECT_ATTR, found.rectNode.style.display || '');
            found.rectNode.style.display = 'none';
          }
          el.setAttribute(STAMP_ATTR, `${slug}#${found.rank}`);
          continue;
        }
      }
      // No-N Champion: fall through to standard slug mapping (no special handling).
    }

    const targetSrc = resolveLocalIcon(slug, iconSet);
    if (source.read(el) !== targetSrc) source.write(el, targetSrc);
    el.setAttribute(STAMP_ATTR, slug);
  }
}

function applyChampionOverlay(el: Element, source: IconSource, rank: number): void {
  composeChampionWithRank(rank).then((dataUrl) => {
    if (!dataUrl) return;
    // Element may have been removed or re-stamped while we were composing — bail if so.
    if (!el.isConnected) return;
    if (source.read(el) !== dataUrl) source.write(el, dataUrl);
  });
}

// Re-run swap whenever the SPA mutates the DOM. Debounced so quick batches of additions
// don't spam the swap routine. Returns a disposer.
export function startIconSwapObserver(iconSet: IconSet, site: SiteContext): () => void {
  swapPageRankIcons(iconSet, site);

  let debounce: ReturnType<typeof setTimeout> | null = null;
  let currentIconSet = iconSet;

  const observer = new MutationObserver(() => {
    if (debounce) return;
    debounce = setTimeout(() => {
      debounce = null;
      swapPageRankIcons(currentIconSet, site);
    }, 250);
  });
  // Observe the whole body — tracker.gg's lazy-loaded card grid sits outside
  // `main/#app/.content` on profile pages, and we'd miss it otherwise. Watching
  // `href` too lets us catch SVG <image> swaps (e.g. stats.cc Champion).
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'href', 'xlink:href'],
  });

  // React to preference changes from the popup without waiting for a navigation.
  const onStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, area: string): void => {
    if (area !== 'local' || !changes['r6_preferences']) return;
    const next = changes['r6_preferences'].newValue as { iconSet?: IconSet } | undefined;
    if (!next?.iconSet || next.iconSet === currentIconSet) return;
    currentIconSet = next.iconSet;
    swapPageRankIcons(currentIconSet, site);
  };
  chrome.storage.onChanged.addListener(onStorageChange);

  return () => {
    observer.disconnect();
    chrome.storage.onChanged.removeListener(onStorageChange);
    if (debounce) clearTimeout(debounce);
  };
}
