// Gust Link Strifer — content script

const DEFAULT_COLOR = "#e53935";
const PRESETS = [
  "#e53935", "#fb8c00", "#fdd835", "#43a047",
  "#00acc1", "#1e88e5", "#8e24aa"
];
const HIDE_DELAY_MS = 400;

let strikedUrls = {};
let hoverMode = false;
let showCounter = false;
let defaultColor = DEFAULT_COLOR;
let customColors = [];

// ---------- Утилиты ----------
function normalizeUrl(url, base) {
  try {
    const u = new URL(url, base || location.href);
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

// ---------- Стиль ----------
function applyStrikeToLink(link, strike, color) {
  if (strike) {
    link.classList.add("link-striked");
    link.dataset.striked = "1";
    link.dataset.strikeColor = color || DEFAULT_COLOR;
    link.style.setProperty("--gls-strike-color", color || DEFAULT_COLOR);
  } else {
    link.classList.remove("link-striked");
    delete link.dataset.striked;
    delete link.dataset.strikeColor;
    link.style.removeProperty("--gls-strike-color");
  }
}

function processAllLinks() {
  document.querySelectorAll("a[href]").forEach((link) => {
    const norm = normalizeUrl(link.href);
    if (!norm) return;
    const rec = strikedUrls[norm];
    if (rec) applyStrikeToLink(link, true, rec.color);
    else if (link.dataset.striked) applyStrikeToLink(link, false);
  });
  if (hoverMode) installHoverListeners();
  installAltClick();
  updateCounter();
}

// ---------- Общие действия ----------
function strikeUrl(url, color) {
  strikedUrls[url] = { color: color || defaultColor, ts: Date.now() };
  chrome.storage.local.set({ strikedUrls });
  sendToBackground({ action: "strike", url, color: color || defaultColor });
  processAllLinks();
}

function unstrikeUrl(url) {
  delete strikedUrls[url];
  chrome.storage.local.set({ strikedUrls });
  sendToBackground({ action: "unstrike", url });
  processAllLinks();
}

// ---------- Hover-оверлей (✕ / ↺) ----------
let hoverEl = null;
let hoverTarget = null;
let hideTimer = null;

function ensureHoverEl() {
  if (hoverEl) return hoverEl;
  hoverEl = document.createElement("div");
  hoverEl.className = "gls-hover-wrap";
  hoverEl.innerHTML = `
    <button class="gls-hover-btn gls-hover-strike" title="Strike">✕</button>
    <button class="gls-hover-btn gls-hover-unstrike" title="Unstrike">↺</button>
  `;
  hoverEl.addEventListener("mouseenter", () => {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  });
  hoverEl.addEventListener("mouseleave", () => {
    scheduleHide();
  });
  hoverEl.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  hoverEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || !hoverTarget) return;
    e.preventDefault();
    e.stopPropagation();
    const url = normalizeUrl(hoverTarget.href);
    if (!url) return;
    if (btn.classList.contains("gls-hover-strike")) {
      strikeUrl(url, defaultColor);
    } else {
      unstrikeUrl(url);
    }
    hideHoverNow();
  });
  document.documentElement.appendChild(hoverEl);
  return hoverEl;
}

function showHoverEl(link) {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  const el = ensureHoverEl();
  hoverTarget = link;

  const rec = strikedUrls[normalizeUrl(link.href)];
  el.querySelector(".gls-hover-strike").style.display = rec ? "none" : "";
  el.querySelector(".gls-hover-unstrike").style.display = rec ? "" : "none";

  const r = link.getBoundingClientRect();
  const top = window.scrollY + r.top + r.height / 2;
  const left = window.scrollX + r.right + 4;
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  el.style.display = "flex";
  void el.offsetWidth;
  el.classList.add("gls-visible");
}

function scheduleHide() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hideHoverNow();
  }, HIDE_DELAY_MS);
}

function hideHoverNow() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (hoverEl) {
    hoverEl.classList.remove("gls-visible");
    setTimeout(() => {
      if (hoverEl && !hoverEl.classList.contains("gls-visible")) {
        hoverEl.style.display = "none";
      }
    }, 160);
  }
  hoverTarget = null;
}

const hoverLinks = new WeakSet();
function installHoverListeners() {
  document.querySelectorAll("a[href]").forEach((link) => {
    if (hoverLinks.has(link)) return;
    hoverLinks.add(link);
    link.addEventListener("mouseenter", () => {
      if (!hoverMode) return;
      showHoverEl(link);
    });
    link.addEventListener("mouseleave", (e) => {
      if (!hoverMode) return;
      const to = e.relatedTarget;
      if (hoverEl && to && hoverEl.contains(to)) return;
      scheduleHide();
    });
  });
}

// ---------- Мини-палитра (Alt+Shift+Click) ----------
let paletteEl = null;
let paletteTarget = null;

function ensurePaletteEl() {
  if (paletteEl) return paletteEl;
  paletteEl = document.createElement("div");
  paletteEl.className = "gls-palette-wrap";
  paletteEl.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  paletteEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-color]");
    if (!btn || !paletteTarget) return;
    e.preventDefault();
    e.stopPropagation();
    const url = normalizeUrl(paletteTarget.href);
    if (!url) return;
    strikeUrl(url, btn.dataset.color);
    hidePalette();
  });
  document.documentElement.appendChild(paletteEl);
  return paletteEl;
}

function showPalette(link) {
  const el = ensurePaletteEl();
  paletteTarget = link;

  const colors = [...PRESETS, ...customColors.filter((c) => !PRESETS.includes(c))];
  el.innerHTML = "";
  for (const hex of colors) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.color = hex;
    b.style.background = hex;
    b.title = hex;
    el.appendChild(b);
  }

  const r = link.getBoundingClientRect();
  const top = window.scrollY + r.top + r.height / 2;
  const left = window.scrollX + r.right + 4;
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  el.style.display = "flex";
  void el.offsetWidth;
  el.classList.add("gls-visible");
}

function hidePalette() {
  if (paletteEl) {
    paletteEl.classList.remove("gls-visible");
    setTimeout(() => {
      if (paletteEl && !paletteEl.classList.contains("gls-visible")) {
        paletteEl.style.display = "none";
      }
    }, 160);
  }
  paletteTarget = null;
}

document.addEventListener("mousedown", (e) => {
  if (paletteEl && paletteEl.classList.contains("gls-visible")) {
    if (!paletteEl.contains(e.target)) hidePalette();
  }
}, true);

// ---------- Alt+Click / Alt+Shift+Click ----------
const altClickLinks = new WeakSet();
function installAltClick() {
  document.querySelectorAll("a[href]").forEach((link) => {
    if (altClickLinks.has(link)) return;
    altClickLinks.add(link);
    link.addEventListener(
      "click",
      (e) => {
        if (!e.altKey) return;
        const url = normalizeUrl(link.href);
        if (!url) return;
        e.preventDefault();
        e.stopPropagation();

        if (e.shiftKey) {
          showPalette(link);
          return;
        }

        if (strikedUrls[url]) unstrikeUrl(url);
        else strikeUrl(url, defaultColor);
      },
      true
    );
  });
}

// ---------- Виджет-счётчик (перетаскиваемый) ----------
let counterEl = null;
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

function ensureCounterEl() {
  if (counterEl) return counterEl;
  counterEl = document.createElement("div");
  counterEl.className = "gls-counter";

  const closeBtn = document.createElement("button");
  closeBtn.className = "gls-counter-close";
  closeBtn.title = chrome.i18n.getMessage("counterClose");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    chrome.storage.local.set({ showCounter: false });
  });

  const domainSpan = document.createElement("span");
  domainSpan.className = "gls-counter-domain";

  const sep = document.createElement("span");
  sep.className = "gls-counter-sep";
  sep.textContent = " / ";

  const totalSpan = document.createElement("span");
  totalSpan.className = "gls-counter-total";

  counterEl.append(closeBtn, domainSpan, sep, totalSpan);
  
  // --- Логика перетаскивания ---
  counterEl.addEventListener("mousedown", (e) => {
    if (e.target.closest(".gls-counter-close")) return;
    e.preventDefault();
    isDragging = true;
    counterEl.classList.add("gls-dragging");

    const rect = counterEl.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    let newX = e.clientX - dragOffsetX;
    let newY = e.clientY - dragOffsetY;

    newX = Math.max(0, Math.min(newX, window.innerWidth - counterEl.offsetWidth));
    newY = Math.max(0, Math.min(newY, window.innerHeight - counterEl.offsetHeight));

    counterEl.style.left = `${newX}px`;
    counterEl.style.top = `${newY}px`;
    counterEl.style.right = "auto";
    counterEl.style.bottom = "auto";
  });

  document.addEventListener("mouseup", () => {
    if (!isDragging) return;
    isDragging = false;
    counterEl.classList.remove("gls-dragging");

    const rect = counterEl.getBoundingClientRect();
    chrome.storage.local.set({
      counterPos: { left: rect.left, top: rect.top }
    });
  });
  // ---------------------------------

  document.documentElement.appendChild(counterEl);
  return counterEl;
}

let lastCounterState = { show: null, page: null, total: null };

async function updateCounter() {
  if (!showCounter) {
    if (counterEl) counterEl.style.display = "none";
    lastCounterState = { show: false, page: null, total: null };
    return;
  }

  const el = ensureCounterEl();

  if (!el.dataset.posInitialized) {
    const data = await chrome.storage.local.get("counterPos");
    if (data.counterPos) {
      el.style.left = `${data.counterPos.left}px`;
      el.style.top = `${data.counterPos.top}px`;
      el.style.right = "auto";
      el.style.bottom = "auto";
    }
    el.dataset.posInitialized = "1";
  }

  // 1. Считаем ссылки на ТЕКУЩЕЙ странице
  const urlsOnPage = new Set();
  document.querySelectorAll("a[href]").forEach((link) => {
    const norm = normalizeUrl(link.href);
    if (norm && strikedUrls[norm]) {
      urlsOnPage.add(norm);
    }
  });
  const pageCount = urlsOnPage.size;

  // 2. Считаем ВСЕГО зачеркнутых в базе
  const totalCount = Object.keys(strikedUrls).length;

  // Обновляем DOM только при изменениях
  if (
    lastCounterState.show !== true ||
    lastCounterState.page !== pageCount ||
    lastCounterState.total !== totalCount
  ) {
    el.style.display = "flex";

    // Используем ключи counterDomain и counterTotal, 
    // но теперь counterDomain означает "на странице"
    const pageText = chrome.i18n.getMessage("counterPage", String(pageCount)) || `страница: ${pageCount}`;
    const totalText = chrome.i18n.getMessage("counterTotal", String(totalCount)) || `всего: ${totalCount}`;

    el.querySelector(".gls-counter-domain").textContent = pageText;
    el.querySelector(".gls-counter-total").textContent = totalText;

    lastCounterState = { show: true, page: pageCount, total: totalCount };
  }
}

function setShowCounter(on) {
  showCounter = !!on;
  updateCounter();
}

// ---------- Очистка страницы ----------
async function clearPage(pageUrl) {
  const pageKey = normalizeUrl(pageUrl);
  const urlsOnPage = new Set();

  document.querySelectorAll("a[href]").forEach((link) => {
    const norm = normalizeUrl(link.href);
    if (norm) urlsOnPage.add(norm);
  });

  let removed = 0;
  for (const key of Object.keys(strikedUrls)) {
    if (urlsOnPage.has(key)) {
      delete strikedUrls[key];
      removed++;
    }
  }

  if (removed === 0 && pageKey && strikedUrls[pageKey]) {
    delete strikedUrls[pageKey];
    removed++;
  }

  await chrome.storage.local.set({ strikedUrls });
  processAllLinks();
  return removed;
}

// ---------- Очистка домена ----------
async function askClearDomain(domain) {
  const toRemove = Object.keys(strikedUrls).filter((u) => safeHost(u) === domain);
  if (toRemove.length === 0) return 0;

  const title = chrome.i18n.getMessage("confirmClearDomainTitle");
  const body = chrome.i18n.getMessage("confirmClearDomainBody", {
    domain,
    count: String(toRemove.length)
  });
  if (!window.confirm(`${title}\n\n${body}`)) return -1;

  for (const u of toRemove) delete strikedUrls[u];
  await chrome.storage.local.set({ strikedUrls });
  processAllLinks();
  return toRemove.length;
}

// ---------- Сообщения ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.action === "strike" && msg.url) {
    strikedUrls[msg.url] = { color: msg.color || defaultColor, ts: Date.now() };
    processAllLinks();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.action === "unstrike" && msg.url) {
    delete strikedUrls[msg.url];
    processAllLinks();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.action === "clearPage") {
    clearPage(msg.pageUrl).then((count) => sendResponse({ count }));
    return true;
  }
  if (msg.action === "askClearDomain") {
    askClearDomain(msg.domain).then((count) => sendResponse({ count }));
    return true;
  }
  if (msg.action === "syncHover") {
    hoverMode = !!msg.on;
    if (hoverMode) installHoverListeners();
    else hideHoverNow();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

// ---------- Синхронизация ----------
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.strikedUrls) {
    strikedUrls = changes.strikedUrls.newValue || {};
    processAllLinks();
  }
  if (changes.hoverMode) {
    hoverMode = !!changes.hoverMode.newValue;
    if (hoverMode) installHoverListeners();
    else hideHoverNow();
  }
  if (changes.defaultColor) {
    defaultColor = changes.defaultColor.newValue || DEFAULT_COLOR;
  }
  if (changes.customColors) {
    customColors = Array.isArray(changes.customColors.newValue)
      ? changes.customColors.newValue
      : [];
  }
  if (changes.showCounter) {
    setShowCounter(!!changes.showCounter.newValue);
  }
});

// ---------- Вспомогательное ----------
function sendToBackground(msg) {
  try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch {}
}

// ---------- Init ----------
async function init() {
  const data = await chrome.storage.local.get([
    "strikedUrls", "hoverMode", "defaultColor", "showCounter", "customColors"
  ]);
  strikedUrls = data.strikedUrls || {};
  hoverMode = !!data.hoverMode;
  defaultColor = data.defaultColor || DEFAULT_COLOR;
  showCounter = !!data.showCounter;
  customColors = Array.isArray(data.customColors) ? data.customColors : [];

  processAllLinks();

  const observer = new MutationObserver(() => {
    processAllLinks();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

init();