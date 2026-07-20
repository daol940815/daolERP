'use client'

// 거래처 중복 정리 — 정책: docs/vendor-master-policy.md
// 시스템은 중복 "후보"만 제시한다. 병합은 그룹마다 사용자가 대표를 고르고 버튼을 눌러야 실행된다(자동 병합 없음).
// 병합된 이름은 대표의 별칭으로 학습되어, 이후 ERP 업로드에서 자동으로 대표에 연결된다.

import { useCallback, useEffect, useState } from 'react'

interface Member { id: string; name: string; count?: number; amount?: number; type?: string; biz_number?: string | null }
interface Group { members: Member[] }
interface Dups { alias_customer: Group[]; alias_purchase: Group[]; vendors: Group[] }

const SECTIONS: { key: keyof Dups; kind: 'erp_alias' | 'vendor'; label: string; statLabel: string }[] = [
  { key: 'alias_customer', kind: 'erp_alias', label: 'ERP 매출처 이름 변형', statLabel: '주문' },
  { key: 'alias_purchase', kind: 'erp_alias', label: 'ERP 매입처 이름 변형', statLabel: '품목' },
  { key: 'vendors',        kind: 'vendor',    label: '거래처(마스터) 중복', statLabel: '' },
]

export default function VendorDedupPage() {
  const [dups, setDups] = useState<Dups | null>(null)
  const [loading, setLoading] = useState(true)
  const [primary, setPrimary] = useState<Record<string, string>>({})   // groupKey → 대표 id
  const [busy, setBusy] = useState<string | null>(null)                // 병합 중 groupKey
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/vendor-master/duplicates')
      const data = await res.json()
      if (res.ok) setDups(data)
      else setMsg(data.error ?? '조회 오류')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const groupKey = (sec: string, g: Group) => `${sec}:${g.members.map(m => m.id).join(',')}`

  const merge = async (sec: typeof SECTIONS[number], g: Group) => {
    const key = groupKey(sec.key, g)
    const into = primary[key] ?? g.members[0].id
    const others = g.members.filter(m => m.id !== into)
    const intoName = g.members.find(m => m.id === into)?.name
    if (!confirm(`'${intoName}'을(를) 대표로 하여 ${others.length}건을 병합합니다.\n병합된 이름은 별칭으로 저장되어 이후 자동 인식됩니다.\n진행할까요?`)) return
    setBusy(key); setMsg(null)
    try {
      for (const m of others) {
        const res = await fetch('/api/vendor-master/merge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: sec.kind, from_id: m.id, into_id: into }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(`'${m.name}' 병합 실패: ${data.error}`)
      }
      setMsg(`✅ '${intoName}' 그룹 병합 완료 (${others.length}건 흡수)`)
      await load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '병합 오류')
    } finally { setBusy(null) }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">거래처 중복 정리</h1>
      <p className="text-gray-500 text-sm mb-1">
        이름이 미세하게 다른 같은 거래처 후보를 제시합니다. 대표를 선택하고 병합하면, 흡수된 이름은 별칭으로 저장되어 이후 자동 인식됩니다.
      </p>
      <p className="text-xs text-gray-400 mb-5">자동 병합은 없습니다 — 모든 병합은 여기서 직접 승인한 것만 실행되고, 이력이 기록됩니다.</p>

      {msg && <div className="mb-4 px-4 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-700">{msg}</div>}
      {loading && <p className="text-sm text-gray-400">불러오는 중…</p>}

      {dups && SECTIONS.map(sec => {
        const groups = dups[sec.key] ?? []
        return (
          <section key={sec.key} className="mb-8">
            <h2 className="text-base font-semibold text-slate-800 mb-2">
              {sec.label} <span className="text-slate-400 font-normal">— {groups.length}그룹</span>
            </h2>
            {groups.length === 0 && <p className="text-sm text-gray-400">중복 후보가 없습니다. </p>}
            <div className="space-y-3">
              {groups.map((g, gi) => {
                const key = groupKey(sec.key, g)
                const sel = primary[key] ?? g.members[0].id
                return (
                  <div key={gi} className="border border-gray-200 rounded-xl p-3">
                    <div className="flex flex-col gap-1.5">
                      {g.members.map(m => (
                        <label key={m.id} className="flex items-center gap-2.5 cursor-pointer text-sm">
                          <input type="radio" name={key} checked={sel === m.id}
                            onChange={() => setPrimary(p => ({ ...p, [key]: m.id }))}
                            className="accent-slate-700" />
                          <span className={sel === m.id ? 'font-semibold text-slate-900' : 'text-gray-700'}>
                            {m.name}
                          </span>
                          {sel === m.id && <span className="px-1.5 py-0.5 text-[10px] bg-slate-900 text-white rounded">대표</span>}
                          <span className="text-xs text-gray-400 ml-auto">
                            {m.count !== undefined && `${sec.statLabel} ${m.count}건`}
                            {m.amount !== undefined && m.amount > 0 && ` · ${m.amount.toLocaleString()}원`}
                            {m.biz_number && ` · ${m.biz_number}`}
                          </span>
                        </label>
                      ))}
                    </div>
                    <div className="mt-2.5 flex justify-end">
                      <button onClick={() => merge(sec, g)} disabled={busy !== null}
                        className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-700 disabled:opacity-40">
                        {busy === key ? '병합 중…' : `대표로 병합 (${g.members.length - 1}건 흡수)`}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
