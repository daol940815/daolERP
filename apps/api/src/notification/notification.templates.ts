/** 알림 템플릿 — 알림 모듈은 도메인을 모르고 템플릿 키+파라미터만 받는다 (기획서 5.5) */

export interface RenderedNotification {
  title: string;
  body: string;
  link?: string;
}

type Params = Record<string, string | number>;

const TEMPLATES: Record<string, (p: Params) => RenderedNotification> = {
  'approval.requested': (p) => ({
    title: '승인 요청',
    body: `${p.applicantName}님의 ${p.requestLabel} 신청이 승인 대기 중입니다.`,
    link: '/approvals',
  }),
  'approval.approved': (p) => ({
    title: '신청 승인됨',
    body: `${p.requestLabel} 신청이 승인되었습니다.`,
    link: String(p.link ?? '/'),
  }),
  'approval.rejected': (p) => ({
    title: '신청 반려됨',
    body: `${p.requestLabel} 신청이 반려되었습니다.${p.comment ? ` (사유: ${p.comment})` : ''}`,
    link: String(p.link ?? '/'),
  }),
  'leave.promotion': (p) => ({
    title: '연차 사용 촉진',
    body: `사용기한이 ${p.daysLeft}일 남은 연차 ${p.remaining}일이 있습니다. 소멸 전에 사용하세요.`,
    link: '/leave',
  }),
  'attendance.weekly-hours': (p) => ({
    title: '주간 근무시간 임박',
    body: `${p.employeeName}님의 이번 주 근무시간이 ${p.hours}시간입니다 (알림 기준 ${p.threshold}시간).`,
    link: '/attendance',
  }),
};

export function renderTemplate(template: string, params: Params): RenderedNotification {
  const fn = TEMPLATES[template];
  if (!fn) return { title: '알림', body: `${template}` };
  return fn(params);
}

export const REQUEST_LABELS: Record<string, string> = {
  LEAVE: '휴가',
  LEAVE_CANCEL: '휴가 취소',
  OVERTIME: '초과근무',
  ATTENDANCE_CORRECTION: '근태 보정',
};
