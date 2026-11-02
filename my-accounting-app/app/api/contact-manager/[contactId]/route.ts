import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildContactDetail } from '@/lib/contact-manager'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

// GET /api/contact-manager/[contactId] — 담당자 상세 (이력·커넥션·영업일지·주문)
export async function GET(_req: NextRequest, { params }: { params: { contactId: string } }) {
  const admin = createAdminClient()
  const detail = await buildContactDetail(admin, params.contactId)
  if ('error' in detail) return NextResponse.json({ error: detail.error }, { status: 500 })
  // 과거 매출 스냅샷 (고객관리문서 기준, 111) — 미적용 환경이면 빈 배열
  let docSales: unknown[] = []
  {
    const { data } = await admin.from('doc_sales_snapshot')
      .select('bank_name, branch_name, total_sales, season, monthly, first_order_date, last_order_date, order_type, source')
      .eq('contact_id', params.contactId)
      .order('total_sales', { ascending: false })
      .limit(50)
    docSales = data ?? []
  }
  const me = await getCurrentUser()
  return NextResponse.json({ ...detail, doc_sales: docSales, can_edit: !!me && can(me, 'customers', 'edit') })
}
