import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'

// 품목 관리 목록의 매입처 연락처 (2026-11-10 사용자 확정, docs/product-master-track.md)
// GET → { phones: { 매입처명: 연락처 } }
// 규칙은 품목 수정 화면(vendor-info)과 같다: 매입 별칭(병합 대표 추적) → vendors.contact_phone,
// 비어 있으면 거래처 담당자 대표(contact_assignments.is_representative, 종료 안 된 배정)의 휴대폰 → 유선.
// 미연결 · 연락처 없음은 응답에서 빠짐(화면은 이름만).
// 품목 목록 API(주문 입력 · 상담일지 공용)에 붙이지 않고 이 화면 전용으로 따로 둔다 — 그 화면들 속도 영향 없음.

type Alias = { id: string; erp_name: string; vendor_id: string | null; merged_into_alias_id: string | null }

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()

  const aliasRes = await fetchAllRows<Alias>((from, to) =>
    admin.from('erp_vendor_aliases')
      .select('id, erp_name, vendor_id, merged_into_alias_id')
      .eq('alias_type', 'purchase').order('id').range(from, to) as unknown as PromiseLike<{ data: Alias[] | null; error: { message: string } | null }>,
  )
  if ('error' in aliasRes) return NextResponse.json({ error: aliasRes.error }, { status: 500 })

  const byId = new Map(aliasRes.data.map(a => [a.id, a]))
  const vendorOfName = new Map<string, string>()
  for (const a of aliasRes.data) {
    let cur: Alias | undefined = a
    for (let i = 0; i < 5 && cur?.merged_into_alias_id; i++) cur = byId.get(cur.merged_into_alias_id)
    if (cur?.vendor_id) vendorOfName.set(a.erp_name, cur.vendor_id)
  }

  const vendorIds = Array.from(new Set(vendorOfName.values()))
  const own = new Map<string, string>()      // (가) vendors.contact_phone
  const rep = new Map<string, string>()      // (나) 대표 담당자 연락처
  const chunks: string[][] = []
  for (let i = 0; i < vendorIds.length; i += 150) chunks.push(vendorIds.slice(i, i + 150))
  await Promise.all(chunks.flatMap(ids => [
    admin.from('vendors').select('id, contact_phone').in('id', ids).then(({ data }) => {
      for (const v of data ?? []) {
        const ph = ((v.contact_phone as string | null) ?? '').trim()
        if (ph) own.set(v.id as string, ph)
      }
    }),
    admin.from('contact_assignments').select('vendor_id, contacts(phone, tel)')
      .in('vendor_id', ids).eq('is_representative', true).is('ended_at', null)
      .then(({ data }) => {
        for (const r of data ?? []) {
          const c = r.contacts as unknown as { phone: string | null; tel: string | null } | null
          const ph = ((c?.phone || c?.tel) ?? '').trim()
          if (ph && !rep.has(r.vendor_id as string)) rep.set(r.vendor_id as string, ph)
        }
      }),
  ]))

  const phones: Record<string, string> = {}
  vendorOfName.forEach((vid, name) => {
    const ph = own.get(vid) ?? rep.get(vid)
    if (ph) phones[name] = ph
  })
  return NextResponse.json({ phones })
}
