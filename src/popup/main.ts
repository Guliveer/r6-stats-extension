import type { UserSettings, Message, SelectProfileResponse } from '../lib/types';
import { parseStatsccProfileUrl, parseTrackerProfileUrl } from '../lib/patterns';

const STATUS_HIDE_MS = 2000;

const ERROR_MESSAGES: Record<Extract<SelectProfileResponse, { ok: false }>['reason'], string> = {
  no_guid: 'Avatar not loaded yet — refresh the tab and try again.',
  no_active_tab: 'Could not access the active tab.',
  not_supported: 'This page is not a supported profile.',
};

function sendMessage<T>(msg: Message): Promise<T> {
  return chrome.runtime.sendMessage(msg);
}

const TRACKERS = {
  trn: 'https://r6.tracker.network/r6siege/profile/{platform}/{id}/overview',
  trnMatches: 'https://r6.tracker.network/r6siege/profile/{platform}/{id}/matches',
  statscc: 'https://stats.cc/siege/{username}/{guid}',
  statsccGuidOnly: 'https://stats.cc/siege/{guid}',
};

function buildUrl(template: string, s: UserSettings): string {
  const trnId = s.username || s.guid;
  return template
    .replace('{platform}', s.platform)
    .replace('{id}', encodeURIComponent(trnId))
    .replace('{username}', encodeURIComponent(s.username))
    .replace('{guid}', encodeURIComponent(s.guid));
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
  const trnMatchesLink = document.getElementById('link-trn-matches') as HTMLAnchorElement;
  const statsccLink = document.getElementById('link-stats-cc') as HTMLAnchorElement;

  if (!settings.username && !settings.guid) {
    linksSection.classList.add('hidden');
    return;
  }

  linksSection.classList.remove('hidden');
  trnLink.href = buildUrl(TRACKERS.trn, settings);
  trnMatchesLink.href = buildUrl(TRACKERS.trnMatches, settings);

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

async function init(): Promise<void> {
  const settings = await sendMessage<UserSettings>({ type: 'GET_SETTINGS' });

  wireManualToggles();
  wireSelectProfile();
  wireSaveButton(settings);

  if (settings.username || settings.guid) {
    renderPopulated(settings);
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
