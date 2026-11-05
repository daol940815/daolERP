// PC 알림(Web Push) — 공용 타입·라벨 (업무요청 트랙 ⑦, 2026-11-03). 서버·브라우저 공용(환경변수 접근 없음).
// 받을 알림 종류는 구독(기기)마다 prefs 에 두며, 키가 없으면 켠 것으로 본다. 주문 수정 승인은 제도 폐지(2026-08-25)로 제외.

export type PushKind = 'wr_new' | 'wr_result' | 'wr_memo' | 'wr_due_today' | 'leave_approve' | 'order_req' | 'order_done' | 'order_reply' | 'order_reply_wait'
export const PUSH_KINDS: PushKind[] = ['wr_new', 'wr_result', 'wr_memo', 'wr_due_today', 'leave_approve', 'order_req', 'order_done', 'order_reply', 'order_reply_wait']
export const PUSH_KIND_LABEL: Record<PushKind, string> = {
  wr_new: '새 업무 요청을 받았을 때',
  wr_result: '내 요청이 반려 · 처리 보고됐을 때',
  wr_memo: '내 요청 · 내 담당 요청에 진행 메모가 달렸을 때',
  wr_due_today: '오늘 마감 요청 (아침 09:00 1회)',
  leave_approve: '휴가 결재 요청 (결재 권한자)',
  order_req: '상담일지 주문 진행 요청을 받았을 때 (미처리 시 다음 날 아침 09:00 1회 더)',
  order_done: '내가 요청한 주문이 입력됐을 때',
  order_reply: '내가 요청 · 상담한 주문에 완료 회신 · 처리 불가 회신이 왔을 때',
  order_reply_wait: '회신 안 한 주문 (입력 다음 날 아침 09:00 1회)',
}
export type PushPrefs = Partial<Record<PushKind, boolean>>
export const prefOn = (prefs: PushPrefs | null | undefined, kind: PushKind) => prefs?.[kind] !== false

export interface PushSubRow {
  id: string
  endpoint: string
  device_label: string | null
  user_agent: string | null
  enabled: boolean
  prefs: PushPrefs
  last_used_at: string | null
  last_error: string | null
  created_at: string
}

// 푸시 본문 — 서비스 워커(public/sw.js)가 읽는 모양
export interface PushPayload { title: string; body: string; url: string; tag?: string; kind: PushKind }

// 브라우저 UA → 기기 이름 기본값 ("Chrome · Windows")
export function deviceLabelFrom(ua: string): string {
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Whale\//.test(ua) ? 'Whale' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : '브라우저'
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua) ? 'Mac' : /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : 'PC'
  return `${b} · ${os}`
}
// "나중에" 를 눌렀을 때 다시 묻기까지 (브라우저별 localStorage)
export const PUSH_LATER_KEY = 'push-later-until'
export const PUSH_LATER_DAYS = 7
