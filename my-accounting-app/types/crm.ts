// 고객관리(CRM) 화면 공용 타입 — docs/customer-management-design.md

export type Grade = 'A' | 'B' | 'C' | 'D'

// 고객 목록 행 (crm_contacts + crm_contact_stats 병합)
export interface CrmContactRow {
  contact_id: string
  bank_name: string
  branch_name: string | null
  name: string
  title: string | null
  role: 'staff' | 'branch_manager'
  phone: string | null
  counselor_now: string | null
  status: string
  total_revenue: number
  revenue_grade: Grade
  continuity_grade: Grade
  intimacy_grade: Grade | null
  overall_grade: Grade
  traded_y2: boolean
  traded_y1: boolean
  traded_y0: boolean
  last_order_date: string | null
  last_activity: string | null
}

// 고객 상세
export interface CrmContactDetail {
  id: string
  vendor_id: string | null
  bank_name: string
  branch_name: string | null
  name: string
  title: string | null
  role: string
  phone: string | null
  office_phone: string | null
  intimacy_grade: Grade | null
  keyman: string | null
  is_rotc: boolean | null
  counselor_prev: string | null
  counselor_now: string | null
  status: string
  memo: string | null
}

// 매출 버킷 (상세 그리드): 명절 또는 연-월
export interface CrmSalesBucket {
  season_code: string | null   // '25설' 등 (명절 버킷)
  month: string | null         // 'YYYY-MM' (상시 버킷)
  amount: number
  legacy: boolean              // true = 엑셀 이관값(2024)
}

export interface CrmOrderRow {
  id: string
  order_no: string
  order_date: string
  season_code: string | null
  total_amount: number
  collect_status: string
}

export interface CrmActivity {
  id: string
  contact_id: string
  activity_date: string
  activity_type: string
  staff_name: string | null
  summary: string | null
  memo: string | null
  next_action_date: string | null
  next_action_memo: string | null
}

export interface CrmSnapshot {
  eval_month: string
  revenue_grade: Grade
  continuity_grade: Grade
  intimacy_grade: Grade | null
  overall_grade: Grade
  total_revenue: number
}

// 매칭 화면: 미귀속 주문 키
export interface CrmUnmatchedKey {
  bank_name: string
  branch_name: string
  manager_name: string
  order_count: number
  total_amount: number
  first_date: string
  last_date: string
}

export const ACTIVITY_TYPES: Record<string, string> = {
  call: '통화', visit: '방문', kakao: '카톡', gift: '선물',
  sample: '샘플', order_followup: '주문 팔로업', etc: '기타',
}

export const GRADE_COLORS: Record<Grade, string> = {
  A: 'bg-emerald-100 text-emerald-700',
  B: 'bg-blue-100 text-blue-700',
  C: 'bg-amber-100 text-amber-700',
  D: 'bg-gray-100 text-gray-500',
}
