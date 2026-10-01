'use client'

import { useState } from 'react'

// 계좌 직접 등록 모달 — 사이드바 통장 내역의 계좌 목록에서 사용 (구 Sidebar.tsx에서 분리)

// ── 계좌 직접 등록 모달 ─────────────────────────────────────────
export default function AddBankModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm]     = useState({ bank_name: '', account_number: '', alias: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [linked, setLinked] = useState<number | null>(null)

  const handleSave = async () => {
    if (!form.bank_name.trim()) { setError('은행명을 입력하세요.'); return }
    setSaving(true)
    const res = await fetch('/api/bank-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bank_name:      form.bank_name.trim(),
        account_number: form.account_number.trim() || undefined,
        alias:          form.alias.trim()          || undefined,
      }),
    })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) { setError(json.error ?? '저장 실패'); return }
    // 자동 연결된 거래 건수 표시 후 닫기
    setLinked(json.linkedTransactions ?? 0)
    onSaved()
    setTimeout(() => onClose(), 1200)
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl p-6 w-80 mx-4"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-gray-900 mb-1">계좌 직접 등록</h3>
        <p className="text-xs text-gray-400 mb-4">파일 업로드 없이 계좌를 먼저 등록합니다.</p>
        {error && <p className="text-red-500 text-xs mb-3">{error}</p>}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              은행명 <span className="text-red-500">*</span>
            </label>
            <input
              autoFocus
              value={form.bank_name}
              onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
              placeholder="예: 우리은행"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              계좌번호 <span className="text-gray-400">(선택)</span>
            </label>
            <input
              value={form.account_number}
              onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))}
              placeholder="예: 1005-804-575410"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              별칭 <span className="text-gray-400">(선택)</span>
            </label>
            <input
              value={form.alias}
              onChange={e => setForm(f => ({ ...f, alias: e.target.value }))}
              placeholder="예: 법인 운영계좌"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
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
            disabled={saving || linked !== null}
            className="flex-1 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? '저장 중...' : linked !== null ? '✓ 등록 완료' : '등록'}
          </button>
        </div>
        {linked !== null && linked > 0 && (
          <p className="text-xs text-green-600 text-center mt-2">
            기존 거래 {linked.toLocaleString()}건이 자동 연결되었습니다.
          </p>
        )}
      </div>
    </div>
  )
}

