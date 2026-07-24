import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/crm/matching — 미귀속 주문 키 목록 (금액 큰 순)
export async function GET() {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('crm_unmatched_keys')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// POST /api/crm/matching — 키를 고객에 연결(학습) 후 매칭 재실행
// body: { bank_name, branch_name, manager_name, contact_id }         기존 고객에 연결
//       { bank_name, branch_name, manager_name, create: true, ... }  신규 고객 생성 후 연결
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const b = await req.json()
  if (b.bank_name === undefined || b.branch_name === undefined || b.manager_name === undefined) {
    return NextResponse.json({ error: '키 3요소(은행·지점·담당자)가 필요합니다.' }, { status: 400 })
  }

  let contactId: string | null = b.contact_id ?? null
  if (!contactId && b.create) {
    const { data: created, error: ce } = await admin
      .from('crm_contacts')
      .insert({
        bank_name: b.bank_name || '(미상)',
        branch_name: b.branch_name || null,
        name: b.name || b.manager_name || '(미상)',
        title: b.title || null,
        counselor_now: b.counselor_now || null,
        memo: '매칭 화면에서 생성',
      })
      .select('id')
      .single()
    if (ce) return NextResponse.json({ error: ce.message }, { status: 500 })
    contactId = created.id as string
  }
  if (!contactId) {
    return NextResponse.json({ error: 'contact_id 또는 create가 필요합니다.' }, { status: 400 })
  }

  const { error: ke } = await admin
    .from('crm_contact_keys')
    .upsert(
      {
        contact_id: contactId,
        bank_name: b.bank_name,
        branch_name: b.branch_name ?? '',
        manager_name: b.manager_name,
        source: 'manual',
      },
      { onConflict: 'bank_name,branch_name,manager_name' },
    )
  if (ke) return NextResponse.json({ error: ke.message }, { status: 500 })

  // 멱등 매칭 재실행 — 방금 학습한 키가 해당 주문 전부에 반영된다
  const { data: matched, error: me } = await admin.rpc('crm_match_orders')
  if (me) return NextResponse.json({ error: me.message }, { status: 500 })
  return NextResponse.json({ contact_id: contactId, matched })
}
