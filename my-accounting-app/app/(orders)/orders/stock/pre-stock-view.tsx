'use client'

// 재고 관리 › 선매입 재고 탭 (1400 — 시안 ③ · ④)
// 입고분(선매입 입고 행)마다 남은 수량 · 단가가 쌓이고, 재고 출고 행이 먼저 들어온 입고분부터 가져간다(선입선출).
// 재고 = 입고 − 출고 ± 조정 (저장하지 않고 계산). 품명을 누르면 품목 원장, 주문번호를 누르면 주문 상세.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { STOCK_VAT_NOTE } from '@/lib/stock-cost'

const won = (n: number | null | undefined) => Math.round(n ?? 0).toLocaleString('ko-KR')
const mmdd = (d: string | null) => (d ? d.slice(5).replace('-', '/') : '-')

interface LotRow { key: string; order_id: string | null; order_no: string | null; line_no: number | null; date: string; quantity: number; unit_cost: number; remaining: number; adjust: boolean }
interface Row {
  product_id: string; item_code: string | null; item_name: string; purchase_vendor_name: string | null
  in_qty: number; out_qty: number; adj_qty: number; stock: number; value: number; avg_cost: number
  oldest_date: string | null; oldest_days: number | null
  last_take: { take_date: string; counted_qty: number; computed_qty: number } | null
  lots: LotRow[]
}
interface Overview {
  asof: string; today: string; old_days: number; rows: Row[]
  kpi: { products_with_stock: number; products_total: number; value: number; month_in: number; month_in_count: number; month_out_cost: number; month_out_count: number; old: number; pending_out: number }
  migration1400?: boolean; error?: string
}
interface LedgerLine {
  date: string; kind: 'in' | 'out' | 'adjust'; order_id: string | null; order_no: string | null; line_no: number | null
  party: string; purpose: string; quantity: number; unit_cost: number; amount: number; lot: string; staff: string | null; balance: number
}

type Chip = 'stock' | 'zero' | 'old' | 'all'
const CHIPS: { key: Chip; label: string }[] = [
  { key: 'stock', label: '재고 있음' }, { key: 'zero', label: '재고 0' }, { key: 'old', label: '오래된 재고' }, { key: 'all', label: '전체' },
]

export default function PreStockView({ asof: asofParam, productId }: { asof: string | null; productId: string | null }) {
  const [asof, setAsof] = useState<string>(asofParam ?? '')
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [chip, setChip] = useState<Chip>('stock')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [ledgerOf, setLedgerOf] = useState<string | null>(productId)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/stock${asof ? `?asof=${asof}` : ''}`)
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? '조회 실패')
      setData(j)
      if (j.migration1400 === false) setError(j.error)
    } catch (e) { setError(e instanceof Error ? e.message : '조회 실패') }
    setLoading(false)
  }, [asof])
  useEffect(() => { load() }, [load])

  const rows = useMemo(() => {
    const all = data?.rows ?? []
    const t = q.trim().toLowerCase()
    return all.filter(r => {
      if (chip === 'stock' && r.stock <= 0) return false
      if (chip === 'zero' && r.stock !== 0) return false
      if (chip === 'old' && !(r.stock > 0 && (r.oldest_days ?? 0) > (data?.old_days ?? 90))) return false
      if (!t) return true
      return [r.item_code, r.item_name, r.purchase_vendor_name].some(v => (v ?? '').toLowerCase().includes(t))
    })
  }, [data, q, chip])
  const chipCount = (c: Chip) => (data?.rows ?? []).filter(r =>
    c === 'stock' ? r.stock > 0 : c === 'zero' ? r.stock === 0 : c === 'old' ? r.stock > 0 && (r.oldest_days ?? 0) > (data?.old_days ?? 90) : true).length

  const k = data?.kpi
  const isPast = !!data && data.asof !== data.today
  const yearEnd = !!data && data.asof.endsWith('-12-31')
  const toggle = (id: string) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const card = 'rounded-xl border bg-white px-4 py-3 text-left'
  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-3 text-[0.8125rem]">
        <label className="text-slate-500">기준일</label>
        <input type="date" value={asof || data?.today || ''} onChange={e => setAsof(e.target.value)}
          className="border border-slate-200 rounded-lg px-2 py-1 text-[0.8125rem]" />
        {asof && <button type="button" onClick={() => setAsof('')} className="text-slate-500 underline">오늘로</button>}
        {isPast && <span className="text-amber-700">{data!.asof} 말 기준 재고입니다{yearEnd ? ' — 연말 재고(세무사에게 넘길 기말 재고자산)' : ''}.</span>}
        <span className="ml-auto text-slate-400 text-[0.75rem]">입력 · 수정은 주문 입력의 품목 행 &quot;재고&quot; 칸에서 합니다</span>
      </div>

      {error && <div className="mb-3 px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">{error}</div>}

      {k && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 mb-3">
          <button type="button" onClick={() => setChip('stock')} className={`${card} ${chip === 'stock' ? 'border-slate-900' : 'border-slate-200'}`}>
            <div className="text-[0.75rem] text-slate-500">재고 있는 품목</div>
            <div className="text-lg font-bold tabular-nums">{won(k.products_with_stock)}<span className="text-[0.75rem] font-normal text-slate-400 ml-1">/ 전체 {won(k.products_total)}</span></div>
          </button>
          <div className={`${card} border-slate-200`} title={`남은 입고분 × 입고 단가(부가세 포함). 월별 손익에서는 공급가액 — ${STOCK_VAT_NOTE}`}>
            <div className="text-[0.75rem] text-slate-500">재고 금액{yearEnd ? ' (연말 재고)' : ''}</div>
            <div className="text-lg font-bold tabular-nums">{won(k.value)}</div>
          </div>
          <div className={`${card} border-slate-200`}>
            <div className="text-[0.75rem] text-slate-500">{data!.asof.slice(5, 7)}월 입고</div>
            <div className="text-lg font-bold tabular-nums">{won(k.month_in)}<span className="text-[0.75rem] font-normal text-slate-400 ml-1">{k.month_in_count}건</span></div>
          </div>
          <div className={`${card} border-slate-200`}>
            <div className="text-[0.75rem] text-slate-500">{data!.asof.slice(5, 7)}월 출고 원가</div>
            <div className="text-lg font-bold tabular-nums">{won(k.month_out_cost)}<span className="text-[0.75rem] font-normal text-slate-400 ml-1">{k.month_out_count}건</span></div>
          </div>
          <button type="button" onClick={() => setChip('old')} className={`${card} ${chip === 'old' ? 'border-slate-900' : 'border-slate-200'}`}>
            <div className="text-[0.75rem] text-slate-500">오래된 재고</div>
            <div className={`text-lg font-bold tabular-nums ${k.old > 0 ? 'text-amber-700' : ''}`}>{won(k.old)}<span className="text-[0.75rem] font-normal text-slate-400 ml-1">입고 후 {data!.old_days}일 넘게</span></div>
          </button>
        </div>
      )}
      {k && k.pending_out > 0 && (
        <div className="mb-3 px-4 py-2 bg-red-50 border border-red-200 text-red-700 text-[0.8125rem] rounded-lg">
          재고 원가가 배정되지 않은 재고 출고 행이 {k.pending_out}건 있습니다(저장 때 재고가 모자랐음). 주문 상세의 재고 원가 칸에 &quot;미배정&quot;으로 보입니다 — 입고를 먼저 넣었는지 확인해 주세요.
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap mb-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="품번 · 품명 · 매입처 검색"
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-[0.8125rem] w-64" />
        {CHIPS.map(c => (
          <button key={c.key} type="button" onClick={() => setChip(c.key)}
            className={`px-3 py-1 rounded-full text-[0.75rem] border ${chip === c.key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}>
            {c.label} <span className="tabular-nums opacity-70">{chipCount(c.key)}</span>
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-[0.8125rem] min-w-[60rem]">
          <thead>
            <tr className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <th className="py-2 px-2.5 text-left font-medium">품번</th>
              <th className="py-2 px-2.5 text-left font-medium">품명</th>
              <th className="py-2 px-2.5 text-left font-medium">매입처</th>
              <th className="py-2 px-2.5 text-right font-medium">입고 누계</th>
              <th className="py-2 px-2.5 text-right font-medium">출고 누계</th>
              <th className="py-2 px-2.5 text-right font-medium">조정</th>
              <th className="py-2 px-2.5 text-right font-medium">재고</th>
              <th className="py-2 px-2.5 text-right font-medium">평균 단가</th>
              <th className="py-2 px-2.5 text-right font-medium">재고 금액</th>
              <th className="py-2 px-2.5 text-left font-medium">가장 오래된 입고</th>
              <th className="py-2 px-2.5 text-left font-medium">최근 실사</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={11} className="py-8 text-center text-slate-400">불러오는 중...</td></tr>}
            {!loading && !rows.length && (
              <tr><td colSpan={11} className="py-8 text-center text-slate-400">
                {(data?.rows.length ?? 0) === 0 ? '선매입 입고 행이 아직 없습니다 — 주문 입력에서 품목 행의 재고 칸을 &quot;선매입 입고&quot;로 저장하면 여기에 쌓입니다.' : '조건에 맞는 품목이 없습니다.'}
              </td></tr>
            )}
            {!loading && rows.map(r => {
              const old = r.stock > 0 && (r.oldest_days ?? 0) > (data?.old_days ?? 90)
              const live = r.lots.filter(l => l.remaining > 0)
              const take = r.last_take
              return (
                <Fragment key={r.product_id}>
                  <tr className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="py-2 px-2.5 tabular-nums text-slate-500">{r.item_code ?? '-'}</td>
                    <td className="py-2 px-2.5">
                      <button type="button" onClick={() => setLedgerOf(r.product_id)} className="font-medium text-slate-900 hover:underline text-left">{r.item_name}</button>
                      {r.lots.length > 0 && (
                        <button type="button" onClick={() => toggle(r.product_id)} className="ml-2 text-[0.6875rem] text-slate-400 hover:text-slate-700">
                          입고분 {r.lots.length} {open.has(r.product_id) ? '접기' : '보기'}
                        </button>
                      )}
                    </td>
                    <td className="py-2 px-2.5 text-slate-600">{r.purchase_vendor_name ?? '-'}</td>
                    <td className="py-2 px-2.5 text-right tabular-nums">{won(r.in_qty)}</td>
                    <td className="py-2 px-2.5 text-right tabular-nums">{won(r.out_qty)}</td>
                    <td className={`py-2 px-2.5 text-right tabular-nums ${r.adj_qty < 0 ? 'text-red-600' : ''}`}>{r.adj_qty ? (r.adj_qty > 0 ? `+${won(r.adj_qty)}` : won(r.adj_qty)) : '0'}</td>
                    <td className="py-2 px-2.5 text-right tabular-nums font-bold">{won(r.stock)}</td>
                    <td className="py-2 px-2.5 text-right tabular-nums">{r.stock > 0 ? won(r.avg_cost) : '-'}</td>
                    <td className="py-2 px-2.5 text-right tabular-nums font-semibold">{won(r.value)}</td>
                    <td className={`py-2 px-2.5 tabular-nums ${old ? 'text-amber-700 font-semibold' : 'text-slate-600'}`}>
                      {r.oldest_date ? `${mmdd(r.oldest_date)} (${r.oldest_days}일)` : '-'}
                    </td>
                    <td className="py-2 px-2.5 text-slate-600">
                      {take ? `${mmdd(take.take_date)} · ${take.counted_qty === take.computed_qty ? '일치' : `${take.counted_qty - take.computed_qty > 0 ? '+' : ''}${take.counted_qty - take.computed_qty}`}` : '없음'}
                    </td>
                  </tr>
                  {open.has(r.product_id) && (
                    <tr className="border-b border-slate-100 bg-slate-50/60">
                      <td />
                      <td colSpan={10} className="py-1.5 px-2.5 text-[0.75rem] text-slate-600">
                        {r.lots.map((l, i) => (
                          <span key={l.key}>
                            {i > 0 && <span className="text-slate-300 mx-1.5">|</span>}
                            {l.order_id
                              ? <Link href={`/orders/${l.order_id}`} className="text-blue-700 hover:underline tabular-nums">{l.order_no}{l.line_no ? ` #${l.line_no}` : ''}</Link>
                              : <span>조정</span>}
                            {' '}<span className="tabular-nums">{mmdd(l.date)} · {won(l.quantity)}개 × {won(l.unit_cost)} · 남음 {won(l.remaining)}</span>
                          </span>
                        ))}
                        {live.length > 0 && <span className="ml-2 text-teal-700">· 다음 출고는 {mmdd(live[0].date)}분 {won(live[0].remaining)}개부터</span>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
          {!loading && rows.length > 0 && (
            <tfoot>
              <tr className="bg-slate-50 font-bold border-t-2 border-slate-200">
                <td className="py-2 px-2.5" colSpan={6}>합계 ({rows.length}품목)</td>
                <td className="py-2 px-2.5 text-right tabular-nums">{won(rows.reduce((s, r) => s + r.stock, 0))}</td>
                <td />
                <td className="py-2 px-2.5 text-right tabular-nums">{won(rows.reduce((s, r) => s + r.value, 0))}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-2 text-[0.75rem] text-slate-400 leading-relaxed">
        · 재고 금액 = 남은 입고분 수량 × 각 입고 단가(입고 행 매입합계 ÷ 수량, 부가세 포함). 세무사 자료가 오기 전 내부 확인용 기말 재고 금액으로도 씁니다.<br />
        · 기존에 배송종류 &quot;샘플&quot;로 넣은 선매입 건은 기초재고를 넣기 전까지 여기에 나오지 않습니다(확인 중).
      </p>

      {ledgerOf && <Ledger productId={ledgerOf} asof={data?.asof ?? null} onClose={() => setLedgerOf(null)} />}
    </div>
  )
}

// 품목 원장 (시안 ④) — 입고 · 출고 · 조정이 모두 원본으로 이어진다
function Ledger({ productId, asof, onClose }: { productId: string; asof: string | null; onClose: () => void }) {
  const [d, setD] = useState<{ product: { item_code: string | null; item_name: string } | null; lines: LedgerLine[]; stock: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    setD(null); setErr(null)
    fetch(`/api/stock/ledger?product_id=${productId}`).then(async r => {
      const j = await r.json()
      if (!r.ok) setErr(j.error ?? '조회 실패'); else setD(j)
    }).catch(() => setErr('조회 실패'))
  }, [productId])
  const KIND: Record<string, { label: string; cls: string }> = {
    in: { label: '입고', cls: 'text-violet-700' }, out: { label: '출고', cls: 'text-teal-700' }, adjust: { label: '조정', cls: 'text-amber-700' },
  }
  return (
    <div className="mt-4 bg-white border border-slate-200 rounded-xl">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100">
        <div className="text-sm font-bold text-slate-900">품목 원장</div>
        {d?.product && <span className="text-[0.8125rem] text-slate-600">{d.product.item_name} <span className="text-slate-400 tabular-nums">{d.product.item_code ?? ''}</span> · 재고 <b className="tabular-nums">{won(d.stock)}</b></span>}
        <button type="button" onClick={onClose} className="ml-auto text-[0.75rem] text-slate-500 hover:text-slate-800">닫기</button>
      </div>
      {err && <div className="px-4 py-3 text-sm text-red-600">{err}</div>}
      {!d && !err && <div className="px-4 py-6 text-center text-slate-400 text-sm">불러오는 중...</div>}
      {d && (
        <div className="overflow-x-auto">
          <table className="w-full text-[0.8125rem] min-w-[56rem]">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <th className="py-1.5 px-2.5 text-left font-medium">날짜</th>
                <th className="py-1.5 px-2.5 text-left font-medium">구분</th>
                <th className="py-1.5 px-2.5 text-left font-medium">원본</th>
                <th className="py-1.5 px-2.5 text-left font-medium">매출처 · 사용처</th>
                <th className="py-1.5 px-2.5 text-left font-medium">용도</th>
                <th className="py-1.5 px-2.5 text-right font-medium">수량</th>
                <th className="py-1.5 px-2.5 text-right font-medium">단가</th>
                <th className="py-1.5 px-2.5 text-right font-medium">금액</th>
                <th className="py-1.5 px-2.5 text-left font-medium">입고분</th>
                <th className="py-1.5 px-2.5 text-right font-medium">재고</th>
                <th className="py-1.5 px-2.5 text-left font-medium">입력</th>
              </tr>
            </thead>
            <tbody>
              {!d.lines.length && <tr><td colSpan={11} className="py-6 text-center text-slate-400">기록이 없습니다.</td></tr>}
              {d.lines.map((l, i) => (
                <tr key={i} className={`border-b border-slate-50 ${asof && l.date > asof ? 'text-slate-400' : ''}`}>
                  <td className="py-1.5 px-2.5 tabular-nums">{mmdd(l.date)}</td>
                  <td className={`py-1.5 px-2.5 font-medium ${KIND[l.kind].cls}`}>{KIND[l.kind].label}</td>
                  <td className="py-1.5 px-2.5 tabular-nums">
                    {l.order_id ? <Link href={`/orders/${l.order_id}`} className="text-blue-700 hover:underline">{l.order_no}{l.line_no ? ` #${l.line_no}` : ''}</Link> : '조정 기록'}
                  </td>
                  <td className="py-1.5 px-2.5">{l.party || '-'}</td>
                  <td className="py-1.5 px-2.5">{l.purpose || '-'}</td>
                  <td className={`py-1.5 px-2.5 text-right tabular-nums ${l.quantity < 0 ? 'text-red-600' : ''}`}>{l.quantity > 0 ? `+${won(l.quantity)}` : won(l.quantity)}</td>
                  <td className="py-1.5 px-2.5 text-right tabular-nums">{won(l.unit_cost)}</td>
                  <td className="py-1.5 px-2.5 text-right tabular-nums">{won(Math.abs(l.amount))}</td>
                  <td className="py-1.5 px-2.5">{l.lot}</td>
                  <td className="py-1.5 px-2.5 text-right tabular-nums font-semibold">{won(l.balance)}</td>
                  <td className="py-1.5 px-2.5 text-slate-500">{l.staff ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-[0.75rem] text-slate-400">용도: 판매(배송종류 지점 · 개별) / 샘플(배송종류 샘플) — 주문 행에서 자동으로 정해집니다. 출고 한 행이 두 입고분에 걸치면 두 줄로 나뉩니다.</p>
        </div>
      )}
    </div>
  )
}
