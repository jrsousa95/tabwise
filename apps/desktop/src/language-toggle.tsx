import { useLanguage } from "./lib/i18n";

/** Alterna PT/EN — fica no header (sessão aberta) e, com `floating`, no canto das telas de entrada. */
function LanguageToggle({ floating = false }: { floating?: boolean }) {
  const [language, setLanguage] = useLanguage();
  const next = language === "pt" ? "en" : "pt";

  return (
    <button
      type="button"
      className={`language-toggle button-secondary${floating ? " language-toggle-floating" : ""}`}
      onClick={() => setLanguage(next)}
      aria-label={language === "pt" ? "Switch to English" : "Mudar para português"}
      title={language === "pt" ? "Switch to English" : "Mudar para português"}
    >
      {language === "pt" ? "EN" : "PT"}
    </button>
  );
}

export default LanguageToggle;
