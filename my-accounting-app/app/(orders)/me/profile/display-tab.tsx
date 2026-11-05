'use client'

// 내 정보 › 화면 설정 — 글자 크기 3단계 · 색 테마 4종 (113, 2026-11-05 사용자 결정: 개인 설정은 이 두 가지만).
// 누르는 즉시 이 화면에 적용되고 계정에 저장된다(다른 PC에서도 같게). 표시만 바뀌고 계산 · 권한 · 기간 기본값과는 무관.

import { useEffect, useState } from 'react'
import {
  DEFAULT_UI_PREFS, FONT_SCALES, FONT_SCALE_LABEL, FONT_SCALE_PERCENT, UI_THEMES, UI_THEME_LABEL, UI_THEME_SWATCH, UI_PREFS_EVENT,
  applyUiPrefs, type UiPrefs,
} from '@/lib/ui-prefs'

export default function DisplayTab() {
  const [prefs, setPrefs] = useState<UiPrefs | null>(null)
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/me/ui-prefs', { cache: 'no-store' }).then(r => r.json()).then(j => {
      setPrefs(j.prefs ?? DEFAULT_UI_PREFS)
      if (j.warning) setMsg({ t: j.warning, ok: false })
    }).catch(() => setPrefs(DEFAULT_UI_PREFS))
  }, [])

  const save = async (next: UiPrefs) => {
    setPrefs(next)
    applyUiPrefs(next)                                                    // 즉시 적용
    window.dispatchEvent(new CustomEvent(UI_PREFS_EVENT, { detail: next }))
    setBusy(true)
    const res = await fetch('/api/me/ui-prefs', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
    const j = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) setMsg({ t: j.error ?? '저장 실패', ok: false })
    else setMsg(j.warning ? { t: j.warning, ok: false } : { t: '저장했습니다. 다른 PC에서 로그인해도 같게 보입니다.', ok: true })
  }

  if (!prefs) return <div className="text-center py-20 text-gray-400">로딩 중...</div>
  const card = 'bg-white border border-gray-200 rounded-xl p-5'
  const isDefault = prefs.fontScale === DEFAULT_UI_PREFS.fontScale && prefs.theme === DEFAULT_UI_PREFS.theme

  return (
    <div className="space-y-4 max-w-3xl">
      {msg && <div className={`px-4 py-2.5 text-sm rounded-lg border ${msg.ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>{msg.t}</div>}

      <div className={card}>
        <h2 className="text-sm font-bold text-gray-900">글자 크기</h2>
        <p className="text-xs text-gray-500 mt-1">화면 전체의 글자와 간격이 함께 커지고 작아집니다.</p>
        <div className="grid grid-cols-3 gap-2 mt-3">
          {FONT_SCALES.map(f => (
            <button key={f} disabled={busy} onClick={() => save({ ...prefs, fontScale: f })}
              className={`border rounded-lg px-3 py-3 text-left transition-colors ${prefs.fontScale === f ? 'border-slate-900 ring-1 ring-slate-900 bg-slate-50' : 'border-gray-200 hover:bg-gray-50'}`}>
              <span className="block font-semibold text-gray-900">{FONT_SCALE_LABEL[f]}</span>
              <span className="block text-gray-500 mt-1" style={{ fontSize: `calc(0.875rem * ${parseFloat(FONT_SCALE_PERCENT[f]) / parseFloat(FONT_SCALE_PERCENT[prefs.fontScale])})` }}>가나다 123</span>
            </button>
          ))}
        </div>
      </div>

      <div className={card}>
        <h2 className="text-sm font-bold text-gray-900">색 테마</h2>
        <p className="text-xs text-gray-500 mt-1">사이드바 · 주요 버튼 · 선택 표시의 기본 색이 바뀝니다. 빨강(마감 지남) · 주황(오늘 마감) · 초록(완료) 같은 의미 색은 그대로입니다.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          {UI_THEMES.map(t => {
            const sw = UI_THEME_SWATCH[t]
            return (
              <button key={t} disabled={busy} onClick={() => save({ ...prefs, theme: t })}
                className={`border rounded-lg p-2 text-left transition-colors ${prefs.theme === t ? 'border-slate-900 ring-1 ring-slate-900' : 'border-gray-200 hover:bg-gray-50'}`}>
                <span className="flex h-12 rounded-md overflow-hidden border border-gray-200">
                  <span className="w-1/3" style={{ background: sw.dark }} />
                  <span className="flex-1 flex items-center justify-center" style={{ background: sw.light }}>
                    <span className="px-2 py-0.5 rounded text-white text-xs" style={{ background: sw.dark }}>버튼</span>
                  </span>
                </span>
                <span className="block text-sm font-medium text-gray-900 mt-1.5">{UI_THEME_LABEL[t]}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button disabled={busy || isDefault} onClick={() => save(DEFAULT_UI_PREFS)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">기본값으로 되돌리기</button>
        <span className="text-xs text-gray-400">브라우저 확대(Ctrl + / Ctrl −)와 함께 써도 됩니다. 확대는 PC마다, 이 설정은 계정마다 저장됩니다.</span>
      </div>
    </div>
  )
}
