'use client'

import { useMemo, useState } from 'react'
import { NumInput, toInt, type ItemDraft, type Product } from './form-shared'
import { fmtPurchasePrice, toPurchasePrice } from '@/lib/purchase-price'

// 미등록 상품 → 품목 관리 등록 (2026-11-19 사용자 승인 "제안대로", 시안 docs/mockups/미등록품목_등록_시안.html)
// 품목관리 트랙(docs/product-master-track.md) 소유 부품 — 상담일지 · 주문서 품목 행과 품목 관리 '미등록 품목' 목록이 같이 쓴다.
//  - 품번 검색에서 고르지 않고 품명을 직접 쓴 행에 '미등록 품목' 표시 + (품목 등록 권한자만) '품목 등록' 버튼
//  - 창에는 행 값(품명 · 매입처 · 판매가 · 매입가)을 미리 채움. 필수 = 품명 · 매입처 · 매입가 · 판매가(지점 또는 개별 하나 이상)
//  - 비슷한 품목이 있으면 "이 품목으로 연결" 후보 — 같은 상품을 두 번 만들지 않게
//  - 저장 후 행은 새 품목에 연결만(품번 · 마스터 값). 행에 입력한 판매가 · 매입가 · 수량은 덮어쓰지 않는다
//  - 이미 저장된 주문 · 상담 행은 바꾸지 않는다(입력 당시 그대로 — 원본 보존)

export interface RegisterSeed {
  item_name: string
  purchase_vendor_name: string
  order_kind?: string        // 지점 · 개별 · 샘플 — 판매가를 어느 칸에 채울지
  sale_price: number
  purchase_price: number
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toLowerCase()

/** 비슷한 품목 — 공백 무시 같은 이름, 또는 한쪽이 다른 쪽을 포함(4자 이상). 같은 매입처 먼저, 최대 5개 */
export function similarProducts(products: Product[], name: string, vendor: string): Product[] {
  const n = norm(name)
  if (!n) return []
  const v = norm(vendor)
  return products
    .filter(p => {
      const pn = norm(p.item_name)
      if (!pn) return false
      if (pn === n) return true
      return Math.min(pn.length, n.length) >= 4 && (pn.includes(n) || n.includes(pn))
    })
    .sort((a, b) => Number(norm(b.purchase_vendor_name) === v) - Number(norm(a.purchase_vendor_name) === v))
    .slice(0, 5)
}

/** 품목 등록 · 연결 후 행에 붙일 값 — 연결 정보와 마스터 값만, 행의 판매가 · 매입가 · 수량은 그대로 */
export function linkPatch(p: Product): Partial<ItemDraft> {
  return {
    product_id: p.id,
    item_code: p.item_code ?? '',
    item_name: p.item_name,
    purchase_vendor_name: p.purchase_vendor_name ?? '',
    branch_sale_price: p.sale_price,
    individual_sale_price: p.individual_sale_price ?? 0,
    branch_purchase_price: p.purchase_price,
    carton_unit: p.carton_unit ?? 0,
    carton_shipping_fee: p.carton_shipping_fee ?? 0,
    loose_shipping_fee: p.loose_shipping_fee ?? 0,
  }
}

/** 행이 '미등록 품목'인지 — 품번 연결 없음 · 품명 있음 · 비용 행 아님 */
export const isUnregisteredRow = (it: Pick<ItemDraft, 'product_id' | 'item_name' | 'is_shipping'>) =>
  !it.product_id && !!it.item_name.trim() && !it.is_shipping

/** 품목 행 아래 표시: '미등록 품목' + 품목 등록 버튼(권한자) 또는 요청 안내 */
export function UnregisteredTag({ canRegister, onRegister }: { canRegister: boolean; onRegister: () => void }) {
  return (
    <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
      <span className="inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[0.625rem] border border-orange-200 bg-orange-50 text-orange-700">미등록 품목</span>
      {canRegister
        ? <button type="button" onClick={onRegister} className="text-[0.6875rem] text-blue-700 underline whitespace-nowrap">품목 등록</button>
        : <span className="text-[0.625rem] text-gray-400 whitespace-nowrap">등록은 품목 관리 담당에게 요청</span>}
    </div>
  )
}

export default function ProductRegisterDialog({ seed, products, onClose, onDone }: {
  seed: RegisterSeed
  products: Product[]                                   // 비슷한 품목 찾기용
  onClose: () => void
  onDone: (p: Product, created: boolean) => void       // 새로 등록(created) 또는 기존 품목으로 연결
}) {
  const indiv = seed.order_kind === '개별'
  const sample = seed.order_kind === '샘플'
  const [f, setF] = useState({
    item_code: '', item_name: seed.item_name.trim(), purchase_vendor_name: seed.purchase_vendor_name.trim(), category: '',
    sale_price: !indiv && !sample ? seed.sale_price : 0,
    individual_sale_price: indiv ? seed.sale_price : 0,
    purchase_price: seed.purchase_price,
    carton_unit: 0, carton_shipping_fee: 0, loose_shipping_fee: 0, memo: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<typeof f>) => setF(prev => ({ ...prev, ...patch }))
  const similar = useMemo(() => similarProducts(products, f.item_name, f.purchase_vendor_name), [products, f.item_name, f.purchase_vendor_name])

  const missing = [
    !f.item_name.trim() && '품명', !f.purchase_vendor_name.trim() && '매입처',
    !(f.purchase_price > 0) && '매입가', !(f.sale_price > 0 || f.individual_sale_price > 0) && '판매가(지점 또는 개별)',
  ].filter(Boolean) as string[]

  const save = async () => {
    if (missing.length) { setError(`${missing.join(' · ')}을(를) 입력해 주세요.`); return }
    setSaving(true); setError(null)
    const res = await fetch('/api/orders-portal/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', ...f }),
    })
    const json = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok || !json.product) { setError(json.error ?? '등록하지 못했습니다.'); return }
    onDone(json.product as Product, true)
  }

  const pre = (on: boolean) => on ? 'border-sky-300 bg-sky-50' : 'border-gray-300 bg-white'
  const cls = 'border rounded-lg px-2.5 py-1.5 text-sm w-full'
  const num = 'text-right tabular-nums'
  const label = 'block text-[0.6875rem] text-gray-500 mb-0.5'
  const req = <span className="text-red-600">*</span>

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full p-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="text-sm font-bold text-gray-900">품목 관리에 등록</div>
        <div className="text-xs text-gray-500 mt-0.5">
          하늘색 칸은 품목 행에서 가져온 값입니다. 저장하면 품목 관리에 등록되고 이 행이 새 품목에 연결됩니다(행의 가격 · 수량은 그대로).
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3">
          <div><label className={label}>품번</label>
            <input value={f.item_code} onChange={e => set({ item_code: e.target.value })} placeholder="없으면 빈칸" className={`${cls} ${pre(false)}`} /></div>
          <div className="col-span-2"><label className={label}>품명 {req}</label>
            <input value={f.item_name} onChange={e => set({ item_name: e.target.value })} className={`${cls} ${pre(!!seed.item_name.trim())}`} /></div>
          <div><label className={label}>매입처 {req}</label>
            <input value={f.purchase_vendor_name} onChange={e => set({ purchase_vendor_name: e.target.value })} className={`${cls} ${pre(!!seed.purchase_vendor_name.trim())}`} /></div>
          <div><label className={label}>지점판매가 {req}<span className="text-gray-400"> (개별과 둘 중 하나)</span></label>
            <NumInput value={f.sale_price ? f.sale_price.toLocaleString('ko-KR') : ''} onChange={e => set({ sale_price: toInt(e.target.value) })}
              placeholder="0" className={`${cls} ${num} ${pre(!indiv && !sample && seed.sale_price > 0)}`} /></div>
          <div><label className={label}>개별판매가</label>
            <NumInput value={f.individual_sale_price ? f.individual_sale_price.toLocaleString('ko-KR') : ''} onChange={e => set({ individual_sale_price: toInt(e.target.value) })}
              placeholder="미지정" className={`${cls} ${num} ${pre(indiv && seed.sale_price > 0)}`} /></div>
          <div><label className={label}>매입가 {req}</label>
            <NumInput decimals={2} value={f.purchase_price ? fmtPurchasePrice(f.purchase_price) : ''} onChange={e => set({ purchase_price: toPurchasePrice(e.target.value) })}
              placeholder="0" className={`${cls} ${num} ${pre(seed.purchase_price > 0)}`} /></div>
          <div><label className={label}>분류(목차)</label>
            <input value={f.category} onChange={e => set({ category: e.target.value })} className={`${cls} ${pre(false)}`} /></div>
          <div><label className={label}>카톤단위</label>
            <NumInput value={f.carton_unit || ''} onChange={e => set({ carton_unit: toInt(e.target.value) })} placeholder="개/카톤" className={`${cls} ${num} ${pre(false)}`} /></div>
          <div><label className={label}>카톤택배비</label>
            <NumInput value={f.carton_shipping_fee ? f.carton_shipping_fee.toLocaleString('ko-KR') : ''} onChange={e => set({ carton_shipping_fee: toInt(e.target.value) })} placeholder="0" className={`${cls} ${num} ${pre(false)}`} /></div>
          <div><label className={label}>카톤외택배비</label>
            <NumInput value={f.loose_shipping_fee ? f.loose_shipping_fee.toLocaleString('ko-KR') : ''} onChange={e => set({ loose_shipping_fee: toInt(e.target.value) })} placeholder="0" className={`${cls} ${num} ${pre(false)}`} /></div>
          <div><label className={label}>메모</label>
            <input value={f.memo} onChange={e => set({ memo: e.target.value })} className={`${cls} ${pre(false)}`} /></div>
        </div>
        {indiv && seed.purchase_price > 0 && (
          <div className="mt-2 text-xs text-amber-700">개별 행에서 가져온 매입가는 택배비가 포함된 값일 수 있습니다 — 품목의 매입가는 지점 기준(택배비 제외)으로 넣어 주세요.</div>
        )}
        {similar.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <div className="font-semibold">비슷한 품목이 이미 있습니다 — 같은 상품이면 새로 만들지 말고 그 품목에 연결하세요</div>
            <ul className="mt-1 space-y-0.5">
              {similar.map(p => (
                <li key={p.id}>
                  {[p.item_code, p.item_name].filter(Boolean).join(' ')} ({[p.purchase_vendor_name, p.sale_price ? `지점판매가 ${p.sale_price.toLocaleString('ko-KR')}` : ''].filter(Boolean).join(' · ')})
                  {' '}<button type="button" onClick={() => onDone(p, false)} className="underline text-blue-700">이 품목으로 연결</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <div className="mt-3 px-3 py-2 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} className="px-3.5 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600">취소</button>
          <button type="button" onClick={save} disabled={saving}
            className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-sm disabled:opacity-50">
            {saving ? '등록 중...' : '등록하고 연결'}
          </button>
        </div>
      </div>
    </div>
  )
}
