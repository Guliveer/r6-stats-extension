// R6 Siege ranked tiers. Each division spans 100 MMR (Champion is open-ended starting at 5000).
// Ordered low-to-high; index → MMR floor = 1000 + index * 100.

export interface RankInfo {
  tier: string;
  division: string | null;
  display: string;
  bottom: number;
  top: number | null;
  color: string;
  short: string;
}

const TIER_COLORS: Record<string, string> = {
  Copper: '#a47452',
  Bronze: '#cd7f32',
  Silver: '#c0c0c0',
  Gold: '#f5c542',
  Platinum: '#5fdcc6',
  Emerald: '#3dd476',
  Diamond: '#7eb8ff',
  Champion: '#e74c3c',
  Legend: '#a855f7',
};

const TIER_SHORT: Record<string, string> = {
  Copper: 'C', Bronze: 'B', Silver: 'S', Gold: 'G',
  Platinum: 'P', Emerald: 'E', Diamond: 'D', Champion: 'CH', Legend: 'L',
};

const DIVISIONS = ['V', 'IV', 'III', 'II', 'I'] as const;

interface RankRow {
  tier: string;
  division: string | null;
  bottom: number;
  top: number | null;
}

const TABLE: RankRow[] = (() => {
  const tiers = ['Copper', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond'];
  const rows: RankRow[] = [];
  let mmr = 1000;
  for (const tier of tiers) {
    for (const division of DIVISIONS) {
      rows.push({ tier, division, bottom: mmr, top: mmr + 99 });
      mmr += 100;
    }
  }
  rows.push({ tier: 'Champion', division: null, bottom: 5000, top: null });
  rows.push({ tier: 'Legend', division: null, bottom: 0, top: null });
  return rows;
})();

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function normalizeDivision(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  return DIVISIONS.includes(upper as typeof DIVISIONS[number]) ? upper : null;
}

// Look up a row by tier name (case-insensitive) and roman-numeral division.
// `mmr` is used only as a tiebreaker / fallback when division is missing.
export function lookupRank(tierRaw: string, divisionRaw: string | null, mmr?: number): RankInfo | null {
  const tier = titleCase(tierRaw);
  if (!TIER_COLORS[tier]) return null;

  const division = normalizeDivision(divisionRaw);

  let row: RankRow | undefined;
  if (tier === 'Champion' || tier === 'Legend') {
    row = TABLE.find(r => r.tier === tier);
  } else if (division) {
    row = TABLE.find(r => r.tier === tier && r.division === division);
  } else if (mmr != null) {
    // No division reported — pick the row whose [bottom, top] covers the MMR.
    row = TABLE.find(r => r.tier === tier && mmr >= r.bottom && (r.top == null || mmr <= r.top));
  }
  if (!row) return null;

  const display = row.division ? `${row.tier} ${row.division}` : row.tier;
  return {
    tier: row.tier,
    division: row.division,
    display,
    bottom: row.bottom,
    top: row.top,
    color: TIER_COLORS[row.tier],
    short: TIER_SHORT[row.tier],
  };
}
