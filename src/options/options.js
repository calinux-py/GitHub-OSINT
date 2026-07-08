const $ = (selector) => document.querySelector(selector);
const defaults = { token: "", commitDepth: 100, autoOpen: false, cacheMinutes: 5, externalOsint: false };
const fields = {
  form: $("#settings-form"),
  token: $("#token"),
  commitDepth: $("#commit-depth"),
  cacheMinutes: $("#cache-minutes"),
  autoOpen: $("#auto-open"),
  externalOsint: $("#external-osint"),
  status: $("#save-status")
};

const settings = await chrome.storage.local.get(defaults);
fields.token.value = settings.token || "";
fields.commitDepth.value = String(settings.commitDepth || 100);
fields.cacheMinutes.value = String(settings.cacheMinutes || 5);
fields.autoOpen.checked = Boolean(settings.autoOpen);
fields.externalOsint.checked = Boolean(settings.externalOsint);

$("#reveal").addEventListener("click", (event) => {
  const reveal = fields.token.type === "password";
  fields.token.type = reveal ? "text" : "password";
  event.currentTarget.textContent = reveal ? "HIDE" : "SHOW";
});

function formValue() {
  return {
    token: fields.token.value.trim(),
    commitDepth: Number(fields.commitDepth.value),
    cacheMinutes: Number(fields.cacheMinutes.value),
    autoOpen: fields.autoOpen.checked,
    externalOsint: fields.externalOsint.checked
  };
}

fields.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await chrome.storage.local.set(formValue());
  fields.status.textContent = "Settings saved";
  window.setTimeout(() => { fields.status.textContent = ""; }, 1800);
});
