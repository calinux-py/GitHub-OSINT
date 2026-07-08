(() => {
  const RESERVED = new Set([
    "about", "account", "apps", "codespaces", "collections", "customer-stories", "enterprise",
    "events", "explore", "features", "issues", "login", "logout", "marketplace", "new",
    "notifications", "organizations", "orgs", "pricing", "pulls", "readme", "search", "security",
    "settings", "site", "sponsors", "signup", "team", "topics", "trending"
  ]);
  const host = document.createElement("div");
  host.id = "gitscope-extension-root";
  host.style.cssText = "all:initial;position:fixed;inset:0 0 auto auto;z-index:2147483646;pointer-events:none";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host{color-scheme:dark}
      *{box-sizing:border-box}
      .launcher{pointer-events:auto;position:fixed;right:16px;top:50%;transform:translateY(-50%);width:44px;height:56px;border:1px solid #30363d;border-radius:12px;background:#161b22;color:#58a6ff;box-shadow:0 12px 36px rgba(0,0,0,.28);display:grid;place-items:center;cursor:pointer;transition:right .18s ease,background .18s ease,border-color .18s ease}
      .launcher:hover{background:#21262d;border-color:#8c959f}
      .launcher:focus-visible{outline:2px solid #4493f8;outline-offset:3px}
      .launcher img{width:32px;height:32px;border-radius:8px}
      .launcher .pulse{position:absolute;right:6px;top:6px;width:6px;height:6px;border-radius:50%;background:#58a6ff;box-shadow:0 0 0 3px rgba(68,147,248,.15)}
      .frame{pointer-events:auto;position:fixed;top:8px;right:8px;width:min(570px,calc(100vw - 16px));height:calc(100vh - 16px);border:0;border-radius:16px;background:#0d1117;box-shadow:0 24px 70px rgba(0,0,0,.42);opacity:0;transform:translateX(calc(100% + 24px));transition:transform .2s ease,opacity .2s ease;visibility:hidden}
      :host(.open) .frame{opacity:1;transform:translateX(0);visibility:visible}
      :host(.open) .launcher{right:min(590px,calc(100vw - 60px));opacity:0;visibility:hidden}
      .unsupported{display:none}
      @media(max-width:520px){.frame{top:0;right:0;width:100vw;height:100vh;border-radius:0}.launcher{right:10px}:host(.open) .launcher{display:none}}
      @media(prefers-reduced-motion:reduce){.frame,.launcher{transition:none}}
    </style>
    <button class="launcher" type="button" aria-label="Open GitHub OSINT investigator" title="Open GitHub OSINT (Alt+Shift+G)">
      <span class="pulse"></span>
      <img src="${chrome.runtime.getURL("assets/icon-32.png")}" alt="">
    </button>
    <iframe class="frame" title="GitHub OSINT investigator" src="${chrome.runtime.getURL("src/panel/panel.html")}" allow="clipboard-write"></iframe>
  `;
  document.documentElement.appendChild(host);

  const launcher = shadow.querySelector(".launcher");
  const frame = shadow.querySelector(".frame");
  let currentContext = null;
  let isOpen = false;
  let lastUrl = location.href;

  function contributionSummary() {
    const graph = document.querySelector(".js-yearly-contributions, [data-testid='contribution-graph']");
    if (!graph) return null;
    const text = String(graph.innerText || "");
    const totalMatch = text.match(/([\d,.]+)\s+contributions?\s+in\s+(?:the last year|\d{4})/i);
    const days = [...graph.querySelectorAll("[data-date]")].map((day) => ({
      date: day.getAttribute("data-date"),
      level: Number(day.getAttribute("data-level") || 0)
    })).filter((day) => day.date);
    const activeDays = days.filter((day) => day.level > 0);
    const levels = activeDays.reduce((counts, day) => {
      counts[day.level] = (counts[day.level] || 0) + 1;
      return counts;
    }, {});
    return {
      total: totalMatch ? Number(totalMatch[1].replaceAll(",", "")) : null,
      activeDays: activeDays.length,
      firstDate: days[0]?.date || null,
      lastDate: days.at(-1)?.date || null,
      intensityDays: levels,
      privateMarkerVisible: /private contributions?/i.test(text)
    };
  }

  function pageSignals(kind) {
    const mainText = String(document.querySelector("main")?.innerText || "").slice(0, 30_000);
    if (kind === "profile") {
      return {
        privateProfile: /(?:this )?profile is private|private profile|activity is hidden/i.test(mainText),
        contributions: contributionSummary()
      };
    }
    const visibilityLabels = [...document.querySelectorAll("header span, main span, [data-testid='repository-visibility-label']")]
      .filter((element) => element.children.length === 0)
      .map((element) => String(element.textContent || "").trim().toLowerCase());
    return {
      privateLabelVisible: visibilityLabels.includes("private") || /\bprivate repository\b/i.test(mainText),
      unavailableMessageVisible: /repository not found|page not found|is unavailable/i.test(mainText)
    };
  }

  function parseContext() {
    const segments = location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (segments[0] === "orgs" && segments[1] && segments.length <= 3) {
      return { kind: "profile", login: segments[1], url: location.href, pageData: pageSignals("profile") };
    }
    if (!segments.length || RESERVED.has(segments[0].toLowerCase())) return null;
    if (segments.length >= 2 && segments[1] && !segments[1].startsWith("@")) {
      return { kind: "repository", owner: segments[0], repo: segments[1], url: location.href, pageData: pageSignals("repository") };
    }
    const achievements = [...document.querySelectorAll('a[href*="/achievements/"]')].map((link) => {
      const image = link.querySelector("img");
      const slug = link.pathname.split("/").filter(Boolean).at(-1) || "";
      const name = (image?.alt || link.getAttribute("aria-label") || slug).replace(/^Achievement:\s*/i, "").replaceAll("-", " ").trim();
      return { name, url: link.href, image: image?.src || null };
    }).filter((item, index, all) => item.name && all.findIndex((other) => other.name === item.name) === index);
    return { kind: "profile", login: segments[0], url: location.href, pageData: { achievements, ...pageSignals("profile") } };
  }

  function notifyPanel() {
    if (!currentContext || !frame.contentWindow) return;
    frame.contentWindow.postMessage({ source: "gitscope-content", type: "CONTEXT", context: currentContext }, "*");
  }

  function setOpen(value) {
    if (!currentContext) return;
    isOpen = Boolean(value);
    host.classList.toggle("open", isOpen);
    if (isOpen) notifyPanel();
  }

  function syncContext() {
    const next = parseContext();
    const changed = JSON.stringify(next) !== JSON.stringify(currentContext);
    currentContext = next;
    launcher.classList.toggle("unsupported", !next);
    if (!next) {
      host.classList.remove("open");
      isOpen = false;
    } else if (changed) {
      notifyPanel();
    }
  }

  launcher.addEventListener("click", () => setOpen(!isOpen));
  frame.addEventListener("load", notifyPanel);
  window.addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow || event.data?.source !== "gitscope-panel") return;
    if (event.data.type === "READY") notifyPanel();
    if (event.data.type === "CLOSE") setOpen(false);
  });
  window.addEventListener("keydown", (event) => {
    if (event.altKey && event.shiftKey && event.key.toLowerCase() === "g") {
      event.preventDefault();
      setOpen(!isOpen);
    }
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "GITSCOPE_TOGGLE") setOpen(!isOpen);
  });

  const observer = new MutationObserver(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    syncContext();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", syncContext);
  document.addEventListener("turbo:load", syncContext);
  syncContext();
  chrome.storage.local.get({ autoOpen: false }).then(({ autoOpen }) => {
    if (autoOpen && currentContext) setOpen(true);
  });
})();
