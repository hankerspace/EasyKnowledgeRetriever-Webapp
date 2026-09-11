import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { pickLanguage, translate } from '@/lib/messages'

const KEY = 'ekr.lang'
const I18nContext = createContext(null)

// `?lang=fr` (shareable link) > the user's saved choice > APP_LANGUAGE from the deployment > English.
function initialLanguage() {
  let saved = null
  try { saved = localStorage.getItem(KEY) } catch { /* storage unavailable */ }
  const fromUrl = new URLSearchParams(window.location.search).get('lang')
  return pickLanguage(fromUrl, saved, window.env?.APP_LANGUAGE)
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(initialLanguage)
  useEffect(() => { document.documentElement.lang = lang }, [lang])
  const setLang = useCallback((next) => {
    setLangState(next)
    try { localStorage.setItem(KEY, next) } catch { /* private mode */ }
  }, [])
  const value = useMemo(() => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars) }), [lang, setLang])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/** `{ lang, setLang, t }` — `t('answer.excerpts', { count: 3 })`. */
export const useI18n = () => useContext(I18nContext)
