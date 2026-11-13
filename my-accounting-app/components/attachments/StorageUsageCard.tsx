'use client'

// 파일 저장 공간 사용량 (1200, 2026-11-11) — 마스터 계정 화면용. Supabase 무료 플랜 1GB 대비 얼마나 찼는지.
//  버킷별(공통 첨부 · 발주서 첨부 · 배송 명단 …) + 공통 첨부의 화면별. 80% 를 넘으면 경고색.

import { useEffect, useState } from 'react'
import { ATTACH_OWNER_LABEL, fmtBytes } from '@/lib/attachments'

interface Usage { buckets: { bucket_id: string; files: number; bytes: number }[]; total_bytes: number; limit_bytes: number; by_owner: { owner_type: string; files: number; bytes: number }[]; hint?: string }
const BUCKET_LABEL: Record<string, string> = { attachments: '공통 첨부', 'po-attachments': '발주서 첨부', 'delivery-rosters': '배송 명단', 'po-forms': '매입처 발주서 양식' }

export default function StorageUsageCard() {
  const [u, setU] = useState<Usage | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/attachments/usage', { cache: 'no-store' }).then(async r => {
      const j = await r.json().catch(() => ({}))
      if (!r.ok) setErr(j.error ?? '사용량 조회 실패'); else setU(j)
    }).catch(() => setErr('사용량 조회 실패'))
  }, [])
  if (err) return <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 mt-4 text-sm text-red-600">파일 저장 공간: {err}</div>
  if (!u) return null
  const pct = u.limit_bytes ? Math.min(100, (u.total_bytes / u.limit_bytes) * 100) : 0
  const warn = pct >= 80
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 mt-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-sm font-bold text-gray-900">파일 저장 공간</h2>
        <span className={`text-sm tabular-nums ${warn ? 'text-amber-700 font-semibold' : 'text-gray-700'}`}>{fmtBytes(u.total_bytes)} / {fmtBytes(u.limit_bytes)} ({pct.toFixed(1)}%)</span>
        <span className="text-[0.6875rem] text-gray-400">Supabase 무료 플랜 기준 · 마스터 계정만 보입니다</span>
      </div>
      {u.hint && <p className="text-xs text-amber-700 mt-1">{u.hint}</p>}
      <div className="h-2 bg-slate-100 rounded-full mt-2 overflow-hidden">
        <div className={`h-full ${warn ? 'bg-amber-500' : 'bg-slate-700'}`} style={{ width: `${Math.max(pct, 0.5)}%` }} />
      </div>
      <div className="flex gap-x-5 gap-y-1 flex-wrap mt-2 text-xs text-gray-600">
        {u.buckets.map(b => <span key={b.bucket_id}>{BUCKET_LABEL[b.bucket_id] ?? b.bucket_id} <span className="tabular-nums text-gray-900">{fmtBytes(b.bytes)}</span> · {b.files}개</span>)}
        {u.by_owner.length > 0 && <span className="text-gray-400">|</span>}
        {u.by_owner.map(o => <span key={o.owner_type}>{ATTACH_OWNER_LABEL[o.owner_type] ?? o.owner_type} 첨부 <span className="tabular-nums text-gray-900">{fmtBytes(o.bytes)}</span> · {o.files}개</span>)}
      </div>
      {warn && <p className="text-xs text-amber-700 mt-2">80%를 넘었습니다. 오래된 첨부를 회사 서버로 옮겨 정리하거나 요금제 변경을 검토하세요.</p>}
    </div>
  )
}
