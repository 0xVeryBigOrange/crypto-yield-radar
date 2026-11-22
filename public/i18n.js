(function () {
  const KEY = "keymint.lang";

  function get() {
    return localStorage.getItem(KEY) === "en" ? "en" : "zh";
  }

  function apply(lang) {
    const next = lang === "en" ? "en" : "zh";
    localStorage.setItem(KEY, next);
    document.documentElement.lang = next === "en" ? "en" : "zh-CN";
    document.querySelectorAll("[data-en]").forEach((el) => {
      if (el.tagName === "META") {
        if (!el.dataset.zh) el.dataset.zh = el.getAttribute("content") || "";
        el.setAttribute("content", next === "en" ? el.dataset.en : el.dataset.zh);
        return;
      }
      if (!el.dataset.zh) el.dataset.zh = el.textContent;
      el.textContent = next === "en" ? el.dataset.en : el.dataset.zh;
    });
    document.querySelectorAll("[data-en-placeholder]").forEach((el) => {
      if (!el.dataset.zhPlaceholder) el.dataset.zhPlaceholder = el.getAttribute("placeholder") || "";
      el.setAttribute("placeholder", next === "en" ? el.dataset.enPlaceholder : el.dataset.zhPlaceholder);
    });
    document.querySelectorAll(".lang-btn").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.dataset.lang === next ? "true" : "false");
    });
    document.dispatchEvent(new CustomEvent("keymint:lang", { detail: next }));
  }

  window.KeymintI18n = { get, apply };

  function boot() {
    apply(get());
    document.querySelectorAll(".lang-btn").forEach((btn) => {
      btn.addEventListener("click", () => apply(btn.dataset.lang));
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
