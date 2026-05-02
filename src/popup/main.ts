import type { UserSettings, PinnedPlayer, PinFailReason, Message, SelectProfileResponse, PinResponse } from '../lib/types';
import { parseStatsccProfileUrl, parseTrackerProfileUrl } from '../lib/patterns';

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
  const img = document.getElementById('avatar-img') as HTMLImageElement;
  const placeholder = document.getElementById('avatar-placeholder')!;

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

function renderPopulated(settings: UserSettings): void {
  (document.getElementById('username') as HTMLInputElement).value = settings.username;
  (document.getElementById('platform') as HTMLSelectElement).value = settings.platform;
  (document.getElementById('guid') as HTMLInputElement).value = settings.guid;

  updateAvatar(settings);
  updateLinks(settings);
  showSection('populated-section');
}

function wireManualToggles(): void {
  const empty: UserSettings = { username: '', platform: 'ubi', guid: '', avatarUrl: '' };
  document.querySelectorAll<HTMLButtonElement>('.manual-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      renderPopulated(empty);
      (document.getElementById('username') as HTMLInputElement).focus();
    });
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
    showStatus('Saved!');
  });
}

// --- Tabs ---

type TabId = 'main' | 'pinned';

function showTab(id: TabId): void {
  document.getElementById('tab-main')!.classList.toggle('hidden', id !== 'main');
  document.getElementById('tab-pinned')!.classList.toggle('hidden', id !== 'pinned');

  const btnMain = document.getElementById('btn-tab-main')!;
  const btnPinned = document.getElementById('btn-tab-pinned')!;
  const activeClasses = ['text-gray-200', 'border-orange-600'];
  const inactiveClasses = ['text-gray-500', 'border-transparent'];

  const [on, off] = id === 'main' ? [btnMain, btnPinned] : [btnPinned, btnMain];
  on.classList.add(...activeClasses);
  on.classList.remove(...inactiveClasses);
  off.classList.add(...inactiveClasses);
  off.classList.remove(...activeClasses);
}

function wireTabs(): void {
  document.getElementById('btn-tab-main')!.addEventListener('click', () => showTab('main'));
  document.getElementById('btn-tab-pinned')!.addEventListener('click', () => showTab('pinned'));
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

async function init(): Promise<void> {
  const settings = await sendMessage<UserSettings>({ type: 'GET_SETTINGS' });

  wireManualToggles();
  wireSelectProfile();
  wireSaveButton(settings);
  wireTabs();

  if (settings.username || settings.guid) {
    renderPopulated(settings);
    wireDragAndDrop(document.getElementById('pinned-list')!);
    await wirePinCurrent();
    await refreshPinnedList();
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
