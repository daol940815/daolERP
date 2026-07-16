'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

// 거래처 연동 재정비 2단계 — ERP 별칭 등록 대기.
// ERP 업로드가 만든 별칭 중 거래처 미연결분을 자동 판정과 함께 보여주고,
// 선택한 것을 일괄 생성·연결하거나 제외한다 (확정은 사용자).

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

interface PendingRow {
  id: string
  alias_type: string
  erp_name: string
  order_count: number
  order_total: number
  suggestion: { action: 'create' | 'link' | 'exclude'; vendorId?: string; vendorName?: string; reason: string }
}

export default function ErpAliasPendingPage() {
  const [rows, setRows] = useState<PendingRow[] | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 6000) }

  const load = useCallback(async () => {
    setRows(null)
    const res = await fetch('/api/erp-aliases/pending', { cache: 'no-store' })
    const json = await res.json()
    if (!res.ok) { showMsg(`조회 실패: ${json.error ?? '오류'}`); setRows([]); return }
    const list: PendingRow[] = json.data ?? []
    setRows(list)
    // 제외 권장을 뺀 나머지를 기본 선택
    setChecked(new Set(list.filter(r => r.suggestion.action !== 'exclude').map(r => r.id)))
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = (id: string) => setChecked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const run = async (mode: 'apply' | 'exclude') => {
    if (!rows) return
    const targets = rows.filter(r => checked.has(r.id))
    if (!targets.length) { showMsg('선택된 항목이 없습니다.'); return }
    const label = mode === 'apply'
      ? `선택 ${targets.length}건을 자동 판정대로 생성·연결합니다.`
      : `선택 ${targets.length}건을 거래처 관리 대상에서 제외합니다.`
    if (!confirm(`${label}\n진행할까요?`)) return
    setBusy(true)
    const actions = targets.map(r => mode === 'exclude'
      ? { aliasId: r.id, action: 'exclude' as const }
      : r.suggestion.action === 'link'
        ? { aliasId: r.id, action: 'link' as const, vendorId: r.suggestion.vendorId }
        : r.suggestion.action === 'exclude'
          ? { aliasId: r.id, action: 'exclude' as const }
          : { aliasId: r.id, action: 'create' as const })
    const res = await fetch('/api/erp-aliases/pending', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions }),
    })
    const json = await res.json()
    setBusy(false)
    if (!res.ok) { showMsg(`처리 실패: ${json.error ?? '오류'}`); return }
    showMsg(`거래처 생성 ${json.created}곳 · 별칭 연결 ${json.linked}건 · 제외 ${json.excluded}건${json.failed ? ` · 실패 ${json.failed}건` : ''}`)
    load()
  }

  const stats = useMemo(() => {
    if (!rows) return null
    return {
      total: rows.length,
      amount: rows.reduce((s, r) => s + r.order_total, 0),
      customer: rows.filter(r => r.alias_type === 'customer').length,
    }
  }, [rows])

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-gray-900">ERP 거래처 등록 대기</h1>
        <Link href="/erp-aliases" className="text-sm text-slate-500 hover:text-slate-900 underline">별칭 관리로</Link>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        ERP 업로드에서 발견됐지만 거래처 마스터에 없는 상대입니다. 자동 판정을 확인하고 일괄 처리하세요.
        생성 시 ERP 표기 그대로 등록되며, 이후 세금계산서가 올라오면 사업자번호가 자동 보완됩니다.
      </p>

      {stats && (
        <p className="text-sm text-gray-600 mb-3">
          대기 <b>{stats.total.toLocaleString()}</b>건 (매출처 {stats.customer} · 매입처 {stats.total - stats.customer})
          · 걸린 주문 금액 <b>{won(stats.amount)}</b>
        </p>
      )}

      <div className="flex items-center gap-2 mb-3">
        <button onClick={() => run('apply')} disabled={busy || !rows?.length}
          className="px-3 py-2 rounded-lg text-sm font-medium bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50">
          {busy ? '처리 중...' : `선택 ${checked.size}건 자동 판정대로 생성·연결`}
        </button>
        <button onClick={() => run('exclude')} disabled={busy || !rows?.length}
          className="px-3 py-2 rounded-lg text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          선택 제외 (거래처 관리 안 함)
        </button>
        {rows && rows.length > 0 && (
          <button onClick={() => setChecked(checked.size === rows.length ? new Set() : new Set(rows.map(r => r.id)))}
            className="text-xs text-gray-400 hover:text-gray-600 underline">
            전체 선택/해제
          </button>
        )}
      </div>

      {rows === null ? (
        <div className="py-16 text-center text-gray-400 text-sm">불러오는 중...</div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center text-gray-400 text-sm">등록 대기 항목이 없습니다 — 모든 ERP 상대가 거래처와 연동되어 있습니다.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500">
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2 text-left">구분</th>
                <th className="px-3 py-2 text-left">ERP 표기</th>
                <th className="px-3 py-2 text-right">주문</th>
                <th className="px-3 py-2 text-right">주문 금액</th>
                <th className="px-3 py-2 text-left">자동 판정</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-slate-50">
                  <td className="px-3 py-2"><input type="checkbox" checked={checked.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td className="px-3 py-2 text-gray-500">{r.alias_type === 'customer' ? '매출처' : '매입처'}</td>
                  <td className="px-3 py-2 text-gray-900">{r.erp_name}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{r.order_count ? `${r.order_count}건` : '-'}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{r.order_total ? won(r.order_total) : '-'}</td>
                  <td className="px-3 py-2">
                    {r.suggestion.action === 'create' && <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-xs mr-1.5">신규 생성</span>}
                    {r.suggestion.action === 'link' && <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-xs mr-1.5">기존 연결</span>}
                    {r.suggestion.action === 'exclude' && <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-xs mr-1.5">제외 권장</span>}
                    <span className="text-xs text-gray-400">{r.suggestion.reason}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {msg && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg z-50 max-w-md">{msg}</div>
      )}
    </div>
  )
}
