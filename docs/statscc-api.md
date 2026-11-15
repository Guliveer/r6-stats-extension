# stats.cc API reference

The JSON API that the stats.cc frontend calls. The extension uses it as the primary source
for rank, RP and ranked K/D (`src/lib/statscc-api.ts`, decision log in
[`data-sources.md`](data-sources.md)).

> **Unofficial.** This is stats.cc's private backend, not a published contract. It can change
> without notice. Everything below was verified against live responses; anything marked
> _(observed)_ was seen in the browser's network panel but its payload was not inspected.

## Access

| | |
|---|---|
| Base URL | `https://api.stats.cc/siege/v2` |
| Auth | none — no key, no cookies, no account |
| CORS | `Access-Control-Allow-Origin: *` on every response, including error responses |
| Methods | `GET` only on the endpoints below |
| Rate limits | unknown; nothing in the response headers advertises them |
| Content type | `application/json` |

Because CORS is open, these calls work from three places: the extension service worker
(needs `https://api.stats.cc/*` in `host_permissions`), a content script on any page, and a
plain `fetch()` from DevTools. `credentials: 'omit'` is what the extension sends.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `/config` | Static slug constants, including the live season |
| `/profiles/{guid}` | Full player profile: account, rank records, per-mode stats |
| `/profiles/{guid}/summary` | Aggregated kills/deaths/wins/losses for a range |
| `/profiles/{guid}/matches` | Match list |
| `/profiles/{guid}/encounters` | Players met as enemy/team |

### `GET /config`

```json
{
  "constants": {
    "slugs": {
      "current_season": "split-fire",
      "ranked_playlist": "ranked",
      "quick_match_playlist": "quick-match",
      "ranked_bomb_mode": "ranked-bomb",
      "unranked_rank": "v7-unranked",
      "champion_rank": "v7-champion-i",
      "canceled_end_game_reason": "canceled",
      "finished_end_game_reason": "finished"
    }
  }
}
```

`constants.slugs` holds more keys than the ones above. The three we rely on:

- `current_season` — the live season slug (`split-fire`, `system-override`, …). **This is
  the reason the extension no longer scans the Nuxt payload** for a `siegeConfig` object
  whose array position moved between builds.
- `ranked_bomb_mode` — key into `season_mode_records[season]` for ranked Bomb (`ranked-bomb`).
- `unranked_rank` — slug for the current-generation "unranked" icon (`v7-unranked`).

Changes once per season, so the extension caches it as a promise for the lifetime of the
service worker and does not cache failures.

### `GET /profiles/{guid}`

`guid` is the Ubisoft profile UUID (the same one the extension already stores). A username
does **not** work here — unlike `tracker.gg`, which accepts either.

Top-level keys:

```
id  user_id  username  platform  level  hs  views
last_played_at  fetched_at  updated_at  username_history  settings
ranked_season_records  legend_season_records  max_rank_season
season_mode_records  season_datacenter_records
bans  external_bans  top_operators  platform_profiles  entitlements
```

`fetched_at` is stats.cc's own last upstream refresh — not the time of this request. It is
the field to use if a caller wants to show data staleness.

#### `ranked_season_records`

Keyed by season slug. Each entry is self-contained:

```json
{
  "split-fire": {
    "season": "split-fire",
    "rank": "v7-silver-i",
    "max_rank": "v7-gold-v",
    "rank_points": 2400,
    "max_rank_points": 2515
  }
}
```

- `rank` is already a stats.cc icon slug (`v7-silver-i`, `champion`, `v7-champion-i`,
  `unranked`), so it feeds straight into `parseRankSlug()` in `src/lib/statscc-rank.ts`.
- `rank_points` is the MMR/RP shown in the popup.
- **Missing season key** means the player has not placed this season → render "No rank".
- A profile with **no `ranked_season_records` block at all** is treated as unrecognised
  input by the extension (fall back to the page), not as "unranked".

`legend_season_records` follows the same shape for the legacy legend/Champion track.

#### `season_mode_records`

Two levels: season slug → mode slug → stats.

```json
{
  "split-fire": {
    "ranked-bomb": {
      "season": "split-fire",
      "mode": "ranked-bomb",
      "matches": 31,
      "wins": 13,
      "losses": 17,
      "abandons": 3,
      "draws": 0,
      "wr": 41.94,
      "kills": 136,
      "deaths": 137,
      "assists": 29,
      "headshots": 76,
      "kd": 0.9927,
      "kda": 1.2044,
      "kpm": 4.387,
      "hs": 55.88
    },
    "quick-match-bomb": { "...": "same shape" },
    "3v3": { "...": "same shape" }
  }
}
```

The mode key must come from `config.constants.slugs.ranked_bomb_mode` rather than being
hard-coded — the extension used to derive `"ranked-bomb"` from the Nuxt payload.

### `GET /profiles/{guid}/summary`

```
?playlist=ranked&start_date=2026-11-08T14:00:00.000Z&end_date=2026-11-15T14:00:00.000Z
```

Returns `{ kills, deaths, wins, losses, abandons, draws, matches, rank_points_delta, streak }`.
All counters came back `0` without a date range in our test, so treat `start_date` /
`end_date` as required in practice. Not used by the extension.

### `GET /profiles/{guid}/matches`

`?playlist=ranked` _(observed, 200 — payload not inspected)_. The match list behind the
profile's Matches tab; a candidate future source for the RP session summary on tracker.gg.

### `GET /profiles/{guid}/encounters`

`?type=enemy` or `?type=team`, optionally `&playlist=ranked` _(observed, 200 — payload not
inspected)_.

## Errors

Validation failures return `400` with a structured body:

```json
{
  "kind": "validation_failure",
  "message": "Validation failure",
  "issues": [
    { "path": ["path", "platform_slug"], "kind": "too_long", "message": "Value must have a length of at most 32" }
  ]
}
```

Unknown routes return `404` with `{"kind": "unknown_route", "message": "Route not found"}`.

That `platform_slug` message is worth knowing: sub-paths like `/profiles/{guid}/ranked`
are not routes — they are parsed as a `platform_slug` path segment and rejected for being
longer than 32 characters. A `400` with `platform_slug` in it means "this sub-resource does
not exist", not "your parameters are wrong".

## How the extension uses it

| File | Role |
|---|---|
| `src/lib/statscc-api.ts` | Client: `/config` + `/profiles/{guid}`, mapping to `PlayerRank` / `RankedStats` |
| `src/lib/statscc-rank.ts` | `parseRankSlug()` — shared by the API and HTML paths |
| `src/background/service-worker.ts` | `fetchRankFromStatscc()` — API first, HTML fallback |
| `src/content/statscc.ts` | On-profile extraction — API first, then `__NUXT_DATA__`, then regex over the DOM |

Any unusable response (non-OK, missing `ranked_season_records`, unparseable slug) makes the
client return `null`, and the caller falls back to the SSR payload. An API change degrades
to the previous behaviour instead of losing rank data.

## Re-verifying

Open any stats.cc profile in DevTools and run:

```js
const g = '<player-guid>';
const cfg = await (await fetch('https://api.stats.cc/siege/v2/config')).json();
const s = cfg.constants.slugs.current_season;
const p = await (await fetch('https://api.stats.cc/siege/v2/profiles/' + g)).json();
console.log(s, p.ranked_season_records?.[s], p.season_mode_records?.[s]?.[cfg.constants.slugs.ranked_bomb_mode]);
```

If the shapes above no longer match, update this file and `src/lib/statscc-api.ts` together.
