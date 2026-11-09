// 담당자 연락처 → 인물 마스터 반영 (116, 2026-11-09 사용자 승인)
//  - 상담·주문에 적은 핸드폰(phone) · 유선(tel)을 contacts에 채운다 — **비어 있는 칸만** (기확정 값은 덮어쓰지 않는다).
//  - 다르면 건드리지 않는다. 화면이 "마스터 번호와 다름"을 표시한다 (ContactOpt.phone · tel 비교).
//  - 116 미적용(tel 컬럼 없음)이면 phone만 채운다. 실패해도 문서 저장에는 영향 없음 (호출부에서 await만).
import type { SupabaseClient } from '@supabase/supabase-js'

const t = (v: unknown) => { const s = String(v ?? '').trim(); return s || null }
// 비교용 — 숫자만 (010-1234-5678 = 01012345678)
export const normTel = (v: unknown) => String(v ?? '').replace(/\D/g, '')

export async function fillContactPhonesIfEmpty(
  admin: SupabaseClient,
  contactId: string | null | undefined,
  input: { phone?: string | null; tel?: string | null },
): Promise<{ phone?: string; tel?: string } | null> {
  const phone = t(input.phone), tel = t(input.tel)
  if (!contactId || (!phone && !tel)) return null
  let cur: { phone: string | null; tel?: string | null } | null = null
  let hasTel = true
  const withTel = await admin.from('contacts').select('phone, tel').eq('id', contactId).maybeSingle()
  if (withTel.error) {
    if (!/tel/i.test(withTel.error.message)) return null
    hasTel = false
    const r = await admin.from('contacts').select('phone').eq('id', contactId).maybeSingle()
    cur = (r.data as { phone: string | null } | null) ?? null
  } else cur = (withTel.data as { phone: string | null; tel: string | null } | null) ?? null
  if (!cur) return null

  const patch: { phone?: string; tel?: string } = {}
  if (phone && !t(cur.phone)) patch.phone = phone
  if (hasTel && tel && !t(cur.tel)) patch.tel = tel
  if (!Object.keys(patch).length) return null
  const { error } = await admin.from('contacts').update(patch).eq('id', contactId)
  return error ? null : patch
}
