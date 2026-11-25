'use client'

import { useEffect, useRef, useState } from 'react'
import type { ShipInput } from '@/lib/ship-address'
import { fieldCls, labelCls } from '@/components/ui/kit'

// 주문서 배송지 카드 (513, 2026-11-04 사용자 확정 — 시안 docs/mockups/배송지_주문서_시안.html)
//  - 자동 채움 (2026-11-17 기준 = 지점 + 담당자): 같은 지점 + 같은 담당자의 최근 배송지 → 없으면 같은 지점의 최근 배송지
//    → 그것도 없으면 수령인 · 연락처만 거래처 담당자로. 근거는 주문 + 상담일지에 적은 배송지(최근순). 담당자를 고르거나 바꾸면 다시 채운다
//  - 사용자가 직접 고친 뒤에는 자동 채움이 덮어쓰지 않는다 (주문처를 바꿔도 유지)
//  - 주소는 카카오(다음) 우편번호 검색으로만 입력, 상세주소만 직접 입력
//  - 개별 배송 품목만 있으면 카드를 닫고 안내 (수령인별 주소는 발주서 배송명단)

export const EMPTY_SHIP: ShipInput = { ship_name: null, ship_phone: null, ship_zip: null, ship_addr1: null, ship_addr2: null }

interface RecentAddr extends ShipInput { last_order_no: string | null; last_date: string; count: number; from?: 'order' | 'consult'; same_contact?: boolean }

interface DaumPostcodeData { zonecode: string; roadAddress: string; address: string; buildingName: string; apartment: string }
declare global {
  interface Window {
    daum?: { Postcode: new (o: { oncomplete: (d: DaumPostcodeData) => void }) => { open: () => void } }
  }
}
const POSTCODE_SRC = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
function loadPostcode(): Promise<void> {
  if (typeof window === 'undefined' || window.daum?.Postcode) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const exist = document.querySelector(`script[src="${POSTCODE_SRC}"]`) as HTMLScriptElement | null
    const s = exist ?? document.createElement('script')
    s.addEventListener('load', () => resolve())
    s.addEventListener('error', () => reject(new Error('우편번호 검색을 불러오지 못했습니다.')))
    if (!exist) { s.src = POSTCODE_SRC; s.async = true; document.head.appendChild(s) }
  })
}

export default function ShipCard({ value, onChange, vendorId, contactId, contactName, contactPhone, autoFill, applies, disabled }: {
  value: ShipInput
  onChange: (v: ShipInput) => void
  vendorId: string | null
  contactId?: string | null      // 거래처 담당자(contacts) — 자동 채움 기준 지점 + 담당자 (2026-11-17)
  contactName: string | null     // 거래처 담당자 표기 (존칭 포함)
  contactPhone: string | null
  autoFill: boolean              // 신규·상담 전환만 true (수정·재등록은 원본 값 유지)
  applies: boolean               // 지점·샘플 품목이 있는지
  disabled?: boolean
}) {
  const [recent, setRecent] = useState<RecentAddr[]>([])
  const [source, setSource] = useState<{ kind: 'recent'; no: string | null; date: string; from: 'order' | 'consult'; same: boolean } | { kind: 'contact' } | null>(null)
  const [openList, setOpenList] = useState(false)
  const [pcError, setPcError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)      // 513 미적용
  const touched = useRef(!autoFill)                    // 사용자가 직접 고쳤는지
  const addr2Ref = useRef<HTMLInputElement>(null)
  const valueRef = useRef(value)
  valueRef.current = value

  useEffect(() => { loadPostcode().catch(() => {}) }, [])

  // 주문처 · 담당자가 바뀌면 최근 배송지 조회 + (자동 채움 대상이면) 첫 번째로 채움 — 같은 담당자 것이 먼저 온다
  useEffect(() => {
    setRecent([]); setOpenList(false)
    if (!vendorId) { setSource(null); return }
    let alive = true
    ;(async () => {
      const res = await fetch(`/api/orders-portal/ship-addresses?vendor_id=${vendorId}${contactId ? `&contact_id=${contactId}` : ''}`)
      const json = await res.json().catch(() => ({}))
      if (!alive) return
      const list: RecentAddr[] = res.ok ? (json.data ?? []) : []
      setPending(!!json.migration_pending)
      setRecent(list)
      if (touched.current) return
      if (list.length) {
        const r = list[0]
        onChange({ ship_name: r.ship_name, ship_phone: r.ship_phone, ship_zip: r.ship_zip, ship_addr1: r.ship_addr1, ship_addr2: r.ship_addr2 })
        setSource({ kind: 'recent', no: r.last_order_no, date: r.last_date, from: r.from ?? 'order', same: !!r.same_contact })
      } else {
        onChange({ ...EMPTY_SHIP, ship_name: contactName, ship_phone: contactPhone })
        setSource({ kind: 'contact' })
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId, contactId])

  // 지난 배송지가 없는 주문처: 담당자를 나중에 고르면 수령인·연락처를 그때 채운다
  useEffect(() => {
    if (touched.current || source?.kind !== 'contact') return
    const v = valueRef.current
    if (v.ship_addr1) return
    onChange({ ...v, ship_name: contactName, ship_phone: contactPhone })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactName, contactPhone])

  const set = (patch: Partial<ShipInput>) => { touched.current = true; onChange({ ...value, ...patch }) }

  const searchAddr = () => {
    setPcError(null)
    if (!window.daum?.Postcode) {
      loadPostcode().then(() => setPcError('우편번호 검색 준비가 끝났습니다. 다시 눌러주세요.'))
        .catch(e => setPcError(e instanceof Error ? e.message : String(e)))
      return
    }
    new window.daum.Postcode({
      oncomplete: d => {
        const extra = d.buildingName && d.apartment === 'Y' ? ` (${d.buildingName})` : ''
        set({ ship_zip: d.zonecode, ship_addr1: (d.roadAddress || d.address) + extra })
        setTimeout(() => addr2Ref.current?.focus(), 50)
      },
    }).open()
  }

  const pick = (r: RecentAddr) => {
    touched.current = true
    onChange({ ship_name: r.ship_name, ship_phone: r.ship_phone, ship_zip: r.ship_zip, ship_addr1: r.ship_addr1, ship_addr2: r.ship_addr2 })
    setSource({ kind: 'recent', no: r.last_order_no, date: r.last_date, from: r.from ?? 'order', same: !!r.same_contact })
    setOpenList(false)
  }

  const label = labelCls
  const free = fieldCls('free')   // 입력 칸 — components/ui/kit.tsx (흰 = 직접 입력 · 회색 = 자동)
  const btn = 'px-2 py-1 text-xs border border-slate-400 rounded-md text-slate-700 hover:bg-slate-50 disabled:opacity-50'

  return (
    <div className="bg-white border border-slate-300 rounded-xl p-4 mt-3">
      <div className="text-sm font-bold text-slate-900 mb-2">
        배송지 <span className="text-xs font-normal text-slate-500 ml-1">지점 · 샘플 배송 품목에 적용 · 개별 배송은 발주서 배송명단에서 수령인별로</span>
      </div>

      {!applies ? (
        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 leading-relaxed">
          이 주문은 <b>개별 배송</b> 품목만 있어 배송지를 받지 않습니다. 수령인별 주소는 발주서의 배송명단에 적어주세요.
          <span className="text-slate-500"> 지점 · 샘플 품목을 추가하면 배송지 칸이 다시 열립니다.</span>
        </div>
      ) : (
        <>
          {pending && (
            <div className="mb-2 text-xs px-3 py-1.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">
              513 마이그레이션(배송지)이 아직 적용되지 않아 배송지를 저장할 수 없습니다. 비워두고 저장하세요.
            </div>
          )}
          <div className="relative mb-2.5">
            <div className={`flex items-center gap-2 flex-wrap text-xs rounded-lg px-3 py-1.5 border ${
              source?.kind === 'recent' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : source?.kind === 'contact' && !value.ship_addr1 ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-slate-50 border-slate-300 text-slate-600'}`}>
              <span>
                {source?.kind === 'recent'
                  ? <>
                      {source.from === 'consult' ? <>상담일지({source.date})에 적은</> : <>지난 주문 <b>{source.no ?? ''}</b> ({source.date})</>}
                      {' '}배송지를 불러왔습니다{contactId ? (source.same ? ' — 같은 담당자' : ' — 이 담당자로 보낸 기록이 없어 같은 지점의 최근 배송지') : ''}
                    </>
                  : source?.kind === 'contact'
                    ? (value.ship_addr1 ? '주소를 입력했습니다' : '이 주문처로 보낸 기록이 없습니다 — 수령인은 담당자로 채웠습니다. 주소를 검색해주세요.')
                    : vendorId ? '배송지를 확인하세요' : '주문처를 고르면 그 주문처로 보냈던 최근 배송지가 자동으로 채워집니다'}
              </span>
              <span className="ml-auto flex gap-1.5">
                <button type="button" className={btn} disabled={disabled || !recent.length}
                  onClick={() => setOpenList(o => !o)}>최근 배송지 {recent.length ? `${recent.length} ` : ''}▾</button>
                <button type="button" className={btn} disabled={disabled || !contactName}
                  onClick={() => set({ ship_name: contactName, ship_phone: contactPhone })}>담당자 정보로 채우기</button>
                <button type="button" className={btn} disabled={disabled}
                  onClick={() => { touched.current = true; onChange({ ...EMPTY_SHIP }); setSource(null) }}>비우기</button>
              </span>
            </div>
            {openList && (
              <div className="absolute right-0 z-20 mt-1 w-full md:w-[34rem] bg-white border border-slate-400 rounded-lg shadow-lg overflow-hidden text-xs">
                <div className="px-3 py-1.5 text-xs text-slate-500 bg-slate-50">이 주문처의 배송지 — 같은 담당자 먼저, 최근순 · 같은 배송지는 1번만 (주문 + 상담일지)</div>
                {recent.map((r, i) => (
                  <button key={i} type="button" onClick={() => pick(r)}
                    className="block w-full text-left px-3 py-2 border-t border-slate-200 hover:bg-blue-50">
                    <div className="text-slate-900">{[r.ship_name, r.ship_phone].filter(Boolean).join(' · ') || '(수령인 없음)'}</div>
                    <div className="text-slate-600 mt-0.5">
                      {[r.ship_addr1, r.ship_addr2].filter(Boolean).join(' · ')} — {r.from === 'consult' ? '상담일지 ' : ''}{r.last_date}{r.count > 1 ? ` 외 ${r.count - 1}회` : ''}
                      {r.same_contact && <span className="ml-1.5 text-emerald-700">같은 담당자</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-x-3 gap-y-2.5">
            <div className="col-span-1 md:col-span-2">
              <label className={label}>수령인</label>
              <input value={value.ship_name ?? ''} disabled={disabled} onChange={e => set({ ship_name: e.target.value || null })}
                className={free} placeholder="예: 권오병 부장님" />
            </div>
            <div className="col-span-1 md:col-span-2">
              <label className={label}>수령인 연락처</label>
              <input value={value.ship_phone ?? ''} disabled={disabled} onChange={e => set({ ship_phone: e.target.value || null })}
                className={free} placeholder="010-" />
            </div>
            <div className="col-span-2 md:col-span-2">
              <label className={label}>우편번호</label>
              <div className="flex gap-1.5">
                <input value={value.ship_zip ?? ''} readOnly
                  className={fieldCls('auto')} placeholder="주소 검색" />
                <button type="button" onClick={searchAddr} disabled={disabled}
                  className="px-3 py-1.5 text-sm rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 whitespace-nowrap disabled:opacity-50">
                  주소 검색
                </button>
              </div>
            </div>
            <div className="col-span-2 md:col-span-4">
              <label className={label}>주소 <span className="text-slate-500">(주소 검색으로 입력)</span></label>
              <input value={value.ship_addr1 ?? ''} readOnly onClick={() => !disabled && !value.ship_addr1 && searchAddr()}
                className={fieldCls('auto', 'md', 'cursor-pointer')}
                placeholder="주소 검색을 눌러 입력" />
            </div>
            <div className="col-span-2 md:col-span-2">
              <label className={label}>상세주소</label>
              <input ref={addr2Ref} value={value.ship_addr2 ?? ''} disabled={disabled}
                onChange={e => set({ ship_addr2: e.target.value || null })} className={free} placeholder="층 · 부서 등" />
            </div>
          </div>
          {pcError && <div className="mt-1.5 text-xs text-red-600">{pcError}</div>}
          <div className="mt-1.5 text-xs text-slate-500">
            이 주문만 다른 곳으로 보낼 때는 그대로 고치면 됩니다 — 고친 값은 이 주문에만 저장되고 다음 주문에서는 &lsquo;최근 배송지&rsquo;에 함께 뜹니다. 비워둬도 저장됩니다.
          </div>
        </>
      )}
    </div>
  )
}
