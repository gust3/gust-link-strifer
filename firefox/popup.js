// Gust Link Strifer — popup logic

const PRESETS = [
  { name: "red",    hex: "#e53935" },
  { name: "orange", hex: "#fb8c00" },
  { name: "yellow", hex: "#fdd835" },
  { name: "green",  hex: "#43a047" },
  { name: "cyan",   hex: "#00acc1" },
  { name: "blue",   hex: "#1e88e5" },
  { name: "purple", hex: "#8e24aa" }
];

const DEFAULT_COLOR = PRESETS[0].hex;
const MAX_CUSTOM = 8;

const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;
const $ = (id) => document.getElementById(id);

// ---------- Хелперы ----------
function normalizeHex(v) {
  if (typeof v !== "string") return null;

  const legacyMap = {
    red: "#e53935", orange: "#fb8c00", yellow: "#fdd835",
    green: "#43a047", cyan: "#00acc1", blue: "#1e88e5", purple: "#8e24aa"
  };
  if (legacyMap[v]) return legacyMap[v];

  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    const [, r, g, b] = v;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

function isStrikeRecord(rec) {
  return rec && typeof rec === "object" && typeof rec.color === "string";
}

// ---------- Палитра ----------
async function renderPalette() {
  const data = await chrome.storage.local.get(["defaultColor", "customColors"]);
  const current = normalizeHex(data.defaultColor) || DEFAULT_COLOR;
  const custom = Array.isArray(data.customColors)
    ? data.customColors.map(normalizeHex).filter(Boolean).slice(0, MAX_CUSTOM)
    : [];

  const presetWrap = $("palette");
  presetWrap.innerHTML = "";
  for (const p of PRESETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.style.background = p.hex;
    b.title = t(`color${p.name[0].toUpperCase()}${p.name.slice(1)}`);
    if (p.hex === current) b.classList.add("active");
    b.addEventListener("click", () => setDefaultColor(p.hex));
    presetWrap.appendChild(b);
  }

  const addedWrap = $("addedColors");
  addedWrap.innerHTML = "";
  for (const hex of custom) {
    const b = document.createElement("button");
    b.type = "button";
    b.style.background = hex;
    b.title = `${hex} (${t("popupRightClickRemove")})`;
    if (hex === current) b.classList.add("active");
    b.addEventListener("click", () => setDefaultColor(hex));
    b.addEventListener("contextmenu", async (e) => {
      e.preventDefault();
      const d = await chrome.storage.local.get("customColors");
      const arr = (d.customColors || []).filter(
        (x) => normalizeHex(x) !== hex
      );
      await chrome.storage.local.set({ customColors: arr });
      renderPalette();
    });
    addedWrap.appendChild(b);
  }
}

async function setDefaultColor(hex) {
  const norm = normalizeHex(hex) || DEFAULT_COLOR;
  await chrome.storage.local.set({ defaultColor: norm });
  renderPalette();
}

// ---------- Статистика ----------
async function refreshStats(overrideText) {
  if (overrideText) {
    $("stats").textContent = overrideText;
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const data = await chrome.storage.local.get("strikedUrls");
  const all = data.strikedUrls || {};
  const total = Object.keys(all).length;

  let domain = 0;
  if (tab && tab.url) {
    try {
      const host = new URL(tab.url).host;
      for (const u of Object.keys(all)) {
        try {
          if (new URL(u).host === host) domain++;
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  $("stats").textContent = t("popupStats", [String(total), String(domain)]);
}

// ---------- Экспорт ----------
async function exportData() {
  const data = await chrome.storage.local.get([
    "strikedUrls",
    "defaultColor",
    "customColors",
    "hoverMode",
    "showCounter"
  ]);

  const payload = {
    _format: "gust-link-strifer",
    _version: 2,
    _exportedAt: new Date().toISOString(),
    ...data
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gust-link-strifer-backup-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Импорт ----------
async function importData(file) {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) throw new Error("bad");

    const next = {};
    if (parsed.strikedUrls && typeof parsed.strikedUrls === "object") {
      for (const [url, rec] of Object.entries(parsed.strikedUrls)) {
        let color = DEFAULT_COLOR;
        let ts = Date.now();

        if (typeof rec === "string") {
          color = normalizeHex(rec) || DEFAULT_COLOR;
        } else if (typeof rec === "number") {
          ts = rec;
        } else if (isStrikeRecord(rec)) {
          color = normalizeHex(rec.color) || DEFAULT_COLOR;
          ts = typeof rec.ts === "number" ? rec.ts : Date.now();
        }
        next[url] = { color, ts };
      }
    }

    const update = { strikedUrls: next };

    if (parsed.defaultColor) {
      const c = normalizeHex(parsed.defaultColor);
      if (c) update.defaultColor = c;
    }

    if (Array.isArray(parsed.customColors)) {
      update.customColors = parsed.customColors
        .map(normalizeHex)
        .filter(Boolean)
        .slice(0, MAX_CUSTOM);
    }

    if (typeof parsed.hoverMode === "boolean") update.hoverMode = parsed.hoverMode;
    if (typeof parsed.showCounter === "boolean") update.showCounter = parsed.showCounter;

    await chrome.storage.local.set(update);

    await refreshStats(t("popupImportOk", [String(Object.keys(next).length)]));
    await renderPalette();
  } catch (err) {
    console.error("[GLS] import error:", err);
    await refreshStats(t("popupImportErr"));
  }
}

// ---------- Инициализация ----------
document.addEventListener("DOMContentLoaded", async () => {
  document.title = t("popupTitle");
  $("title").textContent = t("popupTitle");
  $("colorLabel").textContent = t("popupColorLabel");
  $("hoverLabel").textContent = t("popupHoverLabel");
  $("counterLabel").textContent = t("popupShowCounter");
  $("clearPageBtn").textContent = t("popupClearPage");
  $("exportBtn").textContent = t("popupExport");
  $("importBtn").textContent = t("popupImport");
  $("customColorLabel").textContent = t("popupCustomColor");
  $("donateTitle").textContent = t("popupDonate");
  $("donateText").textContent = t("popupDonateText");
  $("donateBtnText").textContent = t("popupDonateBtn");
  $("hint").textContent = t("popupHint");

  const data = await chrome.storage.local.get([
    "hoverMode",
    "showCounter",
    "defaultColor"
  ]);

  $("hoverToggle").checked = !!data.hoverMode;
  $("counterToggle").checked = !!data.showCounter;
  $("customColor").value = normalizeHex(data.defaultColor) || DEFAULT_COLOR;

  await renderPalette();
  await refreshStats();

  // ---------- Чекбокс: hover ----------
  $("hoverToggle").addEventListener("change", async (e) => {
    const on = e.target.checked;
    await chrome.storage.local.set({ hoverMode: on });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs
        .sendMessage(tab.id, { action: "syncHover", on })
        .catch(() => {});
    }
  });

  // ---------- Чекбокс: счётчик ----------
  $("counterToggle").addEventListener("change", async (e) => {
    await chrome.storage.local.set({ showCounter: e.target.checked });
  });

  // ---------- Свой цвет ----------
  $("customColor").addEventListener("change", async (e) => {
    const hex = normalizeHex(e.target.value) || DEFAULT_COLOR;

    const d = await chrome.storage.local.get("customColors");
    let arr = Array.isArray(d.customColors)
      ? d.customColors.map(normalizeHex).filter(Boolean)
      : [];

    if (!arr.includes(hex)) {
      arr.unshift(hex);
      if (arr.length > MAX_CUSTOM) arr = arr.slice(0, MAX_CUSTOM);
      await chrome.storage.local.set({ customColors: arr });
    }

    await setDefaultColor(hex);
    $("customColor").value = hex;
  });

  // ---------- Очистить текущую страницу ----------
  $("clearPageBtn").addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    let key;
    try {
      const u = new URL(tab.url);
      u.hash = "";
      key = u.toString();
    } catch {
      return;
    }

    const d = await chrome.storage.local.get("strikedUrls");
    const all = d.strikedUrls || {};

    if (all[key]) {
      delete all[key];
      await chrome.storage.local.set({ strikedUrls: all });
      await refreshStats();
    }
  });

  // ---------- Импорт/экспорт ----------
  $("exportBtn").addEventListener("click", exportData);
  $("importBtn").addEventListener("click", () => $("importFile").click());

  $("importFile").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) {
      await importData(file);
    }
    e.target.value = "";
  });
});