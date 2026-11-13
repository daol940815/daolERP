'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useNotifRefresh, requestNotifRefresh } from '@/lib/use-notif-refresh'

// 결제 확인 (1300, 2026-11-13 사용자 확정 — 시안 docs/mockups/결제처리_시안.html)
// 영업지원이 주문 상세에 남긴 결제 기록(1차)을 카드 매출 · 통장 입금 원본과 대조해 확정한다(2차).
// 시스템은 후보만 붙이고, 확정은 사람이 누른다. 확정하면 기록의 주문별 금액대로 수금 매칭이 만들어져 미수가 줄어든다.

type Method = 'card' | 'transfer' | 'invoice'
interface Cand {
  source_type: 'bank' | 'card'; source_id: string; tx_date: string; label: string
  amount: number; remaining: number; strength: 'strong' | 'weak' | 'mismatch'; reason: string
}
interface Row {
  id: string; method: Method; pay_date: string; amount: number
  approval_number: string | null; card_last4: string | null; depositor_name: string | null; due_date: string | null
  memo: string | null; vendor_name: string | null; created_by_name: string | null; created_at: string
  confirmed_by_name: string | null; confirmed_at: string | null
  orders: { order_id: string; order_no: string | null; amount: number }[]
  candidates: Cand[]; flag: 'ready' | 'mismatch' | 'overdue' | 'waiting' | null; wait_days: number
  invoice_linked: number | null
  matched: { source_type: string; label: string; paid_date: string; amount: number }[]
  mine: boolean
}
interface Found {
  source_type: 'bank' | 'card'; id: string; tx_date: string; label: string; vendor_name: string | null
  amount: number; remaining: number
}

const won = (n: number) => n.toLocaleString('ko-KR')
const SHORT: Record<Method, string> = { card: '카드', transfer: '계좌이체', invoice: '계산서 발행' }
const BADGE: Record<Method, string> = {
  card: 'bg-violet-50 text-violet-700', transfer: 'bg-blue-50 text-blue-700', invoice: 'bg-indigo-50 text-indigo-700',
}
const clue = (r: Row) => r.method === 'card'
  ? [r.approval_number && `승인 ${r.approval_number}`, r.card_last4 && `카드 뒤 ${r.card_last4}`].filter(Boolean).join(' · ')
  : r.method === 'transfer' ? (r.depositor_name ? `입금자 ${r.depositor_name}` : '입금자 미기재')
    : (r.due_date ? `입금 예정 ${r.due_date}` : '입금 예정일 미기재')

type Kpi = 'all' | 'ready' | 'mismatch' | 'overdue'

export default function PaymentConfirmPage() {
  const [tab, setTab] = useState<'pending' | 'confirmed'>('pending')
  const [rows, setRows] = useState<Row[]>([])
  const [latest, setLatest] = useState<{ card: string | null; bank: string | null }>({ card: null, bank: null })
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [kpi, setKpi] = useState<Kpi>('all')
  const [method, setMethod] = useState<Method | 'all'>('all')
  const [mineOnly, setMineOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  // 다른 입금 찾기
  const [findId, setFindId] = useState<string | null>(null)
  const [findQ, setFindQ] = useState('')
  const [findAmount, setFindAmount] = useState(true)
  const [found, setFound] = useState<Found[]>([])
  const [finding, setFinding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const res = await fetch(`/api/payment-records?state=${tab}`)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setError(json.error ?? '조회 실패'); setRows([]) }
    else { setRows(json.rows ?? []); setLatest(json.latest ?? { card: null, bank: null }); setCanEdit(!!json.can_edit) }
    setLoading(false)
  }, [tab])
  useEffect(() => { load() }, [load])
  useNotifRefresh(load)

  const counts = useMemo(() => ({
    all: rows.length,
    amount: rows.reduce((s, r) => s + r.amount, 0),
    ready: rows.filter(r => r.flag === 'ready').length,
    mismatch: rows.filter(r => r.flag === 'mismatch').length,
    overdue: rows.filter(r => r.flag === 'overdue').length,
  }), [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (tab === 'pending' && kpi !== 'all' && r.flag !== kpi) return false
      if (method !== 'all' && r.method !== method) return false
      if (mineOnly && !r.mine) return false
      if (!q) return true
      return [r.vendor_name, r.approval_number, r.depositor_name, r.created_by_name, r.memo, String(r.amount), ...r.orders.map(o => o.order_no)]
        .some(v => (v ?? '').toLowerCase().includes(q))
    })
  }, [rows, tab, kpi, method, mineOnly, search])

  const confirmWith = async (r: Row, src: { source_type: 'bank' | 'card'; source_id: string; tx_date: string; label: string }) => {
    const orders = r.orders.map(o => `${o.order_no ?? ''} ${won(o.amount)}원`).join('\n')
    if (!confirm(`이 결제를 확정할까요?\n\n기록: ${SHORT[r.method]} ${r.pay_date} ${won(r.amount)}원\n원본: ${src.label} ${src.tx_date}\n\n주문별 수금 처리\n${orders}`)) return
    setBusyId(r.id); setMsg(null)
    const res = await fetch(`/api/payment-records/${r.id}/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources: [{ source_type: src.source_type, source_id: src.source_id, amount: r.amount }] }),
    })
    const json = await res.json().catch(() => ({}))
    setBusyId(null)
    if (!res.ok) { setMsg(json.error ?? '확정 실패'); return }
    setMsg(`확정했습니다 — ${r.vendor_name ?? ''} ${won(r.amount)}원, 주문 ${r.orders.length}건의 미수가 줄었습니다.`)
    setFindId(null); requestNotifRefresh(); load()
  }

  const release = async (r: Row) => {
    const reason = prompt(`확인 해제 — 이 결제의 수금 처리를 되돌립니다.\n기록은 "확인 대기"로 돌아가고 주문 미수가 ${won(r.amount)}원 다시 늘어납니다.\n\n해제 사유를 입력하세요.`)
    if (reason == null) return
    if (reason.trim().length < 2) { setMsg('확인 해제 사유를 입력해야 합니다.'); return }
    setBusyId(r.id); setMsg(null)
    const res = await fetch(`/api/payment-records/${r.id}/confirm`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
    })
    const json = await res.json().catch(() => ({}))
    setBusyId(null)
    if (!res.ok) { setMsg(json.error ?? '확인 해제 실패'); return }
    setMsg('확인 해제했습니다 — 기록이 확인 대기로 돌아갔습니다.')
    requestNotifRefresh(); load()
  }

  const runFind = async (r: Row, q = findQ, useAmount = findAmount) => {
    setFinding(true)
    const p = new URLSearchParams()
    if (q.trim()) p.set('q', q.trim())
    if (!useAmount) p.set('amount', '')
    const res = await fetch(`/api/payment-records/${r.id}/sources?${p}`)
    const json = await res.json().catch(() => ({}))
    setFinding(false)
    if (!res.ok) { setMsg(json.error ?? '검색 실패'); setFound([]); return }
    const want = r.method === 'card' ? 'card' : 'bank'
    setFound(((json.candidates ?? []) as Found[]).filter(c => c.source_type === want))
  }
  const openFind = (r: Row) => {
    if (findId === r.id) { setFindId(null); return }
    setFindId(r.id); setFindQ(''); setFindAmount(true); setFound([]); runFind(r, '', true)
  }

  const kpiCard = (key: Kpi, label: string, value: string, sub: string, tone = 'text-gray-900') => (
    <button onClick={() => { setTab('pending'); setKpi(key) }}
      className={`text-left bg-white border rounded-xl px-4 py-3 ${tab === 'pending' && kpi === key ? 'border-slate-900 ring-1 ring-slate-900' : 'border-gray-200 hover:border-gray-300'}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-bold mt-1 ${tone}`}>{value}</p>
      <p className="text-[0.6875rem] text-gray-400">{sub}</p>
    </button>
  )
  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs border ${on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
      {label}
    </button>
  )

  return (
    <div className="w-full">
      <div className="mb-3">
        <h1 className="text-2xl font-bold text-gray-900">결제 확인</h1>
        <p className="text-sm mt-1 text-gray-500">
          주문에 남긴 결제 기록을 카드 매출 · 통장 입금 원본과 대조해 확정합니다. 확정해야 주문 미수가 줄어듭니다.
          <span className="text-gray-400"> 원본 최신일 — 카드 매출 {latest.card ?? '없음'} · 통장 {latest.bank ?? '없음'}</span>
        </p>
      </div>

      {msg && <div className="mb-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      {error && <div className="mb-3 px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>}

      {tab === 'pending' && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
          {kpiCard('all', '확인 대기', `${counts.all}건`, `${won(counts.amount)}원`)}
          {kpiCard('ready', '후보 있음', `${counts.ready}건`, '원본에서 찾음 — 확인 후 확정', 'text-emerald-700')}
          {kpiCard('mismatch', '불일치', `${counts.mismatch}건`, '금액 · 원본 잔액이 기록과 다름', 'text-red-600')}
          {kpiCard('overdue', '대기 경과', `${counts.overdue}건`, '원본이 올라왔는데 후보 없음', 'text-amber-700')}
          <Link href="/erp-matching" className="text-left bg-white border border-gray-200 hover:border-gray-300 rounded-xl px-4 py-3">
            <p className="text-xs text-gray-500">기록 없는 입금</p>
            <p className="text-sm font-semibold mt-1 text-gray-900">입금 매칭으로 이동</p>
            <p className="text-[0.6875rem] text-gray-400">안내 없이 들어온 입금을 주문에 붙임</p>
          </Link>
        </div>
      )}

      <div className="flex gap-1 border-b border-gray-200 mb-3">
        {([['pending', '확인 대기'], ['confirmed', '확인 완료 (최근 200건)']] as const).map(([k, label]) => (
          <button key={k} onClick={() => { setTab(k); setKpi('all'); setFindId(null) }}
            className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 whitespace-nowrap ${tab === k ? 'border-slate-900 text-slate-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        {chip(method === 'all', '전체 수단', () => setMethod('all'))}
        {(['card', 'transfer', 'invoice'] as Method[]).map(m => <Fragment key={m}>{chip(method === m, SHORT[m], () => setMethod(m))}</Fragment>)}
        <span className="w-px h-5 bg-gray-200 mx-1" />
        {chip(mineOnly, '내가 입력한 것', () => setMineOnly(v => !v))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="매출처 · 주문번호 · 승인번호 · 입금자 · 금액 검색"
          className="ml-auto border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-72 max-w-full focus:outline-none focus:ring-2 focus:ring-slate-900" />
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">
          {rows.length === 0 ? (tab === 'pending' ? '확인을 기다리는 결제 기록이 없습니다. 결제 기록은 주문 상세 › 결제 내역에서 남깁니다.' : '확인된 결제 기록이 아직 없습니다.') : '조건에 맞는 기록이 없습니다.'}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[64rem]">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200 bg-gray-50">
                <th className="py-2.5 px-3 font-medium">결제일</th>
                <th className="py-2.5 px-3 font-medium">수단</th>
                <th className="py-2.5 px-3 font-medium">매출처 · 주문</th>
                <th className="py-2.5 px-3 font-medium text-right">기록 금액</th>
                <th className="py-2.5 px-3 font-medium">대조 단서</th>
                <th className="py-2.5 px-3 font-medium">{tab === 'pending' ? '원본 후보' : '대조한 원본'}</th>
                <th className="py-2.5 px-3 font-medium">{tab === 'pending' ? '기록' : '기록 · 확인'}</th>
                <th className="py-2.5 px-3 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <Fragment key={r.id}>
                  <tr className="border-b border-gray-100 align-top">
                    <td className="py-2.5 px-3 tabular-nums whitespace-nowrap">{r.pay_date}</td>
                    <td className="py-2.5 px-3">
                      <span className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[0.6875rem] font-medium ${BADGE[r.method]}`}>{SHORT[r.method]}</span>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="text-gray-900">{r.vendor_name ?? '(매출처 미연결)'}</div>
                      <div className="text-[0.6875rem] text-gray-500">
                        {r.orders.map((o, i) => (
                          <Fragment key={o.order_id}>
                            {i > 0 && ', '}
                            <Link href={`/orders/${o.order_id}`} className="hover:underline tabular-nums">{o.order_no ?? '-'}</Link>
                            {r.orders.length > 1 && <span className="text-gray-400"> {won(o.amount)}</span>}
                          </Fragment>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold tabular-nums whitespace-nowrap">{won(r.amount)}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-700">
                      {clue(r)}
                      {r.method === 'invoice' && r.invoice_linked != null && (
                        <div className={`text-[0.6875rem] ${r.invoice_linked === 0 ? 'text-gray-400' : r.invoice_linked === r.amount ? 'text-emerald-700' : 'text-red-600'}`}>
                          {r.invoice_linked === 0 ? '홈택스 계산서 미연결' : r.invoice_linked === r.amount ? '홈택스 계산서 연결됨' : `홈택스 계산서 ${won(r.invoice_linked)}원 — 기록과 다름`}
                        </div>
                      )}
                      {r.memo && <div className="text-[0.6875rem] text-gray-400">{r.memo}</div>}
                    </td>
                    <td className="py-2.5 px-3 text-xs">
                      {tab === 'confirmed' ? (
                        r.matched.map((m, i) => (
                          <div key={i} className="text-gray-700">{m.label} <span className="tabular-nums text-gray-500">{m.paid_date} · {won(m.amount)}원</span></div>
                        ))
                      ) : r.candidates.length === 0 ? (
                        <span className={r.flag === 'overdue' ? 'text-red-600' : 'text-gray-400'}>
                          {r.method === 'invoice'
                            ? (r.flag === 'overdue' ? `입금 예정일 지남 · 입금 없음` : '입금 전')
                            : r.flag === 'overdue' ? `후보 없음 · ${r.wait_days}일째` : `원본 대기 (${r.method === 'card' ? '카드 매출' : '통장'} 최신 ${(r.method === 'card' ? latest.card : latest.bank) ?? '없음'})`}
                        </span>
                      ) : (
                        <div className="space-y-1">
                          {r.candidates.map(c => (
                            <div key={c.source_id} className={`rounded-lg border px-2 py-1.5 ${c.strength === 'strong' ? 'bg-green-50 border-green-200' : c.strength === 'mismatch' ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                              <div className="flex items-center gap-2">
                                <span className="text-gray-800">{c.label} <span className="tabular-nums">{c.tx_date}</span> <b className={`tabular-nums ${c.strength === 'mismatch' ? 'text-red-600' : ''}`}>{won(c.amount)}</b></span>
                                {canEdit && c.strength !== 'mismatch' && (
                                  <button onClick={() => confirmWith(r, c)} disabled={busyId === r.id}
                                    className={`ml-auto whitespace-nowrap px-2 py-0.5 rounded text-[0.6875rem] font-semibold disabled:opacity-40 ${c.strength === 'strong' ? 'bg-slate-900 text-white hover:bg-slate-700' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-100'}`}>
                                    확정
                                  </button>
                                )}
                              </div>
                              <div className="text-[0.6875rem] text-gray-500">{c.reason}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-xs text-gray-700 whitespace-nowrap">
                      {r.created_by_name ?? '-'}{r.mine && <span className="text-[0.625rem] text-gray-400"> (나)</span>}
                      {tab === 'confirmed' && <div className="text-[0.6875rem] text-gray-400">확인 {r.confirmed_by_name ?? '-'} {r.confirmed_at?.slice(5, 10)}</div>}
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      {tab === 'pending' ? (<>
                        {r.flag === 'mismatch' && <div className="mb-1"><span className="inline-block px-1.5 py-0.5 rounded text-[0.6875rem] font-semibold bg-red-100 text-red-700">불일치</span></div>}
                        {canEdit && (
                          <button onClick={() => openFind(r)}
                            className="text-[0.6875rem] px-2 py-0.5 border border-gray-300 rounded text-gray-600 hover:bg-gray-50">
                            {findId === r.id ? '찾기 닫기' : '다른 입금 찾기'}
                          </button>
                        )}
                        {(r.flag === 'mismatch' || r.flag === 'overdue') && (
                          <div className="mt-1">
                            <Link href="/me/requests/new" className="text-[0.6875rem] text-gray-500 underline">입력자에게 업무 요청</Link>
                          </div>
                        )}
                      </>) : canEdit && (
                        <button onClick={() => release(r)} disabled={busyId === r.id}
                          className="text-[0.6875rem] px-2 py-0.5 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-40">확인 해제</button>
                      )}
                    </td>
                  </tr>
                  {findId === r.id && (
                    <tr className="border-b border-gray-100 bg-slate-50">
                      <td colSpan={8} className="px-3 py-3">
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <span className="text-xs font-semibold text-gray-700">{r.method === 'card' ? '카드 매출' : '통장 입금'}에서 직접 찾기</span>
                          <input value={findQ} onChange={e => setFindQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') runFind(r) }}
                            placeholder={r.method === 'card' ? '카드번호 일부 · 매입사' : '입금자 · 적요'}
                            className="border border-gray-300 rounded-lg px-2.5 py-1 text-xs w-52 bg-white" />
                          <label className="text-xs text-gray-600 flex items-center gap-1">
                            <input type="checkbox" checked={findAmount} onChange={e => { setFindAmount(e.target.checked); runFind(r, findQ, e.target.checked) }} />
                            금액 {won(r.amount)}원만
                          </label>
                          <button onClick={() => runFind(r)} className="px-2.5 py-1 rounded-lg text-xs bg-slate-900 text-white">찾기</button>
                          <span className="text-[0.6875rem] text-gray-400">결제일 7일 전부터 · 아직 주문에 배분되지 않은 것만</span>
                        </div>
                        {finding ? <div className="text-xs text-gray-400 py-2">찾는 중...</div>
                          : found.length === 0 ? <div className="text-xs text-gray-400 py-2">조건에 맞는 원본이 없습니다. 원본 파일이 아직 올라오지 않았을 수 있습니다.</div>
                            : (
                              <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-64 overflow-y-auto">
                                {found.map(c => (
                                  <div key={c.id} className="flex items-center gap-3 px-2.5 py-1.5 text-xs flex-wrap">
                                    <span className="tabular-nums text-gray-500">{c.tx_date}</span>
                                    <span className="text-gray-800">{c.label}</span>
                                    {c.vendor_name && <span className="text-gray-400">{c.vendor_name}</span>}
                                    <span className="ml-auto tabular-nums">잔액 <b>{won(c.remaining)}</b>{c.remaining !== c.amount && <span className="text-gray-400"> / {won(c.amount)}</span>}</span>
                                    {c.remaining >= r.amount ? (
                                      <button onClick={() => confirmWith(r, { source_type: c.source_type, source_id: c.id, tx_date: c.tx_date, label: c.label })} disabled={busyId === r.id}
                                        className="px-2 py-0.5 rounded bg-slate-900 text-white font-semibold disabled:opacity-40">이 원본으로 확정</button>
                                    ) : <span className="text-gray-400">잔액 부족</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[0.6875rem] text-gray-400 mt-3 leading-relaxed">
        확정은 사람이 누릅니다 — 시스템은 후보만 붙입니다. 금액이 기록과 다르면 확정할 수 없으니 입력자가 기록을 고친 뒤 확정하세요.
        확정된 기록은 잠기며, 잘못 확정했으면 확인 완료 탭에서 확인 해제(사유 필수)로 되돌립니다.
      </p>
    </div>
  )
}
