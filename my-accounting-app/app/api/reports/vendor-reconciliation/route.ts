import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildReconciliationRows } from '@/lib/vendor-reconciliation'

export const dynamic = 'force-dynamic'

// GET /api/reports/vendor-reconciliation?direction=sales|purchase&from=&to=
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const direction = searchParams.get('direction') === 'purchase' ? 'purchase' : 'sales'
  const result = await buildReconciliationRows(
    admin, direction, searchParams.get('from'), searchParams.get('to'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({ data: result.rows })
}
