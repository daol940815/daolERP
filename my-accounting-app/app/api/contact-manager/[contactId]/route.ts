import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildContactDetail } from '@/lib/contact-manager'

export const dynamic = 'force-dynamic'

// GET /api/contact-manager/[contactId] — 담당자 상세 (이력·커넥션·영업일지·주문)
export async function GET(_req: NextRequest, { params }: { params: { contactId: string } }) {
  const admin = createAdminClient()
  const detail = await buildContactDetail(admin, params.contactId)
  if ('error' in detail) return NextResponse.json({ error: detail.error }, { status: 500 })
  return NextResponse.json(detail)
}
