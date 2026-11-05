import type { SupabaseClient } from '@supabase/supabase-js'

// ── 고객별 다올 담당 (112, 2026-11-05 사용자 확정) ─────────────────────
// "데이터는 무조건 은행 - 지점 - 고객의 담당자가 기입되어야 해"
//  - 원본 = contact_assignments.staff_employee_id (현재 배정 = ended_at IS NULL) 한 곳
//  - 주문의 상담자 = 그 지점 · 고객의 다올 담당. 지점 담당(vendor_staff)으로 대신 채우지 않는다
//  - 비어 있으면 주문 입력 시 고른 상담자를 자동 저장 (빈 경우만 — 기존 값은 덮어쓰지 않음)
//  - 사용자가 매출처(customer · both)에 고객을 직접 등록 · 배정할 때는 다올 담당 필수

export const STAFF_112_HINT = '112 마이그레이션(고객별 다올 담당)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
export const STAFF_REQUIRED_MSG = '다올 담당(자사 영업 직원)을 선택해주세요. 은행 · 지점 · 고객마다 담당이 기입되어야 합니다.'

// 이 거래처가 매출처인지 (매입처 담당자에는 다올 담당을 받지 않는다)
export async function isSalesVendor(admin: SupabaseClient, vendorId: string): Promise<boolean> {
  const { data } = await admin.from('vendors').select('type').eq('id', vendorId).maybeSingle()
  return !data || data.type === 'customer' || data.type === 'both'
}

// 고객 등록 · 배정 요청의 다올 담당 검사 — 매출처면 필수. 반환: 저장할 값 또는 오류
export async function requireStaff(
  admin: SupabaseClient, vendorId: string, raw: unknown,
): Promise<{ staff: string | null } | { error: string }> {
  const staff = typeof raw === 'string' && raw ? raw : null
  if (staff) return { staff }
  return (await isSalesVendor(admin, vendorId)) ? { error: STAFF_REQUIRED_MSG } : { staff: null }
}

// 주문 저장 시: 고객 다올 담당이 비어 있으면 상담자로 채운다 (있으면 그대로)
export async function fillCustomerStaffIfEmpty(
  admin: SupabaseClient, vendorId: string | null | undefined, contactId: string | null | undefined, employeeId: string | null | undefined,
): Promise<void> {
  if (!vendorId || !contactId || !employeeId) return
  await admin.from('contact_assignments')
    .update({ staff_employee_id: employeeId })
    .eq('vendor_id', vendorId).eq('contact_id', contactId)
    .is('ended_at', null).is('staff_employee_id', null)
    .then(() => null, () => null)
}
