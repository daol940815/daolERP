'use client'

import { useMemo, useState } from 'react'
import { REASONS, type ReasonKind } from '@/lib/payment-reasons'

// 결제 기록 취소 · 삭제 · 수정 사유 고르기 (1305, 2026-11-18)
// 글자를 치면 항목 이름 · 키워드로 걸러진 목록이 나오고, 하나를 고른다. '기타'는 직접 입력이 필수.
export interface ReasonValue { code: string; text: string }
export const reasonReady = (v: ReasonValue | null) => !!v && !!v.code && (v.code !== 'etc' || v.text.trim().length >= 2)

export default function ReasonPicker({ kind, value, onChange, label }: {
  kind: ReasonKind; value: ReasonValue | null; onChange: (v: ReasonValue | null) => void; label: string
}) {
  const [q, setQ] = useState('')
  const picked = REASONS[kind].find(r => r.code === value?.code) ?? null
  const list = useMemo(() => {
    const k = q.trim().toLowerCase()
    if (!k) return REASONS[kind]
    const hit = REASONS[kind].filter(r => r.code !== 'etc' && `${r.label} ${r.keywords ?? ''}`.toLowerCase().includes(k))
    return [...hit, ...REASONS[kind].filter(r => r.code === 'etc')]   // 맞는 항목이 없어도 '기타'는 항상 남긴다
  }, [kind, q])

  return (
    <div>
      <label className="block text-[0.6875rem] text-gray-500 mb-1">{label} <span className="text-red-600">*</span></label>
      {picked ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-2 py-1 rounded-lg bg-slate-900 text-white text-xs">{picked.label}</span>
          <button type="button" onClick={() => { onChange(null); setQ('') }} className="text-[0.6875rem] px-2 py-0.5 border border-gray-300 rounded bg-white text-gray-600 hover:bg-gray-50">다시 고르기</button>
          {picked.code === 'etc' && (
            <input value={value?.text ?? ''} onChange={e => onChange({ code: 'etc', text: e.target.value })} autoFocus placeholder="사유를 직접 입력하세요"
              className="flex-1 min-w-[12rem] border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
          )}
        </div>
      ) : (
        <div className="border border-gray-300 rounded-lg bg-white overflow-hidden max-w-md">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="글자를 치면 맞는 사유가 나옵니다"
            className="w-full px-2.5 py-1.5 text-sm border-b border-gray-200 focus:outline-none" />
          <div className="max-h-40 overflow-y-auto">
            {list.map(r => (
              <button key={r.code} type="button" onClick={() => onChange({ code: r.code, text: '' })}
                className="block w-full text-left px-2.5 py-1.5 text-xs text-gray-700 hover:bg-slate-50">{r.label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
