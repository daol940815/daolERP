import { redirect } from 'next/navigation'

// 입금 매칭은 결제 확인 화면의 '기록 없는 입금' 탭으로 통합 (2026-11-16) — 옛 주소는 탭으로 보낸다(쿼리 보존: ?depositId= 등)
export default function LegacyErpMatchingPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const p = new URLSearchParams({ tab: 'deposits' })
  for (const [k, v] of Object.entries(searchParams)) if (typeof v === 'string' && k !== 'tab') p.set(k, v)
  redirect(`/payments?${p}`)
}
