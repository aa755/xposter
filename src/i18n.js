(() => {
  const STORAGE_LANGUAGE = "xposter_language";
  const AUTO_LANGUAGE = "auto";
  const LANGUAGE_OPTIONS = [
    { code: AUTO_LANGUAGE, nativeName: "Automatic", htmlLang: "en" },
    { code: "en", nativeName: "English", htmlLang: "en" },
    { code: "zh", nativeName: "中文", htmlLang: "zh-CN" },
    { code: "zh-TW", nativeName: "繁體中文", htmlLang: "zh-TW" },
    { code: "ja", nativeName: "日本語", htmlLang: "ja" },
    { code: "fr", nativeName: "Français", htmlLang: "fr" },
    { code: "ru", nativeName: "Русский", htmlLang: "ru" },
    { code: "es", nativeName: "Español", htmlLang: "es" },
    { code: "de", nativeName: "Deutsch", htmlLang: "de" },
    { code: "pt", nativeName: "Português", htmlLang: "pt" },
    { code: "ko", nativeName: "한국어", htmlLang: "ko" }
  ];
  const LANGUAGE_ALIASES = new Map([
    ["zh-cn", "zh"],
    ["zh-hans", "zh"],
    ["zh-sg", "zh"],
    ["zh-tw", "zh-TW"],
    ["zh-hant", "zh-TW"],
    ["zh-hk", "zh-TW"],
    ["ja-jp", "ja"],
    ["fr-fr", "fr"],
    ["fr-ca", "fr"],
    ["ru-ru", "ru"],
    ["es-es", "es"],
    ["es-mx", "es"],
    ["de-de", "de"],
    ["pt-br", "pt"],
    ["pt-pt", "pt"],
    ["ko-kr", "ko"]
  ]);
  const SUPPORTED_LANGUAGES = new Set(LANGUAGE_OPTIONS.filter((item) => item.code !== AUTO_LANGUAGE).map((item) => item.code));
  const LANGUAGE_META = new Map(LANGUAGE_OPTIONS.map((item) => [item.code, item]));
  const messages = Object.fromEntries(Array.from(SUPPORTED_LANGUAGES, (language) => [language, {}]));
  const reverse = Object.fromEntries(Array.from(SUPPORTED_LANGUAGES, (language) => [language, new Map()]));
  const missing = new Set();
  let currentPreference = AUTO_LANGUAGE;
  let currentLanguage = preferredLanguage();

  function hasChromeStorage() {
    return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
  }

  function normalizeLanguage(language) {
    const value = String(language || "").replace("_", "-");
    const lowerValue = value.toLowerCase();
    if (lowerValue === AUTO_LANGUAGE || lowerValue === "system" || lowerValue === "browser") return preferredLanguage();
    if (LANGUAGE_ALIASES.has(lowerValue)) return LANGUAGE_ALIASES.get(lowerValue);
    const primary = lowerValue.split("-")[0];
    if (SUPPORTED_LANGUAGES.has(primary)) return primary;
    return "en";
  }

  function normalizeLanguagePreference(language) {
    const value = String(language || "").replace("_", "-");
    const lowerValue = value.toLowerCase();
    if (lowerValue === AUTO_LANGUAGE || lowerValue === "system" || lowerValue === "browser") return AUTO_LANGUAGE;
    return normalizeLanguage(value);
  }

  function resolvePreference(preference = currentPreference) {
    return preference === AUTO_LANGUAGE ? preferredLanguage() : normalizeLanguage(preference);
  }

  function preferredLanguage() {
    const candidates = [navigator.language, ...(Array.isArray(navigator.languages) ? navigator.languages : [])];
    for (const candidate of candidates) {
      const value = String(candidate || "").toLowerCase().replace("_", "-");
      const normalized = LANGUAGE_ALIASES.get(value) || value.split("-")[0];
      if (SUPPORTED_LANGUAGES.has(normalized)) return normalized;
    }
    return "en";
  }

  function rebuildReverse() {
    for (const language of Object.keys(reverse)) {
      reverse[language].clear();
    }
    for (const [language, table] of Object.entries(messages)) {
      for (const [key, value] of Object.entries(table)) {
        reverse[language].set(value, key);
      }
    }
  }

  function registerMessages(nextMessages = {}) {
    for (const [language, table] of Object.entries(nextMessages)) {
      const normalized = normalizeLanguage(language);
      if (!messages[normalized] || !table || typeof table !== "object") continue;
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
    for (const language of [currentLanguage, "en", ...SUPPORTED_LANGUAGES]) {
      const source = reverse[language]?.get(text);
      if (source) return source;
    }
    return text;
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
    document.documentElement.lang = htmlLang();
    document.body.dataset.language = currentLanguage;
    document.body.dataset.languagePreference = currentPreference;
  }

  async function setLanguage(language, { persist = true, render = true } = {}) {
    currentPreference = normalizeLanguagePreference(language);
    currentLanguage = resolvePreference(currentPreference);
    if (render) renderDom();
    if (persist && hasChromeStorage()) {
      await chrome.storage.local.set({ [STORAGE_LANGUAGE]: currentPreference }).catch(() => {});
    }
    window.dispatchEvent(new CustomEvent("xposter:i18n-language", {
      detail: { language: currentLanguage, preference: currentPreference }
    }));
    return currentLanguage;
  }

  async function restoreLanguage({ render = true } = {}) {
    if (hasChromeStorage()) {
      const stored = await chrome.storage.local.get(STORAGE_LANGUAGE).catch(() => ({}));
      if (stored[STORAGE_LANGUAGE]) {
        return setLanguage(stored[STORAGE_LANGUAGE], { persist: false, render });
      }
    }
    return setLanguage(currentPreference, { persist: false, render });
  }

  function language() {
    return currentLanguage;
  }

  function preference() {
    return currentPreference;
  }

  function htmlLang(language = currentLanguage) {
    return LANGUAGE_META.get(normalizeLanguage(language))?.htmlLang || "en";
  }

  function languageOptions() {
    return LANGUAGE_OPTIONS.map((option) => ({ ...option }));
  }

  function missingKeys() {
    return Array.from(missing).sort();
  }

  window.xPosterI18n = {
    STORAGE_LANGUAGE,
    AUTO_LANGUAGE,
    language,
    preference,
    languageOptions,
    normalizeLanguage,
    normalizeLanguagePreference,
    preferredLanguage,
    htmlLang,
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
