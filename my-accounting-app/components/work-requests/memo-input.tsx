'use client'

// 업무 요청 메모 입력 (2026-11-18 사용자 결정 — 단락을 나눌 수 있게)
//  여러 줄 입력칸: Enter = 저장, Shift+Enter = 줄바꿈 (카카오톡 PC와 같은 방식). 내용이 길어지면 칸이 아래로 늘어난다.
//  한글 조합 중 Enter 는 저장하지 않는다(글자 잘림 · 두 번 저장 방지).
//  useMemoPrompt: 처리 완료 보고 결과 메모 · 반려 사유처럼 버튼을 누르면 묻는 입력 — 브라우저 기본 입력창(한 줄)을 대신한다.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export const MEMO_KEY_HINT = 'Enter 저장 · Shift+Enter 줄바꿈'
const MAX_HEIGHT_REM = 16

// Enter 로 저장해도 되는 키 입력인가 (Shift · 한글 조합 중 제외)
const isSubmitKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) =>
  e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229

export function MemoTextarea({ value, onChange, onSubmit, placeholder, disabled, autoFocus, minRows = 1, className = '' }: {
  value: string; onChange: (v: string) => void; onSubmit: () => void
  placeholder?: string; disabled?: boolean; autoFocus?: boolean; minRows?: number; className?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  // 내용에 맞춰 높이 조절 (최대 16rem, 넘치면 칸 안에서 스크롤)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const max = parseFloat(getComputedStyle(document.documentElement).fontSize || '16') * MAX_HEIGHT_REM
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`
  }, [value])
  return (
    <textarea ref={ref} value={value} rows={minRows} disabled={disabled} autoFocus={autoFocus} placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => { if (isSubmitKey(e)) { e.preventDefault(); if (value.trim()) onSubmit() } }}
      className={`w-full resize-none border border-gray-300 rounded-lg px-3 py-1.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:bg-gray-50 ${className}`} />
  )
}

interface Ask { title: string; detail?: string; required?: boolean; confirmLabel?: string; placeholder?: string; danger?: boolean }

// 버튼을 누르면 여러 줄 입력 대화상자를 띄우고 입력값(취소면 null)을 돌려준다
export function useMemoPrompt() {
  const [ask, setAsk] = useState<Ask | null>(null)
  const [text, setText] = useState('')
  const resolver = useRef<((v: string | null) => void) | null>(null)
  const open = useCallback((a: Ask) => new Promise<string | null>(res => { resolver.current = res; setText(''); setAsk(a) }), [])
  const close = useCallback((v: string | null) => { resolver.current?.(v); resolver.current = null; setAsk(null) }, [])
  const ok = () => { const v = text.trim(); if (ask?.required && !v) return; close(v) }
  useEffect(() => {
    if (!ask) return
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(null) }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [ask, close])
  const element = ask ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={() => close(null)}>
      <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl p-5" onClick={e => e.stopPropagation()}>
        <p className="text-sm font-bold text-gray-900">{ask.title}{ask.required ? <span className="text-red-500"> *</span> : <span className="text-xs text-gray-400 font-normal"> (선택)</span>}</p>
        {ask.detail && <p className="text-xs text-gray-500 mt-0.5 truncate">{ask.detail}</p>}
        <div className="mt-3">
          <MemoTextarea value={text} onChange={setText} onSubmit={ok} autoFocus minRows={4} placeholder={ask.placeholder} />
        </div>
        <div className="flex items-center gap-2 mt-3">
          <span className="text-[0.6875rem] text-gray-400">{MEMO_KEY_HINT}</span>
          <button onClick={() => close(null)} className="ml-auto px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">취소</button>
          <button onClick={ok} disabled={!!ask.required && !text.trim()}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-40 ${ask.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-900 hover:bg-slate-700'}`}>{ask.confirmLabel ?? '확인'}</button>
        </div>
      </div>
    </div>
  ) : null
  return { ask: open, element }
}
