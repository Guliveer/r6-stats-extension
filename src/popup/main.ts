import type { UserSettings, PinnedPlayer, PinFailReason, Message, SelectProfileResponse, PinResponse, PlayerRank, RankedStats, UserPreferences } from '../lib/types';
import { DEFAULT_PREFERENCES, MIN_REFRESH_MINUTES, MIN_VISIBLE_PINNED, MAX_VISIBLE_PINNED } from '../lib/types';
import { parseStatsccProfileUrl, parseTrackerProfileUrl } from '../lib/patterns';
import { lookupRank } from '../lib/ranks';
import { resolveIconSlug } from '../lib/statscc-rank';

const STATUS_HIDE_MS = 2000;

const ERROR_MESSAGES: Record<Extract<SelectProfileResponse, { ok: false }>['reason'], string> = {
  no_guid: 'Avatar not loaded yet — refresh the tab and try again.',
  no_active_tab: 'Could not access the active tab.',
  not_supported: 'This page is not a supported profile.',
};

const PIN_ERROR_MESSAGES: Record<PinFailReason, string> = {
  no_guid: 'Avatar not loaded yet — refresh the tab and try again.',
  no_active_tab: 'Could not access the active tab.',
  not_supported: 'Open a tracker.gg or stats.cc profile tab first.',
  already_pinned: 'This profile is already pinned.',
};

function sendMessage<T>(msg: Message): Promise<T> {
  return chrome.runtime.sendMessage(msg);
}

// Reusable "new tab" URLs — visiting any of these means the active tab is empty in the
// user's intent, so we can navigate it without losing anything. Includes the major
// browsers' default new-tab URLs plus about:blank.
const REUSABLE_TAB_URL_RE = /^(?:about:blank|chrome:\/\/newtab\/?|chrome-search:\/\/local-ntp\/.*|edge:\/\/newtab\/?|brave:\/\/newtab\/?|opera:\/\/startpage\/?|vivaldi:\/\/startpage\/?)$/i;

// When the user clicks any link in the popup, reuse the active tab if it's currently
// "blank" (default new-tab page or about:blank). Otherwise fall back to opening in a
// new tab — the same behaviour as the link's target=_blank would naturally produce.
function wireSmartLinkOpening(): void {
  document.addEventListener('click', async (e) => {
    const anchor = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    // Only intercept external (http/https) links — leave in-popup hash anchors alone.
    if (!/^https?:\/\//i.test(href)) return;

    e.preventDefault();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const isBlank = !tab?.url || REUSABLE_TAB_URL_RE.test(tab.url) || tab.pendingUrl === 'chrome://newtab/';
    if (tab?.id != null && isBlank) {
      await chrome.tabs.update(tab.id, { url: href });
    } else {
      await chrome.tabs.create({ url: href });
    }
    window.close();
  });
}

const TRACKERS = {
  trn: 'https://r6.tracker.network/r6siege/profile/{platform}/{id}/overview',
  statscc: 'https://stats.cc/siege/{username}/{guid}',
  statsccGuidOnly: 'https://stats.cc/siege/{guid}',
};

interface UrlTokens {
  username: string;
  platform: 'ubi' | 'psn' | 'xbl';
  guid: string;
}

function buildUrl(template: string, s: UrlTokens): string {
  // Prefer GUID for tracker.gg — it's stable across username changes and works for every
  // profile (tracker.gg accepts both forms, but username lookups fail for renamed accounts).
  const trnId = s.guid || s.username;
  return template
    .replace('{platform}', s.platform)
    .replace('{id}', encodeURIComponent(trnId))
    .replace('{username}', encodeURIComponent(s.username))
    .replace('{guid}', encodeURIComponent(s.guid));
}

function statsccUrlFor(player: UrlTokens): string | null {
  if (!player.guid) return null;
  const template = player.username ? TRACKERS.statscc : TRACKERS.statsccGuidOnly;
  return buildUrl(template, player);
}

function updateAvatar(settings: UserSettings): void {
  const wires: { img: HTMLImageElement; placeholder: HTMLElement }[] = [
    { img: document.getElementById('avatar-img') as HTMLImageElement, placeholder: document.getElementById('avatar-placeholder')! },
    { img: document.getElementById('avatar-img-edit') as HTMLImageElement, placeholder: document.getElementById('avatar-placeholder-edit')! },
  ];

  for (const { img, placeholder } of wires) {
    if (settings.avatarUrl) {
      img.src = settings.avatarUrl;
      img.classList.remove('hidden');
      placeholder.classList.add('hidden');
      img.onerror = () => {
        img.classList.add('hidden');
        placeholder.classList.remove('hidden');
      };
    } else {
      img.classList.add('hidden');
      placeholder.classList.remove('hidden');
      placeholder.textContent = settings.username ? settings.username.charAt(0).toUpperCase() : '?';
    }
  }
}

function updateProfileCompact(settings: UserSettings): void {
  const usernameEl = document.getElementById('profile-username')!;
  const platformEl = document.getElementById('profile-platform')!;
  const rankEl = document.getElementById('profile-rank')!;

  usernameEl.textContent = settings.username || '(no username)';
  platformEl.textContent = settings.platform;

  rankEl.textContent = '';
  if (settings.rank) rankEl.appendChild(buildRankRow(settings.rank, settings.rankedStats));
}

function showProfileEdit(expanded: boolean): void {
  document.getElementById('profile-compact')!.classList.toggle('hidden', expanded);
  document.getElementById('profile-edit')!.classList.toggle('hidden', !expanded);
}

function updateLinks(settings: UserSettings): void {
  const linksSection = document.getElementById('links-section')!;
  const guidNote = document.getElementById('guid-note')!;
  const trnLink = document.getElementById('link-trn') as HTMLAnchorElement;
  const statsccLink = document.getElementById('link-stats-cc') as HTMLAnchorElement;

  if (!settings.username && !settings.guid) {
    linksSection.classList.add('hidden');
    return;
  }

  linksSection.classList.remove('hidden');
  trnLink.href = buildUrl(TRACKERS.trn, settings);

  if (settings.guid) {
    const template = settings.username ? TRACKERS.statscc : TRACKERS.statsccGuidOnly;
    statsccLink.href = buildUrl(template, settings);
    statsccLink.style.display = '';
    guidNote.classList.add('hidden');
  } else {
    statsccLink.style.display = 'none';
    guidNote.classList.remove('hidden');
  }
}

type DetectedTab = { source: 'tracker.gg' | 'stats.cc'; username: string } | null;

async function detectActiveTabProfile(): Promise<DetectedTab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return null;

  const statscc = parseStatsccProfileUrl(tab.url);
  if (statscc) return { source: 'stats.cc', username: statscc.username };

  const tracker = parseTrackerProfileUrl(tab.url);
  if (tracker) return { source: 'tracker.gg', username: tracker.username };

  return null;
}

type SectionId = 'empty-on-profile' | 'empty-off-profile' | 'populated-section';
const SECTION_IDS: SectionId[] = ['empty-on-profile', 'empty-off-profile', 'populated-section'];

function showSection(id: SectionId): void {
  for (const s of SECTION_IDS) {
    document.getElementById(s)!.classList.toggle('hidden', s !== id);
  }
}

function showStatus(text: string): void {
  const status = document.getElementById('save-status')!;
  status.textContent = text;
  status.classList.remove('hidden');
  setTimeout(() => status.classList.add('hidden'), STATUS_HIDE_MS);
}

interface ConfirmOptions {
  title: string;
  body: string;
  okLabel?: string;
}

function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal')!;
    const titleEl = document.getElementById('confirm-title')!;
    const bodyEl = document.getElementById('confirm-body')!;
    const okBtn = document.getElementById('confirm-ok') as HTMLButtonElement;
    const cancelBtn = document.getElementById('confirm-cancel') as HTMLButtonElement;

    titleEl.textContent = opts.title;
    bodyEl.textContent = opts.body;
    okBtn.textContent = opts.okLabel ?? 'Confirm';

    modal.classList.remove('hidden');
    okBtn.focus();

    const cleanup = (result: boolean): void => {
      modal.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };

    const onOk = (): void => cleanup(true);
    const onCancel = (): void => cleanup(false);
    const onBackdrop = (e: MouseEvent): void => { if (e.target === modal) cleanup(false); };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cleanup(false);
      else if (e.key === 'Enter') cleanup(true);
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
  });
}

function renderPopulated(settings: UserSettings, expand = false): void {
  (document.getElementById('username') as HTMLInputElement).value = settings.username;
  (document.getElementById('platform') as HTMLSelectElement).value = settings.platform;
  (document.getElementById('guid') as HTMLInputElement).value = settings.guid;

  updateAvatar(settings);
  updateLinks(settings);
  updateProfileCompact(settings);
  showProfileEdit(expand);
  showSection('populated-section');
}

function wireManualToggles(): void {
  const empty: UserSettings = { username: '', platform: 'ubi', guid: '', avatarUrl: '' };
  document.querySelectorAll<HTMLButtonElement>('.manual-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      renderPopulated(empty, true);
      (document.getElementById('username') as HTMLInputElement).focus();
    });
  });
}

function wireProfileEditToggle(): void {
  document.getElementById('btn-edit-profile')?.addEventListener('click', () => {
    showProfileEdit(true);
    (document.getElementById('username') as HTMLInputElement).focus();
  });
}

function wireSelectProfile(): void {
  const btn = document.getElementById('btn-select-profile') as HTMLButtonElement;
  const err = document.getElementById('select-error')!;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    err.classList.add('hidden');

    const response = await sendMessage<SelectProfileResponse>({ type: 'SELECT_PROFILE_FROM_TAB' });

    btn.disabled = false;

    if (response.ok) {
      renderPopulated(response.settings);
      showStatus('Profile selected!');
      return;
    }

    err.textContent = ERROR_MESSAGES[response.reason];
    err.classList.remove('hidden');
  });
}

function wireSaveButton(initialSettings: UserSettings): void {
  const usernameInput = document.getElementById('username') as HTMLInputElement;
  const platformSelect = document.getElementById('platform') as HTMLSelectElement;
  const guidInput = document.getElementById('guid') as HTMLInputElement;

  document.getElementById('btn-save')!.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    const platform = platformSelect.value as 'ubi' | 'psn' | 'xbl';
    const guid = guidInput.value.trim();

    // Preserves avatarUrl from initial load — service worker never overwrites it on manual save.
    const newSettings: UserSettings = { ...initialSettings, username, platform, guid };
    await sendMessage({ type: 'SAVE_SETTINGS', payload: { username, platform, guid } });

    updateAvatar(newSettings);
    updateLinks(newSettings);
    updateProfileCompact(newSettings);
    showProfileEdit(false);
    showStatus('Saved!');
  });
}

// --- Pinned players ---

function createTrackerIconLink(href: string, label: 'TN' | 'SC', fullName: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.title = `Open on ${fullName}`;
  a.textContent = label;
  const isTn = label === 'TN';
  const color = isTn ? '#FF3D2C' : 'hsl(37,52%,69%)';
  const bg = isTn ? 'rgba(255,61,44,0.1)' : 'hsla(37,52%,69%,0.1)';
  const border = isTn ? 'rgba(255,61,44,0.2)' : 'hsla(37,52%,69%,0.2)';
  a.className = 'flex items-center justify-center w-7 h-7 rounded-md text-[0.6rem] font-bold shrink-0 transition hover:brightness-125';
  a.style.cssText = `background:${bg};border:1px solid ${border};color:${color};text-decoration:none;`;
  return a;
}

function playerKey(p: PinnedPlayer): string {
  return `${p.platform}:${p.username.toLowerCase()}`;
}

// Stored rank data carries a raw slug (`rank.slug`); we apply the current iconSet pref
// at render time so toggling the setting never requires re-fetching profile data.
// Falls back to the legacy `iconUrl` field for pinned players saved before slug tracking.
let currentPreferences: UserPreferences = DEFAULT_PREFERENCES;

function rankIconUrl(rank: PlayerRank): string | null {
  if (rank.slug) {
    return chrome.runtime.getURL(`icons/ranks/${resolveIconSlug(rank.slug, currentPreferences.iconSet)}-small.webp`);
  }
  if (rank.iconUrl) {
    if (/^https?:\/\//i.test(rank.iconUrl)) return rank.iconUrl;
    return chrome.runtime.getURL(rank.iconUrl);
  }
  return null;
}

function buildLetterIcon(info: ReturnType<typeof lookupRank>): HTMLElement {
  const icon = document.createElement('span');
  icon.className = 'flex items-center justify-center w-4 h-4 rounded text-[0.5rem] font-bold shrink-0';
  icon.style.cssText = info
    ? `background:${info.color}1f;color:${info.color};border:1px solid ${info.color}55;`
    : 'background:rgba(160,160,160,0.15);color:#aaa;border:1px solid rgba(160,160,160,0.3);';
  icon.textContent = info?.short ?? '?';
  return icon;
}

function buildRankRow(rank: PlayerRank, stats?: RankedStats): HTMLElement {
  const row = document.createElement('div');
  row.className = 'flex items-center gap-1.5 mt-0.5';

  const fetchedTitle = `Last fetched: ${new Date(rank.fetchedAt).toLocaleString()}`;
  const isUnranked = !rank.tier || /no\s*rank|unranked/i.test(rank.tier);

  if (isUnranked) {
    row.title = fetchedTitle;
    const iconSrc = rankIconUrl(rank);
    if (iconSrc) {
      const iconImg = document.createElement('img');
      iconImg.src = iconSrc;
      iconImg.alt = 'No rank';
      iconImg.className = 'w-5 h-5 shrink-0 object-contain opacity-70';
      iconImg.onerror = () => iconImg.remove();
      row.appendChild(iconImg);
    }
    const label = document.createElement('span');
    label.className = 'text-[0.65rem] text-gray-500 italic';
    label.textContent = 'No rank';
    row.appendChild(label);
    return row;
  }

  const info = lookupRank(rank.tier, rank.division ?? null, stats?.mmr);

  // Tooltip surfaces the division MMR range (e.g. "Diamond II: 4300–4399 (current 4350)")
  // for users who want it; we no longer occupy a row inch for it.
  const rangeTitle = info && info.bottom != null
    ? `${info.display}: ${info.bottom}–${info.top ?? '∞'}${stats?.mmr != null ? ` (current ${stats.mmr})` : ''}`
    : info?.display ?? rank.tier;
  row.title = `${rangeTitle}\n${fetchedTitle}`;

  const iconSrc = rankIconUrl(rank);
  if (iconSrc) {
    const iconImg = document.createElement('img');
    iconImg.src = iconSrc;
    iconImg.alt = info?.display ?? rank.tier;
    iconImg.className = 'w-5 h-5 shrink-0 object-contain';
    iconImg.onerror = () => iconImg.replaceWith(buildLetterIcon(info));
    row.appendChild(iconImg);
  } else {
    row.appendChild(buildLetterIcon(info));
  }

  const label = document.createElement('span');
  label.className = 'text-[0.65rem] font-medium truncate';
  label.style.color = info?.color ?? '#cbd5e1';
  label.textContent = info?.display ?? rank.tier;
  row.appendChild(label);

  // Right side: K/D and RP. Both optional — render whichever we have.
  const right = document.createElement('span');
  right.className = 'text-[0.6rem] text-gray-500 ml-auto shrink-0 font-mono flex items-center gap-1.5';
  let hasContent = false;

  if (stats?.kd != null) {
    const kd = document.createElement('span');
    kd.textContent = `K/D ${stats.kd.toFixed(2)}`;
    right.appendChild(kd);
    hasContent = true;
  }

  if (stats?.mmr != null) {
    const mmr = document.createElement('span');
    mmr.style.color = info?.color ?? '#94a3b8';
    mmr.textContent = `${stats.mmr} RP`;
    if (hasContent) {
      const sep = document.createElement('span');
      sep.textContent = '•';
      sep.className = 'opacity-50';
      right.appendChild(sep);
    }
    right.appendChild(mmr);
    hasContent = true;
  }

  if (hasContent) row.appendChild(right);

  return row;
}

function createPinnedCard(player: PinnedPlayer, onRemove: () => void): HTMLElement {
  const card = document.createElement('div');
  card.className = 'flex items-center gap-2 px-3 py-2 bg-gray-900/60 border border-gray-800/60 rounded-lg group transition';
  card.dataset.playerKey = playerKey(player);

  const handle = document.createElement('span');
  handle.className = 'shrink-0 text-gray-600 hover:text-gray-400 cursor-grab active:cursor-grabbing select-none leading-none text-sm';
  handle.textContent = '⋮⋮';
  handle.title = 'Drag to reorder';
  handle.draggable = true;
  card.appendChild(handle);

  const info = document.createElement('div');
  info.className = 'flex-1 min-w-0';

  const nameRow = document.createElement('div');
  nameRow.className = 'flex items-baseline gap-1.5 min-w-0';

  const name = document.createElement('span');
  name.className = 'text-[0.8rem] font-medium text-gray-200 truncate';
  name.textContent = player.username;

  const platform = document.createElement('span');
  platform.className = 'text-[0.6rem] text-gray-600 uppercase shrink-0';
  platform.textContent = player.platform;

  nameRow.append(name, platform);
  info.appendChild(nameRow);

  if (player.rank) {
    info.appendChild(buildRankRow(player.rank, player.rankedStats));
  }

  card.appendChild(info);

  card.appendChild(createTrackerIconLink(buildUrl(TRACKERS.trn, player), 'TN', 'Tracker.network'));
  const scHref = statsccUrlFor(player);
  if (scHref) card.appendChild(createTrackerIconLink(scHref, 'SC', 'Stats.cc'));

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.title = 'Unpin';
  removeBtn.textContent = '×';
  removeBtn.className = 'w-6 h-6 flex items-center justify-center rounded text-gray-600 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition text-base leading-none shrink-0';
  removeBtn.addEventListener('click', onRemove);
  card.appendChild(removeBtn);

  return card;
}

async function refreshPinnedList(): Promise<void> {
  const list = await sendMessage<PinnedPlayer[]>({ type: 'GET_PINNED_PLAYERS' });
  renderPinnedList(list);
}

// --- Drag & drop reorder ---

let draggingCard: HTMLElement | null = null;

function cardAfterPoint(container: HTMLElement, y: number): HTMLElement | null {
  const cards = Array.from(container.querySelectorAll<HTMLElement>(':scope > [data-player-key]'))
    .filter(c => c !== draggingCard);
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) return card;
  }
  return null;
}

function wireDragAndDrop(container: HTMLElement): void {
  container.addEventListener('dragstart', (e) => {
    const handle = e.target as HTMLElement;
    const card = handle.closest<HTMLElement>('[data-player-key]');
    if (!card || !container.contains(card)) return;
    draggingCard = card;
    card.classList.add('opacity-40');
    e.dataTransfer?.setData('text/plain', card.dataset.playerKey ?? '');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragover', (e) => {
    if (!draggingCard) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const after = cardAfterPoint(container, e.clientY);
    if (after) {
      container.insertBefore(draggingCard, after);
    } else {
      container.appendChild(draggingCard);
    }
  });

  container.addEventListener('dragend', () => {
    draggingCard?.classList.remove('opacity-40');
    draggingCard = null;
  });

  container.addEventListener('drop', async (e) => {
    e.preventDefault();
    const order = Array.from(container.querySelectorAll<HTMLElement>(':scope > [data-player-key]'))
      .map(c => c.dataset.playerKey!)
      .map(parsePlayerKey);
    const list = await sendMessage<PinnedPlayer[]>({ type: 'REORDER_PINNED_PLAYERS', payload: order });
    renderPinnedList(list);
  });
}

function parsePlayerKey(key: string): { username: string; platform: 'ubi' | 'psn' | 'xbl' } {
  const [platform, ...rest] = key.split(':');
  return { platform: platform as 'ubi' | 'psn' | 'xbl', username: rest.join(':') };
}

function renderPinnedList(players: PinnedPlayer[]): void {
  const container = document.getElementById('pinned-list')!;
  const empty = document.getElementById('pinned-empty')!;

  container.textContent = '';
  empty.classList.toggle('hidden', players.length > 0);

  for (const player of players) {
    const card = createPinnedCard(player, async () => {
      const confirmed = await confirmDialog({
        title: 'Unpin player',
        body: `Remove ${player.username} from your pinned list?`,
        okLabel: 'Unpin',
      });
      if (!confirmed) return;
      const next = await sendMessage<PinnedPlayer[]>({
        type: 'UNPIN_PLAYER',
        payload: { username: player.username, platform: player.platform },
      });
      renderPinnedList(next);
    });
    container.appendChild(card);
  }

  // Cards exist now → measure them and re-apply max-height with real numbers.
  applyVisiblePinned();
}

async function wirePinCurrent(): Promise<void> {
  const btn = document.getElementById('btn-pin-current') as HTMLButtonElement;
  const err = document.getElementById('pin-error')!;

  const detected = await detectActiveTabProfile();
  if (!detected) {
    btn.disabled = true;
    btn.title = 'Open a tracker.gg or stats.cc profile tab first.';
  } else {
    btn.title = `Pin ${detected.username} (from ${detected.source})`;
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    err.classList.add('hidden');

    const response = await sendMessage<PinResponse>({ type: 'PIN_CURRENT_TAB' });

    btn.disabled = false;

    if (response.ok) {
      renderPinnedList(response.list);
      showStatus('Player pinned!');
      return;
    }

    err.textContent = PIN_ERROR_MESSAGES[response.reason];
    err.classList.remove('hidden');
  });
}

// --- Settings modal ---

function applyVisiblePinned(): void {
  const list = document.getElementById('pinned-list');
  if (!list) return;

  const n = currentPreferences.visiblePinnedCount;
  const firstCard = list.firstElementChild as HTMLElement | null;
  if (!firstCard) {
    list.style.maxHeight = `${n * 60}px`;
    return;
  }
  // Measure card and gap from real layout. Tailwind's `space-y-1.5` uses
  // `> * + * { margin-top: 6px }` instead of CSS `gap`, so reading getComputedStyle
  // on the list returns gap:0. We grab the second card's marginTop instead.
  const cardHeight = firstCard.getBoundingClientRect().height;
  const secondCard = firstCard.nextElementSibling as HTMLElement | null;
  const gap = secondCard ? parseFloat(window.getComputedStyle(secondCard).marginTop) || 0 : 6;

  // N cards + (N-1) gaps, plus a generous slack for sub-pixel rounding and any
  // box-shadow/outline that protrudes past getBoundingClientRect.
  // Add a full gap of slack on top of the math — covers sub-pixel rounding, late-loading
  // images that shift card height after measurement, and any box-shadow/border that
  // extends below getBoundingClientRect.
  const total = Math.ceil(n * cardHeight + n * gap) + 4;
  list.style.maxHeight = `${total}px`;
}

function applyPreferencesToUI(): void {
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="iconSet"]')) {
    radio.checked = radio.value === currentPreferences.iconSet;
  }
  (document.getElementById('prefs-autorefresh') as HTMLInputElement).checked = currentPreferences.pinnedAutoRefresh.enabled;
  (document.getElementById('prefs-interval') as HTMLInputElement).value = String(currentPreferences.pinnedAutoRefresh.intervalMinutes);
  (document.getElementById('prefs-visible') as HTMLInputElement).value = String(currentPreferences.visiblePinnedCount);
  applyVisiblePinned();
}

async function persistPreferences(partial: Partial<UserPreferences>): Promise<void> {
  const next = await sendMessage<UserPreferences>({ type: 'SAVE_PREFERENCES', payload: partial });
  currentPreferences = next;
  applyPreferencesToUI();
  // Re-render whatever currently shows ranks so the iconSet change is visible immediately.
  refreshPinnedList();
  const settings = await sendMessage<UserSettings>({ type: 'GET_SETTINGS' });
  updateProfileCompact(settings);
}

function wireSettingsModal(): void {
  const modal = document.getElementById('settings-modal')!;
  const open = document.getElementById('btn-open-settings')!;
  const close = document.getElementById('settings-close')!;

  const showModal = (): void => modal.classList.remove('hidden');
  const hideModal = (): void => modal.classList.add('hidden');

  open.addEventListener('click', showModal);
  close.addEventListener('click', hideModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) hideModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) hideModal();
  });

  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="iconSet"]')) {
    radio.addEventListener('change', () => {
      if (radio.checked) persistPreferences({ iconSet: radio.value as UserPreferences['iconSet'] });
    });
  }

  const autorefresh = document.getElementById('prefs-autorefresh') as HTMLInputElement;
  autorefresh.addEventListener('change', () => {
    persistPreferences({
      pinnedAutoRefresh: { ...currentPreferences.pinnedAutoRefresh, enabled: autorefresh.checked },
    });
  });

  const interval = document.getElementById('prefs-interval') as HTMLInputElement;
  // Persist on blur/Enter rather than every keystroke — number inputs fire 'input' for
  // partial values mid-typing, which would clamp users below their target.
  const commitInterval = (): void => {
    const minutes = Math.max(MIN_REFRESH_MINUTES, Math.round(Number(interval.value) || MIN_REFRESH_MINUTES));
    interval.value = String(minutes);
    persistPreferences({
      pinnedAutoRefresh: { ...currentPreferences.pinnedAutoRefresh, intervalMinutes: minutes },
    });
  };
  interval.addEventListener('change', commitInterval);
  interval.addEventListener('blur', commitInterval);

  const visible = document.getElementById('prefs-visible') as HTMLInputElement;
  const commitVisible = (): void => {
    const count = Math.min(MAX_VISIBLE_PINNED, Math.max(MIN_VISIBLE_PINNED, Math.round(Number(visible.value) || MIN_VISIBLE_PINNED)));
    visible.value = String(count);
    persistPreferences({ visiblePinnedCount: count });
  };
  visible.addEventListener('change', commitVisible);
  visible.addEventListener('blur', commitVisible);
}

async function init(): Promise<void> {
  const [settings, prefs] = await Promise.all([
    sendMessage<UserSettings>({ type: 'GET_SETTINGS' }),
    sendMessage<UserPreferences>({ type: 'GET_PREFERENCES' }),
  ]);
  currentPreferences = prefs;

  wireManualToggles();
  wireSelectProfile();
  wireSaveButton(settings);
  wireProfileEditToggle();
  wireSettingsModal();
  wireSmartLinkOpening();
  applyPreferencesToUI();

  // Footer version label — single source of truth is the manifest, so we never need
  // to keep this string in sync manually.
  const versionEl = document.getElementById('footer-version');
  if (versionEl) versionEl.textContent = `v${chrome.runtime.getManifest().version}`;

  if (settings.username || settings.guid) {
    renderPopulated(settings);
    wireDragAndDrop(document.getElementById('pinned-list')!);
    await wirePinCurrent();
    await refreshPinnedList();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes['r6_pinned_players']) refreshPinnedList();
      if (changes['r6_settings']) {
        const newSettings = changes['r6_settings'].newValue as UserSettings | undefined;
        if (newSettings) updateProfileCompact(newSettings);
      }
      if (changes['r6_preferences']) {
        const newPrefs = changes['r6_preferences'].newValue as UserPreferences | undefined;
        if (newPrefs) {
          currentPreferences = newPrefs;
          applyPreferencesToUI();
          refreshPinnedList();
        }
      }
    });
    return;
  }

  const detected = await detectActiveTabProfile();
  if (detected) {
    (document.getElementById('detected-source') as HTMLElement).textContent = detected.source;
    (document.getElementById('detected-username') as HTMLElement).textContent = detected.username;
    showSection('empty-on-profile');
  } else {
    showSection('empty-off-profile');
  }
}

init();
