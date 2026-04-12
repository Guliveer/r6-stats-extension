import type { UserSettings, Message } from '../lib/types';

function sendMessage<T>(msg: Message): Promise<T> {
  return chrome.runtime.sendMessage(msg);
}

const TRACKERS = {
  trn: 'https://r6.tracker.network/r6siege/profile/{platform}/{id}/overview',
  trnMatches: 'https://r6.tracker.network/r6siege/profile/{platform}/{id}/matches',
  statscc: 'https://stats.cc/siege/{username}/{guid}',
};

function buildUrl(template: string, s: UserSettings): string {
  // tracker.network can use either username or GUID
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
    // Show first letter of username
    placeholder.textContent = settings.username ? settings.username.charAt(0).toUpperCase() : '?';
  }
}

function updateLinks(settings: UserSettings): void {
  const linksSection = document.getElementById('links-section')!;
  const noUsername = document.getElementById('no-username')!;
  const guidNote = document.getElementById('guid-note')!;

  const hasId = settings.username || settings.guid;
  if (!hasId) {
    linksSection.classList.add('hidden');
    noUsername.classList.remove('hidden');
    return;
  }

  linksSection.classList.remove('hidden');
  noUsername.classList.add('hidden');

  // Tracker.network links (work with username OR guid)
  const trnLink = document.getElementById('link-trn') as HTMLAnchorElement;
  const trnMatchesLink = document.getElementById('link-trn-matches') as HTMLAnchorElement;

  if (settings.username || settings.guid) {
    trnLink.href = buildUrl(TRACKERS.trn, settings);
    trnLink.style.display = '';
    trnMatchesLink.href = buildUrl(TRACKERS.trnMatches, settings);
    trnMatchesLink.style.display = '';
  } else {
    trnLink.style.display = 'none';
    trnMatchesLink.style.display = 'none';
  }

  // Stats.cc (requires both username AND guid)
  const statsccLink = document.getElementById('link-stats-cc') as HTMLAnchorElement;
  if (settings.username && settings.guid) {
    statsccLink.href = buildUrl(TRACKERS.statscc, settings);
    statsccLink.style.display = '';
    guidNote.classList.add('hidden');
  } else {
    statsccLink.style.display = 'none';
    // Show note about GUID requirement
    guidNote.classList.remove('hidden');
  }
}

async function init(): Promise<void> {
  const settings = await sendMessage<UserSettings>({ type: 'GET_SETTINGS' });

  const usernameInput = document.getElementById('username') as HTMLInputElement;
  const platformSelect = document.getElementById('platform') as HTMLSelectElement;
  const guidInput = document.getElementById('guid') as HTMLInputElement;

  usernameInput.value = settings.username;
  platformSelect.value = settings.platform;
  guidInput.value = settings.guid;

  updateAvatar(settings);
  updateLinks(settings);

  document.getElementById('btn-save')!.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    const platform = platformSelect.value as 'ubi' | 'psn' | 'xbl';
    const guid = guidInput.value.trim();

    const newSettings = { ...settings, username, platform, guid };
    await sendMessage({ type: 'SAVE_SETTINGS', payload: { username, platform, guid } });

    updateAvatar(newSettings);
    updateLinks(newSettings);

    const status = document.getElementById('save-status')!;
    status.classList.remove('hidden');
    setTimeout(() => status.classList.add('hidden'), 2000);
  });
}

init();
