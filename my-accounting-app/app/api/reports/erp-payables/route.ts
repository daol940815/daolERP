import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildPayableRows } from '@/lib/erp-reports'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/reports/erp-payables?monthFrom=YYYY-MM&monthTo=YYYY-MM
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const result = await buildPayableRows(admin, searchParams.get('monthFrom'), searchParams.get('monthTo'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({ data: result.rows })
}
