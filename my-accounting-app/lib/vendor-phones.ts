// 매입처명 → 연락처 (품목 관리 목록 · 원가표 다운로드의 매입처 연락처 필터 공용, 2026-11-19 route에서 분리)
// 규칙: 매입 별칭(병합 대표 추적) → vendors.contact_phone, 비면 거래처 담당자 대표의 휴대폰 → 유선. 미연결 · 없음은 빠짐.
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/fetch-all-rows'

type Alias = { id: string; erp_name: string; vendor_id: string | null; merged_into_alias_id: string | null }

export async function loadVendorPhones(admin: SupabaseClient): Promise<{ phones: Record<string, string> } | { error: string }> {

  const aliasRes = await fetchAllRows<Alias>((from, to) =>
    admin.from('erp_vendor_aliases')
      .select('id, erp_name, vendor_id, merged_into_alias_id')
      .eq('alias_type', 'purchase').order('id').range(from, to) as unknown as PromiseLike<{ data: Alias[] | null; error: { message: string } | null }>,
  )
  if ('error' in aliasRes) return { error: aliasRes.error }

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
  return { phones }
}
