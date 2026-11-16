'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { t, type Lang } from '@/i18n';
import type { I18nKey } from '@/i18n/en';

interface LanguageContextValue {
  lang: Lang;
  setLang: (next: Lang) => void;
  tr: (key: I18nKey, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'ko',
  setLang: () => {},
  tr: (key, vars) => t('ko', key, vars),
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('ko');

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('tenderPortalLang');
      if (saved === 'en' || saved === 'ko') {
        setLangState(saved);
        document.documentElement.lang = saved;
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  const setLang = (next: Lang) => {
    setLangState(next);
    if (typeof document !== 'undefined') {
      document.documentElement.lang = next;
    }
    try {
      window.localStorage.setItem('tenderPortalLang', next);
    } catch {
      // Ignore storage errors
    }
  };

  const tr = (key: I18nKey, vars?: Record<string, string | number>) => t(lang, key, vars);

  return (
    <LanguageContext.Provider value={{ lang, setLang, tr }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}

export function LanguageSwitcher() {
  const { lang, setLang, tr } = useLanguage();
  return (
    <select
      className="role-select"
      aria-label={tr('app.language')}
      value={lang}
      onChange={(e) => setLang(e.target.value as Lang)}
      data-testid="language-select"
    >
      <option value="ko">한국어</option>
      <option value="en">English</option>
    </select>
  );
}
