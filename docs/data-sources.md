# Data sources

Rank, RP and ranked K/D come from **stats.cc's own public JSON API**. No key, no account,
no configuration. `src/lib/statscc-api.ts` is the client; `src/lib/statscc-rank.ts` parses
the SSR payload and is the fallback when the API is unreachable.

## Primary — `api.stats.cc`

Two keyless `GET` requests: `/siege/v2/config` for the live season slug and the mode/rank
slugs, `/siege/v2/profiles/{guid}` for `ranked_season_records` (rank slug + RP) and
`season_mode_records` (K/D). Full endpoint reference, response shapes and error details:
[`statscc-api.md`](statscc-api.md).

Why this over the alternatives: no key, no account, and it replaces a *more* fragile
dependency. `siegeConfig` in the `__NUXT_DATA__` compact array moved between index 4 and
1628 across builds; here the season is a named field.

Two rules the client applies:

- A season key missing from `ranked_season_records` means the player hasn't placed this
  season → "No rank" with the `unranked_rank` slug.
- A profile with **no** `ranked_season_records` block at all is treated as a failure, not
  as "unranked" — unrecognised shape, so we fall back to parsing the page.

## Fallback — stats.cc SSR payload

`extractRankFromStatsccHtml()` reads `<script id="__NUXT_DATA__">` from the page. Still used
when the API call fails, and it needs no network round trip when we're already on the page.

## Third-party APIs evaluated and rejected

### `hmes98318/r6s-stats-api`
Requires Node.js 24.15+ and ships **Playwright as a runtime dependency**, downloading its
own Chromium. Cannot run in a Manifest V3 service worker — it would need a separate local
server.

### `r6-data.js` (Arenyze / R6Data)
Node SDK over a plain JSON API, so it *was* implemented and then removed: **every user
needs their own API key, and keys are issued with a validity period.** Once a key expires
the extension silently degrades to scraping, and an extension cannot renew a user's key.
Lookups also take a username rather than a GUID, so GUID-only pinned players skipped it.

### Ubisoft internal endpoints (the `rainbow6-russia` Postman collection)
Requires a full `ubiservices` login — Ubisoft email + password, 2FA ticket exchange, then a
per-title space token. Shipping that means storing the user's Ubisoft password in an
extension. Undocumented and against Ubisoft's terms.

### Tracker Network developer API
Tracker explicitly does not offer R6: “we do not currently offer our R6 API, nor have any
plans to”. Keys from their developer portal return `401 Invalid authentication credentials`
on the R6 endpoints.

## Summary

| Option | Runs in MV3? | Credentials | Status |
|---|---|---|---|
| `api.stats.cc` | Yes — plain `fetch`, CORS `*` | none | **primary** |
| stats.cc `__NUXT_DATA__` | Yes — same-origin scrape | none | fallback |
| `r6s-stats-api` | No — Node + Playwright | none | rejected |
| `r6-data.js` API | Yes | per-user key that expires | rejected |
| Ubisoft internal | Fragile | Ubisoft password, 2FA off | rejected |
| Tracker Network | Yes | API key, no R6 access | rejected |
