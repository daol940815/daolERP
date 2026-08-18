import type { SupabaseClient } from '@supabase/supabase-js'

// 업무일지 공용 로직 (700 마이그레이션)
//  - 계정이 ERP에서 한 업무를 자동으로 한 줄 남긴다. 기재 실패가 원래 저장을
//    막으면 안 되므로 recordWorkLog는 예외를 던지지 않고 성공 여부만 돌려준다.
//  - 영업일지(contact_activities)와 다른 개념 — 그쪽은 영업자가 직접 쓰는 문서다.

export const WORK_LOG_ACTIONS = [
  '상담작성', '상담수정', '주문전환', '주문작성', '주문수정', '영업일지', '직접기재',
] as const
export type WorkLogAction = (typeof WORK_LOG_ACTIONS)[number]

// 직접 기재 구분 — ERP 밖 업무 (사용해보고 조정 예정)
export const WORK_LOG_CATEGORIES = ['회의', '출고·포장', '재고', '고객응대', '기타'] as const

export const WORK_LOG_MIGRATION_HINT =
  '700 마이그레이션(업무일지)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'

export const isWorkLogMissing = (message: string) =>
  /erp_work_logs|relation .* does not exist/i.test(message)

// KST 기준 오늘 (업무일 그룹·집계 기준)
export const kstToday = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())

export interface WorkLogInput {
  employeeId: string | null
  action: WorkLogAction
  content: string
  workDate?: string | null                       // 미지정 시 KST 오늘
  refType?: 'consultation' | 'order' | 'activity' | null
  refId?: string | null
  category?: string | null
}

// 자동 기재 — 실패해도 호출부의 본 작업은 유지한다 (기재는 부수 효과)
export async function recordWorkLog(
  admin: SupabaseClient,
  input: WorkLogInput,
): Promise<boolean> {
  if (!input.employeeId) return false          // 직원 미연결 계정은 기재 대상 아님
  const content = input.content.trim()
  if (!content) return false
  try {
    const { error } = await admin.from('erp_work_logs').insert({
      employee_id: input.employeeId,
      work_date: input.workDate || kstToday(),
      source: 'auto',
      action: input.action,
      content,
      category: input.category ?? null,
      ref_type: input.refType ?? null,
      ref_id: input.refId ?? null,
    })
    return !error
  } catch {
    return false
  }
}

// ── 표시 문구 만들기 ──────────────────────────────────
// 사용자 목표 형식: "00월 00일 A지점 A담당자와 상담" — 날짜는 화면의 날짜 그룹이
// 담당하므로 본문에는 대상과 행위만 넣는다.

const label = (...parts: (string | null | undefined)[]) =>
  parts.map(p => (p ?? '').trim()).filter(Boolean).join(' ')

export const consultContent = (
  fields: { bank_name?: string | null; branch_name?: string | null; manager_name?: string | null; consult_type?: string | null },
  verb: '상담' | '상담 내용 수정',
) => {
  const who = label(fields.bank_name, fields.branch_name, fields.manager_name)
  const type = fields.consult_type ? ` (${fields.consult_type})` : ''
  if (verb === '상담') return `${who ? `${who}와 ` : ''}상담${type}`
  return `${who ? `${who} ` : ''}상담 내용 수정${type}`
}

export const orderContent = (
  opts: { customer?: string | null; orderNo?: string | null; itemCount?: number; total?: number },
  verb: '주문서 작성' | '주문서 수정' | '상담을 주문서로 전환',
) => {
  const head = label(opts.customer) || '주문'
  const tail: string[] = []
  if (opts.orderNo) tail.push(opts.orderNo)
  if (opts.itemCount) tail.push(`품목 ${opts.itemCount}건`)
  if (opts.total) tail.push(`${Math.round(opts.total).toLocaleString('ko-KR')}원`)
  return `${head} ${verb}${tail.length ? ` · ${tail.join(' · ')}` : ''}`
}

export const journalContent = (
  opts: { contactName?: string | null; vendorName?: string | null; activityType?: string | null },
) => {
  const who = label(opts.vendorName, opts.contactName) || '영업일지'
  const type = opts.activityType ? ` (${opts.activityType})` : ''
  return `${who} 영업일지 작성${type}`
}
