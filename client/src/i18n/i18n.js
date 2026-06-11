import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import pt from './pt.json';
import en from './en.json';
import es from './es.json';
import zh from './zh.json';
import ja from './ja.json';   // 👈 novo
import hi from './hi.json';   // 👈 novo
import de from './de.json';   // 👈 novo

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      pt: { translation: pt },
      en: { translation: en },
      es: { translation: es },
      zh: { translation: zh },
      ja: { translation: ja },   // 👈 novo
      hi: { translation: hi },   // 👈 novo
      de: { translation: de },   // 👈 novo
    },
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;