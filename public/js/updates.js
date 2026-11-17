// updates.js - notice when a new version of the app has been installed while this page is still running the old one.
// An installed phone app is resumed rather than reloaded, so it can go on running old scripts for days. The service
// worker swaps in the new files by itself; this only tells the person (and, after a long absence, reloads).

import { buildFrom } from './reporter.js';

// Away this long, a reload costs nothing (the address and all saved data survive it), so it happens on its own
export const AUTO_RELOAD_AFTER_MS = 5 * 60 * 1000;

export function shouldAutoReload({ ready, hiddenMs }) {
  return Boolean(ready) && hiddenMs >= AUTO_RELOAD_AFTER_MS;
}

// The build this page has already moved to is remembered, so the notice appears once per genuinely newer build. Without
// that, a browser that announces the same version again after a reload would bring the notice straight back.
const SEEN_KEY = 'spindex_build_seen';

export function shouldShowUpdate(build, storage = globalThis.localStorage) {
  try {
    return !build || build === 'unknown' ? true : storage.getItem(SEEN_KEY) !== build;
  } catch {
    return true;
  }
}

export function markBuildSeen(build, storage = globalThis.localStorage) {
  try {
    if (build && build !== 'unknown') storage.setItem(SEEN_KEY, build);
  } catch {
    // Private mode: the notice may come back once, which is all
  }
}

// The newest build the service worker has installed, such as "v56"
export async function currentBuild() {
  try {
    return buildFrom(await caches.keys());
  } catch {
    return 'unknown';
  }
}

// container: navigator.serviceWorker. onReady runs once, when a newer version has taken over from the one this page loaded with.
export function watchForUpdates({ container, onReady }) {
  if (!container) return null;
  let hadController = Boolean(container.controller); // the very first install also fires "controllerchange": that is not an update
  let ready = false;

  container.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    if (ready) return;
    ready = true;
    onReady();
  });

  return {
    isReady: () => ready,
    // Browsers only look for a new version when a page is opened, not when an app is brought back to the front
    async check() {
      try {
        const registration = await container.getRegistration();
        await registration?.update();
      } catch {
        // offline, or the server is down: try again next time
      }
    },
  };
}
