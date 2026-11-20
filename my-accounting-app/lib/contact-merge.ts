import type { SupabaseClient } from '@supabase/supabase-js'
import { followContactMerge } from '@/lib/individual-customer'

// 거래처 담당자(인물) 병합 — 담당자 관리 화면(/api/contact-manager merge · merge_review)과
// 매출처 합치기 뒤 같은 이름 담당자 정리(2026-11-20 데이터 작업)가 같은 함수를 쓴다.
// 인물 병합 — source의 모든 참조를 target으로 이전하고 merged_into_id를 남긴다.
// contact_name_links는 (vendor_id, raw_name) 유니크라 target에 같은 표기가 있으면
// source 쪽 행을 제거한다. 105·500 미적용 테이블은 건너뛴다.
export async function mergeContactInto(
  admin: SupabaseClient,
  sourceId: string,
  targetId: string,
): Promise<string | null> {
  {
    const { error } = await admin.from('contact_assignments')
      .update({ contact_id: targetId }).eq('contact_id', sourceId)
    if (error) return error.message
  }
  for (const t of ['contact_activities', 'erp_consultations', 'erp_orders'] as const) {
    const { error } = await admin.from(t).update({ contact_id: targetId }).eq('contact_id', sourceId)
    if (error && !/does not exist|contact_id/.test(error.message)) return error.message
  }
  {
    // 유니크 충돌 안전 이전: target에 같은 (vendor_id, raw_name)이 없을 때만 이전, 잔여 삭제
    const { data: links } = await admin.from('contact_name_links')
      .select('id, vendor_id, raw_name').eq('contact_id', sourceId)
    for (const l of (links ?? [])) {
      const { data: dup } = await admin.from('contact_name_links')
        .select('id').eq('vendor_id', l.vendor_id).eq('raw_name', l.raw_name).neq('contact_id', sourceId).limit(1)
      if (dup?.length) await admin.from('contact_name_links').delete().eq('id', l.id)
      else await admin.from('contact_name_links').update({ contact_id: targetId }).eq('id', l.id)
    }
  }
  // 전화번호 보강: target이 비어 있으면 source 번호 승계
  const [{ data: src }, { data: tgt }] = await Promise.all([
    admin.from('contacts').select('phone').eq('id', sourceId).maybeSingle(),
    admin.from('contacts').select('phone').eq('id', targetId).maybeSingle(),
  ])
  if (src?.phone && !tgt?.phone) await admin.from('contacts').update({ phone: src.phone }).eq('id', targetId)
  const { error } = await admin.from('contacts').update({ merged_into_id: targetId }).eq('id', sourceId)
  if (error) return error.message
  // 같은 매출처에 같은 인물의 현재 배정이 둘 이상이 되면 하나만 남긴다(2026-11-16) —
  // 대표 배정 우선, 없으면 먼저 시작한 배정. 다올 담당이 비어 있으면 지우는 쪽 값을 이어받는다.
  {
    const { data: act } = await admin.from('contact_assignments')
      .select('id, vendor_id, is_representative, started_at, staff_employee_id, title')
      .eq('contact_id', targetId).is('ended_at', null)
    const byVendor = new Map<string, NonNullable<typeof act>>()
    for (const a of act ?? []) byVendor.set(a.vendor_id as string, [...(byVendor.get(a.vendor_id as string) ?? []), a])
    for (const rows of Array.from(byVendor.values())) {
      if (rows.length < 2) continue
      rows.sort((x, y) => Number(y.is_representative) - Number(x.is_representative)
        || String(x.started_at ?? '').localeCompare(String(y.started_at ?? '')))
      const keep = rows[0]
      const patch: Record<string, unknown> = {}
      if (!keep.staff_employee_id) { const s = rows.find(r => r.staff_employee_id); if (s) patch.staff_employee_id = s.staff_employee_id }
      if (!keep.title) { const t = rows.find(r => r.title); if (t) patch.title = t.title }
      if (Object.keys(patch).length) await admin.from('contact_assignments').update(patch).eq('id', keep.id)
      const drop = rows.slice(1).map(r => r.id as string)
      // 직함 변경 이력(117)은 남기는 배정으로 옮긴 뒤 지운다 (미적용이면 건너뜀)
      await admin.from('contact_assignment_changes').update({ assignment_id: keep.id }).in('assignment_id', drop)
      await admin.from('contact_assignments').delete().in('id', drop)
    }
  }
  // 개인 고객(115): 흡수된 인물의 고객 전용 매출처를 남는 인물 쪽으로 정리
  await followContactMerge(admin, sourceId, targetId)
  return null
}
