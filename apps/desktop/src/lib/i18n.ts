import { useSyncExternalStore } from "react";

/**
 * UI bilíngue PT/EN — sem lib de i18n: cada tela declara as próprias
 * mensagens com `defineMessages` (pt e en lado a lado, mesmas chaves
 * garantidas pelo tipo) e lê com `useMessages`. Mensagem com parâmetro
 * (plural, interpolação) é só uma função.
 *
 * O idioma é preferência do terminal (localStorage), não do operador —
 * vale inclusive na tela de Login, antes de existir sessão.
 */
export type Language = "pt" | "en";

const STORAGE_KEY = "tabwise:language";

function detectInitialLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "pt" || stored === "en") return stored;
  } catch {
    // localStorage indisponível — cai no idioma do sistema
  }
  return navigator.language.toLowerCase().startsWith("pt") ? "pt" : "en";
}

let currentLanguage: Language = detectInitialLanguage();
const listeners = new Set<() => void>();

function applyDocumentLanguage(language: Language) {
  document.documentElement.lang = language === "pt" ? "pt-BR" : "en";
}
applyDocumentLanguage(currentLanguage);

export function getLanguage(): Language {
  return currentLanguage;
}

export function setLanguage(language: Language) {
  if (language === currentLanguage) return;
  currentLanguage = language;
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // preferência só não persiste entre aberturas do app
  }
  applyDocumentLanguage(language);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLanguage(): [Language, (language: Language) => void] {
  const language = useSyncExternalStore(subscribe, getLanguage);
  return [language, setLanguage];
}

/** Locale do Intl pro idioma atual (datas, números). */
export function getLocale(language: Language = currentLanguage): string {
  return language === "pt" ? "pt-BR" : "en-CA";
}

type Messages = Record<string, string | ((...args: never[]) => string)>;

export function defineMessages<T extends Messages>(messages: { pt: T; en: { [K in keyof T]: T[K] } }) {
  return messages;
}

/** Mensagens da tela no idioma atual; re-renderiza o componente quando o idioma muda. */
export function useMessages<T extends Messages>(messages: { pt: T; en: { [K in keyof T]: T[K] } }): T {
  const [language] = useLanguage();
  return messages[language] as T;
}

/** Data+hora no formato do idioma atual (substitui `toLocaleString("pt-BR")`). */
export function formatDateTime(value: string | number | Date): string {
  return new Date(value).toLocaleString(getLocale());
}

/** Só a data no formato do idioma atual (substitui `toLocaleDateString("pt-BR")`). */
export function formatDate(value: string | number | Date): string {
  return new Date(value).toLocaleDateString(getLocale());
}

/** Número inteiro/decimal no formato do idioma atual. */
export function formatNumber(value: number): string {
  return value.toLocaleString(getLocale());
}
