# Page structure reference

Stable selectors and DOM landmarks the extension relies on. Update whenever a target site
changes layout so we don't have to re-discover them mid-task.

> **How to refresh this file.** Open the URL in DevTools, run the snippets in
> `scripts/dump-page-structure.md`, paste the output into the matching section below.

## Conventions

- `selector` blocks list the CSS we use; mark a selector `unverified` if it's a guess.
- `inject-point` documents *where* the extension appends/clones DOM.
- `extract` documents *what* the extension reads out of DOM.

## Identifiers — important

- **stats.cc requires GUID.** Username is optional (cosmetic only). URLs of the form
  `/siege/{guid}` work without a username; URLs of the form `/siege/{username}` without a
  GUID do **not**. Any stats.cc API call must use the GUID.
- **tracker.gg accepts either** username or GUID. We prefer GUID (stable across renames).

## Icon swap — per-site rules

The swap loop in `src/lib/icon-swap.ts` is constrained by site convention. Don't
re-derive these rules from first principles — they're the result of multiple rounds of
user feedback.

| Site | Mode | Behavior |
|---|---|---|
| stats.cc | Default (auto) | no-op (restore originals) |
| stats.cc | New | swap all, Champion uses bundled tracker.gg/{N}.webp (plate+rect+text hidden) |
| stats.cc | Old | swap all EXCEPT Champion — stats.cc already serves legacy Champion artwork |
| tracker.gg | Default | no-op |
| tracker.gg | New | **no-op** — tracker.gg already ships v7 artwork everywhere |
| tracker.gg | Old | swap to legacy, including Champion via canvas overlay |

- **Champion on either site** is swapped to the bundled tracker.gg artwork (the variant
  with the leaderboard rank N baked in). All 9999 PNGs are scraped at build time
  (`scripts/scrape-champion-ranks.mjs`) and recompressed to 128×128 webp q50
  (`scripts/convert-champion-ranks.mjs`) — ~50 MB total, well under Chrome Web Store's
  100 MB unpacked limit. We can't fetch the artwork at runtime: trackercdn doesn't send
  Access-Control-Allow-Origin so the SVG `<image crossorigin>` request from stats.cc fails.
- **Stats.cc Champion** SVG is `<image>` + `<rect>` (default-black plate) + `<text>`.
  Both the rect and text are hidden when swapping; the bundled tracker.gg artwork has
  both baked in. **Players outside the top-9999 leaderboard** don't get the rect + text
  — `extractStatsccChampionRank` returns null, and we fall through to the standard slug
  mapping (`v7-champion-i` on New).
- **Tracker.gg Champion** outside the top-9999 uses URLs like `/champion-i.png` (no
  leaderboard number) — `extractTrackerChampionRank` returns null and we fall through
  to standard slug mapping (`champion-star` on Old).
- **Tracker.gg Champion** beyond N=9999 (shouldn't happen — 9999 is the documented max)
  falls back to the in-memory canvas composer in `lib/champion-overlay.ts`.
- **Champion on tracker.gg** has the leaderboard rank baked into the PNG
  (`/ranks/champion-ranks/{N}.png`). Old mode preserves it via `composeChampionWithRank`
  in `src/lib/champion-overlay.ts` — draws N on top of `champion-small.webp`'s black plate.
- **Unranked on tracker.gg** is always skipped — it's the official Ubisoft art and fits
  surrounding UI.
- **Unranked on stats.cc** is swapped (it lives inside the same radial SVG layout as
  ranked icons; half-swapped layout looks broken).

---

## tracker.gg / r6.tracker.network

### `/r6siege/profile/{platform}/{user-or-guid}/overview` and `/matches`

- **profile nav** (Tracker.gg's own tabs Overview / Stats / Operators / Matches):
  - selector: `.v3-tabs`
  - inject-point: cloned tab inside `.v3-tabs` → "Stats.cc" link
- **avatar / GUID source**: `img[src*="ubisoft-avatars"]` — the URL contains the player GUID
  (regex `GUID_RE`).
- **display name fallback** (when slug is a GUID): avatar `alt` attribute (`"{name}'s Avatar"`)
  or page `<h1>`.
- **match rows**: `.v3-match-row` (used for RP balance injection).
- **per-day group**: `.col-span-full.grid` containing a `<header>` with `.text-18` date label.

### `/r6siege/matches/{matchGuid}` (match summary)

- **route detection**: `parseTrackerMatchPath(location.pathname)` (lib/patterns.ts).
- **tab nav** (Career / Scoreboard / Rounds): container `.r6s-table__tabs`, each tab is a
  `<div class="trn-match-drawer__tabs-tab ...">` (NOT an anchor). State modifiers:
  `--active`, `--disabled`. Verified 2026-06.
  - inject-point: `appendClonedTab` clones any inactive tab's classes onto an `<a>`
    pointing at stats.cc.
- **note**: tabs are divs, not anchors. Cloudflare blocks headless fetches of these
  pages, so DOM dumps must be captured from a real logged-in browser.

---

## stats.cc

### `/siege/{guid}` and `/siege/{username}/{guid}` (player profile)

- **profile nav**: a `<nav>` whose anchors all match `/siege/{user}/{guid}/...`.
  - detection: `findProfileNav()` in src/content/statscc.ts.
  - inject-point: cloned tab → "Tracker.gg" link.
- **player rank, RP, ranked K/D** — primary source is the JSON API, not the page:
  `api.stats.cc/siege/v2/config` (live season slug) + `api.stats.cc/siege/v2/profiles/{guid}`
  (`ranked_season_records`, `season_mode_records`). See [`statscc-api.md`](statscc-api.md)
  for the endpoint reference and [`data-sources.md`](data-sources.md) for why.
  `src/lib/statscc-api.ts` is the client; the Nuxt payload below is the fallback.
- **fallback: Nuxt SSR payload** (NOT rendered DOM):
  - source: `<script id="__NUXT_DATA__" type="application/json">` — a flat
    Nuxt CompactSerializer array of indices. Also note: `siegeConfig` (with `currentSeason`)
    moves around the array between Nuxt builds (we've seen it at idx 4 and 1628), so
    scan the whole array for any object with `currentSeason` + `seasons` + `ranks`.
  - profile object: find the entry whose `id` or `user_id` references the GUID string's
    array index AND has a `ranked_season_records` field.
  - current rank slug: `profile.ranked_season_records[currentSeasonSlug].rank` →
    deref to a string like `"diamond-ii"`, `"v7-gold-iv"`, `"unranked"`. If the current
    season has no record, the player hasn't played ranked this season → render "No rank".
  - current RP: `profile.ranked_season_records[currentSeasonSlug].rank_points` (deref).
  - ranked K/D: `profile.season_mode_records[currentSeasonSlug]["ranked-bomb"].kd`. If
    `ranked-bomb` is absent under that season, the player hasn't played ranked this
    season — `rankedStats` is `null`.
  - rank icon URL: `https://static.stats.cc/siege/ranks/{slug}-small.webp`.
  - implementation: `src/lib/statscc-rank.ts`, deref helpers in `src/lib/nuxt-payload.ts`.
- **avatar**: `img[src*="ubisoft-avatars"]` (shares CDN with tracker.gg).

### `/siege/matches/{matchGuid}` (match summary)

- **match nav** (Summary / Scoreboard / Rounds): a `<ul>` with ≥2 `<a>` whose href starts
  with `/siege/matches/{matchGuid}`.
  - detection: `findMatchNav()` in statscc.ts.
  - inject-point: cloned tab → "Tracker.gg" link.
- **player links in scoreboard / team list / timeline**: `a[href]` matching
  `^/siege/{user}/{guid}` (regex `PLAYER_LINK_HREF_RE`). Used to inject per-player TN icons.

---

## Rank icon URL conventions — verified inventory

Kept here so we don't re-discover URL formats every session. Update when a site changes.

### tracker.gg (`r6.tracker.network` / `tracker.gg`)

All icons go through `imgsvc.trackercdn.com/url/.../IMAGE-URL/image.png` — a Cloudflare
image proxy that wraps the real URL percent-encoded. Decode the inner URL before regex.

| Convention | Example URL fragment | Slug we map to |
|---|---|---|
| Per-tier+division (numeric) | `/ranks/3.0/medium/gold-2.png?v=5` | `gold-ii` |
| No-rank placeholder | `/ranks/s28/small/unranked.png` | `unranked` |
| Plain Champion (no number) | `/ranks/3.0/medium/champion.png` | `champion` |
| Champion with leaderboard top-X | `/ranks/champion-ranks/{N}.png?v=6` | `champion` (N tracked separately) |
| **Possibly future format** for Champion top-X | _unknown — see "Open questions" below_ | TBD |

**Numeric divisions**: `1=I, 2=II, 3=III, 4=IV, 5=V`. Convert to roman in
`extractTrackerSlug`.

**Champion top-X**: documented max is 9999. We bundle all 9999 PNGs into
`public/icons/ranks/champion-ranks/{N}.webp`. Runtime fetch from trackercdn fails CORS
(no `Access-Control-Allow-Origin`).

### stats.cc

All icons live under `static.stats.cc/siege/ranks/{slug}-{size}.{ext}`. Sizes seen:
`small`, `large`. Extensions: webp.

| Convention | Example slug | Notes |
|---|---|---|
| Pre-rework artwork (legacy) | `gold-iv`, `bronze-i`, `unranked` | All seasons before System Override |
| Post-rework artwork (v7) | `v7-gold-iv`, `v7-unranked` | System Override + later |
| Plain Champion (no division) | `champion` | Used for all Champion records, regardless of season |
| Legacy Champion star variant | `champion-star` | Used historically for top players |

**No leaderboard rank in URL.** Stats.cc renders Champion top-X as a sibling SVG
`<text>` inside the same `<svg>` wrapper as `<image>`. Layout for ANY Champion icon:

```html
<svg viewBox="0 0 500 500" width="36" height="36">
  <g transform="translate(-779 -321)">
    <image href="https://static.stats.cc/siege/ranks/champion-small.webp" />
    <rect width="276" height="140" transform="translate(892 547)"/>  <!-- default-black plate -->
    <text fill="#fff" font-size="36"><tspan>159</tspan></text>        <!-- white N -->
  </g>
</svg>
```

Three-layer composition: image + rect plate + text. To swap to a baked-in (number-on-icon)
variant, you must hide BOTH the rect AND the text or they'll render twice. See
`extractStatsccChampionRank` and the rect/text hiding logic in `lib/icon-swap.ts`.

**SVG `<image>`, not HTML `<img>`.** stats.cc uses inline SVG with `<image href="...">`.
HTML `<img>` is reserved for avatars and operators. The swap loop iterates both.

### Element types per site

| Site | Rank icon element | Source attr |
|---|---|---|
| tracker.gg | `<img>` (HTML) | `src` (or `currentSrc` for srcset) |
| stats.cc | `<image>` (SVG) | `href` (or legacy `xlink:href`) |

### Champion swap decision matrix

`docs/page-structure.md` already has the full table. Summary:

| Site | Mode | Champion |
|---|---|---|
| tracker.gg | Default | native PNG with N baked in |
| tracker.gg | New | no-op (tracker.gg already serves v7) |
| tracker.gg | Old | canvas overlay on `champion-small.webp` (stats.cc-style: clean shield + black plate + white N) |
| stats.cc | Default | native (image + rect + text) |
| stats.cc | New | bundled `champion-ranks/{N}.webp` + hide rect + blank text |
| stats.cc | Old | **skip** — stats.cc already serves legacy Champion artwork |

### Open questions / probe scripts

When something doesn't match this doc, capture a fresh DOM dump with the matching probe
script in `scripts/dump-page-structure.md` and update this section.

## How to capture a fresh dump

If a selector breaks or you need the agent to know the exact structure of a page:

1. Open the page in Chrome DevTools.
2. Run the snippets in `scripts/dump-page-structure.md` (one per landmark).
3. Paste the output into the matching section above and commit.

The DOM dump should be small (just the relevant subtree) — enough for the agent to pick a
selector without re-fetching the page.
