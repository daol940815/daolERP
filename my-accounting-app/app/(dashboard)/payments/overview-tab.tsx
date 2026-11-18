'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { PAY_METHOD_TAG_CLS, PAY_METHOD_TAG_LABEL, PAY_STAGE_CLS, PAY_STAGE_LABEL, showMethodTag, type PayState } from '@/lib/pay-state'
import PayFilterBar, { passPayFilter, usePayFilter, type StaffScope } from '@/components/payments/PayFilterBar'
import { OrderNoLink } from '@/components/payments/OrderPreview'
import { useReasonDialog } from '@/components/payments/ReasonDialog'
import { useNotifRefresh, requestNotifRefresh } from '@/lib/use-notif-refresh'

// 결제 확인 › 전체 현황 (2026-11-18 실무자 요청 — 시안 docs/mockups/결제확인_탭5개_시안.html)
// 주문 한 줄씩, 결제 상태 칩으로 거르는 "보는 화면". 처음 열면 내 담당 지점 · 전체 기간 · 주문일 최신순.
// 확정 · 연락 기록은 매칭 대기 · 결제 안내 대상 탭에서 한다("…에서 열기"). 예외로 매칭 해제만 여기서 한다(사유 필수).

interface Rec { id: string; cancel: boolean; method: string; kind: string | null; pay_date: string; amount: number; clue: string; created_by_name: string | null; created_at: string; confirmed_by_name: string | null; confirmed_at: string | null }
interface Match { id: string; source_type: string; label: string; amount: number; paid_date: string; matched_by_name: string | null; created_at: string | null; record_id: string | null; derived: boolean }
interface Row {
  order_id: string; order_no: string | null; order_date: string; customer_name: string; manager: string
  staff_ids: string[]; staff_names: string[]; net: number; outstanding: number; pay: PayState
  records: Rec[]
}
interface Detail { matches: Match[]; contact_count: number; last_contact: string | null }
interface Released { id: string; order_no: string | null; amount: number | null; paid_date: string | null; reason_text: string | null; employee_name: string | null; created_at: string; origin: string | null }
type Stage = 'all' | 'unpaid' | 'partial_pay' | 'match_wait' | 'partial_match' | 'done'
const STAGES: { key: Stage; label: string }[] = [
  { key: 'all', label: '전체' }, { key: 'unpaid', label: '미결제' }, { key: 'partial_pay', label: '일부 결제' },
  { key: 'match_wait', label: '매칭 대기' }, { key: 'partial_match', label: '일부 매칭' }, { key: 'done', label: '완료' },
]
const METHOD: Record<string, string> = { card: '카드', transfer: '계좌이체', invoice: '계산서 발행' }
const won = (n: number) => n.toLocaleString('ko-KR')
const when = (iso?: string | null) => { if (!iso) return ''; const d = new Date(new Date(iso).getTime() + 9 * 3600000).toISOString(); return `${d.slice(5, 10)} ${d.slice(11, 16)}` }
const PAGE = 100

export default function OverviewTab() {
  const { filter, update, applyScope, ready } = usePayFilter()
  const [rows, setRows] = useState<Row[]>([])
  const [released, setReleased] = useState<Released[]>([])
  const [scope, setScope] = useState<StaffScope | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  // 펼친 주문의 상세(매칭 내역 · 연락 기록) — 펼칠 때 그 주문 것만 읽는다(목록을 가볍게)
  const [details, setDetails] = useState<Record<string, Detail>>({})
  const [shown, setShown] = useState(PAGE)
  const [showReleased, setShowReleased] = useState(false)
  const reasonDlg = useReasonDialog()

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const res = await fetch('/api/payment-records/overview', { cache: 'no-store' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setError(json.error ?? '조회 실패'); setRows([]) }
    else { setRows(json.rows ?? []); setReleased(json.released ?? []); setScope(json.scope ?? null); setCanEdit(!!json.can_edit); applyScope(json.scope); setDetails({}) }
    setLoading(false)
  }, [applyScope])
  useEffect(() => { load() }, [load])
  useNotifRefresh(load)
  useEffect(() => {
    if (!openId || details[openId]) return
    let alive = true
    fetch(`/api/payment-records/overview?order_id=${openId}`, { cache: 'no-store' }).then(r => r.json())
      .then(j => { if (alive) setDetails(d => ({ ...d, [openId]: { matches: j.matches ?? [], contact_count: j.contact_count ?? 0, last_contact: j.last_contact ?? null } })) })
      .catch(() => { if (alive) setDetails(d => ({ ...d, [openId]: { matches: [], contact_count: 0, last_contact: null } })) })
    return () => { alive = false }
  }, [openId, details])

  // 기간 · 검색 · 지점 담당까지 거른 것 (상태 칩의 건수는 이 범위에서 센다)
  const scoped = useMemo(() => rows.filter(r => passPayFilter(filter, {
    staff_ids: r.staff_ids, date: r.order_date,
    fields: {
      vendor: r.customer_name, order: r.order_no, manager: r.manager,
      approval: r.records.map(x => x.clue).join(' '), depositor: r.records.map(x => x.clue).join(' '),
      amount: [r.net, r.outstanding, ...r.records.map(x => x.amount)].join(' '),
    },
  })), [rows, filter])
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: scoped.length }
    for (const r of scoped) c[r.pay.stage] = (c[r.pay.stage] ?? 0) + 1
    return c
  }, [scoped])
  const noneCount = useMemo(() => rows.filter(r => r.staff_ids.length === 0).length, [rows])
  const filtered = useMemo(() => (stage === 'all' ? scoped : scoped.filter(r => r.pay.stage === stage)), [scoped, stage])
  const outstandingSum = filtered.reduce((s, r) => s + r.outstanding, 0)
  useEffect(() => { setShown(PAGE) }, [filter, stage])

  // 매칭 해제 — 결제 기록에 연결된 매칭은 기록 단위로, 직접 붙인 매칭은 그 한 건만 (사유 필수)
  const unmatch = async (r: Row, m: Match) => {
    const reason = await reasonDlg.ask('release', `매칭 해제 — ${r.order_no ?? ''}`,
      `${m.label} ${won(m.amount)}원(${m.paid_date})의 매칭을 풉니다. 주문 미수가 그만큼 다시 늘어납니다.${m.record_id ? '\n결제 기록에 연결된 매칭이라 그 기록의 매칭이 모두 풀리고 기록은 매칭 대기로 돌아갑니다.' : ''}`)
    if (!reason) return
    setMsg(null)
    const res = m.record_id
      ? await fetch(`/api/payment-records/${m.record_id}/confirm`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) })
      : await fetch(`/api/erp-matching?id=${m.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setMsg(json.error ?? '매칭 해제 실패'); return }
    setMsg('매칭을 해제했습니다.')
    requestNotifRefresh(); load()
  }

  const recLine = (x: Rec) => `${x.cancel ? '취소' : METHOD[x.method] ?? x.method}${x.kind ? `(${x.kind})` : ''} ${x.clue} · ${x.cancel ? '−' : ''}${won(x.amount)}`
  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button key={label} onClick={onClick} className={`px-3 py-1 rounded-full text-xs border whitespace-nowrap ${on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}>{label}</button>
  )

  return (
    <div className="w-full">
      {reasonDlg.node}
      <p className="text-sm text-gray-500 mb-3">주문마다 결제가 어디까지 왔는지 한눈에 봅니다. 처리할 것은 줄을 펼쳐 매칭 대기 · 결제 안내 대상 탭으로 넘어가서 합니다.</p>
      {msg && <div className="mb-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      {error && <div className="mb-3 px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>}

      <PayFilterBar filter={filter} update={update} scope={scope} noneCount={noneCount} />
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        {STAGES.map(s => chip(stage === s.key, `${s.label} ${counts[s.key] ?? 0}`, () => setStage(s.key)))}
        <span className="ml-auto text-sm text-gray-600">미수 합계 <b className="tabular-nums text-gray-900">{won(outstandingSum)}원</b></span>
      </div>

      {loading || !ready ? (
        <div className="text-center py-20 text-gray-400">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">
          {rows.length === 0 ? '직접 입력한 주문이 아직 없습니다.' : '조건에 맞는 주문이 없습니다. 지점 담당을 "전체"로 바꾸거나 기간 · 검색을 확인하세요.'}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[68rem]">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200 bg-gray-50">
                <th className="py-2.5 px-3 font-medium">주문일 / 번호</th>
                <th className="py-2.5 px-3 font-medium">매출처 · 고객</th>
                <th className="py-2.5 px-3 font-medium">지점 담당</th>
                <th className="py-2.5 px-3 font-medium text-right">주문 금액</th>
                <th className="py-2.5 px-3 font-medium text-right">미수</th>
                <th className="py-2.5 px-3 font-medium">결제 상태</th>
                <th className="py-2.5 px-3 font-medium">결제 기록 · 대조 단서</th>
                <th className="py-2.5 px-3 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, shown).map(r => {
                const first = r.records.find(x => !x.cancel) ?? r.records[0]
                const open = openId === r.order_id
                const pendingRec = r.records.some(x => !x.confirmed_at)
                const det = details[r.order_id]
                return (
                  <Fragment key={r.order_id}>
                    <tr className={`border-b border-gray-100 align-top ${open ? 'bg-slate-50' : ''}`}>
                      <td className="py-2.5 px-3 whitespace-nowrap tabular-nums">{r.order_date}<div className="text-[0.6875rem]"><OrderNoLink id={r.order_id} no={r.order_no} /></div></td>
                      <td className="py-2.5 px-3"><div className="text-gray-900">{r.customer_name || '-'}</div><div className="text-[0.6875rem] text-gray-500">{r.manager}</div></td>
                      <td className="py-2.5 px-3 text-xs whitespace-nowrap">{r.staff_names.length ? r.staff_names.join(', ') : <span className="text-gray-400">담당 미지정</span>}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">{won(r.net)}</td>
                      <td className={`py-2.5 px-3 text-right tabular-nums whitespace-nowrap ${r.outstanding > 0 ? 'font-semibold' : 'text-gray-400'}`}>{won(r.outstanding)}</td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[0.6875rem] font-semibold ${PAY_STAGE_CLS[r.pay.stage]}`}>{PAY_STAGE_LABEL[r.pay.stage]}</span>
                        {showMethodTag(r.pay.stage) && r.pay.method && <span className={`ml-1 inline-block px-1.5 py-0.5 rounded text-[0.6875rem] ${PAY_METHOD_TAG_CLS[r.pay.method]}`}>{PAY_METHOD_TAG_LABEL[r.pay.method]}</span>}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-gray-700">
                        {first ? (<>
                          {recLine(first)}{r.records.length > 1 && <span className="text-gray-400"> 외 {r.records.length - 1}건</span>}
                          <div className="text-[0.6875rem] text-gray-500">기재 {first.created_by_name ?? '-'} · {when(first.created_at)}{first.confirmed_at && ` · 매칭 ${first.confirmed_by_name ?? '-'} · ${when(first.confirmed_at)}`}</div>
                        </>) : r.pay.matched > 0 ? <span className="text-gray-500">기록 없이 입금 · 결제를 직접 붙임</span>
                          : <span className="text-gray-400">기록 없음</span>}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <button onClick={() => setOpenId(open ? null : r.order_id)} className="text-[0.6875rem] px-2 py-0.5 border border-gray-300 rounded text-gray-600 hover:bg-gray-50">{open ? '접기' : '펼치기'}</button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-gray-100 bg-slate-50">
                        <td colSpan={8} className="px-3 pb-3">
                          <div className="bg-white border border-gray-200 rounded-lg p-3 text-xs">
                            <div className="text-gray-500 mb-1.5">결제 기록 {r.records.filter(x => !x.cancel).length}건{det ? ` · 수금 매칭 ${det.matches.length}건 · 연락 기록 ${det.contact_count}건${det.last_contact ? ` (최근 ${det.last_contact.slice(5)})` : ''}` : ' · 매칭 내역 불러오는 중...'}</div>
                            {r.records.map(x => (
                              <div key={x.id} className={`py-1 border-t border-gray-100 first:border-t-0 ${x.cancel ? 'text-orange-800' : 'text-gray-800'}`}>
                                <span className="tabular-nums">{x.pay_date}</span> · {recLine(x)}원
                                <span className={`ml-1.5 px-1.5 py-px rounded text-[0.625rem] font-semibold ${x.confirmed_at ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{x.cancel ? (x.confirmed_at ? '취소 매칭 완료' : '취소 대기') : (x.confirmed_at ? '매칭 완료' : '매칭 대기')}</span>
                                <span className="text-gray-500"> 기재 {x.created_by_name ?? '-'} · {when(x.created_at)}{x.confirmed_at && ` · 매칭 ${x.confirmed_by_name ?? '-'} · ${when(x.confirmed_at)}`}</span>
                              </div>
                            ))}
                            {(det?.matches ?? []).map(m => (
                              <div key={m.id} className="py-1 border-t border-gray-100 flex items-center gap-2 flex-wrap">
                                <span className="text-gray-800"><span className="tabular-nums">{m.paid_date}</span> · {m.label} · <b className={`tabular-nums ${m.amount < 0 ? 'text-red-700' : ''}`}>{won(m.amount)}원</b></span>
                                <span className="text-gray-500">매칭 {m.matched_by_name ?? (m.derived ? '계산서 입금에서 넘어옴' : '기록 없음')}{m.created_at && ` · ${when(m.created_at)}`}</span>
                                {canEdit && !m.derived && m.amount > 0 && m.source_type !== 'prepay' && (
                                  <button onClick={() => unmatch(r, m)} className="ml-auto px-2 py-0.5 border border-red-200 text-red-600 rounded hover:bg-red-50">매칭 해제</button>
                                )}
                              </div>
                            ))}
                            {det && r.records.length === 0 && det.matches.length === 0 && <div className="text-gray-400 py-1">결제 기록과 수금 매칭이 없습니다.</div>}
                            <div className="flex gap-2 flex-wrap mt-2.5">
                              {pendingRec && <Link href={`/payments?tab=match&q=${encodeURIComponent(r.order_no ?? '')}`} className="px-2.5 py-1 rounded bg-slate-900 text-white font-semibold">매칭 대기에서 열기</Link>}
                              {(r.pay.stage === 'unpaid' || r.pay.stage === 'partial_pay') && <Link href={`/payments?tab=guide&q=${encodeURIComponent(r.order_no ?? '')}`} className="px-2.5 py-1 rounded bg-slate-900 text-white font-semibold">결제 안내에서 열기</Link>}
                              <Link href={`/orders/${r.order_id}`} className="px-2.5 py-1 border border-gray-300 rounded text-gray-700 hover:bg-gray-50">주문 상세</Link>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          {filtered.length > shown && (
            <div className="p-3 text-center border-t border-gray-100">
              <button onClick={() => setShown(n => n + PAGE)} className="px-4 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">더 보기 ({shown} / {filtered.length})</button>
            </div>
          )}
        </div>
      )}

      {released.length > 0 && (
        <div className="mt-4">
          <button onClick={() => setShowReleased(v => !v)} className="text-sm text-gray-600 hover:underline">{showReleased ? '▾' : '▸'} 최근 매칭 해제 이력 ({released.length}건)</button>
          {showReleased && (
            <div className="mt-2 bg-white border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                  <th className="py-2 px-3 font-medium">해제 시각</th><th className="py-2 px-3 font-medium">해제한 사람</th><th className="py-2 px-3 font-medium">주문번호</th>
                  <th className="py-2 px-3 font-medium">결제일</th><th className="py-2 px-3 font-medium text-right">금액</th><th className="py-2 px-3 font-medium">어디서</th><th className="py-2 px-3 font-medium">사유</th>
                </tr></thead>
                <tbody>
                  {released.map(l => (
                    <tr key={l.id} className="border-b border-gray-100">
                      <td className="py-2 px-3 whitespace-nowrap tabular-nums text-gray-600">{when(l.created_at)}</td>
                      <td className="py-2 px-3 whitespace-nowrap">{l.employee_name ?? '-'}</td>
                      <td className="py-2 px-3 whitespace-nowrap">{l.order_no ?? '-'}</td>
                      <td className="py-2 px-3 whitespace-nowrap text-gray-600">{l.paid_date ?? '-'}</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap tabular-nums">{l.amount != null ? won(l.amount) : '-'}</td>
                      <td className="py-2 px-3 text-xs text-gray-500">{l.origin ?? ''}</td>
                      <td className="py-2 px-3 text-gray-700">{l.reason_text ?? <span className="text-gray-400">사유 없음</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
