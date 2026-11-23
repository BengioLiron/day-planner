import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./en";
import { he } from "./he";
import type { Language } from "../data/db";

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, he: { translation: he } },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** Switch language and text direction together. */
export function applyLanguage(lang: Language) {
  if (i18n.language !== lang) void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
}

export default i18n;
