const toggle = document.getElementById('toggle');

chrome.storage.local.get(['rmEnabled'], (s) => {
  toggle.checked = s.rmEnabled !== false; // default ON
});

toggle.addEventListener('change', () => {
  chrome.storage.local.set({ rmEnabled: toggle.checked });
});
