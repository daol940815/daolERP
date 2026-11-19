import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { loadVendorPhones } from '@/lib/vendor-phones'

export const dynamic = 'force-dynamic'

// 품목 관리 목록의 매입처 연락처 (2026-11-10 사용자 확정, docs/product-master-track.md)
// GET → { phones: { 매입처명: 연락처 } }
// 규칙은 품목 수정 화면(vendor-info)과 같다: 매입 별칭(병합 대표 추적) → vendors.contact_phone,
// 비어 있으면 거래처 담당자 대표(contact_assignments.is_representative, 종료 안 된 배정)의 휴대폰 → 유선.
// 미연결 · 연락처 없음은 응답에서 빠짐(화면은 이름만).
// 품목 목록 API(주문 입력 · 상담일지 공용)에 붙이지 않고 이 화면 전용으로 따로 둔다 — 그 화면들 속도 영향 없음.

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const res = await loadVendorPhones(createAdminClient())
  if ('error' in res) return NextResponse.json({ error: res.error }, { status: 500 })
  return NextResponse.json({ phones: res.phones })
}
