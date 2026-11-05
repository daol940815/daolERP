import { redirect } from 'next/navigation'

// 휴가 승인은 휴가 목록으로 통합 (2026-11-04 — 승인 대기 · 처리 내역을 한 목록으로, 3단계 결재)
// 옛 주소는 쿼리를 보존해 새 화면으로 보낸다
export default function LegacyLeaveApprovalsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === 'string') p.set(k, v)
    else if (Array.isArray(v)) v.forEach(x => p.append(k, x))
  }
  const qs = p.toString()
  redirect(`/hr/leaves${qs ? `?${qs}` : ''}`)
}
