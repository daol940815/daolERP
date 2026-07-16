'use client'

import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { ErpVendorAlias } from '@/types/erp'
import type { Vendor } from '@/types/tax-invoice'
import { bestNameMatch } from '@/lib/name-similarity'
import SearchableSelect from '@/components/ui/SearchableSelect'

type VendorInfo = Pick<Vendor,
  'id' | 'name' | 'type' | 'biz_number' | 'contact_name' | 'contact_phone' | 'email' | 'note' | 'match_aliases' | 'card_numbers' | 'is_active'
>
interface AliasRow extends ErpVendorAlias { vendors: VendorInfo | null }

type Tab = 'customer' | 'purchase'

const pct = (n: number) => `${Math.round(n * 100)}%`

const TYPE_META: Record<string, { label: string; cls: string }> = {
  vendor:   { label: '매입처',     cls: 'bg-orange-100 text-orange-700' },
  customer: { label: '매출처',     cls: 'bg-blue-100 text-blue-700' },
  both:     { label: '매입+매출',  cls: 'bg-purple-100 text-purple-700' },
}

// 펼침 편집용 임시 값
interface Draft {
  biz: string
  aliases: string[]
  cards: string[]
  newAlias: string
  newCard: string
  contactName: string
  contactPhone: string
  email: string
  note: string
}

// ── 칩 입력 (입금/출금계좌명, 카드번호 공용) ────────────────────────
function ChipInput({
  items, onAdd, onRemove, placeholder, mono,
}: {
  items: string[]
  onAdd: (v: string) => void
  onRemove: (v: string) => void
  placeholder: string
  mono?: boolean
}) {
  const [input, setInput] = useState('')
  const handleAdd = () => {
    const v = input.trim()
    if (!v || items.includes(v)) { setInput(''); return }
    onAdd(v)
    setInput('')
  }
  return (
    <div className="flex flex-wrap gap-1 items-center">
      {items.map(v => (
        <span
          key={v}
          className={`group inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-700 hover:bg-gray-200 ${mono ? 'font-mono' : ''}`}
        >
          {v}
          <button
            onClick={() => onRemove(v)}
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 leading-none transition-opacity"
          >✕</button>
        </span>
      ))}
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd() } }}
        onBlur={handleAdd}
        placeholder={placeholder}
        className={`text-xs px-2 py-0.5 border border-dashed border-gray-300 rounded w-32 focus:outline-none focus:border-slate-500 text-gray-500 placeholder-gray-400 ${mono ? 'font-mono' : ''}`}
      />
    </div>
  )
}

// ── 거래처 등록/수정 모달 (ERP 미연동 거래처 — "기타 거래처") ────────
function VendorModal({
  vendor, defaultType, onClose, onSaved,
}: {
  vendor: Vendor | null
  defaultType: 'vendor' | 'customer'
  onClose: () => void
  onSaved: (v: Vendor) => void
}) {
  const [form, setForm] = useState({
    name:          vendor?.name ?? '',
    biz_number:    vendor?.biz_number ?? '',
    type:          vendor?.type ?? defaultType,
    contact_name:  vendor?.contact_name ?? '',
    contact_phone: vendor?.contact_phone ?? '',
    email:         vendor?.email ?? '',
    note:          vendor?.note ?? '',
    match_aliases: vendor?.match_aliases ?? [] as string[],
    card_numbers:  vendor?.card_numbers ?? [] as string[],
    ledger_balance: vendor?.ledger_balance != null ? String(vendor.ledger_balance) : '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const handleSave = async () => {
    if (!form.name.trim()) { setError('거래처명은 필수입니다.'); return }
    setSaving(true)
    setError(null)
    const url    = vendor ? `/api/vendors/${vendor.id}` : '/api/vendors'
    const method = vendor ? 'PATCH' : 'POST'
    const payload: Record<string, unknown> = { ...form }
    if (vendor) {
      payload.ledger_balance = form.ledger_balance.trim() ? Number(form.ledger_balance) : null
    } else {
      delete payload.ledger_balance
    }
    const res  = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) { setError(json.error ?? '저장 실패'); return }
    onSaved(json.data)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 mb-4">{vendor ? '거래처 수정' : '기타 거래처 추가'}</h2>
        {!vendor && (
          <p className="text-xs text-gray-400 mb-3">ERP 주문에 아직 등장하지 않는 거래처를 미리 등록합니다.</p>
        )}
        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">거래처명 <span className="text-red-500">*</span></label>
            <input
              autoFocus
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">사업자등록번호</label>
              <input
                value={form.biz_number}
                onChange={e => setForm(f => ({ ...f, biz_number: e.target.value }))}
                placeholder="000-00-00000"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">유형</label>
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as 'vendor' | 'customer' | 'both' }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="vendor">매입처</option>
                <option value="customer">매출처</option>
                <option value="both">매입+매출</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">담당자</label>
              <input
                value={form.contact_name}
                onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">연락처</label>
              <input
                value={form.contact_phone}
                onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
            <input
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">메모</label>
            <textarea
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">입금/출금계좌명</label>
            <p className="text-xs text-gray-400 mb-1.5">은행 거래내역 매칭에 사용됩니다.</p>
            <ChipInput
              items={form.match_aliases}
              placeholder="+ 별칭"
              onAdd={v => setForm(f => ({ ...f, match_aliases: [...f.match_aliases, v] }))}
              onRemove={v => setForm(f => ({ ...f, match_aliases: f.match_aliases.filter(a => a !== v) }))}
            />
          </div>
          {vendor && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">거래처원장 잔액</label>
              <p className="text-xs text-gray-400 mb-1.5">
                거래처가 통보한 원장 기준 잔액 (대사용 참고값, 수기 입력)
                {vendor.ledger_balance_updated_at && ` · 마지막 갱신 ${vendor.ledger_balance_updated_at}`}
              </p>
              <input
                type="number"
                value={form.ledger_balance}
                onChange={e => setForm(f => ({ ...f, ledger_balance: e.target.value }))}
                placeholder="예: 2919000"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">카드번호</label>
            <p className="text-xs text-gray-400 mb-1.5">카드매출 자동 매칭에 사용됩니다.</p>
            <ChipInput
              items={form.card_numbers}
              placeholder="1234-56**-****-7890"
              mono
              onAdd={v => setForm(f => ({ ...f, card_numbers: [...f.card_numbers, v] }))}
              onRemove={v => setForm(f => ({ ...f, card_numbers: f.card_numbers.filter(c => c !== v) }))}
            />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">취소</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ErpAliasesContent() {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  const tab: Tab = searchParams.get('type') === 'purchase' ? 'purchase' : 'customer'
  const setTab = (t: Tab) => router.replace(`${pathname}?type=${t}`)

  const [onlyUnmatched, setOnlyUnmatched] = useState(false)
  const [aliases, setAliases]   = useState<AliasRow[]>([])
  const [vendors, setVendors]   = useState<Vendor[]>([])
  const [loading, setLoading]   = useState(true)
  const [working, setWorking]   = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch]     = useState('')
  const [msg, setMsg]           = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [draft, setDraft]       = useState<Draft | null>(null)
  const [showAddVendor, setShowAddVendor] = useState(false)
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isCustomer = tab === 'customer'
  const tabLabel   = isCustomer ? '매출처' : '매입처'

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const loadVendors = useCallback(() => {
    fetch('/api/vendors?all=true')
      .then(r => r.json())
      .then(d => { if (d.data) setVendors(d.data) })
      .catch(() => null)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams({ type: tab })
    const res  = await fetch(`/api/erp-aliases?${p}`)
    const json = await res.json()
    if (res.ok) setAliases(json.data ?? [])
    else showMsg(`조회 실패: ${json.error ?? '알 수 없는 오류'}`)
    setSelected(new Set())
    setExpandedId(null)
    setDraft(null)
    setLoading(false)
  }, [tab])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadVendors() }, [loadVendors])

  // 별칭별 추천 매칭 (미연결 건만 계산)
  const suggestions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; score: number }>()
    for (const a of aliases) {
      if (a.vendor_id) continue
      const m = bestNameMatch(a.erp_name, vendors)
      if (m) map.set(a.id, m)
    }
    return map
  }, [aliases, vendors])

  // 같은 거래처를 공유하는 ERP명 수 (하나은행 본점 케이스 안내용)
  const vendorAliasCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of aliases) {
      if (!a.vendor_id) continue
      m.set(a.vendor_id, (m.get(a.vendor_id) ?? 0) + 1)
    }
    return m
  }, [aliases])

  // ERP명과 아직 연결되지 않은 "기타 거래처" (탭 유형에 맞는 거래처 중 미연결)
  const otherVendors = useMemo(() => {
    const connected = new Set(aliases.filter(a => a.vendor_id).map(a => a.vendor_id as string))
    return vendors
      .filter(v => isCustomer ? (v.type === 'customer' || v.type === 'both') : (v.type === 'vendor' || v.type === 'both'))
      .filter(v => !connected.has(v.id))
  }, [vendors, aliases, isCustomer])

  const patchAlias = async (id: string, vendorId: string | null): Promise<string | null> => {
    const res  = await fetch('/api/erp-aliases', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, vendor_id: vendorId }),
    })
    const json = await res.json()
    if (!res.ok) return json.error ?? '알 수 없는 오류'
    setAliases(prev => prev.map(a => a.id === id
      ? { ...a, vendor_id: vendorId, vendors: (json.data as AliasRow).vendors }
      : a))
    return null
  }

  const handleConnect = async (alias: AliasRow, vendorId: string) => {
    setWorking(true)
    const err = await patchAlias(alias.id, vendorId || null)
    setWorking(false)
    if (err) { showMsg(`연결 실패: ${err}`); return }
    showMsg(vendorId ? '연결 완료 (이후 업로드에도 자동 적용)' : '연결 해제')
    loadVendors()
  }

  const handleCreateVendor = async (alias: AliasRow) => {
    if (!window.confirm(`"${alias.erp_name}" 이름으로 새 거래처를 만들고 바로 연결할까요?`)) return
    setWorking(true)
    const res  = await fetch('/api/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: alias.erp_name, type: isCustomer ? 'customer' : 'vendor' }),
    })
    const json = await res.json()
    if (!res.ok) { setWorking(false); showMsg(`거래처 생성 실패: ${json.error ?? '알 수 없는 오류'}`); return }
    const v = json.data as Vendor
    setVendors(prev => [...prev, v].sort((a, b) => a.name.localeCompare(b.name, 'ko')))
    const err = await patchAlias(alias.id, v.id)
    setWorking(false)
    if (err) { showMsg(`연결 실패: ${err}`); return }
    showMsg(`거래처 "${v.name}" 생성 후 연결 완료`)
  }

  const handleBulkConnect = async () => {
    const targets = Array.from(selected)
      .map(id => ({ id, sug: suggestions.get(id) }))
      .filter((t): t is { id: string; sug: { id: string; name: string; score: number } } => !!t.sug)
    if (!targets.length) { showMsg('추천 매칭이 있는 항목을 선택하세요.'); return }
    if (!window.confirm(`선택한 ${targets.length}건을 추천 거래처로 일괄 연결할까요?`)) return
    setWorking(true)
    let ok = 0, fail = 0
    for (const t of targets) {
      const err = await patchAlias(t.id, t.sug.id)
      if (err) fail += 1
      else ok += 1
    }
    setWorking(false)
    setSelected(new Set())
    showMsg(`${ok}건 연결 완료${fail ? ` / ${fail}건 실패` : ''}`)
  }

  const selectHighConfidence = () => {
    const n = new Set<string>()
    for (const a of aliases) {
      if (a.vendor_id) continue
      const s = suggestions.get(a.id)
      if (s && s.score >= 0.9) n.add(a.id)
    }
    setSelected(n)
    if (!n.size) showMsg('유사도 90% 이상 추천이 없습니다.')
  }

  const toggleSelect = (id: string) => setSelected(prev => {
    const n = new Set(prev)
    if (n.has(id)) { n.delete(id) } else { n.add(id) }
    return n
  })

  // ── 매칭 정보 펼침 편집 ────────────────────────────
  const toggleExpand = (a: AliasRow) => {
    if (expandedId === a.id) { setExpandedId(null); setDraft(null); return }
    setExpandedId(a.id)
    setDraft({
      biz:          a.vendors?.biz_number ?? '',
      aliases:      a.vendors?.match_aliases ?? [],
      cards:        a.vendors?.card_numbers ?? [],
      newAlias:     '',
      newCard:      '',
      contactName:  a.vendors?.contact_name ?? '',
      contactPhone: a.vendors?.contact_phone ?? '',
      email:        a.vendors?.email ?? '',
      note:         a.vendors?.note ?? '',
    })
  }

  const handleSaveMatchInfo = async (a: AliasRow) => {
    if (!a.vendor_id || !draft) return
    // 입력 중이던 값도 함께 저장
    const aliasList = draft.newAlias.trim() ? [...draft.aliases, draft.newAlias.trim()] : draft.aliases
    const cardList  = draft.newCard.trim()  ? [...draft.cards, draft.newCard.trim()]   : draft.cards
    setWorking(true)
    const res = await fetch(`/api/vendors/${a.vendor_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        biz_number:    draft.biz.trim() || null,
        match_aliases: aliasList,
        card_numbers:  cardList,
        contact_name:  draft.contactName.trim() || null,
        contact_phone: draft.contactPhone.trim() || null,
        email:         draft.email.trim() || null,
        note:          draft.note.trim() || null,
      }),
    })
    const json = await res.json()
    setWorking(false)
    if (!res.ok) { showMsg(`저장 실패: ${json.error ?? '알 수 없는 오류'}`); return }
    // 같은 거래처를 공유하는 모든 행에 반영
    const v = json.data as VendorInfo
    setAliases(prev => prev.map(r => r.vendor_id === a.vendor_id ? { ...r, vendors: v } : r))
    setVendors(prev => prev.map(x => x.id === v.id ? { ...x, ...v } : x))
    setExpandedId(null)
    setDraft(null)
    showMsg('거래처 정보 저장 완료 — 은행·계산서·카드 자동매칭에 사용됩니다.')
  }

  const handleToggleActive = async (a: AliasRow) => {
    if (!a.vendor_id || !a.vendors) return
    setWorking(true)
    const res = await fetch(`/api/vendors/${a.vendor_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !a.vendors.is_active }),
    })
    const json = await res.json()
    setWorking(false)
    if (!res.ok) { showMsg(`변경 실패: ${json.error ?? '알 수 없는 오류'}`); return }
    const v = json.data as VendorInfo
    setAliases(prev => prev.map(r => r.vendor_id === a.vendor_id ? { ...r, vendors: v } : r))
    setVendors(prev => prev.map(x => x.id === v.id ? { ...x, ...v } : x))
    showMsg(v.is_active ? '활성화됨' : '비활성화됨')
  }

  const handleDeleteVendor = async (a: AliasRow) => {
    if (!a.vendor_id || !a.vendors) return
    if (!window.confirm(`'${a.vendors.name}' 거래처를 삭제하시겠습니까?\n연결된 ERP명·거래내역·세금계산서의 거래처 정보는 해제됩니다.`)) return
    setWorking(true)
    const res = await fetch(`/api/vendors/${a.vendor_id}`, { method: 'DELETE' })
    setWorking(false)
    if (!res.ok) { const json = await res.json(); showMsg(`삭제 실패: ${json.error ?? '알 수 없는 오류'}`); return }
    showMsg('거래처 삭제됨')
    setExpandedId(null)
    setDraft(null)
    load()
    loadVendors()
  }

  const handleExport = () => {
    const a = document.createElement('a')
    a.href = `/api/erp-aliases/export?type=${tab}`
    a.click()
  }

  const handleImportFile = async (file: File) => {
    setImporting(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('type', tab)
    const res  = await fetch('/api/erp-aliases/import', { method: 'POST', body: fd })
    const json = await res.json()
    setImporting(false)
    if (!res.ok) { showMsg(`업로드 실패: ${json.error ?? '알 수 없는 오류'}`); return }
    showMsg(
      `업로드 완료 — 연결 ${json.aliasConnected}건, 연결해제 ${json.aliasDisconnected}건, `
      + `거래처 생성 ${json.vendorsCreated}건, 정보수정 ${json.vendorsUpdated}건`
      + (json.skipped ? `, 건너뜀 ${json.skipped}건` : '')
    )
    load()
    loadVendors()
  }

  const q = search.trim()
  const filtered = aliases
    .filter(a => !onlyUnmatched || !a.vendor_id)
    .filter(a => !q || a.erp_name.includes(q) || (a.vendors?.name ?? '').includes(q))

  const unmatchedCount = aliases.filter(a => !a.vendor_id).length
  const colCount = isCustomer ? 7 : 6

  const chipList = (items: string[] | null | undefined, emptyText: string) => {
    const list = (items ?? []).filter(Boolean)
    if (!list.length) return <span className="text-xs text-gray-300">{emptyText}</span>
    return (
      <div className="flex flex-wrap gap-1 max-w-[200px]">
        {list.slice(0, 3).map(s => (
          <span key={s} className="px-1.5 py-0.5 text-[11px] bg-gray-100 text-gray-600 rounded truncate max-w-[90px]">{s}</span>
        ))}
        {list.length > 3 && <span className="text-[11px] text-gray-400">+{list.length - 3}</span>}
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-1">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">{tabLabel} 관리</h1>
          <a href="/erp-aliases/pending"
            className="px-3 py-1.5 rounded-lg text-sm border border-indigo-300 text-indigo-700 hover:bg-indigo-50">
            거래처 등록 대기
          </a>
        </div>
        <p className="text-sm mt-1 text-gray-500">
          ERP에 입력된 {tabLabel}명 기준으로 거래처 연결과 거래처 정보(사업자번호·{isCustomer ? '입금계좌명·카드번호' : '출금계좌명'}·담당자 등)를 한곳에서 관리합니다.
          여러 ERP명(부서·지점)을 같은 거래처에 연결할 수 있습니다.
        </p>
      </div>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {/* 탭 */}
      <div className="flex items-center gap-1 mb-3 mt-3 border-b border-gray-200">
        {([['customer', '매출처'], ['purchase', '매입처']] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-slate-900 text-slate-900 font-medium' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 필터 + 일괄 작업 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={onlyUnmatched} onChange={e => setOnlyUnmatched(e.target.checked)} />
          미연결만 보기
        </label>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={`ERP ${tabLabel}명/거래처명 검색`}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
        <span className="text-xs text-gray-400">미연결 {unmatchedCount} / 전체 {aliases.length}</span>
        <div className="flex-1" />
        <button
          onClick={handleExport}
          disabled={loading || working || importing}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        >
          ⬇ 엑셀 다운로드
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) handleImportFile(file)
            e.target.value = ''
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={loading || working || importing}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        >
          {importing ? '업로드 중...' : '⬆ 엑셀 업로드'}
        </button>
        <button
          onClick={selectHighConfidence}
          disabled={loading || working}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        >
          유사도 90%↑ 전체선택
        </button>
        <button
          onClick={handleBulkConnect}
          disabled={loading || working || selected.size === 0}
          className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs hover:bg-slate-700 disabled:opacity-40"
        >
          {working ? '처리 중...' : `선택 ${selected.size}건 일괄 연결`}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">
          {onlyUnmatched ? '미연결 항목이 없습니다. 모든 매칭이 완료되었습니다. 🎉' : '표시할 항목이 없습니다. ERP 주문 파일을 먼저 업로드해주세요.'}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 w-8"></th>
                <th className="py-2.5 px-3 font-medium">ERP {tabLabel}명</th>
                <th className="py-2.5 px-3 font-medium">연결 거래처</th>
                <th className="py-2.5 px-3 font-medium">사업자번호</th>
                <th className="py-2.5 px-3 font-medium">{isCustomer ? '입금계좌명' : '출금계좌명'}</th>
                {isCustomer && <th className="py-2.5 px-3 font-medium">카드번호</th>}
                <th className="py-2.5 px-3 font-medium text-right">액션</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => {
                const sug = suggestions.get(a.id)
                const sharedCount = a.vendor_id ? (vendorAliasCount.get(a.vendor_id) ?? 1) : 1
                const expanded = expandedId === a.id
                return (
                  <Fragment key={a.id}>
                    <tr className={`border-b border-gray-100 ${expanded ? 'bg-slate-50' : 'hover:bg-gray-50'} ${a.vendors && !a.vendors.is_active ? 'opacity-50' : ''}`}>
                      <td className="py-2 px-3">
                        {!a.vendor_id && (
                          <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)} disabled={!sug} />
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate max-w-[200px] text-gray-900">{a.erp_name}</p>
                          {sharedCount > 1 && (
                            <span className="px-1.5 py-0.5 text-[10px] bg-indigo-50 text-indigo-600 border border-indigo-200 rounded shrink-0" title="여러 ERP명이 같은 거래처에 연결됨">
                              공유 {sharedCount}
                            </span>
                          )}
                          {a.vendors && !a.vendors.is_active && (
                            <span className="px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-500 rounded shrink-0">비활성</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3">
                        <SearchableSelect
                          value={a.vendor_id ?? ''}
                          onChange={id => handleConnect(a, id)}
                          options={vendors.map(v => ({ id: v.id, label: v.name }))}
                          emptyLabel="미연결"
                          disabled={working}
                          className={`border rounded px-2 py-1 text-xs w-44 ${a.vendor_id ? 'border-green-200 text-green-700 bg-green-50' : 'border-gray-200 text-gray-500'}`}
                        />
                        {!a.vendor_id && sug && (
                          <p className="text-[11px] mt-0.5 text-blue-700 truncate max-w-[180px]">
                            추천: {sug.name}{' '}
                            <span className={sug.score >= 0.9 ? 'text-green-600' : sug.score >= 0.7 ? 'text-amber-600' : 'text-gray-400'}>
                              ({pct(sug.score)})
                            </span>
                          </p>
                        )}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        {a.vendors?.biz_number
                          ? <span className="text-xs text-gray-600">{a.vendors.biz_number}</span>
                          : <span className="text-xs text-gray-300">{a.vendor_id ? '미등록' : '-'}</span>}
                      </td>
                      <td className="py-2 px-3">
                        {a.vendor_id ? chipList(a.vendors?.match_aliases, '미등록') : <span className="text-xs text-gray-300">-</span>}
                      </td>
                      {isCustomer && (
                        <td className="py-2 px-3">
                          {a.vendor_id ? chipList(a.vendors?.card_numbers, '미등록') : <span className="text-xs text-gray-300">-</span>}
                        </td>
                      )}
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {a.vendor_id ? (
                          <button
                            onClick={() => toggleExpand(a)}
                            disabled={working}
                            className={`px-2 py-1 text-xs border rounded disabled:opacity-40 ${
                              expanded ? 'border-slate-400 bg-slate-100 text-slate-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                            }`}
                          >
                            {expanded ? '▲ 닫기' : '✎ 거래처 정보'}
                          </button>
                        ) : (
                          <>
                            {sug && (
                              <button
                                onClick={() => handleConnect(a, sug.id)}
                                disabled={working}
                                className="px-2 py-1 text-xs border border-blue-300 text-blue-700 rounded hover:bg-blue-50 disabled:opacity-40 mr-1"
                              >
                                ✓ 추천 연결
                              </button>
                            )}
                            <button
                              onClick={() => handleCreateVendor(a)}
                              disabled={working}
                              className="px-2 py-1 text-xs border border-gray-300 text-gray-600 rounded hover:bg-gray-50 disabled:opacity-40"
                            >
                              + 신규 생성
                            </button>
                          </>
                        )}
                      </td>
                    </tr>

                    {/* 거래처 정보 편집 패널 */}
                    {expanded && draft && a.vendor_id && (
                      <tr className="border-b border-gray-200 bg-slate-50">
                        <td colSpan={colCount} className="px-5 py-4">
                          <div className="flex flex-wrap gap-6">
                            {/* 사업자번호 */}
                            <div>
                              <p className="text-xs font-medium text-gray-500 mb-1.5">사업자번호 <span className="font-normal text-gray-400">(세금계산서 매칭)</span></p>
                              <input
                                value={draft.biz}
                                onChange={e => setDraft(d => d ? { ...d, biz: e.target.value } : d)}
                                placeholder="123-45-67890"
                                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-44 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
                              />
                            </div>

                            {/* 담당자 / 연락처 */}
                            <div className="flex gap-3">
                              <div>
                                <p className="text-xs font-medium text-gray-500 mb-1.5">담당자</p>
                                <input
                                  value={draft.contactName}
                                  onChange={e => setDraft(d => d ? { ...d, contactName: e.target.value } : d)}
                                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
                                />
                              </div>
                              <div>
                                <p className="text-xs font-medium text-gray-500 mb-1.5">연락처</p>
                                <input
                                  value={draft.contactPhone}
                                  onChange={e => setDraft(d => d ? { ...d, contactPhone: e.target.value } : d)}
                                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
                                />
                              </div>
                            </div>

                            {/* 입금/출금계좌명 별칭 */}
                            <div className="min-w-[260px]">
                              <p className="text-xs font-medium text-gray-500 mb-1.5">
                                {isCustomer ? '입금계좌명' : '출금계좌명'} <span className="font-normal text-gray-400">(은행 거래내역 매칭 — 입금자명·적요 표기)</span>
                              </p>
                              <div className="flex flex-wrap gap-1.5 mb-1.5">
                                {draft.aliases.map(s => (
                                  <span key={s} className="flex items-center gap-1 px-2 py-0.5 text-xs bg-white border border-gray-300 rounded-full text-gray-700">
                                    {s}
                                    <button
                                      onClick={() => setDraft(d => d ? { ...d, aliases: d.aliases.filter(x => x !== s) } : d)}
                                      className="text-gray-400 hover:text-red-500"
                                    >✕</button>
                                  </span>
                                ))}
                                {!draft.aliases.length && <span className="text-xs text-gray-400">등록된 계좌명 없음</span>}
                              </div>
                              <div className="flex gap-1.5">
                                <input
                                  value={draft.newAlias}
                                  onChange={e => setDraft(d => d ? { ...d, newAlias: e.target.value } : d)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && draft.newAlias.trim()) {
                                      setDraft(d => d ? { ...d, aliases: [...d.aliases, d.newAlias.trim()], newAlias: '' } : d)
                                    }
                                  }}
                                  placeholder="예: 하나은행본점, (주)다올"
                                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
                                />
                                <button
                                  onClick={() => draft.newAlias.trim() && setDraft(d => d ? { ...d, aliases: [...d.aliases, d.newAlias.trim()], newAlias: '' } : d)}
                                  className="px-2.5 py-1 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-100"
                                >추가</button>
                              </div>
                            </div>

                            {/* 카드번호 (매출처만) */}
                            {isCustomer && (
                              <div className="min-w-[260px]">
                                <p className="text-xs font-medium text-gray-500 mb-1.5">카드번호 <span className="font-normal text-gray-400">(카드매출 매칭)</span></p>
                                <div className="flex flex-wrap gap-1.5 mb-1.5">
                                  {draft.cards.map(s => (
                                    <span key={s} className="flex items-center gap-1 px-2 py-0.5 text-xs bg-white border border-gray-300 rounded-full text-gray-700">
                                      {s}
                                      <button
                                        onClick={() => setDraft(d => d ? { ...d, cards: d.cards.filter(x => x !== s) } : d)}
                                        className="text-gray-400 hover:text-red-500"
                                      >✕</button>
                                    </span>
                                  ))}
                                  {!draft.cards.length && <span className="text-xs text-gray-400">등록된 카드번호 없음</span>}
                                </div>
                                <div className="flex gap-1.5">
                                  <input
                                    value={draft.newCard}
                                    onChange={e => setDraft(d => d ? { ...d, newCard: e.target.value } : d)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter' && draft.newCard.trim()) {
                                        setDraft(d => d ? { ...d, cards: [...d.cards, d.newCard.trim()], newCard: '' } : d)
                                      }
                                    }}
                                    placeholder="1234-56**-****-7890"
                                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
                                  />
                                  <button
                                    onClick={() => draft.newCard.trim() && setDraft(d => d ? { ...d, cards: [...d.cards, d.newCard.trim()], newCard: '' } : d)}
                                    className="px-2.5 py-1 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-100"
                                  >추가</button>
                                </div>
                              </div>
                            )}

                            {/* 메모 */}
                            <div className="min-w-[200px] flex-1">
                              <p className="text-xs font-medium text-gray-500 mb-1.5">메모</p>
                              <textarea
                                value={draft.note}
                                onChange={e => setDraft(d => d ? { ...d, note: e.target.value } : d)}
                                rows={2}
                                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
                              />
                            </div>
                          </div>

                          <div className="flex items-center gap-2 mt-4 flex-wrap">
                            <button
                              onClick={() => handleSaveMatchInfo(a)}
                              disabled={working}
                              className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-xs hover:bg-slate-700 disabled:opacity-40"
                            >
                              {working ? '저장 중...' : '저장'}
                            </button>
                            <button
                              onClick={() => { setExpandedId(null); setDraft(null) }}
                              disabled={working}
                              className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                            >취소</button>
                            <Link
                              href={`/vendors/${a.vendor_id}`}
                              className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-100"
                            >거래처 상세 →</Link>
                            <button
                              onClick={() => handleToggleActive(a)}
                              disabled={working}
                              className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                            >{a.vendors?.is_active ? '비활성화' : '활성화'}</button>
                            <button
                              onClick={() => handleDeleteVendor(a)}
                              disabled={working}
                              className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-xs hover:bg-red-50 disabled:opacity-40"
                            >거래처 삭제</button>
                            {sharedCount > 1 && (
                              <span className="text-xs text-amber-600">
                                ⚠ 이 거래처는 ERP명 {sharedCount}개가 공유 중 — 저장/변경 시 모든 공유 항목에 함께 적용됩니다.
                              </span>
                            )}
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
      )}

      {/* ── 기타 거래처 (ERP명 미연동) ── */}
      <div className="mt-8 mb-2 flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-gray-900">기타 {tabLabel} ({otherVendors.length})</h2>
          <p className="text-xs text-gray-400 mt-0.5">ERP 주문에 아직 등장하지 않았지만 미리 등록해둔 거래처입니다.</p>
        </div>
        <button
          onClick={() => setShowAddVendor(true)}
          className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs hover:bg-slate-700"
        >
          + 기타 거래처 추가
        </button>
      </div>

      {otherVendors.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm border border-gray-200 rounded-xl">등록된 기타 거래처가 없습니다.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {otherVendors.map(v => {
            const tmeta = TYPE_META[v.type] ?? { label: v.type, cls: 'bg-gray-100 text-gray-600' }
            return (
              <div key={v.id} className={`flex items-center gap-3 px-4 py-3 border-b border-gray-100 last:border-b-0 ${!v.is_active ? 'opacity-50' : ''}`}>
                <span className={`px-2 py-0.5 rounded text-xs font-semibold shrink-0 ${tmeta.cls}`}>{tmeta.label}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{v.name}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {v.biz_number ?? '사업자번호 미등록'}
                    {v.contact_name && ` · ${v.contact_name}`}
                    {v.contact_phone && ` · ${v.contact_phone}`}
                  </p>
                </div>
                <Link href={`/vendors/${v.id}`} className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded">상세</Link>
                <button
                  onClick={async () => {
                    setWorking(true)
                    const res = await fetch(`/api/vendors/${v.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ is_active: !v.is_active }),
                    })
                    const json = await res.json()
                    setWorking(false)
                    if (res.ok) { setVendors(prev => prev.map(x => x.id === v.id ? json.data : x)); showMsg(v.is_active ? '비활성화됨' : '활성화됨') }
                  }}
                  disabled={working}
                  className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded disabled:opacity-40"
                >
                  {v.is_active ? '활성' : '비활성'}
                </button>
                <button
                  onClick={() => setEditingVendor(v)}
                  className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                >수정</button>
                <button
                  onClick={async () => {
                    if (!window.confirm(`'${v.name}' 거래처를 삭제하시겠습니까?`)) return
                    setWorking(true)
                    const res = await fetch(`/api/vendors/${v.id}`, { method: 'DELETE' })
                    setWorking(false)
                    if (res.ok) { setVendors(prev => prev.filter(x => x.id !== v.id)); showMsg(`'${v.name}' 삭제됨`) }
                  }}
                  disabled={working}
                  className="px-2 py-1 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-40"
                >삭제</button>
              </div>
            )
          })}
        </div>
      )}

      {showAddVendor && (
        <VendorModal
          vendor={null}
          defaultType={isCustomer ? 'customer' : 'vendor'}
          onClose={() => setShowAddVendor(false)}
          onSaved={v => { setVendors(prev => [...prev, v].sort((a, b) => a.name.localeCompare(b.name, 'ko'))); showMsg(`'${v.name}' 등록됨`) }}
        />
      )}
      {editingVendor && (
        <VendorModal
          vendor={editingVendor}
          defaultType={isCustomer ? 'customer' : 'vendor'}
          onClose={() => setEditingVendor(null)}
          onSaved={v => { setVendors(prev => prev.map(x => x.id === v.id ? v : x)); showMsg(`'${v.name}' 수정됨`) }}
        />
      )}
    </div>
  )
}

export default function ErpAliasesPage() {
  return (
    <Suspense fallback={<div className="text-center py-20 text-gray-400">로딩 중...</div>}>
      <ErpAliasesContent />
    </Suspense>
  )
}
