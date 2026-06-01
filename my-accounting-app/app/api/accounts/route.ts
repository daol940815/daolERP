import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

const ACCOUNT_FIELDS = 'id, name, code, type, keywords, is_active, side_on_in, side_on_out'

// GET /api/accounts?all=true — 전체(비활성 포함) / 기본: 활성만
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const all = new URL(req.url).searchParams.get('all') === 'true'

  let query = admin
    .from('accounts')
    .select(ACCOUNT_FIELDS)
    .order('type')
    .order('code')

  if (!all) query = query.eq('is_active', true)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data ?? [] })
}

// POST /api/accounts — 새 계정과목 생성
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json() as {
    code: string; name: string; type: string; keywords?: string[]
    side_on_in?: string; side_on_out?: string
  }

  if (!body.code?.trim() || !body.name?.trim() || !body.type) {
    return NextResponse.json({ error: '코드, 이름, 유형은 필수입니다.' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('accounts')
    .insert({
      code:        body.code.trim(),
      name:        body.name.trim(),
      type:        body.type,
      keywords:    body.keywords ?? [],
      is_active:   true,
      side_on_in:  body.side_on_in  ?? 'credit',
      side_on_out: body.side_on_out ?? 'debit',
    })
    .select(ACCOUNT_FIELDS)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}
