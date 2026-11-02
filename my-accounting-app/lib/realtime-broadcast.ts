// 즉시 갱신 신호 (업무요청 트랙 ⑥ 2단계, 2026-11-02) — 서버 전용
// 업무 요청 API가 생성·수락·보고 등을 처리한 직후 Supabase Realtime 채널 'wr' 에 'changed' 신호를 보낸다.
// 신호에는 데이터가 없다(요청 id · 관련 직원 id만). 브라우저는 신호를 받으면 기존 알림 API·목록 API를 다시 조회한다
// (권한 검사는 그 API가 한다). 20초 폴링은 안전망으로 그대로 둔다. 실패해도 본 작업에는 영향 없음.
// Realtime HTTP Broadcast: POST {SUPABASE_URL}/realtime/v1/api/broadcast (서비스 키)

import { WR_CHANNEL, WR_EVENT } from '@/lib/notifications'

export async function broadcastWrChanged(requestId: string, employeeIds: (string | null | undefined)[]): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 2500)
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ topic: WR_CHANNEL, event: WR_EVENT, payload: { request_id: requestId, employee_ids: Array.from(new Set(employeeIds.filter((x): x is string => !!x))), at: new Date().toISOString() } }] }),
      signal: ctrl.signal,
      cache: 'no-store',
    })
  } catch { /* 신호 실패는 무시 — 폴링이 받쳐준다 */ } finally { clearTimeout(timer) }
}
