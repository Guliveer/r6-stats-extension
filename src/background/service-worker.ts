import type { Message } from '../lib/types';
import { getSettings, saveSettings } from '../lib/storage';

chrome.runtime.onMessage.addListener(
  (message: Message, _sender, sendResponse) => {
    handleMessage(message).then(sendResponse);
    return true;
  }
);

async function handleMessage(msg: Message): Promise<unknown> {
  switch (msg.type) {
    case 'GET_SETTINGS':
      return await getSettings();
    case 'SAVE_SETTINGS':
      await saveSettings(msg.payload);
      return { ok: true };
    case 'SET_AVATAR': {
      const settings = await getSettings();
      const { username, avatarUrl } = msg.payload;
      // Only save if matches configured username or GUID
      if (
        settings.username &&
        (username.toLowerCase() === settings.username.toLowerCase() ||
         username.toLowerCase() === settings.guid.toLowerCase())
      ) {
        await saveSettings({ avatarUrl });
      }
      return { ok: true };
    }
    default:
      return null;
  }
}
