'use client'

// 재고 관리 › 확인 필요 탭 (2차, 1401 — 시안 ⑤)
// 매입가가 두 번 잡혔을 수 있는 행 · 재고 원가 미배정 행 · 실사 차이를 시스템이 찾아 보여주고, 처리는 사람이 한다.
// 저장된 주문 행을 고치는 조작(재고 출고로 바꾸기)과 확인 · 조정은 모두 사유를 받는다(useReasonDialog).

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useReasonDialog } from '@/components/payments/ReasonDialog'

const won = (n: number | null | undefined) => Math.round(n ?? 0).toLocaleString('ko-KR')
const mmdd = (d: string) => d.slice(5).replace('-', '/')

interface NewBuy { item_id: string; order_id: string; order_no: string; order_date: string; line_no: number; customer: string; item_name: string; quantity: number; purchase_total: number; stock_at_date: number; po_sent: boolean }
interface PendingOut { item_id: string; order_id: string; order_no: string; order_date: string; line_no: number; customer: string; item_name: string; quantity: number; stock_now: number }
interface TakeDiff { stocktake_id: string; take_date: string; item_name: string; counted_qty: number; computed_qty: number; diff: number; staff_name: string | null }
interface Data { newBuy: NewBuy[]; pendingOut: PendingOut[]; takeDiff: TakeDiff[]; marks1401: boolean; can_edit: boolean; error?: string; migration1400?: boolean }

type Kind = 'all' | 'new' | 'pending' | 'take'

export default function ReviewView() {
  const [d, setD] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [kind, setKind] = useState<Kind>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const dlg = useReasonDialog()

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/stock/review')
      const j = await r.json()
      if (!r.ok || j.migration1400 === false) throw new Error(j.error ?? '조회 실패')
      setD(j)
    } catch (e) { setError(e instanceof Error ? e.message : '조회 실패') }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const act = async (key: string, body: Record<string, unknown>, ok: string) => {
    setBusy(key); setError(null); setNotice(null)
    try {
      const r = await fetch('/api/stock/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? '처리 실패')
      setNotice(j.warning ? `${ok} — ${j.warning}` : ok)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : '처리 실패') }
    setBusy(null)
  }
  const toOut = async (r: NewBuy) => {
    const reason = await dlg.ask('stock_out', `${r.order_no} #${r.line_no} 재고 출고로 바꾸기`,
      `${r.item_name} ${won(r.quantity)}개 — 원 행은 취소 이력으로 남고 같은 내용의 재고 출고 행이 새로 등록됩니다.\n매입합계 ${won(r.purchase_total)}원이 0이 되고(매입처에 줄 돈 없음), 재고 원가가 먼저 들어온 입고분 단가로 잡힙니다.`)
    if (reason) act(r.item_id, { action: 'to_out', item_id: r.item_id, reason }, `${r.order_no} #${r.line_no}을(를) 재고 출고로 바꿨습니다`)
  }
  const confirmNew = async (r: NewBuy) => {
    const reason = await dlg.ask('stock_confirm', `${r.order_no} #${r.line_no} 맞음(실제 새로 매입)`, '이 행은 다시 확인 필요에 뜨지 않습니다.')
    if (reason) act(r.item_id, { action: 'confirm_new', item_id: r.item_id, reason }, '확인 처리했습니다')
  }
  const adjust = async (t: TakeDiff) => {
    const reason = await dlg.ask('stock_adjust', `${t.item_name} 실사 차이 조정 (${t.diff > 0 ? '+' : ''}${t.diff})`,
      t.diff < 0 ? '부족분을 먼저 들어온 입고분부터 차감합니다(재고 금액이 줄어듭니다).' : '늘어난 수량은 가장 최근 입고 단가로 입고분이 됩니다.')
    if (reason) act(t.stocktake_id, { action: 'adjust', stocktake_id: t.stocktake_id, reason }, '조정 기록을 남겼습니다')
  }

  const counts = useMemo(() => ({
    new: d?.newBuy.length ?? 0, pending: d?.pendingOut.length ?? 0, take: d?.takeDiff.length ?? 0,
  }), [d])
  const total = counts.new + counts.pending + counts.take
  const show = (k: Exclude<Kind, 'all'>) => kind === 'all' || kind === k
  const canEdit = !!d?.can_edit
  const btn = 'px-2.5 py-1 rounded-md text-[0.75rem] disabled:opacity-40'
  const card = (k: Kind, label: string, n: number, hint: string) => (
    <button type="button" onClick={() => setKind(kind === k ? 'all' : k)}
      className={`rounded-xl border bg-white px-4 py-3 text-left ${kind === k ? 'border-slate-900' : 'border-slate-200'}`}>
      <div className="text-[0.75rem] text-slate-500">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${n > 0 ? 'text-amber-700' : ''}`}>{won(n)}<span className="text-[0.75rem] font-normal text-slate-400 ml-1">{hint}</span></div>
    </button>
  )

  return (
    <div>
      {dlg.node}
      <p className="text-[0.8125rem] text-slate-500 mb-3">시스템은 찾아서 보여주고, 처리는 사람이 합니다. 처리한 사유 · 사람 · 시각은 이력에 남습니다.</p>
      {error && <div className="mb-3 px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>}
      {notice && <div className="mb-3 px-4 py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg">{notice}</div>}
      {d && !d.marks1401 && (
        <div className="mb-3 px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">
          1401 마이그레이션(재고 확인 기록)이 아직 적용되지 않아 &quot;맞음&quot; 처리를 저장할 수 없습니다. Supabase SQL 편집기에서 실행해 주세요.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mb-4">
        {card('new', '재고 있음 · 새로 매입', counts.new, '매입가 중복 의심')}
        {card('pending', '재고 원가 미배정', counts.pending, '저장 때 재고 부족')}
        {card('take', '실사 차이', counts.take, '조정 기록 전')}
      </div>
      {loading && <div className="py-8 text-center text-slate-400 text-sm">불러오는 중...</div>}
      {!loading && d && total === 0 && <div className="py-8 text-center text-slate-400 text-sm bg-white border border-slate-200 rounded-xl">확인할 것이 없습니다.</div>}

      {!loading && d && show('new') && counts.new > 0 && (
        <Section title="재고 있음 · 새로 매입" desc="선매입 재고가 남아 있던 날 같은 품목을 재고 칸 '없음'으로 넣은 행입니다. 재고에서 보냈다면 매입가가 두 번 잡힌 것입니다.">
          <thead>
            <tr className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <Th>주문</Th><Th>날짜</Th><Th>매출처</Th><Th>품명</Th><Th>왜 떴나</Th><Th right>수량</Th><Th right>매입합계</Th><Th>처리</Th>
            </tr>
          </thead>
          <tbody>
            {d.newBuy.map(r => (
              <tr key={r.item_id} className="border-b border-slate-50 align-top">
                <Td><Link href={`/orders/${r.order_id}`} className="text-blue-700 hover:underline tabular-nums">{r.order_no} #{r.line_no}</Link></Td>
                <Td>{mmdd(r.order_date)}</Td>
                <Td>{r.customer || '-'}</Td>
                <Td className="font-medium">{r.item_name}</Td>
                <Td className="text-[0.75rem] text-slate-600">
                  그날 재고 {won(r.stock_at_date)}개인데 매입가가 잡힘
                  {r.po_sent ? <span className="block text-amber-700">발주서 발송됨 — 실제 새로 매입일 가능성이 큽니다</span> : <span className="block text-slate-400">발주서 안 나감</span>}
                </Td>
                <Td right>{won(r.quantity)}</Td>
                <Td right>{won(r.purchase_total)}</Td>
                <Td>
                  {canEdit ? (
                    <div className="flex gap-1.5 flex-wrap">
                      {/* 발주서가 나간 행은 "맞음"을 앞에 — 재고 출고로 바꾸려면 발주서를 먼저 취소해야 한다(서버가 막음) */}
                      {r.po_sent
                        ? <>
                            <button type="button" disabled={!!busy} onClick={() => confirmNew(r)} className={`${btn} bg-slate-900 text-white`}>맞음 (실제 새로 매입)</button>
                            <button type="button" disabled={!!busy} onClick={() => toOut(r)} className={`${btn} border border-slate-300 bg-white`}>재고 출고로 바꾸기</button>
                          </>
                        : <>
                            <button type="button" disabled={!!busy} onClick={() => toOut(r)} className={`${btn} bg-slate-900 text-white`}>재고 출고로 바꾸기</button>
                            <button type="button" disabled={!!busy} onClick={() => confirmNew(r)} className={`${btn} border border-slate-300 bg-white`}>맞음 (실제 새로 매입)</button>
                          </>}
                    </div>
                  ) : <span className="text-[0.75rem] text-slate-400">주문 · 발주 수정 권한자가 처리</span>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Section>
      )}

      {!loading && d && show('pending') && counts.pending > 0 && (
        <Section title="재고 원가 미배정" desc="재고 출고 행인데 저장할 때 재고가 모자라 재고 원가를 계산하지 못했습니다. 입고를 먼저 넣은 뒤 다시 배정하세요.">
          <thead>
            <tr className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <Th>주문</Th><Th>날짜</Th><Th>매출처</Th><Th>품명</Th><Th right>출고 수량</Th><Th right>지금 재고</Th><Th>처리</Th>
            </tr>
          </thead>
          <tbody>
            {d.pendingOut.map(r => (
              <tr key={r.item_id} className="border-b border-slate-50">
                <Td><Link href={`/orders/${r.order_id}`} className="text-blue-700 hover:underline tabular-nums">{r.order_no} #{r.line_no}</Link></Td>
                <Td>{mmdd(r.order_date)}</Td>
                <Td>{r.customer || '-'}</Td>
                <Td className="font-medium">{r.item_name}</Td>
                <Td right>{won(r.quantity)}</Td>
                <Td right className={r.stock_now < r.quantity ? 'text-red-600' : ''}>{won(r.stock_now)}</Td>
                <Td>
                  {canEdit
                    ? <button type="button" disabled={!!busy || r.stock_now < r.quantity} onClick={() => act(r.item_id, { action: 'reallocate', order_id: r.order_id }, '다시 배정했습니다')}
                        title={r.stock_now < r.quantity ? '재고가 모자랍니다 — 선매입 입고를 먼저 넣으세요' : undefined}
                        className={`${btn} bg-slate-900 text-white`}>다시 배정</button>
                    : <span className="text-[0.75rem] text-slate-400">주문 · 발주 수정 권한자가 처리</span>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Section>
      )}

      {!loading && d && show('take') && counts.take > 0 && (
        <Section title="실사 차이" desc="실사 수량과 전산 재고가 다른데 아직 조정 기록이 없습니다. 실사 기록은 고치지 않고 조정 행으로 남깁니다. 출고 누락이면 조정 대신 해당 주문을 찾아 재고 출고로 넣으세요.">
          <thead>
            <tr className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <Th>실사일</Th><Th>품명</Th><Th right>전산</Th><Th right>실사</Th><Th right>차이</Th><Th>실사자</Th><Th>처리</Th>
            </tr>
          </thead>
          <tbody>
            {d.takeDiff.map(t => (
              <tr key={t.stocktake_id} className="border-b border-slate-50">
                <Td>{mmdd(t.take_date)}</Td>
                <Td className="font-medium">{t.item_name}</Td>
                <Td right>{won(t.computed_qty)}</Td>
                <Td right>{won(t.counted_qty)}</Td>
                <Td right className={t.diff < 0 ? 'text-red-600 font-semibold' : 'text-emerald-700 font-semibold'}>{t.diff > 0 ? `+${t.diff}` : t.diff}</Td>
                <Td>{t.staff_name ?? '-'}</Td>
                <Td>
                  {canEdit
                    ? <button type="button" disabled={!!busy} onClick={() => adjust(t)} className={`${btn} bg-slate-900 text-white`}>조정 기록</button>
                    : <span className="text-[0.75rem] text-slate-400">주문 · 발주 수정 권한자가 처리</span>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Section>
      )}
    </div>
  )
}

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl mb-4">
      <div className="px-4 py-2.5 border-b border-slate-100">
        <div className="text-sm font-bold text-slate-900">{title}</div>
        <div className="text-[0.75rem] text-slate-500 mt-0.5">{desc}</div>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-[0.8125rem] min-w-[52rem]">{children}</table></div>
    </div>
  )
}
const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) =>
  <th className={`py-1.5 px-2.5 font-medium ${right ? 'text-right' : 'text-left'}`}>{children}</th>
const Td = ({ children, right, className = '' }: { children: React.ReactNode; right?: boolean; className?: string }) =>
  <td className={`py-1.5 px-2.5 ${right ? 'text-right tabular-nums' : ''} ${className}`}>{children}</td>
