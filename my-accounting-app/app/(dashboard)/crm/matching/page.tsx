'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { CrmContactRow, CrmUnmatchedKey } from '@/types/crm'

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

// 미귀속 주문 키를 기존 고객에 연결하거나 신규 고객으로 생성한다.
// 한 번 연결하면 키가 학습되어 이후 업로드부터 자동 귀속 (erp-aliases와 같은 패턴).
export default function CrmMatchingPage() {
  const [rows, setRows] = useState<CrmUnmatchedKey[]>([])
  const [contacts, setContacts] = useState<CrmContactRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [pick, setPick] = useState<Record<string, string>>({})   // 키 → 선택한 고객 검색어

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 5000) }

  const load = useCallback(async () => {
    setLoading(true)
    const [mres, cres] = await Promise.all([fetch('/api/crm/matching'), fetch('/api/crm/contacts')])
    const mjson = await mres.json()
    const cjson = await cres.json()
    if (Array.isArray(mjson.data)) setRows(mjson.data)
    else showMsg(`조회 실패: ${mjson.error ?? '알 수 없는 오류'}`)
    if (Array.isArray(cjson.data)) setContacts(cjson.data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const keyOf = (r: CrmUnmatchedKey) => `${r.bank_name}|${r.branch_name}|${r.manager_name}`

  // 검색어 → 고객 후보 (거래처+이름 부분 일치, 상위 8)
  const candidates = (q: string) => {
    const s = q.trim()
    if (!s) return []
    return contacts
      .filter(c => `${c.bank_name} ${c.branch_name ?? ''} ${c.name}`.includes(s))
      .slice(0, 8)
  }

  const link = async (r: CrmUnmatchedKey, contactId: string) => {
    setBusy(keyOf(r))
    const res = await fetch('/api/crm/matching', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bank_name: r.bank_name, branch_name: r.branch_name, manager_name: r.manager_name, contact_id: contactId }),
    })
    const json = await res.json()
    setBusy(null)
    if (json.error) showMsg(`연결 실패: ${json.error}`)
    else { showMsg(`연결 완료 — 주문 ${json.matched?.set ?? 0}건 귀속`); load() }
  }

  const createNew = async (r: CrmUnmatchedKey) => {
    setBusy(keyOf(r))
    const res = await fetch('/api/crm/matching', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bank_name: r.bank_name, branch_name: r.branch_name, manager_name: r.manager_name, create: true, name: r.manager_name }),
    })
    const json = await res.json()
    setBusy(null)
    if (json.error) showMsg(`생성 실패: ${json.error}`)
    else { showMsg(`신규 고객 생성 + 주문 ${json.matched?.set ?? 0}건 귀속`); load() }
  }

  const totalAmount = useMemo(() => rows.reduce((s, r) => s + r.total_amount, 0), [rows])

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-4">
        <Link href="/crm" className="text-xs text-slate-500 hover:text-slate-700">← 고객 목록</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">주문 매칭</h1>
        <p className="text-sm mt-1 text-gray-500">
          고객에 귀속되지 않은 주문 키 {rows.length}개 · 합계 {won(totalAmount)} —
          기존 고객에 연결하거나 신규 고객으로 만듭니다. 연결은 학습되어 이후 자동 적용됩니다.
        </p>
      </div>

      {msg && <div className="mb-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">미귀속 주문이 없습니다. 모든 주문이 고객에 연결되어 있습니다.</div>
      ) : (
        <div className="space-y-3">
          {rows.map(r => {
            const k = keyOf(r)
            const q = pick[k] ?? ''
            return (
              <div key={k} className="border border-gray-200 rounded-xl px-4 py-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {r.bank_name || '(은행 없음)'}
                      {r.branch_name && <span className="text-gray-400 ml-1.5">{r.branch_name}</span>}
                      <span className="ml-2 text-gray-700">{r.manager_name || '(담당자 없음)'}</span>
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      주문 {r.order_count}건 · {won(r.total_amount)} · {r.first_date} ~ {r.last_date}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <input
                        value={q}
                        onChange={e => setPick(p => ({ ...p, [k]: e.target.value }))}
                        placeholder="기존 고객 검색 (거래처·이름)"
                        className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                      {q.trim() && (
                        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                          {candidates(q).map(c => (
                            <button key={c.contact_id} onClick={() => link(r, c.contact_id)}
                              disabled={busy === k}
                              className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0">
                              {c.bank_name} {c.branch_name && <span className="text-gray-400">{c.branch_name}</span>}{' '}
                              <span className="font-medium">{c.name}</span>
                              {c.title && <span className="text-gray-400 text-xs ml-1">{c.title}</span>}
                            </button>
                          ))}
                          {candidates(q).length === 0 && <p className="px-3 py-2 text-xs text-gray-400">일치하는 고객이 없습니다.</p>}
                        </div>
                      )}
                    </div>
                    <button onClick={() => createNew(r)} disabled={busy === k}
                      className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 whitespace-nowrap disabled:opacity-50">
                      {busy === k ? '처리 중...' : '신규 고객 생성'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
