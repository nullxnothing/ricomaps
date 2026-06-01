/**
 * MV3 service worker. Minimal: default the enabled flag on first install.
 * (The popup owns the on/off toggle; auto-load handles the main flow.)
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['rmEnabled'], (s) => {
    if (s.rmEnabled === undefined) chrome.storage.local.set({ rmEnabled: true });
  });
});
