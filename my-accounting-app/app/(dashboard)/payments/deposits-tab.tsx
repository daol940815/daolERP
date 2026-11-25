'use client'

import PeriodPresets from '@/components/ui/PeriodPresets'
import { Fragment, Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { DATA_START, getPeriodRange } from '@/lib/period-presets'
import { OrderNoLink } from '@/components/payments/OrderPreview'
import { useReasonDialog } from '@/components/payments/ReasonDialog'
import ReasonPicker, { reasonReady, type ReasonValue } from '@/components/payments/ReasonPicker'

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`

// 이전 처리분 (1309)
interface SettledRow { id: string; source_type: string; amount: number; tx_date: string | null; label: string | null; vendor_name: string | null; reason_text: string; memo: string | null; created_by_name: string | null; created_at: string }
const stamp = (iso: string) => { const d = new Date(new Date(iso).getTime() + 9 * 3600000).toISOString(); return `${d.slice(5, 10)} ${d.slice(11, 16)}` }

interface Candidate {
  id: string
  order_no: string
  order_date: string
  customer_name: string
  manager?: string
  collect_status: string
  net_amount: number
  allocated: number
  remaining: number
}

interface PendingDeposit {
  id: string
  source_type: 'bank' | 'card'
  tx_date: string
  tx_time?: string | null
  counterparty_name: string | null
  description: string | null
  vendor_id?: string
  vendor_name: string
  amount: number
  allocated: number
  remaining: number
  candidates: Candidate[]
  // 추천 주문 — 같은 거래처 · 잔액 같음 · 날짜 가까움 · 양쪽 후보가 하나뿐 (확정은 사람이 누른다, 2026-11-16)
  recommend: { id: string; order_no: string; order_date: string; remaining: number; customer_name?: string; manager?: string } | null
}

interface MatchedRow {
  id: string
  order_id: string
  source_type: 'bank' | 'card'
  amount: number
  paid_date: string
  matched_by: 'auto' | 'manual'
  order_no: string
  customer_name: string
  counterparty_name: string | null
  matched_by_name?: string | null   // 매칭한 사람 (1307). 시각은 created_at
  created_at?: string
}
// 매칭 해제 이력 (1307) — 사유 · 사람 · 시각
interface ReleasedRow { id: string; order_no: string | null; source_type: string | null; amount: number | null; paid_date: string | null; reason_text: string | null; employee_name: string | null; created_at: string }
const when = (iso?: string | null) => { if (!iso) return ''; const d = new Date(new Date(iso).getTime() + 9 * 3600000).toISOString(); return `${d.slice(5, 10)} ${d.slice(11, 16)}` }

type Tab = 'pending' | 'matched'

function ErpMatchingContent() {
  // ?depositId=bank:<id>|card:<id> — 주문 쪽 수금 매칭 모달의 "이 결제건을 다른 주문에도 배분"에서 진입 (2026-11-04)
  const searchParams = useSearchParams()
  const focusDeposit = searchParams.get('depositId') ?? ''
  const [tab, setTab]           = useState<Tab>('pending')
  const [pending, setPending]   = useState<PendingDeposit[]>([])
  const [matched, setMatched]   = useState<MatchedRow[]>([])
  const [released, setReleased] = useState<ReleasedRow[]>([])
  const [relId, setRelId] = useState<string | null>(null)            // 해제 사유 창이 열린 매칭
  const [relReason, setRelReason] = useState<ReasonValue | null>(null)
  const [loading, setLoading]   = useState(true)
  const [working, setWorking]   = useState(false)
  const [dateFrom, setDateFrom] = useState(() => (focusDeposit ? DATA_START : getPeriodRange('당월').from))
  const [dateTo, setDateTo]     = useState(() => getPeriodRange('당월').to)
  const [days, setDays]         = useState(7)
  const [search, setSearch]     = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [recSel, setRecSel] = useState<Set<string>>(new Set())   // 체크한 추천 (일괄 확정)
  const [recOnly, setRecOnly] = useState(false)
  // 이전 처리분 (1309, 2026-11-23) — 체크 칸은 모든 줄에(recSel 공용), 위쪽 버튼이 체크한 것 중 해당하는 줄만 처리한다
  const [showSettled, setShowSettled] = useState(false)
  const [settled, setSettled] = useState<SettledRow[]>([])
  const [settledOk, setSettledOk] = useState(true)
  const [setSel, setSetSel] = useState<Set<string>>(new Set())   // 이전 처리분 보기에서 체크한 것(해제용)
  const reasonDlg = useReasonDialog()
  // 펼친 입금의 주문별 배분 입력값
  const [alloc, setAlloc]       = useState<Record<string, string>>({})
  // 기간 밖 주문을 주문번호로 찾아 후보에 추가 (입금별)
  const [extraCands, setExtraCands] = useState<Record<string, Candidate[]>>({})
  const [orderQ, setOrderQ] = useState('')
  const searchOrder = async (depositId: string) => {
    const q = orderQ.trim()
    if (q.length < 3) { showMsg('주문번호를 3자 이상 입력하세요.'); return }
    const res = await fetch(`/api/erp-matching/order-search?q=${encodeURIComponent(q)}`)
    const json = await res.json()
    if (!res.ok) { showMsg(json.error ?? '검색 실패'); return }
    const found: Candidate[] = (json.data ?? []).filter((c: Candidate) => c.remaining > 0)
    if (!found.length) { showMsg('잔액이 있는 주문을 찾지 못했습니다.'); return }
    setExtraCands(prev => {
      const cur = prev[depositId] ?? []
      const ids = new Set(cur.map(c => c.id))
      return { ...prev, [depositId]: [...cur, ...found.filter(c => !ids.has(c.id))] }
    })
    setOrderQ('')
  }
  const [msg, setMsg]           = useState<string | null>(null)

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 5000) }

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (dateFrom) p.set('from', dateFrom)
    if (dateTo)   p.set('to', dateTo)
    p.set('days', String(days))
    const res  = await fetch(`/api/erp-matching?${p}`)
    const json = await res.json()
    if (res.ok) {
      setPending(json.pending ?? [])
      setMatched(json.matched ?? [])
      setReleased(json.released ?? [])
      const sr = await fetch('/api/erp-matching/settle').then(r => r.json()).catch(() => ({ available: false, rows: [] }))
      setSettled(sr.rows ?? []); setSettledOk(sr.available !== false); setSetSel(new Set())
    } else {
      showMsg(json.error ?? '조회 실패')
      setPending([]); setMatched([])
    }
    setExpandedId(null)
    setAlloc({})
    setRecSel(new Set())
    setLoading(false)
  }, [dateFrom, dateTo, days])
  useEffect(() => {
    if (!focusDeposit || loading) return
    const [, id] = focusDeposit.split(':')
    const d = pending.find(p => p.id === id)
    if (d) { setExpandedId(d.id); setTab('pending') }
  }, [focusDeposit, loading, pending])

  useEffect(() => { load() }, [load])

  // 추천 확정 — 추천된 주문 1건에 입금 잔액 전액을 붙인다. 확정은 사람이 누른다(자동 확정 폐지, 2026-11-16)
  // 체크한 입금을 이전 처리분으로 (사유 필수). 추천이 있는 줄이 섞이면 포함할지 묻는다
  const settleChecked = async () => {
    let list = pending.filter(d => recSel.has(d.id))
    if (!list.length) return
    const withRec = list.filter(d => d.recommend)
    if (withRec.length) {
      const keep = window.confirm(`추천 주문이 있는 입금 ${withRec.length}건이 포함돼 있습니다.\n추천이 있다는 것은 주문에 붙여야 할 돈일 수 있습니다.\n\n[확인] 함께 이전 처리분으로 표시 / [취소] 추천 있는 줄은 빼고 표시`)
      if (!keep) list = list.filter(d => !d.recommend)
      if (!list.length) return
    }
    const sum = list.reduce((x, d) => x + d.remaining, 0)
    const reason = await reasonDlg.ask('settle', `이전 처리분 확정 — ${list.length}건 · ${won(sum)}`, '주문 없이 이미 처리된 입금 · 카드 결제로 표시합니다. 입금대장과 결제 확인 후보에서 빠지고, 미수 · 매출은 바뀌지 않습니다. 해제할 수 있습니다.')
    if (!reason) return
    setWorking(true)
    const res = await fetch('/api/erp-matching/settle', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, items: list.map(d => ({ source_type: d.source_type, source_id: d.id, amount: d.remaining, tx_date: d.tx_date, label: (d.counterparty_name || d.description || '').slice(0, 80), vendor_id: d.vendor_id ?? null })) }),
    })
    const j = await res.json().catch(() => ({}))
    setWorking(false)
    if (!res.ok) { showMsg(j.error ?? '이전 처리분 표시 실패'); return }
    showMsg(`${j.count ?? list.length}건을 이전 처리분으로 표시했습니다`)
    setRecSel(new Set()); load()
  }
  const releaseChecked = async () => {
    const ids = Array.from(setSel)
    if (!ids.length) return
    const reason = await reasonDlg.ask('unsettle', `이전 처리분 해제 — ${ids.length}건`, '해제하면 입금대장 목록으로 돌아옵니다. 처음 표시한 사유와 해제 사유가 모두 남습니다.')
    if (!reason) return
    setWorking(true)
    const res = await fetch('/api/erp-matching/settle', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, reason }) })
    const j = await res.json().catch(() => ({}))
    setWorking(false)
    if (!res.ok) { showMsg(j.error ?? '해제 실패'); return }
    showMsg(`${j.count ?? ids.length}건을 해제했습니다`)
    load()
  }

  const confirmRecommended = async (list: PendingDeposit[]) => {
    const targets = list.filter(d => d.recommend)
    if (!targets.length) return
    const sum = targets.reduce((x, d) => x + d.remaining, 0)
    if (!window.confirm(targets.length === 1
      ? `${targets[0].vendor_name} 입금 ${won(targets[0].remaining)}을(를) 주문 ${targets[0].recommend!.order_no}에 붙여 확정할까요?`
      : `추천 ${targets.length}건(${won(sum)})을 추천된 주문에 붙여 확정할까요?`)) return
    setWorking(true)
    let ok = 0; let fail = ''
    for (const d of targets) {
      const res = await fetch('/api/erp-matching', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_type: d.source_type, source_id: d.id, allocations: [{ order_id: d.recommend!.id, amount: d.remaining }], memo: '추천 확정' }),
      })
      if (res.ok) ok++
      else { const j = await res.json().catch(() => ({})); fail = j.error ?? '확정 실패'; break }
    }
    setWorking(false)
    showMsg(fail ? `${ok}건 확정 후 중단 — ${fail}` : `${ok}건 확정했습니다`)
    load()
  }

  const toggleExpand = (d: PendingDeposit) => {
    if (expandedId === d.id) { setExpandedId(null); setAlloc({}); return }
    setExpandedId(d.id)
    // 잔액이 정확히 일치하는 후보가 하나면 미리 채워준다
    const exact = d.candidates.filter(c => c.remaining === d.remaining)
    setAlloc(exact.length === 1 ? { [exact[0].id]: String(d.remaining) } : {})
  }

  const handleAllocate = async (d: PendingDeposit) => {
    const allocations = Object.entries(alloc)
      .map(([order_id, v]) => ({ order_id, amount: Math.round(Number(String(v).replace(/,/g, ''))) }))
      .filter(a => Number.isFinite(a.amount) && a.amount > 0)
    if (!allocations.length) { showMsg('배분할 금액을 입력하세요.'); return }
    const sum = allocations.reduce((s, a) => s + a.amount, 0)
    if (sum > d.remaining) { showMsg(`배분 합계(${won(sum)})가 입금 잔액(${won(d.remaining)})을 초과합니다.`); return }
    setWorking(true)
    const res  = await fetch('/api/erp-matching', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_type: d.source_type, source_id: d.id, allocations }),
    })
    const json = await res.json()
    setWorking(false)
    if (!res.ok) { showMsg(json.error ?? '배분 실패'); return }
    showMsg(`${allocations.length}건 배분 완료 (${won(sum)})`)
    load()
  }

  const handleUnmatch = async (m: MatchedRow) => {
    // 사유를 항목에서 골라야 한다 (1307) — 사유 · 사람 · 시각이 해제 이력에 남는다
    if (!reasonReady(relReason)) return
    setWorking(true)
    const res  = await fetch(`/api/erp-matching?id=${m.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: relReason }) })
    const json = await res.json()
    setWorking(false)
    if (!res.ok) { showMsg(json.error ?? '해제 실패'); return }
    showMsg('매칭 해제 완료')
    setRelId(null)
    load()
  }

  const q = search.trim()
  const filteredPending = pending.filter(d =>
    (!recOnly || !!d.recommend)
    && (!q || d.vendor_name.includes(q) || (d.counterparty_name ?? '').includes(q) || (d.description ?? '').includes(q)))
  const recCount = pending.filter(d => d.recommend).length
  const filteredMatched = matched.filter(m =>
    !q || m.order_no.includes(q) || m.customer_name.includes(q) || (m.counterparty_name ?? '').includes(q))

  const pendingTotal = filteredPending.reduce((s, d) => s + d.remaining, 0)
  const recChecked = pending.filter(d => recSel.has(d.id) && d.recommend)   // 체크한 줄 중 추천 있는 것

  return (
    <div className="w-full">
      {reasonDlg.node}
      <div className="mb-2 flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-600">
          결제 기록 없이 들어온 통장 입금 · 카드결제를 주문에 붙입니다. 같은 거래처 · 금액 같음 · 날짜 가까움 · 후보가 하나뿐이면 <b className="text-slate-800">추천</b>으로 표시하고, 확정은 직접 누릅니다.
        </p>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-600">추천 기준</label>
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="border border-slate-400 rounded-lg px-2 py-1.5 text-sm text-slate-700" title="추천할 때 입금일과 주문일 차이 허용 범위">
            {[3, 7, 15, 30, 60].map(d => <option key={d} value={d}>±{d}일</option>)}
          </select>
        </div>
      </div>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {/* 기간 빠른 선택 */}
      <PeriodPresets from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t) }} className="mb-2" />

      {/* 필터 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="border border-slate-400 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
        <span className="text-slate-500 text-sm">~</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="border border-slate-400 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="거래처·입금자·주문번호 검색"
          className="border border-slate-400 rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
      </div>

      {tab === 'pending' && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {recCount > 0 && (<>
            <button onClick={() => { setRecOnly(v => !v); setShowSettled(false) }}
              className={`px-3 py-1 rounded-full text-xs border ${recOnly && !showSettled ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-400 text-slate-700 hover:bg-slate-50'}`}>
              추천 있음 {recCount}
            </button>
            <button onClick={() => setRecSel(new Set(pending.filter(d => d.recommend).map(d => d.id)))} className="text-xs text-slate-600 underline">추천 모두 체크</button>
          </>)}
          {settledOk && (
            <button onClick={() => setShowSettled(v => !v)}
              className={`px-3 py-1 rounded-full text-xs border ${showSettled ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-400 text-slate-700 hover:bg-slate-50'}`}>
              이전 처리분 보기 {settled.length}
            </button>
          )}
          <span className="ml-auto flex items-center gap-2 flex-wrap">
            {!showSettled && recSel.size > 0 && (<>
              <span className="text-xs text-slate-700">체크 {recSel.size}건</span>
              {recChecked.length > 0 && (
                <button onClick={() => confirmRecommended(recChecked)} disabled={working}
                  className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40">체크한 추천 확정 ({recChecked.length}건)</button>
              )}
              {settledOk && (
                <button onClick={settleChecked} disabled={working}
                  className="px-3 py-1.5 border border-indigo-200 bg-indigo-50 text-indigo-700 rounded-lg text-sm font-semibold hover:bg-indigo-100 disabled:opacity-40">이전 처리분 확정 ({recSel.size}건)</button>
              )}
              <button onClick={() => setRecSel(new Set())} className="px-3 py-1.5 border border-slate-400 rounded-lg text-sm text-slate-700 hover:bg-slate-50">체크 해제</button>
            </>)}
            {showSettled && setSel.size > 0 && (
              <button onClick={releaseChecked} disabled={working}
                className="px-3 py-1.5 border border-indigo-200 bg-indigo-50 text-indigo-700 rounded-lg text-sm font-semibold hover:bg-indigo-100 disabled:opacity-40">체크한 것 해제 ({setSel.size}건)</button>
            )}
          </span>
        </div>
      )}

      {tab === 'pending' && showSettled && (
        <div className="mb-4 bg-white border border-slate-300 rounded-xl overflow-x-auto">
          <div className="px-3 py-2 border-b border-slate-200 text-sm"><b className="text-slate-900">이전 처리분 {settled.length}건</b>
            <span className="text-xs text-slate-500"> · 주문 없이 처리 완료로 표시한 입금 · 카드 결제 (기간 필터와 무관)</span></div>
          {settled.length === 0 ? <div className="py-8 text-center text-sm text-slate-500">이전 처리분이 없습니다.</div> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-300">
                <th className="py-2 px-3"><input type="checkbox" checked={setSel.size === settled.length && settled.length > 0}
                  onChange={e => setSetSel(e.target.checked ? new Set(settled.map(x => x.id)) : new Set())} aria-label="모두 체크" /></th>
                <th className="py-2 px-3 font-medium">구분</th><th className="py-2 px-3 font-medium">입금일</th><th className="py-2 px-3 font-medium">거래처</th>
                <th className="py-2 px-3 font-medium">입금자/카드</th><th className="py-2 px-3 font-medium text-right">금액</th>
                <th className="py-2 px-3 font-medium">사유 · 메모</th><th className="py-2 px-3 font-medium">표시한 사람 · 시각</th>
              </tr></thead>
              <tbody>
                {settled.map(x => (
                  <tr key={x.id} className="border-b border-slate-200">
                    <td className="py-2 px-3"><input type="checkbox" checked={setSel.has(x.id)} onChange={e => setSetSel(p => { const n = new Set(p); if (e.target.checked) n.add(x.id); else n.delete(x.id); return n })} /></td>
                    <td className="py-2 px-3"><span className={`px-1.5 py-0.5 text-xs rounded ${x.source_type === 'card' ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'}`}>{x.source_type === 'card' ? '카드' : '계좌'}</span></td>
                    <td className="py-2 px-3 whitespace-nowrap text-slate-700">{x.tx_date ?? '-'}</td>
                    <td className="py-2 px-3"><p className="truncate max-w-[180px]">{x.vendor_name ?? '-'}</p></td>
                    <td className="py-2 px-3"><p className="truncate max-w-[180px] text-slate-700">{x.label ?? '-'}</p></td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">{won(x.amount)}</td>
                    <td className="py-2 px-3 text-xs text-slate-800">{x.reason_text}{x.memo && <div className="text-xs text-slate-500">{x.memo}</div>}</td>
                    <td className="py-2 px-3 text-xs whitespace-nowrap">{x.created_by_name ?? '-'}<div className="text-xs text-slate-500">{stamp(x.created_at)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 입금대장 (2026-11-18): 하위 탭 없이 '주문에 붙일 입금'만 보여 준다. 매칭된 입금의 내역 · 해제 · 해제 이력은 전체 현황 탭으로 옮겼다
          (아래 matched 분기는 tab 이 항상 'pending' 이라 그려지지 않는다) */}
      <div className="mb-3 text-sm text-slate-800">주문에 붙일 입금 <b>{filteredPending.length}건</b> <span className="text-slate-600">({won(pendingTotal)})</span>
        <span className="text-xs text-slate-500"> · 붙인 뒤의 내역과 매칭 해제는 전체 현황 탭에서 주문을 펼쳐 봅니다</span></div>

      {loading ? (
        <div className="text-center py-20 text-slate-500">로딩 중...</div>
      ) : tab === 'pending' ? (
        filteredPending.length === 0 ? (
          <div className="text-center py-20 text-slate-500 text-sm">
            미배분 입금이 없습니다. 거래처가 연결된 입금만 대상이 되므로,
            거래내역 화면에서 거래처 자동매칭을 먼저 실행해주세요.
          </div>
        ) : (
          <div className="bg-white border border-slate-300 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-300">
                  <th className="py-2.5 px-3"><input type="checkbox" aria-label="보이는 줄 모두 체크"
                    checked={filteredPending.length > 0 && filteredPending.every(d => recSel.has(d.id))}
                    onChange={e => setRecSel(e.target.checked ? new Set(filteredPending.map(d => d.id)) : new Set())} /></th>
                  <th className="py-2.5 px-3 font-medium">구분</th>
                  <th className="py-2.5 px-3 font-medium">입금일</th>
                  <th className="py-2.5 px-3 font-medium">거래처</th>
                  <th className="py-2.5 px-3 font-medium">입금자/적요</th>
                  <th className="py-2.5 px-3 font-medium text-right">입금액</th>
                  <th className="py-2.5 px-3 font-medium text-right">미배분</th>
                  <th className="py-2.5 px-3 font-medium">추천 · 후보 주문</th>
                  <th className="py-2.5 px-3 font-medium text-right">액션</th>
                </tr>
              </thead>
              <tbody>
                {filteredPending.map(d => {
                  const expanded = expandedId === d.id
                  const allocSum = Object.values(alloc)
                    .map(v => Math.round(Number(String(v).replace(/,/g, ''))))
                    .filter(n => Number.isFinite(n) && n > 0)
                    .reduce((s, n) => s + n, 0)
                  return (
                    <Fragment key={d.id}>
                      <tr className={`border-b border-slate-200 ${expanded ? 'bg-slate-50' : 'hover:bg-slate-50'}`}>
                        <td className="py-2 px-3"><input type="checkbox" checked={recSel.has(d.id)} aria-label="체크"
                          onChange={e => setRecSel(prev => { const n = new Set(prev); if (e.target.checked) n.add(d.id); else n.delete(d.id); return n })} /></td>
                        <td className="py-2 px-3">
                          <span className={`px-1.5 py-0.5 text-xs rounded ${
                            d.source_type === 'card' ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'
                          }`}>
                            {d.source_type === 'card' ? '카드' : '계좌'}
                          </span>
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap text-slate-700">{d.tx_date}{d.tx_time ? ` ${d.tx_time.slice(0, 8)}` : ''}</td>
                        <td className="py-2 px-3"><p className="truncate max-w-[160px]">{d.vendor_name}</p></td>
                        <td className="py-2 px-3">
                          <p className="truncate max-w-[200px] text-slate-700">{d.counterparty_name || d.description || '-'}</p>
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">{won(d.amount)}</td>
                        <td className="py-2 px-3 text-right whitespace-nowrap font-medium text-red-600">{won(d.remaining)}</td>
                        <td className="py-2 px-3 text-xs">
                          {d.recommend ? (
                            <label className="flex items-start gap-1.5">
                              <span>
                                <span className="inline-block px-1.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800 mr-1">추천</span>
                                <OrderNoLink id={d.recommend.id} no={d.recommend.order_no} />
                                <span className="text-slate-800"> · {d.recommend.customer_name ?? ''}{d.recommend.manager ? ` · ${d.recommend.manager}` : ''}</span>
                                <span className="text-slate-500"> · {d.recommend.order_date} · 미수 {won(d.recommend.remaining)}</span>
                              </span>
                            </label>
                          ) : <span className="text-slate-600">{d.candidates.length ? `후보 ${d.candidates.length}건` : '후보 없음'}</span>}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          {d.recommend && (
                            <button onClick={() => confirmRecommended([d])} disabled={working}
                              className="mr-1 px-2 py-1 text-xs rounded bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-40">확정</button>
                          )}
                          <button
                            onClick={() => toggleExpand(d)}
                            disabled={working}
                            className={`px-2 py-1 text-xs border rounded disabled:opacity-40 ${
                              expanded ? 'border-slate-400 bg-slate-100 text-slate-800' : 'border-blue-300 text-blue-700 hover:bg-blue-50'
                            }`}
                          >
                            {expanded ? '▲ 닫기' : d.candidates.length === 0 ? '주문 찾기' : d.recommend ? '다른 주문' : '배분하기'}
                          </button>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-b border-slate-300 bg-slate-50">
                          <td colSpan={9} className="px-5 py-3">
                            <table className="w-full text-xs mb-3">
                              <thead>
                                <tr className="text-left text-slate-500">
                                  <th className="py-1 pr-3 font-medium">주문번호</th>
                                  <th className="py-1 pr-3 font-medium">주문일</th>
                                  <th className="py-1 pr-3 font-medium">은행 · 지점</th>
                                  <th className="py-1 pr-3 font-medium">고객</th>
                                  <th className="py-1 pr-3 font-medium text-right">순매출</th>
                                  <th className="py-1 pr-3 font-medium text-right">기배분</th>
                                  <th className="py-1 pr-3 font-medium text-right">잔액</th>
                                  <th className="py-1 font-medium text-right">배분 금액</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[...d.candidates, ...(extraCands[d.id] ?? []).filter(x => !d.candidates.some(c => c.id === x.id))].map(c => (
                                  <tr key={c.id} className="border-t border-slate-300 text-slate-800">
                                    <td className="py-1.5 pr-3 whitespace-nowrap"><OrderNoLink id={c.id} no={c.order_no} /></td>
                                    <td className="py-1.5 pr-3 whitespace-nowrap">{c.order_date}</td>
                                    <td className="py-1.5 pr-3 whitespace-nowrap">{c.customer_name}</td>
                                    <td className="py-1.5 pr-3 whitespace-nowrap text-slate-700">{c.manager ?? ''}</td>
                                    <td className="py-1.5 pr-3 text-right whitespace-nowrap">{won(c.net_amount)}</td>
                                    <td className="py-1.5 pr-3 text-right whitespace-nowrap text-slate-500">{won(c.allocated)}</td>
                                    <td className="py-1.5 pr-3 text-right whitespace-nowrap font-medium">{won(c.remaining)}</td>
                                    <td className="py-1.5 text-right">
                                      <input
                                        value={alloc[c.id] ?? ''}
                                        onChange={e => setAlloc(prev => ({ ...prev, [c.id]: e.target.value }))}
                                        placeholder="0"
                                        className="border border-slate-400 rounded px-2 py-1 text-xs w-28 text-right focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
                                      />
                                      <button
                                        onClick={() => setAlloc(prev => ({ ...prev, [c.id]: String(Math.min(c.remaining, d.remaining)) }))}
                                        className="ml-1 px-1.5 py-1 text-xs border border-slate-400 rounded text-slate-600 hover:bg-slate-100"
                                        title="주문 잔액(또는 입금 잔액)만큼 채우기"
                                      >채움</button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <div className="flex items-center gap-2 mb-3 text-xs">
                              <input value={orderQ} onChange={e => setOrderQ(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') searchOrder(d.id) }}
                                placeholder="주문번호로 찾기 (기간 밖·다른 거래처 주문도)"
                                className="border border-slate-400 rounded px-2 py-1 w-64 bg-white" />
                              <button onClick={() => searchOrder(d.id)} className="px-2 py-1 border border-slate-400 rounded text-slate-700 hover:bg-slate-100">추가</button>
                            </div>
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => handleAllocate(d)}
                                disabled={working || allocSum <= 0}
                                className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-xs hover:bg-slate-700 disabled:opacity-40"
                              >
                                {working ? '저장 중...' : `배분 저장 (${won(allocSum)})`}
                              </button>
                              <span className={`text-xs ${allocSum > d.remaining ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                                입금 잔액 {won(d.remaining)} 중 {won(allocSum)} 배분
                                {allocSum > d.remaining && ' — 잔액 초과!'}
                              </span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        filteredMatched.length === 0 ? (
          <div className="text-center py-20 text-slate-500 text-sm">기간 내 매칭된 건이 없습니다.</div>
        ) : (
          <div className="bg-white border border-slate-300 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-300">
                  <th className="py-2.5 px-3 font-medium">결제일</th>
                  <th className="py-2.5 px-3 font-medium">주문번호</th>
                  <th className="py-2.5 px-3 font-medium">매출처</th>
                  <th className="py-2.5 px-3 font-medium">입금자/카드번호</th>
                  <th className="py-2.5 px-3 font-medium text-right">매칭 금액</th>
                  <th className="py-2.5 px-3 font-medium">구분</th>
                  <th className="py-2.5 px-3 font-medium">매칭한 사람 · 시각</th>
                  <th className="py-2.5 px-3 font-medium text-right">액션</th>
                </tr>
              </thead>
              <tbody>
                {filteredMatched.map(m => (
                  <Fragment key={m.id}>
                  <tr className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="py-2 px-3 whitespace-nowrap text-slate-700">{m.paid_date}</td>
                    <td className="py-2 px-3 whitespace-nowrap">{m.order_no}</td>
                    <td className="py-2 px-3"><p className="truncate max-w-[180px]">{m.customer_name}</p></td>
                    <td className="py-2 px-3"><p className="truncate max-w-[140px] text-slate-700">{m.counterparty_name ?? '-'}</p></td>
                    <td className="py-2 px-3 text-right whitespace-nowrap font-medium">{won(m.amount)}</td>
                    <td className="py-2 px-3">
                      <span className={`mr-1 px-1.5 py-0.5 text-xs rounded ${
                        m.source_type === 'card' ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'
                      }`}>
                        {m.source_type === 'card' ? '카드' : '계좌'}
                      </span>
                      <span className={`px-1.5 py-0.5 text-xs rounded ${
                        m.matched_by === 'auto' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
                      }`}>
                        {m.matched_by === 'auto' ? '자동' : '수동'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-xs text-slate-700 whitespace-nowrap">
                      {m.matched_by_name ?? (m.matched_by === 'auto' ? '자동' : <span className="text-slate-500">기록 없음</span>)}
                      <span className="text-slate-500 tabular-nums"> · {when(m.created_at)}</span>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={() => { setRelId(relId === m.id ? null : m.id); setRelReason(null) }}
                        disabled={working}
                        className="px-2 py-1 text-xs border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-40"
                      >
                        {relId === m.id ? '닫기' : '해제'}
                      </button>
                    </td>
                  </tr>
                  {relId === m.id && (
                    <tr className="border-b border-slate-200 bg-orange-50">
                      <td colSpan={8} className="px-3 py-3">
                        <div className="text-xs text-slate-800 mb-2"><b>매칭 해제</b> — 주문 {m.order_no}의 매칭 {won(m.amount)}({m.paid_date})을 풉니다. 사유 · 해제한 사람 · 시각이 남습니다.</div>
                        <ReasonPicker kind="release" value={relReason} onChange={setRelReason} label="매칭 해제 사유" />
                        <div className="flex justify-end gap-2 mt-2">
                          <button onClick={() => setRelId(null)} className="px-3 py-1.5 border border-slate-400 rounded-lg text-xs bg-white">닫기</button>
                          <button onClick={() => handleUnmatch(m)} disabled={working || !reasonReady(relReason)}
                            className="px-3 py-1.5 rounded-lg text-xs bg-slate-900 text-white font-semibold disabled:opacity-40">매칭 해제</button>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {tab === 'matched' && released.length > 0 && (
        <div className="mt-4 bg-white border border-slate-300 rounded-xl overflow-x-auto">
          <div className="px-3 py-2 border-b border-slate-200 text-sm"><b className="text-slate-900">최근 매칭 해제 이력</b> <span className="text-xs text-slate-500">최근 {released.length}건 · 기간 필터와 무관</span></div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-300">
                <th className="py-2 px-3 font-medium">해제 시각</th>
                <th className="py-2 px-3 font-medium">해제한 사람</th>
                <th className="py-2 px-3 font-medium">주문번호</th>
                <th className="py-2 px-3 font-medium">결제일</th>
                <th className="py-2 px-3 font-medium text-right">금액</th>
                <th className="py-2 px-3 font-medium">사유</th>
              </tr>
            </thead>
            <tbody>
              {released.map(l => (
                <tr key={l.id} className="border-b border-slate-200">
                  <td className="py-2 px-3 whitespace-nowrap tabular-nums text-slate-700">{when(l.created_at)}</td>
                  <td className="py-2 px-3 whitespace-nowrap">{l.employee_name ?? '-'}</td>
                  <td className="py-2 px-3 whitespace-nowrap">{l.order_no ?? '-'}</td>
                  <td className="py-2 px-3 whitespace-nowrap text-slate-700">{l.paid_date ?? '-'}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">{won(l.amount)}</td>
                  <td className="py-2 px-3 text-slate-800">{l.reason_text ?? <span className="text-slate-500">사유 없음</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// 결제 확인 › 기록 없는 입금 탭 (전 입금 매칭 화면 /erp-matching — 2026-11-16 통합)
export default function DepositsTab() {
  return (
    <Suspense fallback={<div className="text-center py-20 text-slate-500">로딩 중...</div>}>
      <ErpMatchingContent />
    </Suspense>
  )
}
