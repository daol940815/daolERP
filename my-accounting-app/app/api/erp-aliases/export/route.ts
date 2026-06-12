import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

const TYPE_LABEL: Record<string, string> = {
  customer: '매출처',
  vendor:   '매입처',
  both:     '매입+매출',
}

// GET /api/erp-aliases/export?type=customer|purchase
// 매출처/매입처 관리 화면(ERP명 연결 + 기타 거래처)을 엑셀로 내보낸다.
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)
  const type: 'customer' | 'purchase' = searchParams.get('type') === 'purchase' ? 'purchase' : 'customer'
  const isCustomer = type === 'customer'

  const { data: aliases, error: ae } = await admin
    .from('erp_vendor_aliases')
    .select('erp_name, vendor_id, vendors(id, name, type, biz_number, contact_name, contact_phone, email, note, match_aliases, card_numbers, is_active)')
    .eq('alias_type', type)
    .order('erp_name')
    .limit(2000)
  if (ae) return NextResponse.json({ error: ae.message }, { status: 500 })

  const { data: vendors, error: ve } = await admin
    .from('vendors')
    .select('id, name, type, biz_number, contact_name, contact_phone, email, note, match_aliases, card_numbers, is_active')
    .order('name')
    .limit(5000)
  if (ve) return NextResponse.json({ error: ve.message }, { status: 500 })

  const connectedVendorIds = new Set(
    (aliases ?? []).filter(a => a.vendor_id).map(a => a.vendor_id as string)
  )
  const otherVendors = (vendors ?? []).filter(v =>
    (isCustomer ? (v.type === 'customer' || v.type === 'both') : (v.type === 'vendor' || v.type === 'both'))
    && !connectedVendorIds.has(v.id as string)
  )

  type VendorRow = {
    id: string; name: string; type: string
    biz_number: string | null; contact_name: string | null; contact_phone: string | null
    email: string | null; note: string | null
    match_aliases: string[] | null; card_numbers: string[] | null; is_active: boolean
  }

  const rows: Record<string, string>[] = []

  for (const a of aliases ?? []) {
    const v = a.vendors as unknown as VendorRow | null
    rows.push({
      'ERP명':              a.erp_name as string,
      '거래처명':           v?.name ?? '',
      '유형':               v ? (TYPE_LABEL[v.type] ?? v.type) : '',
      '사업자번호':         v?.biz_number ?? '',
      '담당자':             v?.contact_name ?? '',
      '연락처':             v?.contact_phone ?? '',
      '이메일':             v?.email ?? '',
      '입금출금계좌명':     (v?.match_aliases ?? []).join('; '),
      '카드번호':           (v?.card_numbers ?? []).join('; '),
      '활성':               v ? (v.is_active ? 'Y' : 'N') : '',
      '메모':               v?.note ?? '',
    })
  }

  for (const v of otherVendors as VendorRow[]) {
    rows.push({
      'ERP명':              '',
      '거래처명':           v.name,
      '유형':               TYPE_LABEL[v.type] ?? v.type,
      '사업자번호':         v.biz_number ?? '',
      '담당자':             v.contact_name ?? '',
      '연락처':             v.contact_phone ?? '',
      '이메일':             v.email ?? '',
      '입금출금계좌명':     (v.match_aliases ?? []).join('; '),
      '카드번호':           (v.card_numbers ?? []).join('; '),
      '활성':               v.is_active ? 'Y' : 'N',
      '메모':               v.note ?? '',
    })
  }

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [
    { wch: 24 }, // ERP명
    { wch: 20 }, // 거래처명
    { wch: 10 }, // 유형
    { wch: 16 }, // 사업자번호
    { wch: 12 }, // 담당자
    { wch: 14 }, // 연락처
    { wch: 22 }, // 이메일
    { wch: 30 }, // 입금출금계좌명
    { wch: 24 }, // 카드번호
    { wch: 6 },  // 활성
    { wch: 30 }, // 메모
  ]
  XLSX.utils.book_append_sheet(wb, ws, isCustomer ? '매출처 관리' : '매입처 관리')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array
  const today = new Date().toISOString().slice(0, 10)
  const label = isCustomer ? '매출처관리' : '매입처관리'
  return new Response(buf.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${label}_${today}`)}.xlsx`,
    },
  })
}
