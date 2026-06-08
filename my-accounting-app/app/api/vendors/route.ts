import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const VENDOR_FIELDS = 'id, name, biz_number, type, contact_name, contact_phone, email, note, match_aliases, is_active, created_at, updated_at'

// GET /api/vendors?q=검색어&type=vendor|customer|both&all=true
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const q    = searchParams.get('q')?.trim()
  const type = searchParams.get('type')
  const all  = searchParams.get('all') === 'true'

  let query = admin
    .from('vendors')
    .select(VENDOR_FIELDS)
    .order('name')

  if (!all)  query = query.eq('is_active', true)
  if (type)  query = query.eq('type', type)
  if (q)     query = query.or(`name.ilike.%${q}%,biz_number.ilike.%${q}%`)

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data: data ?? [] })
}

// POST /api/vendors — 거래처 등록
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json() as {
    name: string; biz_number?: string; type?: string
    contact_name?: string; contact_phone?: string; email?: string; note?: string
    match_aliases?: string[]
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: '거래처명은 필수입니다.' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('vendors')
    .insert({
      name:          body.name.trim(),
      biz_number:    body.biz_number?.trim()   || null,
      type:          body.type ?? 'vendor',
      contact_name:  body.contact_name?.trim() || null,
      contact_phone: body.contact_phone?.trim()|| null,
      email:         body.email?.trim()        || null,
      note:          body.note?.trim()         || null,
      match_aliases: body.match_aliases ?? [],
    })
    .select(VENDOR_FIELDS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data })
}
