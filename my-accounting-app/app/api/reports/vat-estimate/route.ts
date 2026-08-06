import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildVatEstimate, buildVatReturnView } from '@/lib/vat-report'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/reports/vat-estimate?view=return&year=&m1=&m2=  — 신고서 서식·월별 보기
// GET /api/reports/vat-estimate?from=&to=                  — 기존 요약 (export 등에서 사용)
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  if (searchParams.get('view') === 'return') {
    const year = parseInt(searchParams.get('year') ?? '') || new Date().getFullYear()
    const m1 = Math.min(Math.max(parseInt(searchParams.get('m1') ?? '1') || 1, 1), 12)
    const m2 = Math.min(Math.max(parseInt(searchParams.get('m2') ?? '6') || 6, m1), 12)
    const result = await buildVatReturnView(admin, year, m1, m2)
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
    return NextResponse.json(result.result)
  }

  const from = searchParams.get('from')
  const to   = searchParams.get('to')
  if (!from || !to) return NextResponse.json({ error: 'from, to 파라미터가 필요합니다.' }, { status: 400 })

  const result = await buildVatEstimate(admin, from, to)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json(result.result)
}

// POST /api/reports/vat-estimate — 수동 입력 항목 저장 (현금매출·영세율·대손·경감공제 등)
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => null) as {
    action?: string; period_key?: string; item_key?: string
    supply_amount?: number; tax_amount?: number } | null
  if (body?.action !== 'set_manual' || !body.period_key || !body.item_key) {
    return NextResponse.json({ error: 'action=set_manual, period_key, item_key가 필요합니다.' }, { status: 400 })
  }
  const supply = Math.round(Number(body.supply_amount) || 0)
  const tax = Math.round(Number(body.tax_amount) || 0)
  const { error } = await admin.from('vat_manual_entries').upsert({
    period_key: body.period_key,
    item_key: body.item_key,
    supply_amount: supply,
    tax_amount: tax,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'period_key,item_key' })
  if (error) {
    if (/vat_manual_entries/.test(error.message)) {
      return NextResponse.json({ error: '마이그레이션 106(vat_manual_entries)이 아직 실행되지 않았습니다. SQL 편집기에서 106_vat_manual_entries.sql을 실행해 주세요.' }, { status: 400 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
