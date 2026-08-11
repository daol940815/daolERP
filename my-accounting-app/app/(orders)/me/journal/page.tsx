'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// 내 영업일지 — 본인 활동 기록 목록 + 작성.
// 기록은 인물(contacts) 기준(105 트랙과 동일 테이블) — 담당자가 거래처를
// 옮겨도 이력이 인물을 따라간다. 여기서는 본인(employee_id) 기록만 다룬다.

const ACTIVITY_TYPES = ['방문', '전화', '미팅', '식사', '제안', '상담', '기타'] as const

interface Row {
  id: string
  activity_date: string
  activity_type: string
  content: string
  next_action: string | null
  contact_name: string | null
  vendor_name: string | null
}

interface ContactHit {
  id: string
  name: string
  phone: string | null
  vendor_id: string | null
  vendor_name: string | null
}

export default function MyJournalPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [hint, setHint] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 작성 폼 상태
  const [open, setOpen] = useState(false)
  const [contactQ, setContactQ] = useState('')
  const [hits, setHits] = useState<ContactHit[]>([])
  const [picked, setPicked] = useState<ContactHit | null>(null)
  const [activityType, setActivityType] = useState<string>('전화')
  const [activityDate, setActivityDate] = useState('')
  const [content, setContent] = useState('')
  const [nextAction, setNextAction] = useState('')
  const [saving, setSaving] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const res = await fetch('/api/me/journal')
    const json = await res.json()
    if (!res.ok) setError(json.error ?? '조회 실패')
    else { setRows(json.rows ?? []); setHint(json.hint ?? null) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  // 인물 검색 (300ms 디바운스)
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    const q = contactQ.trim()
    if (!q || (picked && q === picked.name)) { setHits([]); return }
    searchTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/me/journal?search_contact=${encodeURIComponent(q)}`)
      if (!res.ok) return
      setHits((await res.json()).contacts ?? [])
    }, 300)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [contactQ, picked])

  const submit = async () => {
    if (!picked) { alert('인물을 검색해 선택해주세요.'); return }
    if (!content.trim()) { alert('내용을 입력해주세요.'); return }
    setSaving(true)
    const res = await fetch('/api/me/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact_id: picked.id,
        vendor_id: picked.vendor_id ?? undefined,
        activity_date: activityDate || undefined,
        activity_type: activityType,
        content,
        next_action: nextAction || undefined,
      }),
    })
    setSaving(false)
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error ?? '저장 실패'); return }
    setPicked(null); setContactQ(''); setContent(''); setNextAction(''); setActivityDate('')
    setOpen(false)
    load()
  }

  const remove = async (id: string) => {
    if (!confirm('이 기록을 삭제할까요?')) return
    const res = await fetch(`/api/me/journal?id=${id}`, { method: 'DELETE' })
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error ?? '삭제 실패'); return }
    load()
  }

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">내 영업일지</h1>
        <button onClick={() => setOpen(v => !v)}
          className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700">
          {open ? '작성 닫기' : '일지 작성'}
        </button>
        <span className="ml-auto text-xs text-gray-400">최근 100건 표시 · 본인 기록만</span>
      </div>

      {error && <div className="mt-4 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}
      {hint && <div className="mt-4 px-4 py-2.5 bg-amber-50 text-amber-800 text-sm rounded-lg">{hint}</div>}

      {/* 작성 폼 */}
      {open && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mt-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="relative">
              <label className="block text-xs text-gray-500 mb-1">인물 (거래처 담당자)</label>
              <input value={contactQ}
                onChange={e => { setContactQ(e.target.value); setPicked(null) }}
                placeholder="이름 검색"
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              {picked && (
                <p className="text-xs text-emerald-700 mt-1">
                  선택됨: {picked.name}{picked.vendor_name ? ` · ${picked.vendor_name}` : ''}
                </p>
              )}
              {hits.length > 0 && !picked && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                  {hits.map(h => (
                    <button key={h.id}
                      onClick={() => { setPicked(h); setContactQ(h.name); setHits([]) }}
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50">
                      <span className="font-medium">{h.name}</span>
                      <span className="text-xs text-gray-400 ml-1.5">
                        {[h.vendor_name, h.phone].filter(Boolean).join(' · ') || '소속 없음'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">날짜 (비우면 오늘)</label>
              <input type="date" value={activityDate} onChange={e => setActivityDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">유형</label>
              <select value={activityType} onChange={e => setActivityType(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
                {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-3">
            <label className="block text-xs text-gray-500 mb-1">내용</label>
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={3}
              placeholder="상담·방문 내용"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="mt-3 flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">다음 액션 (선택)</label>
              <input value={nextAction} onChange={e => setNextAction(e.target.value)}
                placeholder="예: 다음 주 견적서 발송"
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <button onClick={submit} disabled={saving}
              className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      )}

      {/* 목록 */}
      <div className="bg-white border border-gray-200 rounded-xl mt-4 overflow-x-auto">
        {loading ? <div className="text-center py-16 text-gray-400">로딩 중...</div> : (
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                <th className="py-2 px-3 text-left font-medium">날짜</th>
                <th className="py-2 px-3 text-left font-medium">유형</th>
                <th className="py-2 px-3 text-left font-medium">인물</th>
                <th className="py-2 px-3 text-left font-medium">거래처</th>
                <th className="py-2 px-3 text-left font-medium">내용</th>
                <th className="py-2 px-3 text-left font-medium">다음 액션</th>
                <th className="py-2 px-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-gray-50 align-top">
                  <td className="py-2 px-3 tabular-nums text-xs text-gray-500">{r.activity_date}</td>
                  <td className="py-2 px-3 text-xs">{r.activity_type}</td>
                  <td className="py-2 px-3 font-medium">{r.contact_name ?? '-'}</td>
                  <td className="py-2 px-3 text-xs text-gray-500">{r.vendor_name ?? '-'}</td>
                  <td className="py-2 px-3 text-gray-700 whitespace-pre-wrap">{r.content}</td>
                  <td className="py-2 px-3 text-xs text-gray-500">{r.next_action ?? '-'}</td>
                  <td className="py-2 px-3 text-right">
                    <button onClick={() => remove(r.id)} className="text-xs text-gray-400 hover:text-red-600">삭제</button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400 text-sm">기록이 없습니다. 일지 작성 버튼으로 시작하세요.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
