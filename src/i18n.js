(() => {
  const STORAGE_LANGUAGE = "xposter_language";
  const SUPPORTED_LANGUAGES = new Set(["en", "zh"]);
  const messages = { en: {}, zh: {} };
  const reverse = { en: new Map(), zh: new Map() };
  const missing = new Set();
  let currentLanguage = preferredLanguage();

  function hasChromeStorage() {
    return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
  }

  function normalizeLanguage(language) {
    const value = String(language || "").toLowerCase().replace("_", "-");
    if (value.startsWith("zh")) return "zh";
    if (value.startsWith("en")) return "en";
    return "en";
  }

  function preferredLanguage() {
    return normalizeLanguage(navigator.language || "en");
  }

  function rebuildReverse() {
    for (const language of Object.keys(reverse)) {
      reverse[language].clear();
    }
    for (const [key, value] of Object.entries(messages.en)) {
      reverse.en.set(value, key);
    }
    for (const [key, value] of Object.entries(messages.zh)) {
      reverse.zh.set(value, key);
    }
  }

  function registerMessages(nextMessages = {}) {
    for (const [language, table] of Object.entries(nextMessages)) {
      const normalized = normalizeLanguage(language);
      if (!SUPPORTED_LANGUAGES.has(normalized) || !table || typeof table !== "object") continue;
      Object.assign(messages[normalized], table);
    }
    rebuildReverse();
  }

  function registerLegacyMap(language, map) {
    if (!(map instanceof Map)) return;
    registerMessages({ [language]: Object.fromEntries(map.entries()) });
  }

  function sourceKey(value) {
    const text = String(value ?? "");
    return reverse.en.get(text) || reverse.zh.get(text) || text;
  }

  function interpolate(template, values = {}) {
    return String(template ?? "").replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
  }

  function t(key, values = {}) {
    const normalizedKey = sourceKey(key);
    const table = messages[currentLanguage] || messages.en;
    const source = table[normalizedKey] ?? messages.en[normalizedKey];
    if (source == null) {
      if (currentLanguage !== "en") missing.add(normalizedKey);
      return interpolate(normalizedKey, values);
    }
    return interpolate(source, values);
  }

  function setText(element, key, values = {}) {
    if (element) element.textContent = t(key, values);
  }

  function setAttr(element, attr, key, values = {}) {
    if (element) element.setAttribute(attr, t(key, values));
  }

  function renderDom(root = document.body) {
    root.querySelectorAll("[data-i18n]").forEach((element) => {
      setText(element, element.dataset.i18n);
    });
    root.querySelectorAll("[data-i18n-title]").forEach((element) => {
      setAttr(element, "title", element.dataset.i18nTitle);
    });
    root.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
      setAttr(element, "aria-label", element.dataset.i18nAriaLabel);
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
      setAttr(element, "placeholder", element.dataset.i18nPlaceholder);
    });
    root.querySelectorAll("[data-i18n-value]").forEach((element) => {
      element.value = t(element.dataset.i18nValue);
    });
    document.documentElement.lang = currentLanguage === "zh" ? "zh-CN" : "en";
    document.body.dataset.language = currentLanguage;
  }

  async function setLanguage(language, { persist = true, render = true } = {}) {
    currentLanguage = normalizeLanguage(language);
    if (render) renderDom();
    if (persist && hasChromeStorage()) {
      await chrome.storage.local.set({ [STORAGE_LANGUAGE]: currentLanguage }).catch(() => {});
    }
    window.dispatchEvent(new CustomEvent("xposter:i18n-language", { detail: { language: currentLanguage } }));
    return currentLanguage;
  }

  async function restoreLanguage({ render = true } = {}) {
    if (hasChromeStorage()) {
      const stored = await chrome.storage.local.get(STORAGE_LANGUAGE).catch(() => ({}));
      if (stored[STORAGE_LANGUAGE]) {
        return setLanguage(stored[STORAGE_LANGUAGE], { persist: false, render });
      }
    }
    return setLanguage(currentLanguage, { persist: false, render });
  }

  function language() {
    return currentLanguage;
  }

  function missingKeys() {
    return Array.from(missing).sort();
  }

  window.xPosterI18n = {
    STORAGE_LANGUAGE,
    language,
    normalizeLanguage,
    preferredLanguage,
    registerMessages,
    registerLegacyMap,
    restoreLanguage,
    setLanguage,
    renderDom,
    setText,
    setAttr,
    sourceKey,
    t,
    missingKeys
  };
})();
