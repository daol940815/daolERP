// 알림 센터 — 공용 타입 (docs/work-request-track.md "알림 센터", 2026-10-16 권장안 확정)
// 알림은 저장하지 않는다. /api/notifications 가 원본 상태(업무 요청 · 휴가 신청 · 주문 수정 요청)에서 매번 계산한다.
//  group: todo(지금 해야 할 것, 빨강) · waiting(기다리는 것, 노랑) · info(결과 통지, 파랑 — 종 숫자에 포함하지 않음)

export type NotifGroup = 'todo' | 'waiting' | 'info'
export type NotifTone = 'red' | 'amber' | 'blue' | 'gray'

export interface NotifItem {
  key: string            // 종류 식별자 (토스트 새 항목 판정용: 건수 증가 또는 새 key)
  group: NotifGroup
  tone: NotifTone
  title: string          // "업무 요청 미확인 2건"
  detail: string | null  // 대표 1건 설명
  href: string
  count: number
  at: string | null      // 가장 최근 발생 시각 (확인함 판정·정렬)
}

export interface NotifData {
  at: string
  count: number          // todo + waiting 건수 합 (결과 통지 제외)
  items: NotifItem[]
  badges: Record<string, { n: number; tone: 'red' | 'amber' }>   // 사이드바 메뉴 href → 배지
}

export const NOTIF_GROUP_LABEL: Record<NotifGroup, string> = { todo: '지금 해야 할 것', waiting: '기다리는 것', info: '결과 통지' }
export const NOTIF_POLL_MS = 60_000
export const NOTIF_SEEN_KEY = 'notif-seen-at'
