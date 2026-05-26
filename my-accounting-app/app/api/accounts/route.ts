import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

// GET /api/accounts — 활성 계정과목 전체 조회
export async function GET() {
  const admin = await createAdminClient()

  const { data, error } = await admin
    .from('accounts')
    .select('id, name, code, type, keywords, is_active')
    .eq('is_active', true)
    .order('type')
    .order('name')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data ?? [] })
}
