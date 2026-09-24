// updates.js - notice when a new version of the app has been installed while this page is still running the old one.
// An installed phone app is resumed rather than reloaded, so it can go on running old scripts for days. The service
// worker swaps in the new files by itself; this only tells the person (and, after a long absence, reloads).

// Away this long, a reload costs nothing (the address and all saved data survive it), so it happens on its own
export const AUTO_RELOAD_AFTER_MS = 5 * 60 * 1000;

export function shouldAutoReload({ ready, hiddenMs }) {
  return Boolean(ready) && hiddenMs >= AUTO_RELOAD_AFTER_MS;
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
