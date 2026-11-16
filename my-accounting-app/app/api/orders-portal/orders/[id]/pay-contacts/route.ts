import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import { addContact, listContacts } from '@/lib/payment-guide'

export const dynamic = 'force-dynamic'

// 결제 안내 연락 기록 (1301, 2026-11-16) — 영업지원팀(주문 · 발주 수정 권한)이 주문 단위로 남긴다
//   GET  → { available, contacts }
//   POST { contact_date, method: phone|sms|email|visit|etc, memo?, promise_date? }
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  return NextResponse.json(await listContacts(createAdminClient(), params.id))
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!can(me, 'orders', 'edit')) {
    return NextResponse.json({ error: '연락 기록은 주문 · 발주 수정 권한이 필요합니다. 영업지원팀 홍창의 부장 또는 ERP 담당에게 요청해주세요.' }, { status: 403 })
  }
  const r = await addContact(createAdminClient(), params.id, await req.json().catch(() => ({})), { employeeId: me.employeeId, employeeName: me.employeeName })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(r)
}
