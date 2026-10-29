// Toolbar click opens the organizer tab, or focuses it if it's already open.
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('organizer.html');
  const [existing] = await chrome.tabs.query({ url: `${url}*` });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
});
