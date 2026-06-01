'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'

interface Account {
  id: string
  code: string
  name: string
  type: 'income' | 'expense' | 'asset' | 'liability' | 'equity'
  keywords: string[]
  is_active: boolean
}

const TYPE_META: Record<string, { label: string; cls: string }> = {
  income:    { label: '수익', cls: 'bg-green-100 text-green-700' },
  expense:   { label: '비용', cls: 'bg-red-100 text-red-700' },
  asset:     { label: '자산', cls: 'bg-blue-100 text-blue-700' },
  liability: { label: '부채', cls: 'bg-orange-100 text-orange-700' },
  equity:    { label: '자본', cls: 'bg-purple-100 text-purple-700' },
}

const TYPE_ORDER = ['income', 'expense', 'asset', 'liability', 'equity']

// 엑셀 유형 한글 → 영문 매핑
const TYPE_LABEL_TO_KEY: Record<string, string> = {
  '수익': 'income', '비용': 'expense', '자산': 'asset', '부채': 'liability', '자본': 'equity',
  income: 'income', expense: 'expense', asset: 'asset', liability: 'liability', equity: 'equity',
}

// ── 키워드 칩 컴포넌트 ─────────────────────────────────────────────
function KeywordChips({
  keywords,
  onRemove,
  onAdd,
}: {
  keywords: string[]
  onRemove: (kw: string) => void
  onAdd: (kw: string) => void
}) {
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleAdd = () => {
    const kw = input.trim()
    if (!kw || keywords.includes(kw)) { setInput(''); return }
    onAdd(kw)
    setInput('')
  }

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {keywords.map(kw => (
        <span
          key={kw}
          className="group inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-700 hover:bg-gray-200"
        >
          {kw}
          <button
            onClick={() => onRemove(kw)}
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 leading-none transition-opacity"
          >
            ✕
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd() } }}
        onBlur={handleAdd}
        placeholder="+ 키워드"
        className="text-xs px-2 py-0.5 border border-dashed border-gray-300 rounded w-20 focus:outline-none focus:border-slate-500 text-gray-500 placeholder-gray-400"
      />
    </div>
  )
}

// ── 계정 추가 모달 ─────────────────────────────────────────────────
function AddAccountModal({ onClose, onSave }: { onClose: () => void; onSave: (a: Account) => void }) {
  const [form, setForm] = useState({ code: '', name: '', type: 'expense' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      setError('코드와 이름은 필수입니다.')
      return
    }
    setSaving(true)
    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, keywords: [] }),
    })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) { setError(json.error ?? '저장 실패'); return }
    onSave(json.data)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
        <h2 className="text-lg font-bold text-gray-900 mb-4">계정과목 추가</h2>
        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">코드</label>
            <input
              value={form.code}
              onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
              placeholder="예: 5114"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">이름</label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="예: 도서인쇄비"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">유형</label>
            <select
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              {TYPE_ORDER.map(t => (
                <option key={t} value={t}>{TYPE_META[t]?.label ?? t}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? '저장 중...' : '추가'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 메인 페이지 ────────────────────────────────────────────────────
export default function AccountsPage() {
  const [accounts, setAccounts]   = useState<Account[]>([])
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState<string>('all')
  const [showAdd, setShowAdd]     = useState(false)
  const [toast, setToast]         = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const showMsg = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/accounts?all=true')
    const json = await res.json()
    if (json.data) setAccounts(json.data)
    setLoading(false)
  }, [])

  useEffect(() => { loadAccounts() }, [loadAccounts])

  // 계정 PATCH 공통 함수
  const patch = async (id: string, updates: object) => {
    const res = await fetch(`/api/accounts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    const json = await res.json()
    if (res.ok && json.data) {
      setAccounts(prev => prev.map(a => a.id === id ? json.data : a))
    }
    return res.ok
  }

  const handleRemoveKeyword = async (account: Account, kw: string) => {
    const newKws = account.keywords.filter(k => k !== kw)
    const ok = await patch(account.id, { keywords: newKws })
    if (ok) showMsg(`"${kw}" 키워드 삭제됨`)
  }

  const handleAddKeyword = async (account: Account, kw: string) => {
    const newKws = [...account.keywords, kw]
    const ok = await patch(account.id, { keywords: newKws })
    if (ok) showMsg(`"${kw}" 키워드 추가됨`)
  }

  const handleToggleActive = async (account: Account) => {
    const ok = await patch(account.id, { is_active: !account.is_active })
    if (ok) showMsg(account.is_active ? '비활성화됨' : '활성화됨')
  }

  const handleDelete = async (account: Account) => {
    if (!window.confirm(`'${account.name}' 계정을 삭제하시겠습니까?`)) return
    const res = await fetch(`/api/accounts/${account.id}`, { method: 'DELETE' })
    if (res.ok) {
      setAccounts(prev => prev.filter(a => a.id !== account.id))
      showMsg(`'${account.name}' 삭제됨`)
    }
  }

  // ── 엑셀 다운로드 ────────────────────────────────────────────────
  const handleDownload = () => {
    const rows = accounts.map(a => ({
      '코드':     a.code,
      '계정명':   a.name,
      '유형':     TYPE_META[a.type]?.label ?? a.type,
      '키워드':   (a.keywords ?? []).join(','),
      '활성':     a.is_active ? 'Y' : 'N',
    }))

    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [{ wch: 10 }, { wch: 22 }, { wch: 8 }, { wch: 50 }, { wch: 6 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '계정과목')

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([wbout], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '계정과목.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── 엑셀 업로드 ──────────────────────────────────────────────────
  const handleUpload = async (file: File) => {
    setUploading(true)
    try {
      const ab = await file.arrayBuffer()
      const wb = XLSX.read(ab)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws)

      const existingCodes = new Set(accounts.map(a => a.code))

      const parsed = rows
        .map(row => ({
          code:       String(row['코드']   ?? '').trim(),
          name:       String(row['계정명'] ?? '').trim(),
          type:       TYPE_LABEL_TO_KEY[String(row['유형'] ?? '').trim()] ?? '',
          keywords:   String(row['키워드'] ?? '')
                        .split(',')
                        .map(k => k.trim())
                        .filter(Boolean),
          is_active:  String(row['활성']   ?? 'Y').trim().toUpperCase() !== 'N',
        }))
        .filter(a => a.code && a.name && a.type)

      if (parsed.length === 0) {
        showMsg('유효한 데이터가 없습니다. 형식(코드/계정명/유형/키워드/활성)을 확인해 주세요.')
        return
      }

      const addedCount   = parsed.filter(a => !existingCodes.has(a.code)).length
      const updatedCount = parsed.filter(a =>  existingCodes.has(a.code)).length

      const res = await fetch('/api/accounts/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accounts: parsed }),
      })
      const json = await res.json()

      if (!res.ok) {
        showMsg(json.error ?? '업로드 실패')
      } else {
        const parts: string[] = []
        if (addedCount)   parts.push(`${addedCount}개 추가`)
        if (updatedCount) parts.push(`${updatedCount}개 수정`)
        showMsg(parts.join(', ') + '됨')
        loadAccounts()
      }
    } catch {
      showMsg('파일 파싱 중 오류가 발생했습니다.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // 필터 적용
  const filtered = accounts.filter(a => filter === 'all' || a.type === filter)

  // 유형별 그룹핑
  const grouped = TYPE_ORDER.reduce<Record<string, Account[]>>((acc, type) => {
    const items = filtered.filter(a => a.type === type)
    if (items.length) acc[type] = items
    return acc
  }, {})

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">계정과목 관리</h1>
          <p className="text-gray-500 text-sm mt-1">
            키워드를 기반으로 거래가 자동 분류됩니다.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            onClick={handleDownload}
            disabled={accounts.length === 0}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 flex items-center gap-1.5"
          >
            <span className="text-base leading-none">↓</span>
            엑셀 다운로드
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 flex items-center gap-1.5"
          >
            <span className="text-base leading-none">↑</span>
            {uploading ? '업로드 중...' : '엑셀 업로드'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) handleUpload(file)
            }}
          />
          <button
            onClick={() => setShowAdd(true)}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700"
          >
            + 계정 추가
          </button>
        </div>
      </div>

      {/* 엑셀 형식 안내 */}
      <div className="mt-3 mb-5 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-500">
        엑셀 형식: <span className="font-mono text-gray-700">코드 | 계정명 | 유형(수익/비용/자산/부채/자본) | 키워드(쉼표 구분) | 활성(Y/N)</span>
        &nbsp;— 코드 기준으로 기존 항목은 수정, 없으면 신규 추가됩니다.
      </div>

      {/* 유형 필터 탭 */}
      <div className="flex gap-1 mb-5 flex-wrap">
        {[{ key: 'all', label: '전체' }, ...TYPE_ORDER.map(t => ({ key: t, label: TYPE_META[t]?.label ?? t }))].map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === tab.key
                ? 'bg-slate-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {tab.label}
            {tab.key !== 'all' && (
              <span className="ml-1 text-xs opacity-70">
                {accounts.filter(a => a.type === tab.key).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([type, items]) => {
            const meta = TYPE_META[type] ?? { label: type, cls: 'bg-gray-100 text-gray-600' }
            return (
              <div key={type}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${meta.cls}`}>
                    {meta.label}
                  </span>
                  <div className="flex-1 border-t border-gray-200" />
                </div>

                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 w-20">코드</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 w-36">계정명</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">자동 분류 키워드</th>
                        <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500 w-20">활성</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {items.map(account => (
                        <tr
                          key={account.id}
                          className={`transition-colors ${account.is_active ? '' : 'bg-gray-50 opacity-60'}`}
                        >
                          <td className="px-4 py-3 font-mono text-gray-500 text-xs">{account.code}</td>
                          <td className="px-4 py-3 font-medium text-gray-800">{account.name}</td>
                          <td className="px-4 py-3">
                            <KeywordChips
                              keywords={account.keywords ?? []}
                              onRemove={kw => handleRemoveKeyword(account, kw)}
                              onAdd={kw => handleAddKeyword(account, kw)}
                            />
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => handleToggleActive(account)}
                              className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${
                                account.is_active ? 'bg-green-500' : 'bg-gray-300'
                              }`}
                            >
                              <span
                                className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                                  account.is_active ? 'translate-x-4' : 'translate-x-0'
                                }`}
                              />
                            </button>
                          </td>
                          <td className="px-2 py-3">
                            <button
                              onClick={() => handleDelete(account)}
                              className="text-gray-300 hover:text-red-400 transition-colors text-sm"
                              title="삭제"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}

          {Object.keys(grouped).length === 0 && (
            <div className="text-center py-16 text-gray-400">
              해당 유형의 계정과목이 없습니다.
            </div>
          )}
        </div>
      )}

      {/* 계정 추가 모달 */}
      {showAdd && (
        <AddAccountModal
          onClose={() => setShowAdd(false)}
          onSave={newAccount => {
            setAccounts(prev => [...prev, newAccount])
            showMsg(`'${newAccount.name}' 추가됨`)
          }}
        />
      )}

      {/* 토스트 */}
      {toast && (
        <div className="fixed bottom-6 right-6 px-4 py-3 bg-slate-900 text-white rounded-lg shadow-lg text-sm">
          {toast}
        </div>
      )}
    </div>
  )
}
