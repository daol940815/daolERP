'use client'

// 계정의 화면 설정(employees.ui_prefs)을 이 브라우저에 맞춘다 — 새 PC에서 처음 로그인했거나 다른 PC에서 바꿨을 때.
// 루트 레이아웃은 쿠키 사본으로 먼저 그리고, 여기서 계정 값과 다르면 즉시 적용 + 쿠키 갱신. 설정 화면에서 바꾸면 UI_PREFS_EVENT 로 반영.
import { useEffect } from 'react'
import { applyUiPrefs, decodeUiPrefs, encodeUiPrefs, normalizeUiPrefs, UI_PREFS_COOKIE, UI_PREFS_EVENT, type UiPrefs } from '@/lib/ui-prefs'

export default function UiPrefsSync({ prefs }: { prefs: UiPrefs | null }) {
  useEffect(() => {
    if (!prefs) return   // 113 미적용 · 직원 미연결 — 쿠키 값 그대로
    const cookie = document.cookie.split('; ').find(c => c.startsWith(`${UI_PREFS_COOKIE}=`))?.split('=')[1]
    if (encodeUiPrefs(decodeUiPrefs(cookie)) !== encodeUiPrefs(prefs)) applyUiPrefs(prefs)
  }, [prefs])
  useEffect(() => {
    const on = (e: Event) => applyUiPrefs(normalizeUiPrefs((e as CustomEvent).detail))
    window.addEventListener(UI_PREFS_EVENT, on)
    return () => window.removeEventListener(UI_PREFS_EVENT, on)
  }, [])
  return null
}
