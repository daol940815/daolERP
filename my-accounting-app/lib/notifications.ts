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
  bucket?: NotifBucket   // 알림 칸 — 개인 · 공용 · 내 요청 · 기타 (2026-11-05, 종 버튼 세 칸 + 패널 탭)
}

// 종 숫자 나눔(2026-11-05 사용자 결정): 업무 요청 알림 종류와 같은 기준 — 개인 요청 · 공용 요청 · 내 요청 (+ 휴가 결재 · 주문 승인 = 기타)
//  업무 요청은 "요청 건수"로 센다 — 미확인이면서 마감 지남인 1건은 1로 (중복 없음)
//  2026-11-09: 주문 알림(주문 진행 요청 · 완료 회신 · 주문 수정 승인)을 '주문' 칸으로 분리 — 개인 · 공용 · 내 요청은 업무 요청만.
export type NotifBucket = 'personal' | 'shared' | 'mine' | 'order' | 'other'
export const NOTIF_BUCKETS: NotifBucket[] = ['personal', 'shared', 'mine', 'order', 'other']
export const NOTIF_BUCKET_LABEL: Record<NotifBucket, string> = { personal: '개인', shared: '공용', mine: '내 요청', order: '주문', other: '기타' }
export const NOTIF_BUCKET_HINT: Record<NotifBucket, string> = {
  personal: '나 혼자 담당인 업무 요청', shared: '여러 명이 담당인 업무 요청(선착 · 공동)', mine: '내가 보낸 업무 요청',
  order: '주문 진행 요청 · 완료 회신 · 주문 입력 · 주문 수정 승인', other: '휴가 결재 · 내 휴가 결과',
}
// 알림 출처 표기(2026-11-09) — 항목 key 접두로 판정. 패널 · 토스트 · 확인할 것에 작은 꼬리표로 붙인다.
export type NotifSource = 'wr' | 'order' | 'leave'
export const NOTIF_SOURCE_LABEL: Record<NotifSource, string> = { wr: '업무 요청', order: '주문', leave: '휴가' }
export const notifSource = (key: string): NotifSource | null =>
  key.startsWith('wr:') ? 'wr' : /^(oreq|orep|ocr):/.test(key) ? 'order' : key.startsWith('leave:') ? 'leave' : null

export interface NotifData {
  at: string
  count: number          // breakdown 합 (결과 통지 제외)
  breakdown: Record<NotifBucket, number>
  items: NotifItem[]
  badges: Record<string, { n: number; tone: 'red' | 'amber' }>   // 사이드바 메뉴 href → 배지
}

export const NOTIF_GROUP_LABEL: Record<NotifGroup, string> = { todo: '지금 해야 할 것', waiting: '기다리는 것', info: '결과 통지' }
export const NOTIF_POLL_MS = 20_000   // 2026-11-02: 60초 → 20초 (⑥ 1단계). 탭 복귀·화면 조작 시에는 즉시 조회.
export const NOTIF_SEEN_KEY = 'notif-seen-at'
// 즉시 갱신 신호(⑥ 2단계, 2026-11-02) — 서버가 Realtime Broadcast 로 보내는 채널·이벤트 이름. 신호에는 데이터가 없다(id만).
export const WR_CHANNEL = 'wr'
export const WR_EVENT = 'changed'
