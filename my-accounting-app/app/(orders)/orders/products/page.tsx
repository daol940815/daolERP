'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import VendorInfoPanel, { useVendorInfo } from './vendor-info-panel'
import { branchMargin, individualMargin, formatProfit, formatRate, type Margin } from '@/lib/product-margin'

// 품목 마스터 (2단계) — 주문 입력의 품번 검색 원천.
// 목록 화면 관례: KPI 카드(클릭=필터) + 통합 검색 + 표.
// 조회 · 엑셀 다운로드는 전 직원, 등록 · 수정 · 업로드 · 품절 · 중지는 영업·주문 그룹 수정 권한.
// 버튼은 GET 응답의 can_edit으로 수정 권한자에게만 노출(UX용 — 실제 차단은 API·미들웨어).

interface Product {
  id: string; item_code: string | null; item_name: string; option_name: string | null
  purchase_vendor_name: string | null; category: string | null
  sale_price: number; individual_sale_price: number; purchase_price: number
  carton_unit: number | null; carton_shipping_fee: number; loose_shipping_fee: number
  is_addon: boolean; is_active: boolean; is_soldout?: boolean; is_shipping?: boolean
  status_note?: string | null
  memo: string | null; updated_at: string
}

const won = (n: number) => (n ?? 0).toLocaleString('ko-KR')
const toInt = (s: string) => {
  const n = Number(s.replace(/[^\d-]/g, ''))
  return Number.isFinite(n) ? Math.round(n) : 0
}

const emptyDraft = {
  item_code: '', item_name: '', purchase_vendor_name: '', category: '',
  sale_price: 0, individual_sale_price: 0, purchase_price: 0,
  carton_unit: 0, carton_shipping_fee: 0, loose_shipping_fee: 0,
  is_addon: false, is_shipping: false, memo: '',
}

// 검색 구분 (기존 ERP 방식 — 2026-11-03 실무자 요청)
type CondField = 'all' | 'code' | 'name' | 'vendor' | 'category'
const COND_LABEL: Record<CondField, string> = {
  all: '전체', code: '품번', name: '품명', vendor: '매입처', category: '목차',
}
const condMatch = (p: Product, field: CondField, q: string) => {
  const has = (v?: string | null) => (v ?? '').toLowerCase().includes(q)
  switch (field) {
    case 'code': return has(p.item_code)
    case 'name': return has(p.item_name)
    case 'vendor': return has(p.purchase_vendor_name)
    case 'category': return has(p.category)
    default: return [p.item_code, p.item_name, p.purchase_vendor_name, p.category].some(has)
  }
}

// 정렬 (2026-11-09 사용자 요청 · 시안 확인 후 두 방식 병행 확정):
//  - 검색 줄 오른쪽 "정렬 기준" 선택 상자 + 오름차순/내림차순 버튼
//  - 표 머리글 클릭: 오름차순 → 내림차순 → 기본(품명 오름차순). 두 조작은 같은 상태를 공유
// 빈 값('-')은 방향과 관계없이 항상 맨 아래. 문자는 한글 순 + 숫자 자연 정렬(품번 A-2 < A-10).
type SortKey = 'code' | 'name' | 'category' | 'vendor' | 'sale' | 'individual' | 'purchase'
  | 'b_profit' | 'b_rate' | 'i_profit' | 'i_rate' | 'carton' | 'carton_fee' | 'loose_fee' | 'memo' | 'status'
type SortDir = 'asc' | 'desc'
const DEFAULT_SORT: { key: SortKey; dir: SortDir } = { key: 'name', dir: 'asc' }
// 표 칸 순서 = 머리글 순서
const SORT_COLS: [SortKey, string, 'left' | 'right'][] = [
  ['code', '품번', 'left'], ['name', '품명', 'left'], ['category', '분류', 'left'],
  ['vendor', '매입처', 'left'], ['sale', '지점판매가', 'right'], ['individual', '개별판매가', 'right'],
  ['purchase', '매입가', 'right'], ['b_profit', '마진', 'right'], ['carton', '카톤단위', 'right'],
  ['carton_fee', '카톤택배비', 'right'], ['loose_fee', '카톤외택배비', 'right'],
  ['memo', '메모', 'left'], ['status', '상태', 'left'],
]
// 마진 칸(2026-11-10): 머리글 '마진' 클릭 = 지점 이익금 순, 선택 상자는 지점 · 개별 × 이익금 · 마진율 4가지
const SORT_LABEL = {
  ...Object.fromEntries(SORT_COLS.map(([k, l]) => [k, l])),
  b_profit: '지점 이익금', b_rate: '지점 마진율', i_profit: '개별 이익금', i_rate: '개별 마진율',
} as Record<SortKey, string>
// 선택 상자 순서 — 자주 쓰는 품번 · 품명 · 지점판매가를 앞에
const SORT_OPTIONS: SortKey[] = ['code', 'name', 'sale', 'individual', 'purchase',
  'b_profit', 'b_rate', 'i_profit', 'i_rate', 'vendor',
  'category', 'carton', 'carton_fee', 'loose_fee', 'memo', 'status']
const sortValue = (p: Product, key: SortKey): string | number | null => {
  const txt = (v?: string | null) => (v ?? '').trim() || null
  const num = (v?: number | null) => (v ? v : null)   // 0·빈 값은 화면에서 '-' — 빈 값 취급
  switch (key) {
    case 'code': return txt(p.item_code)
    case 'name': return txt(p.item_name)
    case 'category': return txt(p.category)
    case 'vendor': return txt(p.purchase_vendor_name)
    case 'sale': return p.sale_price ?? 0
    case 'individual': return num(p.individual_sale_price)
    case 'purchase': return p.purchase_price ?? 0
    // 마진율 (-)(판매가 없음) · 개별판매가 없음은 빈 값 = 맨 아래
    case 'b_profit': return branchMargin(p).profit
    case 'b_rate': return branchMargin(p).rate
    case 'i_profit': return individualMargin(p)?.profit ?? null
    case 'i_rate': return individualMargin(p)?.rate ?? null
    case 'carton': return num(p.carton_unit)
    case 'carton_fee': return p.carton_unit ? (p.carton_shipping_fee ?? 0) : null
    case 'loose_fee': return num(p.loose_shipping_fee)
    case 'memo': return txt(p.memo)
    case 'status': return p.is_active ? 0 : 1   // 사용 → 중지
  }
}
const compareBy = (key: SortKey, dir: SortDir) => (a: Product, b: Product) => {
  const va = sortValue(a, key), vb = sortValue(b, key)
  if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1
  const c = typeof va === 'number' && typeof vb === 'number'
    ? va - vb
    : String(va).localeCompare(String(vb), 'ko', { numeric: true })
  return dir === 'asc' ? c : -c
}

// 마진 한 줄: "지점 1,420원 (31.6%)" — 마이너스 빨간색, 개별판매가 없음은 '-'
function MarginLine({ label, m }: { label: string; m: Margin | null }) {
  const neg = m !== null && Math.round(m.profit) < 0
  return (
    <div className="flex justify-end items-baseline gap-1.5">
      <span className="text-[0.625rem] text-gray-400">{label}</span>
      {m === null ? <span className="text-gray-400">-</span> : (
        <span className={neg ? 'text-red-600 font-medium' : 'text-emerald-700'}>
          {formatProfit(m.profit)} <span className="text-xs">({formatRate(m.rate)})</span>
        </span>
      )}
    </div>
  )
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // 구분 검색 + 결과 내 재검색 (2026-11-03 실무자 요청·사용자 승인):
  // 구분·검색어 입력은 즉시 필터, Enter로 조건 칩에 쌓여 전부 만족(AND)한 품목만 표시
  const [search, setSearch] = useState('')
  const [condField, setCondField] = useState<CondField>('all')
  const [conds, setConds] = useState<{ field: CondField; value: string }[]>([])
  const [filter, setFilter] = useState<'active' | 'inactive' | 'addon' | 'cost' | 'all'>('active')
  const [sort, setSort] = useState(DEFAULT_SORT)
  const isDefaultSort = sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir
  // 머리글 클릭: 다른 칸 → 오름차순, 오름차순 → 내림차순, 내림차순 → 기본 순서
  const toggleSort = (key: SortKey) => setSort(prev =>
    prev.key !== key ? { key, dir: 'asc' } : prev.dir === 'asc' ? { key, dir: 'desc' } : DEFAULT_SORT)
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  // 매입처 담당자 · 연락처 · 이메일 (2026-11-10) — 폼이 열려 있을 때 매입처명 기준으로 조회
  const vinfo = useVendorInfo(draft.purchase_vendor_name, editingId !== null)
  const [uploading, setUploading] = useState(false)
  // 수정 권한 (2026-11-10): 응답 받기 전에는 숨김 — 권한 없는 직원에게 버튼이 잠깐 보였다 사라지지 않게
  const [canEdit, setCanEdit] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const res = await fetch('/api/orders-portal/products')
    const json = await res.json()
    if (!res.ok) setError(json.error ?? '조회 실패')
    else { setProducts(json.products); setCanEdit(json.can_edit === true) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter(p => {
      if (filter === 'active' && !p.is_active) return false
      if (filter === 'inactive' && p.is_active) return false
      if (filter === 'addon' && !p.is_addon) return false   // 부가상품(옵션)만 — 중지 포함
      if (filter === 'cost' && !p.is_shipping) return false   // 비용 품목만
      // 고정된 조건 전부 만족(AND) = 검색 결과 내 재검색
      if (!conds.every(c => condMatch(p, c.field, c.value.toLowerCase()))) return false
      if (!q) return true
      return condMatch(p, condField, q)   // 입력 중인 검색어는 즉시 필터
    })
  }, [products, search, condField, conds, filter])

  // 정렬은 필터 결과에만 적용 (같은 값끼리는 원래 순서 = API 품명순 유지)
  const sorted = useMemo(() => [...filtered].sort(compareBy(sort.key, sort.dir)), [filtered, sort])

  // 조건 칩 추가 (Enter·매입처 클릭) — 같은 조건 중복 방지
  const addCond = (field: CondField, value: string) => {
    const v = value.trim()
    if (!v) return
    setConds(prev => prev.some(c => c.field === field && c.value === v) ? prev : [...prev, { field, value: v }])
  }

  const kpi = useMemo(() => ({
    active: products.filter(p => p.is_active).length,
    inactive: products.filter(p => !p.is_active).length,
    addon: products.filter(p => p.is_addon).length,
    cost: products.filter(p => p.is_shipping).length,
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
    const vendorPatch = vinfo.changes(draft.purchase_vendor_name)   // 바뀐 매입처 정보 칸 (권한 · 연결 있을 때만)
    const doneMsg = editingId === 'new' ? '품목이 등록되었습니다.' : '품목이 수정되었습니다.'
    const ok = await act(
      editingId === 'new' ? { action: 'create', ...draft } : { action: 'update', id: editingId, ...draft },
      doneMsg,
    )
    if (!ok) return
    if (vendorPatch) {
      // 매입처 정보 자체 수정 — 품목에는 저장하지 않음, 그 매입처의 모든 품목에 적용
      const res = await fetch('/api/orders-portal/products/vendor-info', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: draft.purchase_vendor_name, ...vendorPatch }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(`품목은 저장됐지만 매입처 정보는 저장하지 못했습니다 — ${json.error ?? res.status}`)
        return   // 폼을 열어 둬 다시 시도할 수 있게
      }
      setNotice(`${doneMsg} 매입처 정보 ${json.updated}칸도 저장했습니다 — 이 매입처의 모든 품목에 적용됩니다.`)
    }
    setEditingId(null); setDraft(emptyDraft)
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
      is_addon: p.is_addon ?? false,
      is_shipping: p.is_shipping ?? false,
      memo: p.memo ?? '',
    })
  }

  // 업로드 확인 팝업 (2026-11-04 실무자 요청·B안): 파일 선택 → 서버 검사(반영 없음)
  // → 건수 확인 팝업 → 확인 시 실제 업로드. 잘못된 파일은 숫자로 바로 드러난다.
  const [pending, setPending] = useState<{ file: File; stats: Record<string, number> } | null>(null)

  const checkFile = async (file: File) => {
    setUploading(true); setError(null); setNotice(null)
    const fd = new FormData()
    fd.append('file', file); fd.append('dry_run', '1')
    const res = await fetch('/api/orders-portal/products/import', { method: 'POST', body: fd })
    const json = await res.json()
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
    if (!res.ok) { setError(json.error ?? '파일 검사 실패'); return }
    setPending({ file, stats: json })
  }

  const upload = async (file: File) => {
    setPending(null)
    setUploading(true); setError(null); setNotice(null)
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/orders-portal/products/import', { method: 'POST', body: fd })
    const json = await res.json()
    if (!res.ok) setError(json.error ?? '업로드 실패')
    else {
      setNotice(`업로드 완료 — 신규 ${json.created}건 · 갱신 ${json.updated}건 · 변경 없음 ${json.unchanged ?? 0}건 · 건너뜀 ${json.skipped}건`
        + (json.status_marked ? ` · 상태 표기 ${json.status_marked}건` : '')
        + (json.vendor_updated ? ` · 매입처 정보 갱신 ${json.vendor_updated}곳` : '')
        + (json.vendor_unlinked ? ` · 매입처 미연결 ${json.vendor_unlinked}곳(정보 미반영)` : ''))
      await load()
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const inputCls = 'border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm'

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">품목 관리</h1>
        <span className="text-xs text-gray-400">주문 입력의 품번 검색 원천 — 품번 선택 시 품명·매입처·가격 자동</span>
        <span className="ml-auto flex gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) checkFile(f) }} />
          <button onClick={() => {
              const p = new URLSearchParams()
              if (filter !== 'active') p.set('filter', filter)
              // 조건 칩 + 입력 중 검색어 그대로 — 다운로드도 화면과 같은 결과
              conds.forEach(c => p.append('cond', `${c.field}:${c.value}`))
              if (search.trim()) p.append('cond', `${condField}:${search.trim()}`)
              window.location.href = `/api/orders-portal/products/export?${p}`
            }}
            title="현재 필터·검색 조건 그대로 원가표 양식으로 다운로드 — 수정 후 그대로 재업로드 가능"
            className="px-3.5 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600">
            엑셀 다운로드
          </button>
          {canEdit && <>
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="px-3.5 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 disabled:opacity-50">
            {uploading ? '처리 중...' : '상품 엑셀 업로드'}
          </button>
          <button onClick={() => { setEditingId('new'); setDraft(emptyDraft) }}
            className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-sm">+ 품목 등록</button>
          </>}
        </span>
      </div>

      {/* KPI 카드 (클릭=필터) — 전체 품목 카드가 전체 조회 (2026-11-03 사용자 요청) */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 mt-4 max-w-5xl">
        {([
          ['all', '전체 품목', products.length, 'text-blue-700'],
          ['active', '사용 중 품목', kpi.active, ''],
          ['inactive', '중지 품목', kpi.inactive, 'text-gray-400'],
          ['addon', '부가상품(옵션)', kpi.addon, 'text-violet-600'],
        ] as const).map(([key, title, val, cls]) => (
          <button key={key} onClick={() => setFilter(key)}
            className={`bg-white border rounded-xl px-4 py-3 text-left ${filter === key ? 'border-slate-800' : 'border-gray-200'}`}>
            <div className="text-[0.6875rem] text-gray-400">{title}</div>
            <div className={`text-lg font-bold tabular-nums ${cls}`}>{val}</div>
          </button>
        ))}
        {/* 비용 품목 (배송비 · 퀵비 · 설치비 등) — 발주서 배송명단 제외 대상 (이름 키워드 후보 추천은 오판만 나와 폐지, 2026-11-05) */}
        <button onClick={() => setFilter('cost')}
          className={`bg-white border rounded-xl px-4 py-3 text-left ${filter === 'cost' ? 'border-slate-800' : 'border-gray-200'}`}>
          <div className="text-[0.6875rem] text-gray-400">비용 품목</div>
          <div className="text-lg font-bold tabular-nums text-amber-700">{kpi.cost}</div>
        </button>
        {/* 매입처 수 — 정보 표시용 (필터 아님) */}
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-left">
          <div className="text-[0.6875rem] text-gray-400">매입처 수</div>
          <div className="text-lg font-bold tabular-nums text-gray-500">{kpi.vendors}</div>
        </div>
      </div>

      {/* 구분 검색 + 결과 내 재검색: Enter로 조건이 쌓이고 전부 만족한 품목만 표시 */}
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <select value={condField} onChange={e => setCondField(e.target.value as CondField)}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
          {(Object.keys(COND_LABEL) as CondField[]).map(f => (
            <option key={f} value={f}>{COND_LABEL[f]}</option>
          ))}
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && search.trim()) { addCond(condField, search); setSearch('') }
          }}
          placeholder={`${COND_LABEL[condField]} 검색 — Enter로 조건 고정(결과 내 재검색)`}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-80" />
        {conds.map((c, i) => (
          <span key={`${c.field}:${c.value}`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200">
            {COND_LABEL[c.field]}: {c.value}
            <button onClick={() => setConds(prev => prev.filter((_, j) => j !== i))}
              className="text-blue-400 hover:text-blue-700" title="조건 제거">×</button>
          </span>
        ))}
        {conds.length > 0 && (
          <button onClick={() => setConds([])} className="text-xs text-gray-400 hover:text-gray-600">
            조건 모두 지우기
          </button>
        )}
        <span className="text-xs text-gray-400">{filtered.length}건</span>
        {/* 정렬 기준 선택 — 머리글 클릭과 같은 상태 */}
        <span className="ml-auto flex items-center gap-1.5 flex-wrap">
          {!isDefaultSort && (
            <button onClick={() => setSort(DEFAULT_SORT)} className="text-xs text-gray-400 hover:text-gray-600 mr-1"
              title="기본 순서(품명 오름차순)로 되돌리기">
              정렬 해제
            </button>
          )}
          <label htmlFor="product-sort-key" className="text-xs text-gray-500">정렬 기준</label>
          <select id="product-sort-key" value={sort.key}
            onChange={e => setSort(prev => ({ key: e.target.value as SortKey, dir: prev.dir }))}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
            {SORT_OPTIONS.map(k => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
          </select>
          <span className="inline-flex border border-gray-300 rounded-lg overflow-hidden" role="group" aria-label="정렬 방향">
            {(['asc', 'desc'] as const).map(d => (
              <button key={d} onClick={() => setSort(prev => ({ ...prev, dir: d }))} aria-pressed={sort.dir === d}
                className={`px-2.5 py-1.5 text-sm ${sort.dir === d ? 'bg-slate-900 text-white' : 'bg-white text-gray-500 hover:text-gray-800'}`}>
                {d === 'asc' ? '오름차순' : '내림차순'}
              </button>
            ))}
          </span>
        </span>
      </div>

      {error && <div className="mt-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg whitespace-pre-line">{error}</div>}
      {notice && <div className="mt-3 px-4 py-2.5 bg-emerald-50 text-emerald-700 text-sm rounded-lg">{notice}</div>}

      {/* 등록·수정 폼 */}
      {editingId && (
        <div className="mt-3 p-3.5 bg-white border border-slate-300 rounded-xl flex items-end gap-2.5 flex-wrap">
          <div>
            <label className="block text-[0.6875rem] text-gray-500 mb-0.5">품번</label>
            <input value={draft.item_code} onChange={e => setDraft(d => ({ ...d, item_code: e.target.value }))}
              className={`${inputCls} w-28`} placeholder="선택" />
          </div>
          <div>
            <label className="block text-[0.6875rem] text-gray-500 mb-0.5">품명 *</label>
            <input value={draft.item_name} onChange={e => setDraft(d => ({ ...d, item_name: e.target.value }))}
              className={`${inputCls} w-64`} />
          </div>
          <div>
            <label className="block text-[0.6875rem] text-gray-500 mb-0.5">매입처</label>
            <input value={draft.purchase_vendor_name} onChange={e => setDraft(d => ({ ...d, purchase_vendor_name: e.target.value }))}
              className={`${inputCls} w-40`} placeholder="발주서 분리 기준" />
          </div>
          <div>
            <label className="block text-[0.6875rem] text-gray-500 mb-0.5">지점판매가</label>
            <input value={draft.sale_price ? won(draft.sale_price) : ''} onChange={e => setDraft(d => ({ ...d, sale_price: toInt(e.target.value) }))}
              className={`${inputCls} w-28 text-right tabular-nums`} placeholder="0"
              title="한 곳 묶음 배송 — 배송비는 카톤 기준 별도" />
          </div>
          <div>
            <label className="block text-[0.6875rem] text-gray-500 mb-0.5">개별판매가</label>
            <input value={draft.individual_sale_price ? won(draft.individual_sale_price) : ''} onChange={e => setDraft(d => ({ ...d, individual_sale_price: toInt(e.target.value) }))}
              className={`${inputCls} w-28 text-right tabular-nums`} placeholder="미지정"
              title="여러 곳 개별 배송 — 배송비 포함가. 비우면 지점판매가 사용" />
          </div>
          <div>
            <label className="block text-[0.6875rem] text-gray-500 mb-0.5">매입가</label>
            <input value={draft.purchase_price ? won(draft.purchase_price) : ''} onChange={e => setDraft(d => ({ ...d, purchase_price: toInt(e.target.value) }))}
              className={`${inputCls} w-28 text-right tabular-nums`} placeholder="0" />
          </div>
          <div>
            <label className="block text-[0.6875rem] text-gray-500 mb-0.5">카톤단위</label>
            <input value={draft.carton_unit || ''} onChange={e => setDraft(d => ({ ...d, carton_unit: toInt(e.target.value) }))}
              className={`${inputCls} w-20 text-right tabular-nums`} placeholder="개/카톤" title="1카톤에 들어가는 수량 — 비우면 배송비 자동 계산 안 함" />
          </div>
          <div>
            <label className="block text-[0.6875rem] text-gray-500 mb-0.5">카톤택배비</label>
            <input value={draft.carton_shipping_fee ? won(draft.carton_shipping_fee) : ''} onChange={e => setDraft(d => ({ ...d, carton_shipping_fee: toInt(e.target.value) }))}
              className={`${inputCls} w-24 text-right tabular-nums`} placeholder="0" title="카톤당 택배비" />
          </div>
          <div>
            <label className="block text-[0.6875rem] text-gray-500 mb-0.5">카톤외택배비</label>
            <input value={draft.loose_shipping_fee ? won(draft.loose_shipping_fee) : ''} onChange={e => setDraft(d => ({ ...d, loose_shipping_fee: toInt(e.target.value) }))}
              className={`${inputCls} w-24 text-right tabular-nums`} placeholder="0"
              title="낱개 1건 택배비 — 지점 배송 나머지 낱개분·개별 배송 파생가 계산에 사용" />
          </div>
          <div>
            <label className="block text-[0.6875rem] text-gray-500 mb-0.5">분류</label>
            <input value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}
              className={`${inputCls} w-24`} placeholder="타올 등" />
          </div>
          <div>
            <label className="block text-[0.6875rem] text-gray-500 mb-0.5">메모</label>
            <input value={draft.memo} onChange={e => setDraft(d => ({ ...d, memo: e.target.value }))}
              className={`${inputCls} w-40`} />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 pb-2 cursor-pointer"
            title="포장지·쇼핑백 등 — 주문 입력에서 같은 매입처 상품의 옵션 추가 칩으로 노출">
            <input type="checkbox" checked={draft.is_addon}
              onChange={e => setDraft(d => ({ ...d, is_addon: e.target.checked }))} />
            부가상품
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 pb-2 cursor-pointer"
            title="비용 품목 (배송비 · 퀵비 · 설치비 등, 703) — 옵션 칩으로 노출, 선택 시 판매가 0 기본. 발주서 품목 표에는 나오고 배송명단에서는 빠집니다">
            <input type="checkbox" checked={draft.is_shipping}
              onChange={e => setDraft(d => ({ ...d, is_shipping: e.target.checked }))} />
            비용 품목
          </label>
          <VendorInfoPanel info={vinfo.info} draft={vinfo.draft} setDraft={vinfo.setDraft}
            loading={vinfo.loading} inputCls={inputCls} />
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
                {SORT_COLS.map(([key, label, align]) => {
                  const on = sort.key === key
                  return (
                    <th key={key} className={`py-2 px-3 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}
                      aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button onClick={() => toggleSort(key)}
                        title="클릭: 오름차순 → 내림차순 → 기본 순서(품명)"
                        className={`inline-flex items-center gap-0.5 whitespace-nowrap hover:text-gray-800 ${on ? 'text-gray-900' : ''}`}>
                        {label}
                        <span className={on ? '' : 'text-gray-300'}>{on ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
                      </button>
                    </th>
                  )
                })}
                {canEdit && <th className="py-2 px-3" />}
              </tr>
            </thead>
            <tbody>
              {sorted.map(p => (
                <tr key={p.id} className={`border-b border-gray-50 ${p.is_active ? '' : 'text-gray-400'}`}>
                  <td className="py-1.5 px-3 text-xs tabular-nums whitespace-nowrap">{p.item_code ?? '-'}</td>
                  <td className="py-1.5 px-3 font-medium">
                    {p.item_name}
                    {p.is_addon && (
                      <span className="ml-1.5 inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[0.625rem] font-medium bg-violet-50 text-violet-600">옵션</span>
                    )}
                    {p.is_shipping && (
                      <span className="ml-1.5 inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[0.625rem] font-medium bg-amber-50 text-amber-700">비용</span>
                    )}
                    {p.is_soldout && (
                      <span className="ml-1.5 inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[0.625rem] font-medium bg-red-50 text-red-600">품절</span>
                    )}
                    {/* 원가표 상태 메모 (512) — 원문 그대로 표시 */}
                    {p.status_note && (
                      <span className="ml-1.5 text-[0.625rem] text-amber-600 whitespace-pre-line align-middle">{p.status_note}</span>
                    )}
                  </td>
                  <td className="py-1.5 px-3 text-xs whitespace-nowrap">{p.category ?? '-'}</td>
                  <td className="py-1.5 px-3 whitespace-nowrap">
                    {p.purchase_vendor_name ? (
                      <button onClick={() => addCond('vendor', p.purchase_vendor_name!)}
                        title="클릭하면 이 매입처 조건으로 필터"
                        className="hover:underline hover:text-blue-700">
                        {p.purchase_vendor_name}
                      </button>
                    ) : '-'}
                  </td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{won(p.sale_price)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{p.individual_sale_price ? won(p.individual_sale_price) : '-'}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{won(p.purchase_price)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap">
                    <MarginLine label="지점" m={branchMargin(p)} />
                    <MarginLine label="개별" m={individualMargin(p)} />
                  </td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{p.carton_unit ?? '-'}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{p.carton_unit ? won(p.carton_shipping_fee) : '-'}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{p.loose_shipping_fee ? won(p.loose_shipping_fee) : '-'}</td>
                  <td className="py-1.5 px-3 text-xs">{p.memo ?? '-'}</td>
                  <td className="py-1.5 px-3">
                    <span className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[0.6875rem] font-medium ${p.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {p.is_active ? '사용' : '중지'}
                    </span>
                  </td>
                  {canEdit && <td className="py-1.5 px-3 text-right whitespace-nowrap">
                    <button onClick={() => startEdit(p)} className="text-xs text-blue-700 hover:underline mr-2.5">수정</button>
                    <button onClick={() => act({ action: p.is_soldout ? 'restock' : 'soldout', id: p.id },
                        p.is_soldout ? '품절이 해제되었습니다.' : '품절 처리되었습니다. 상담·주문 입력 검색에 품절로 표시됩니다.')}
                      className={`text-xs mr-2.5 hover:underline ${p.is_soldout ? 'text-red-500' : 'text-gray-400'}`}>
                      {p.is_soldout ? '품절해제' : '품절'}
                    </button>
                    <button onClick={() => act({ action: p.is_active ? 'deactivate' : 'reactivate', id: p.id })}
                      className="text-xs text-gray-400 hover:underline">
                      {p.is_active ? '중지' : '재사용'}
                    </button>
                  </td>}
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={canEdit ? 14 : 13} className="text-center py-12 text-gray-400 text-sm">
                  {canEdit ? '품목이 없습니다. 상품 엑셀 업로드 또는 개별 등록으로 시작하세요.' : '품목이 없습니다.'}
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      {canEdit && <p className="text-xs text-gray-400 mt-2">
        회사 원가표 엑셀을 그대로 업로드하면 됩니다 (원가표 시트의 품번 · 상품명(원가표 등록용) · 옵션명 · 매입처 ·
        지점배송매입가 · 지점/개별배송판매가 · 목차 · 카톤단위 · 택배비(카톤단위/카톤외)를 인식, 카탈로그 제작용 컬럼은 무시).
        품번 기준으로 갱신되며, 주문 입력에서 지점=지점판매가+카톤 공식 배송비 / 개별=개별판매가(배송비 포함)가 자동 적용됩니다.
      </p>}

      {/* 업로드 확인 팝업 — 검사 결과(반영 없음)를 보여주고 확인 후 실제 업로드 */}
      {pending && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4"
          onClick={() => setPending(null)}>
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 p-5 w-full max-w-md"
            onClick={e => e.stopPropagation()}>
            <div className="text-sm font-bold text-gray-900">업로드 하시겠습니까?</div>
            <div className="mt-2 text-sm text-gray-700 break-all">{pending.file.name}</div>
            <div className="mt-3 p-3 bg-gray-50 rounded-lg text-sm text-gray-700 space-y-1">
              <div>인식 <b className="tabular-nums">{pending.stats.parsed ?? 0}</b>건
                {pending.stats.skipped ? <span className="text-gray-400"> (건너뜀 {pending.stats.skipped}건)</span> : null}
              </div>
              <div>
                신규 <b className="tabular-nums">{pending.stats.created ?? 0}</b>건 ·
                갱신 <b className="tabular-nums">{pending.stats.updated ?? 0}</b>건 ·
                변경 없음 <b className="tabular-nums">{pending.stats.unchanged ?? 0}</b>건
              </div>
              {(pending.stats.status_marked ?? 0) > 0 && <div>상태 표기(품절·단종 등) {pending.stats.status_marked}건</div>}
              {(pending.stats.vendor_updated ?? 0) > 0 && <div>매입처 연락 정보 갱신 예정 {pending.stats.vendor_updated}곳</div>}
            </div>
            {(pending.stats.created ?? 0) > (pending.stats.updated ?? 0) + (pending.stats.unchanged ?? 0) && (
              <div className="mt-2 text-xs text-amber-600">
                신규가 기존 갱신보다 많습니다 — 다른 양식이나 옛 파일일 수 있으니 파일을 한 번 더 확인하세요.
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setPending(null)}
                className="px-3.5 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600">취소</button>
              <button onClick={() => upload(pending.file)}
                className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-sm">업로드</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
