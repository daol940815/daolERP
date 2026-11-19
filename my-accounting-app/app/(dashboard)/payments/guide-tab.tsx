'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import PayFilterBar, { passPayFilter, usePayFilter, type StaffScope } from '@/components/payments/PayFilterBar'
import { OrderNoLink } from '@/components/payments/OrderPreview'
import { PAY_METHOD_TAG_CLS, PAY_METHOD_TAG_LABEL, PAY_STAGE_CLS, PAY_STAGE_LABEL, showMethodTag, type PayState } from '@/lib/pay-state'

// 결제 확인 › 결제 안내 대상 (2026-11-16 3단계) — 영업지원 작업 목록
// 결제 상태가 미결제 · 일부 결제인 주문. 받을 금액 = 청구 금액(순매출 + 선결제, 1308) − 기록 금액. 연락 기록(1301)을 남긴다.

type Method = 'phone' | 'sms' | 'email' | 'visit' | 'etc'
const METHOD_LABEL: Record<Method, string> = { phone: '전화', sms: '문자', email: '메일', visit: '방문', etc: '기타' }
interface Contact { id: string; contact_date: string; method: Method; memo: string | null; promise_date: string | null; created_by_name: string | null }
interface Row {
  order_id: string; order_no: string | null; order_date: string
  customer_name: string; manager: string; phone: string; staff_name: string | null
  net: number; prepay?: number; to_collect: number; pay: PayState; days: number   // net = 청구 금액(선결제 포함)
  last_contact: Contact | null; contact_count: number; promise_overdue: boolean; mine: boolean
  staff_ids?: string[]; staff_names?: string[]
}
type Kpi = 'all' | 'unpaid' | 'partial' | 'over7' | 'promise'
type Chip = 'all' | 'mine' | 'never' | 'over30'

const won = (n: number) => n.toLocaleString('ko-KR')
const today = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)

export default function GuideTab() {
  const [rows, setRows] = useState<Row[]>([])
  const [canContact, setCanContact] = useState(false)
  const [contactsAvailable, setContactsAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kpi, setKpi] = useState<Kpi>('all')
  const [chip, setChip] = useState<Chip>('all')
  // 공통 필터 줄 (2026-11-18) — 지점 담당(기본 내 담당) · 기간(주문일) · 검색
  const { filter, update, applyScope } = usePayFilter()
  const [scope, setScope] = useState<StaffScope | null>(null)
  // 연락 기록 창
  const [target, setTarget] = useState<Row | null>(null)
  const [history, setHistory] = useState<Contact[]>([])
  const [cDate, setCDate] = useState(today())
  const [cMethod, setCMethod] = useState<Method>('phone')
  const [cMemo, setCMemo] = useState('')
  const [cPromise, setCPromise] = useState('')
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const res = await fetch('/api/payment-records/guide')
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setError(json.error ?? '조회 실패'); setRows([]) }
    else { setRows(json.rows ?? []); setCanContact(!!json.can_contact); setContactsAvailable(json.contacts_available !== false); setScope(json.scope ?? null); applyScope(json.scope) }
    setLoading(false)
  }, [applyScope])
  useEffect(() => { load() }, [load])

  const counts = useMemo(() => ({
    all: rows.length, amount: rows.reduce((s, r) => s + r.to_collect, 0),
    unpaid: rows.filter(r => r.pay.stage === 'unpaid').length,
    partial: rows.filter(r => r.pay.stage === 'partial_pay').length,
    over7: rows.filter(r => r.days > 7).length,
    promise: rows.filter(r => r.promise_overdue).length,
  }), [rows])

  const filtered = useMemo(() => rows.filter(r => {
    if (kpi === 'unpaid' && r.pay.stage !== 'unpaid') return false
    if (kpi === 'partial' && r.pay.stage !== 'partial_pay') return false
    if (kpi === 'over7' && r.days <= 7) return false
    if (kpi === 'promise' && !r.promise_overdue) return false
    if (chip === 'mine' && !r.mine) return false
    if (chip === 'never' && r.contact_count > 0) return false
    if (chip === 'over30' && r.days <= 30) return false
    return passPayFilter(filter, {
      staff_ids: r.staff_ids, date: r.order_date,
      fields: { vendor: r.customer_name, order: r.order_no, manager: [r.manager, r.phone, r.staff_name].filter(Boolean).join(' '), amount: [r.net, r.to_collect].join(' ') },
    })
  }), [rows, kpi, chip, filter])
  const noneCount = useMemo(() => rows.filter(r => !(r.staff_ids ?? []).length).length, [rows])
  // 화면에는 100건씩 그린다(검색 · 필터 · 건수 · 엑셀은 전체 기준) (2026-11-18)
  const [shown, setShown] = useState(100)
  useEffect(() => { setShown(100) }, [filter, kpi, chip])

  const openContact = async (r: Row) => {
    setTarget(r); setHistory([]); setCDate(today()); setCMethod('phone'); setCMemo(''); setCPromise(''); setFormErr(null)
    const res = await fetch(`/api/orders-portal/orders/${r.order_id}/pay-contacts`)
    const json = await res.json().catch(() => ({}))
    if (res.ok) setHistory(json.contacts ?? [])
  }
  const saveContact = async () => {
    if (!target) return
    setBusy(true); setFormErr(null)
    const res = await fetch(`/api/orders-portal/orders/${target.order_id}/pay-contacts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_date: cDate, method: cMethod, memo: cMemo, promise_date: cPromise || null }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setFormErr(json.error ?? '저장 실패'); return }
    setTarget(null); load()
  }

  // 화면에 걸러진 그대로 내려받기
  const exportXlsx = async () => {
    if (!filtered.length) return
    const header = ['주문일', '주문번호', '매출처', '담당자', '연락처', '다올 직원', '청구 금액', '받을 금액', '결제 상태', '결제 수단', '지난 날', '최근 연락일', '최근 연락', '입금 약속일']
    const body = filtered.map(r => [
      r.order_date, r.order_no ?? '', r.customer_name, r.manager, r.phone, r.staff_name ?? '', r.net, r.to_collect,
      PAY_STAGE_LABEL[r.pay.stage], r.pay.method ? PAY_METHOD_TAG_LABEL[r.pay.method] : '', r.days,
      r.last_contact?.contact_date ?? '', r.last_contact ? `${METHOD_LABEL[r.last_contact.method]} · ${r.last_contact.created_by_name ?? ''} ${r.last_contact.memo ?? ''}`.trim() : '',
      r.last_contact?.promise_date ?? '',
    ])
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.aoa_to_sheet([header, ...body])
    ws['!cols'] = [11, 14, 26, 16, 16, 10, 13, 13, 10, 8, 7, 11, 40, 11].map(wch => ({ wch }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '결제 안내 대상')
    XLSX.writeFile(wb, `결제안내대상_${today()}_${filtered.length}건.xlsx`)
  }

  const kpiCard = (key: Kpi, label: string, value: string, sub: string, tone = 'text-gray-900') => (
    <button onClick={() => setKpi(kpi === key ? 'all' : key)}
      className={`text-left bg-white border rounded-xl px-4 py-3 ${kpi === key ? 'border-slate-900 ring-1 ring-slate-900' : 'border-gray-200 hover:border-gray-300'}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-bold mt-1 ${tone}`}>{value}</p>
      <p className="text-[0.6875rem] text-gray-400">{sub}</p>
    </button>
  )
  const chipBtn = (key: Chip, label: string) => (
    <button onClick={() => setChip(chip === key ? 'all' : key)}
      className={`px-3 py-1 rounded-full text-xs border ${chip === key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}>{label}</button>
  )
  const inputCls = 'w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900'

  return (
    <div className="w-full">
      <p className="text-sm text-gray-500 mb-3">
        결제가 덜 된 주문입니다(결제 상태 미결제 · 일부 결제). 결제를 받으면 주문 상세에서 결제 기록을 남기세요 — 전액 기록되면 이 목록에서 빠지고 매칭 대기로 넘어갑니다.
      </p>
      {error && <div className="mb-3 px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>}
      {!contactsAvailable && !loading && (
        <div className="mb-3 px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">연락 기록은 1301 마이그레이션을 실행한 뒤부터 쓸 수 있습니다. 목록은 그대로 볼 수 있습니다.</div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        {kpiCard('all', '안내 대상', `${counts.all}건`, `받을 금액 ${won(counts.amount)}원`)}
        {kpiCard('unpaid', '미결제', `${counts.unpaid}건`, '결제 기록 없음', 'text-red-600')}
        {kpiCard('partial', '일부 결제', `${counts.partial}건`, '나머지를 받아야 함', 'text-orange-700')}
        {kpiCard('over7', '7일 넘게 지남', `${counts.over7}건`, '주문일 기준', 'text-amber-700')}
        {kpiCard('promise', '약속일 지남', `${counts.promise}건`, '입금 약속일 경과', 'text-red-600')}
      </div>

      <PayFilterBar filter={filter} update={update} scope={scope} noneCount={noneCount} />
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        {chipBtn('all', '전체')}{chipBtn('mine', '내 주문')}{chipBtn('never', '연락한 적 없음')}{chipBtn('over30', '30일 넘음')}
        <button onClick={exportXlsx} disabled={!filtered.length}
          className="ml-auto px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">엑셀 ({filtered.length}건)</button>
      </div>

      {loading ? <div className="text-center py-20 text-gray-400">불러오는 중...</div>
        : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400 text-sm">{rows.length === 0 ? '결제 안내가 필요한 주문이 없습니다.' : '조건에 맞는 주문이 없습니다.'}</div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[60rem]">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-200 bg-gray-50">
                  <th className="py-2.5 px-3 font-medium">주문일 / 번호</th>
                  <th className="py-2.5 px-3 font-medium">매출처 · 담당자</th>
                  <th className="py-2.5 px-3 font-medium">지점 담당</th>
                  <th className="py-2.5 px-3 font-medium text-right" title="받을 돈 = 순매출 + 선결제 품목">청구 금액</th>
                  <th className="py-2.5 px-3 font-medium text-right">받을 금액</th>
                  <th className="py-2.5 px-3 font-medium">결제</th>
                  <th className="py-2.5 px-3 font-medium text-right">지난 날</th>
                  <th className="py-2.5 px-3 font-medium">최근 연락</th>
                  <th className="py-2.5 px-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, shown).map(r => (
                  <tr key={r.order_id} className="border-b border-gray-100 align-top hover:bg-gray-50">
                    <td className="py-2.5 px-3 whitespace-nowrap tabular-nums">
                      {r.order_date}
                      <div className="text-[0.6875rem]"><OrderNoLink id={r.order_id} no={r.order_no} /></div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="text-gray-900">{r.customer_name || '-'}</div>
                      <div className="text-[0.6875rem] text-gray-500">{[r.manager, r.phone].filter(Boolean).join(' · ')}{r.staff_name ? <span className="text-gray-400"> · 다올 {r.staff_name}</span> : null}</div>
                    </td>
                    <td className="py-2.5 px-3 text-xs whitespace-nowrap">{r.staff_names?.length ? r.staff_names.join(', ') : <span className="text-gray-400">담당 미지정</span>}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">{won(r.net)}{(r.prepay ?? 0) > 0 && <div className="text-[0.6875rem] text-violet-700">선결제 {won((r.prepay ?? 0))} 포함</div>}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap font-semibold text-red-600">{won(r.to_collect)}</td>
                    <td className="py-2.5 px-3">
                      <span className="inline-flex items-center gap-1 whitespace-nowrap">
                        {r.pay.method && showMethodTag(r.pay.stage) && (
                          <span className={`px-1.5 py-px rounded border bg-white text-[0.625rem] font-semibold ${PAY_METHOD_TAG_CLS[r.pay.method]}`}>{PAY_METHOD_TAG_LABEL[r.pay.method]}</span>
                        )}
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[0.6875rem] font-medium ${PAY_STAGE_CLS[r.pay.stage]}`}>{PAY_STAGE_LABEL[r.pay.stage]}</span>
                      </span>
                    </td>
                    <td className={`py-2.5 px-3 text-right tabular-nums whitespace-nowrap ${r.days > 30 ? 'text-red-600 font-semibold' : r.days > 7 ? 'text-amber-700' : 'text-gray-600'}`}>{r.days}일</td>
                    <td className="py-2.5 px-3 text-xs">
                      {r.last_contact ? (<>
                        <div className="text-gray-700">{r.last_contact.contact_date.slice(5)} {METHOD_LABEL[r.last_contact.method]} · {r.last_contact.created_by_name ?? ''}{r.contact_count > 1 && <span className="text-gray-400"> 외 {r.contact_count - 1}건</span>}</div>
                        {r.last_contact.promise_date
                          ? <div className={r.promise_overdue ? 'text-red-600' : 'text-gray-500'}>입금 약속 {r.last_contact.promise_date.slice(5)}{r.promise_overdue ? ' (지남)' : ''}</div>
                          : r.last_contact.memo && <div className="text-gray-400 truncate max-w-[14rem]" title={r.last_contact.memo}>{r.last_contact.memo}</div>}
                      </>) : <span className="text-gray-400">없음</span>}
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      {contactsAvailable && (
                        <button onClick={() => openContact(r)}
                          className="text-[0.6875rem] px-2 py-0.5 border border-gray-300 rounded text-gray-600 hover:bg-gray-50">{canContact ? '연락 기록' : '연락 내역'}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > shown && (
              <div className="p-3 text-center border-t border-gray-100">
                <button onClick={() => setShown(n => n + 100)} className="px-4 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">더 보기 ({shown} / {filtered.length})</button>
              </div>
            )}
          </div>
        )}

      {target && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setTarget(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-gray-200 font-semibold text-gray-900">
              연락 기록 — {target.order_no ?? ''} {target.customer_name}
              <div className="text-xs font-normal text-gray-500 mt-0.5">{[target.manager, target.phone].filter(Boolean).join(' · ')} · 받을 금액 {won(target.to_collect)}원</div>
            </div>
            <div className="px-5 py-4">
              {canContact && (<>
                <div className="grid grid-cols-2 gap-2.5 mb-2.5">
                  <div>
                    <label className="block text-[0.6875rem] text-gray-500 mb-1">연락한 날</label>
                    <input type="date" value={cDate} onChange={e => setCDate(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-[0.6875rem] text-gray-500 mb-1">방법</label>
                    <select value={cMethod} onChange={e => setCMethod(e.target.value as Method)} className={inputCls}>
                      {(Object.keys(METHOD_LABEL) as Method[]).map(m => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
                    </select>
                  </div>
                </div>
                <label className="block text-[0.6875rem] text-gray-500 mb-1">내용</label>
                <textarea value={cMemo} onChange={e => setCMemo(e.target.value)} rows={2} placeholder="예: 담당자 부재, 내일 다시 연락" className={inputCls} />
                <div className="grid grid-cols-2 gap-2.5 mt-2.5">
                  <div>
                    <label className="block text-[0.6875rem] text-gray-500 mb-1">입금 약속일 (선택)</label>
                    <input type="date" value={cPromise} onChange={e => setCPromise(e.target.value)} className={inputCls} />
                  </div>
                </div>
                {formErr && <div className="mt-2 text-xs text-red-600">{formErr}</div>}
              </>)}
              <div className={`text-xs text-gray-600 leading-relaxed ${canContact ? 'mt-3 pt-3 border-t border-gray-100' : ''}`}>
                <div className="font-semibold text-gray-700 mb-1">지난 기록</div>
                {history.length === 0 ? <div className="text-gray-400">없음</div> : history.map(h => (
                  <div key={h.id}>{h.contact_date.slice(5)} {METHOD_LABEL[h.method]} · {h.created_by_name ?? ''}{h.memo ? ` — ${h.memo}` : ''}{h.promise_date ? ` (약속 ${h.promise_date.slice(5)})` : ''}</div>
                ))}
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex justify-end gap-2">
              <button onClick={() => setTarget(null)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white">닫기</button>
              {canContact && (
                <button onClick={saveContact} disabled={busy}
                  className="px-3 py-1.5 rounded-lg text-sm bg-slate-900 text-white font-semibold hover:bg-slate-700 disabled:opacity-40">{busy ? '저장 중...' : '저장'}</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
