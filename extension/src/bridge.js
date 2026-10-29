// Runs a function inside an open claude.ai tab (page context), so requests carry
// claude.ai's own sign-in and origin. `func` must be self-contained and should
// return { __error } instead of throwing.

const CLAUDE_TABS = 'https://claude.ai/*';

function waitComplete(tabId) {
  return new Promise(resolve => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') done();
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(t => {
      if (t.status === 'complete') done();
    });
  });
}

async function claudeTab() {
  const tabs = await chrome.tabs.query({ url: CLAUDE_TABS });
  const tab = tabs.find(t => t.status === 'complete') || tabs[0];
  if (tab) {
    if (tab.status !== 'complete') await waitComplete(tab.id);
    return tab.id;
  }
  const created = await chrome.tabs.create({ url: 'https://claude.ai/recents', active: false });
  await waitComplete(created.id);
  return created.id;
}

export async function runInClaude(func, args = []) {
  const tabId = await claudeTab();
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args });
  if (!res) throw new Error('No response from the claude.ai tab');
  const r = res.result;
  if (r && r.__error) throw Object.assign(new Error(r.__error), { status: r.__status, retryAfter: r.__retryAfter });
  return r;
}
