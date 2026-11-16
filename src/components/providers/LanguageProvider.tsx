'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { errorMessage, t, tv, type Lang } from '@/i18n';
import type { I18nKey } from '@/i18n/en';
import { ApiClientError } from '@/lib/client/api';
import { firebaseAuthErrorKey } from '@/lib/client/authErrors';

interface LanguageContextValue {
  lang: Lang;
  setLang: (next: Lang) => void;
  tr: (key: I18nKey, vars?: Record<string, string | number>) => string;
  /** Translate a stored value such as an NDA status; unknown values are shown as-is. */
  trv: (prefix: string, value: string | null | undefined) => string;
  /** User-facing message for any thrown error (API error codes are localized). */
  trError: (error: unknown) => string;
}

function buildHelpers(lang: Lang) {
  const tr = (key: I18nKey, vars?: Record<string, string | number>) => t(lang, key, vars);
  const trv = (prefix: string, value: string | null | undefined) => tv(lang, prefix, value);
  const trError = (error: unknown) => {
    if (error instanceof ApiClientError) return errorMessage(lang, error.code, error.message);
    const authKey = firebaseAuthErrorKey(error);
    if (authKey) return t(lang, authKey);
    if (error instanceof Error && error.message) return error.message;
    return t(lang, 'auth.err.generic');
  };
  return { tr, trv, trError };
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'ko',
  setLang: () => {},
  ...buildHelpers('ko'),
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

  const helpers = useMemo(() => buildHelpers(lang), [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, ...helpers }}>
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
