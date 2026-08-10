'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// 품목 마스터 (2단계) — 주문 입력의 품번 검색 원천.
// 목록 화면 관례: KPI 카드(클릭=필터) + 통합 검색 + 표.
// 조회는 전 직원, 등록·수정·엑셀 업로드는 manager/admin (API에서 차단).

interface Product {
  id: string; item_code: string | null; item_name: string; option_name: string | null
  purchase_vendor_name: string | null; category: string | null
  sale_price: number; individual_sale_price: number; purchase_price: number
  carton_unit: number | null; carton_shipping_fee: number; loose_shipping_fee: number
  is_active: boolean; memo: string | null; updated_at: string
}

const won = (n: number) => (n ?? 0).toLocaleString('ko-KR')
const toInt = (s: string) => {
  const n = Number(s.replace(/[^\d-]/g, ''))
  return Number.isFinite(n) ? Math.round(n) : 0
}

const emptyDraft = {
  item_code: '', item_name: '', purchase_vendor_name: '', category: '',
  sale_price: 0, individual_sale_price: 0, purchase_price: 0,
  carton_unit: 0, carton_shipping_fee: 0, loose_shipping_fee: 0, memo: '',
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'active' | 'inactive' | 'all'>('active')
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const res = await fetch('/api/orders-portal/products')
    const json = await res.json()
    if (!res.ok) setError(json.error ?? '조회 실패')
    else setProducts(json.products)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter(p => {
      if (filter === 'active' && !p.is_active) return false
      if (filter === 'inactive' && p.is_active) return false
      if (!q) return true
      return [p.item_code, p.item_name, p.purchase_vendor_name, p.category].some(v => (v ?? '').toLowerCase().includes(q))
    })
  }, [products, search, filter])

  const kpi = useMemo(() => ({
    active: products.filter(p => p.is_active).length,
    inactive: products.filter(p => !p.is_active).length,
    vendors: new Set(products.filter(p => p.is_active && p.purchase_vendor_name).map(p => p.purchase_vendor_name)).size,
  }), [products])

  const act = async (body: Record<string, unknown>, doneMsg?: string) => {
    setError(null); setNotice(null)
    const res = await fetch('/api/orders-portal/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) { setError(json.error); return false }
    if (doneMsg) setNotice(doneMsg)
    await load()
    return true
  }

  const save = async () => {
    if (!draft.item_name.trim()) { setError('품명을 입력해주세요.'); return }
    const ok = await act(
      editingId === 'new' ? { action: 'create', ...draft } : { action: 'update', id: editingId, ...draft },
      editingId === 'new' ? '품목이 등록되었습니다.' : '품목이 수정되었습니다.',
    )
    if (ok) { setEditingId(null); setDraft(emptyDraft) }
  }

  const startEdit = (p: Product) => {
    setEditingId(p.id)
    setDraft({
      item_code: p.item_code ?? '', item_name: p.item_name,
      purchase_vendor_name: p.purchase_vendor_name ?? '', category: p.category ?? '',
      sale_price: p.sale_price, individual_sale_price: p.individual_sale_price ?? 0,
      purchase_price: p.purchase_price,
      carton_unit: p.carton_unit ?? 0, carton_shipping_fee: p.carton_shipping_fee ?? 0,
      loose_shipping_fee: p.loose_shipping_fee ?? 0,
      memo: p.memo ?? '',
    })
  }

  const upload = async (file: File) => {
    setUploading(true); setError(null); setNotice(null)
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/orders-portal/products/import', { method: 'POST', body: fd })
    const json = await res.json()
    if (!res.ok) setError(json.error ?? '업로드 실패')
    else {
      setNotice(`업로드 완료 — 신규 ${json.created}건 · 갱신 ${json.updated}건 · 건너뜀 ${json.skipped}건`)
      await load()
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const inputCls = 'border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm'

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">품목 마스터</h1>
        <span className="text-xs text-gray-400">주문 입력의 품번 검색 원천 — 품번 선택 시 품명·매입처·가격 자동</span>
        <span className="ml-auto flex gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="px-3.5 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 disabled:opacity-50">
            {uploading ? '업로드 중...' : '상품 엑셀 업로드'}
          </button>
          <button onClick={() => { setEditingId('new'); setDraft(emptyDraft) }}
            className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-sm">+ 품목 등록</button>
        </span>
      </div>

      {/* KPI 카드 (클릭=필터) */}
      <div className="grid grid-cols-3 gap-2.5 mt-4 max-w-xl">
        {([
          ['active', '사용 중 품목', kpi.active, ''],
          ['inactive', '중지 품목', kpi.inactive, 'text-gray-400'],
          ['all', '매입처 수', kpi.vendors, 'text-blue-700'],
        ] as const).map(([key, title, val, cls]) => (
          <button key={key} onClick={() => setFilter(key)}
            className={`bg-white border rounded-xl px-4 py-3 text-left ${filter === key ? 'border-slate-800' : 'border-gray-200'}`}>
            <div className="text-[11px] text-gray-400">{title}</div>
            <div className={`text-lg font-bold tabular-nums ${cls}`}>{val}</div>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="품번 · 품명 · 매입처 검색"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-72" />
        <span className="text-xs text-gray-400">{filtered.length}건</span>
      </div>

      {error && <div className="mt-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg whitespace-pre-line">{error}</div>}
      {notice && <div className="mt-3 px-4 py-2.5 bg-emerald-50 text-emerald-700 text-sm rounded-lg">{notice}</div>}

      {/* 등록·수정 폼 */}
      {editingId && (
        <div className="mt-3 p-3.5 bg-white border border-slate-300 rounded-xl flex items-end gap-2.5 flex-wrap">
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">품번</label>
            <input value={draft.item_code} onChange={e => setDraft(d => ({ ...d, item_code: e.target.value }))}
              className={`${inputCls} w-28`} placeholder="선택" />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">품명 *</label>
            <input value={draft.item_name} onChange={e => setDraft(d => ({ ...d, item_name: e.target.value }))}
              className={`${inputCls} w-64`} />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">매입처</label>
            <input value={draft.purchase_vendor_name} onChange={e => setDraft(d => ({ ...d, purchase_vendor_name: e.target.value }))}
              className={`${inputCls} w-40`} placeholder="발주서 분리 기준" />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">지점판매가</label>
            <input value={draft.sale_price ? won(draft.sale_price) : ''} onChange={e => setDraft(d => ({ ...d, sale_price: toInt(e.target.value) }))}
              className={`${inputCls} w-28 text-right tabular-nums`} placeholder="0"
              title="한 곳 묶음 배송 — 배송비는 카톤 기준 별도" />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">개별판매가</label>
            <input value={draft.individual_sale_price ? won(draft.individual_sale_price) : ''} onChange={e => setDraft(d => ({ ...d, individual_sale_price: toInt(e.target.value) }))}
              className={`${inputCls} w-28 text-right tabular-nums`} placeholder="미지정"
              title="여러 곳 개별 배송 — 배송비 포함가. 비우면 지점판매가 사용" />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">매입가</label>
            <input value={draft.purchase_price ? won(draft.purchase_price) : ''} onChange={e => setDraft(d => ({ ...d, purchase_price: toInt(e.target.value) }))}
              className={`${inputCls} w-28 text-right tabular-nums`} placeholder="0" />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">카톤단위</label>
            <input value={draft.carton_unit || ''} onChange={e => setDraft(d => ({ ...d, carton_unit: toInt(e.target.value) }))}
              className={`${inputCls} w-20 text-right tabular-nums`} placeholder="개/카톤" title="1카톤에 들어가는 수량 — 비우면 배송비 자동 계산 안 함" />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">카톤택배비</label>
            <input value={draft.carton_shipping_fee ? won(draft.carton_shipping_fee) : ''} onChange={e => setDraft(d => ({ ...d, carton_shipping_fee: toInt(e.target.value) }))}
              className={`${inputCls} w-24 text-right tabular-nums`} placeholder="0" title="카톤당 택배비" />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">카톤외택배비</label>
            <input value={draft.loose_shipping_fee ? won(draft.loose_shipping_fee) : ''} onChange={e => setDraft(d => ({ ...d, loose_shipping_fee: toInt(e.target.value) }))}
              className={`${inputCls} w-24 text-right tabular-nums`} placeholder="0"
              title="낱개 1건 택배비 — 지점 배송 나머지 낱개분·개별 배송 파생가 계산에 사용" />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">분류</label>
            <input value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}
              className={`${inputCls} w-24`} placeholder="타올 등" />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">메모</label>
            <input value={draft.memo} onChange={e => setDraft(d => ({ ...d, memo: e.target.value }))}
              className={`${inputCls} w-40`} />
          </div>
          <button onClick={save} className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-sm">
            {editingId === 'new' ? '등록' : '저장'}
          </button>
          <button onClick={() => { setEditingId(null); setDraft(emptyDraft) }}
            className="px-3.5 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600">취소</button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl mt-3 overflow-x-auto">
        {loading ? <div className="text-center py-16 text-gray-400">로딩 중...</div> : (
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                <th className="py-2 px-3 text-left font-medium">품번</th>
                <th className="py-2 px-3 text-left font-medium">품명</th>
                <th className="py-2 px-3 text-left font-medium">분류</th>
                <th className="py-2 px-3 text-left font-medium">매입처</th>
                <th className="py-2 px-3 text-right font-medium">지점판매가</th>
                <th className="py-2 px-3 text-right font-medium">개별판매가</th>
                <th className="py-2 px-3 text-right font-medium">매입가</th>
                <th className="py-2 px-3 text-right font-medium">마진(지점)</th>
                <th className="py-2 px-3 text-right font-medium">카톤단위</th>
                <th className="py-2 px-3 text-right font-medium">카톤택배비</th>
                <th className="py-2 px-3 text-right font-medium">카톤외택배비</th>
                <th className="py-2 px-3 text-left font-medium">메모</th>
                <th className="py-2 px-3 text-left font-medium">상태</th>
                <th className="py-2 px-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className={`border-b border-gray-50 ${p.is_active ? '' : 'text-gray-400'}`}>
                  <td className="py-1.5 px-3 text-xs tabular-nums whitespace-nowrap">{p.item_code ?? '-'}</td>
                  <td className="py-1.5 px-3 font-medium">{p.item_name}</td>
                  <td className="py-1.5 px-3 text-xs whitespace-nowrap">{p.category ?? '-'}</td>
                  <td className="py-1.5 px-3 whitespace-nowrap">{p.purchase_vendor_name ?? '-'}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{won(p.sale_price)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{p.individual_sale_price ? won(p.individual_sale_price) : '-'}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{won(p.purchase_price)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-emerald-700">{won(p.sale_price - p.purchase_price)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{p.carton_unit ?? '-'}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{p.carton_unit ? won(p.carton_shipping_fee) : '-'}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{p.loose_shipping_fee ? won(p.loose_shipping_fee) : '-'}</td>
                  <td className="py-1.5 px-3 text-xs">{p.memo ?? '-'}</td>
                  <td className="py-1.5 px-3">
                    <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${p.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {p.is_active ? '사용' : '중지'}
                    </span>
                  </td>
                  <td className="py-1.5 px-3 text-right whitespace-nowrap">
                    <button onClick={() => startEdit(p)} className="text-xs text-blue-700 hover:underline mr-2.5">수정</button>
                    <button onClick={() => act({ action: p.is_active ? 'deactivate' : 'reactivate', id: p.id })}
                      className="text-xs text-gray-400 hover:underline">
                      {p.is_active ? '중지' : '재사용'}
                    </button>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={14} className="text-center py-12 text-gray-400 text-sm">
                  품목이 없습니다. 상품 엑셀 업로드 또는 개별 등록으로 시작하세요.
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-2">
        회사 원가표 엑셀을 그대로 업로드하면 됩니다 (원가표 시트의 품번 · 상품명(원가표 등록용) · 옵션명 · 매입처 ·
        지점배송매입가 · 지점/개별배송판매가 · 목차 · 카톤단위 · 택배비(카톤단위/카톤외)를 인식, 카탈로그 제작용 컬럼은 무시).
        품번 기준으로 갱신되며, 주문 입력에서 지점=지점판매가+카톤 공식 배송비 / 개별=개별판매가(배송비 포함)가 자동 적용됩니다.
      </p>
    </div>
  )
}
