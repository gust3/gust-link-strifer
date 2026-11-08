// Gust Link Strifer — background service worker
// Хранение: strikedUrls[url] = { color: "#hex", ts: number }
//           defaultColor: "#hex"
//           customColors: ["#hex", ...]

const PRESET_COLORS = {
  red:    "#e53935",
  orange: "#fb8c00",
  yellow: "#fdd835",
  green:  "#43a047",
  cyan:   "#00acc1",
  blue:   "#1e88e5",
  purple: "#8e24aa"
};
const DEFAULT_COLOR = PRESET_COLORS.red;

// ---------- Меню ----------
chrome.runtime.onInstalled.addListener(() => {
  buildMenus();
});

chrome.runtime.onStartup.addListener(() => {
  buildMenus();
});

// Пересобирать меню при изменении кастомных цветов
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.customColors) {
    buildMenus();
  }
});

function buildMenus() {
  chrome.storage.local.get(["customColors"], (data) => {
    const custom = Array.isArray(data.customColors) ? data.customColors : [];

    chrome.contextMenus.removeAll(() => {
      // 1. Зачеркнуть ссылку текущим цветом
      chrome.contextMenus.create({
        id: "strike-link",
        title: chrome.i18n.getMessage("menuStrike"),
        contexts: ["link"]
      });

      // 2. Убрать зачёркивание
      chrome.contextMenus.create({
        id: "unstrike-link",
        title: chrome.i18n.getMessage("menuUnstrike"),
        contexts: ["link"]
      });

      // 3. Установить цвет (не зачёркивает, а меняет defaultColor)
      chrome.contextMenus.create({
        id: "set-color-parent",
        title: chrome.i18n.getMessage("menuSetColor"),
        contexts: ["link", "page"]
      });

      for (const name of Object.keys(PRESET_COLORS)) {
        chrome.contextMenus.create({
          id: `set-color-${name}`,
          parentId: "set-color-parent",
          title: chrome.i18n.getMessage(
            `color${name[0].toUpperCase()}${name.slice(1)}`
          ),
          contexts: ["link", "page"]
        });
      }

      custom.forEach((hex, i) => {
        chrome.contextMenus.create({
          id: `set-custom-${i}`,
          parentId: "set-color-parent",
          title: hex,
          contexts: ["link", "page"]
        });
      });

      // 4. Очистка
      chrome.contextMenus.create({
        id: "clear-domain",
        title: chrome.i18n.getMessage("menuClearDomain"),
        contexts: ["page", "link"]
      });

      chrome.contextMenus.create({
        id: "clear-page",
        title: chrome.i18n.getMessage("menuClearPage"),
        contexts: ["page", "link"]
      });
    });
  });
}

// ---------- Клик по меню ----------
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // ---- Установить цвет (работает и по ссылке, и по странице) ----
  if (info.menuItemId.startsWith("set-color-")) {
    const name = info.menuItemId.replace("set-color-", "");
    const color = PRESET_COLORS[name] || DEFAULT_COLOR;
    await chrome.storage.local.set({ defaultColor: color });
    return;
  }

  if (info.menuItemId.startsWith("set-custom-")) {
    const idx = Number(info.menuItemId.replace("set-custom-", ""));
    const data = await chrome.storage.local.get("customColors");
    const custom = Array.isArray(data.customColors) ? data.customColors : [];
    const color = custom[idx];
    if (!color) return;
    await chrome.storage.local.set({ defaultColor: color });
    return;
  }

  if (!tab || !tab.id) return;

  if (info.menuItemId === "clear-domain") {
    const pageUrl = info.pageUrl || tab.url || "";
    const domain = safeHost(pageUrl);
    if (!domain) return;
    sendMessage(tab.id, { action: "askClearDomain", domain });
    return;
  }

  if (info.menuItemId === "clear-page") {
    const pageUrl = info.pageUrl || tab.url || "";
    sendMessage(tab.id, { action: "clearPage", pageUrl });
    return;
  }

  if (!info.linkUrl) return;
  const url = normalizeUrl(info.linkUrl);
  if (!url) return;

  if (info.menuItemId === "strike-link") {
    const color = await getDefaultColor();
    await addStrikedUrl(url, color);
    sendMessage(tab.id, { action: "strike", url, color });
  } else if (info.menuItemId === "unstrike-link") {
    await removeStrikedUrl(url);
    sendMessage(tab.id, { action: "unstrike", url });
  }
});

// ---------- Сообщения из content ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) return;

  if (msg.action === "strike" && msg.url) {
    addStrikedUrl(msg.url, msg.color || DEFAULT_COLOR).then(() =>
      sendResponse({ ok: true })
    );
    return true;
  }

  if (msg.action === "unstrike" && msg.url) {
    removeStrikedUrl(msg.url).then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});

// ---------- Утилиты ----------
function sendMessage(tabId, msg) {
  chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
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

async function getDefaultColor() {
  const data = await chrome.storage.local.get("defaultColor");
  return data.defaultColor || DEFAULT_COLOR;
}

// ---------- Хранилище ----------
async function getStriked() {
  const data = await chrome.storage.local.get("strikedUrls");
  return data.strikedUrls || {};
}

async function addStrikedUrl(url, color) {
  const all = await getStriked();
  all[url] = { color: color || DEFAULT_COLOR, ts: Date.now() };
  await chrome.storage.local.set({ strikedUrls: all });
}

async function removeStrikedUrl(url) {
  const all = await getStriked();
  delete all[url];
  await chrome.storage.local.set({ strikedUrls: all });
}