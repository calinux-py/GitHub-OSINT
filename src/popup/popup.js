const $ = (selector) => document.querySelector(selector);

$("#open").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: "GITSCOPE_TOGGLE" }).catch(() => {});
  window.close();
});
$("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
