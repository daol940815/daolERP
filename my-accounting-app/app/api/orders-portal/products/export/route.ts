import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 품목 마스터 엑셀 다운로드 — 업로드(원가표) 양식 호환.
// 시트명 '원가표' + 2행 헤더(택배비 → 카톤단위/카톤외)로 내려주므로,
// 이 파일을 수정해 그대로 다시 업로드하면 품번 기준으로 갱신된다 (왕복 호환).
//  - 카탈로그 제작용 컬럼(표기용 상품명·소비자가·구성·재고)은 저장하지 않으므로 없음
//  - 개별배송매입가는 파생값(지점배송매입가+카톤외택배비) — 참고용 포함, 재업로드 시 무시됨
//  - 부가상품·상태 컬럼은 화면 관리용 참고 — 재업로드 시 부가상품은 품번 규칙으로 재판정
//
// GET ?filter=active|inactive|addon|all&q= — 품목 마스터 화면의 현재 필터 그대로

interface P {
  item_code: string | null
  item_name: string
  option_name: string | null
  purchase_vendor_name: string | null
  category: string | null
  sale_price: number
  individual_sale_price: number
  purchase_price: number
  carton_unit: number | null
  carton_shipping_fee: number
  loose_shipping_fee: number
  is_addon: boolean
  is_active: boolean
  is_soldout?: boolean
  memo: string | null
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const filter = sp.get('filter') ?? 'active'
  const q = (sp.get('q') ?? '').trim().toLowerCase()

  const load = (withSoldout: boolean) => fetchAllRows<P>((from, to) =>
    admin.from('erp_products')
      .select((withSoldout
        ? 'item_code, item_name, option_name, purchase_vendor_name, category, sale_price, individual_sale_price, purchase_price, carton_unit, carton_shipping_fee, loose_shipping_fee, is_addon, is_active, is_soldout, memo'
        : 'item_code, item_name, option_name, purchase_vendor_name, category, sale_price, individual_sale_price, purchase_price, carton_unit, carton_shipping_fee, loose_shipping_fee, is_addon, is_active, memo') as string)
      .order('item_code', { ascending: true, nullsFirst: false })
      .range(from, to) as unknown as PromiseLike<{ data: P[] | null; error: { message: string } | null }>,
  )
  // is_soldout은 509 — 미적용 환경이면 컬럼 없이 재조회
  let result = await load(true)
  if ('error' in result && /is_soldout/i.test(result.error)) result = await load(false)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  // 화면과 동일한 필터 (page.tsx의 filtered 로직과 맞출 것)
  const rows = result.data.filter(p => {
    if (filter === 'active' && !p.is_active) return false
    if (filter === 'inactive' && p.is_active) return false
    if (filter === 'addon' && !p.is_addon) return false
    if (!q) return true
    return [p.item_code, p.item_name, p.purchase_vendor_name, p.category]
      .some(v => (v ?? '').toLowerCase().includes(q))
  })
  if (!rows.length) return NextResponse.json({ error: '조건에 맞는 품목이 없습니다.' }, { status: 404 })

  // 2행 헤더 — 업로드 파서가 인식하는 원가표 형식 그대로
  // (택배비 컬럼은 헤더 1행에 '택배비', 2행에 카톤단위/카톤외 서브헤더)
  const header1 = ['목차', '품번', '상품명(원가표 등록용)', '옵션명', '매입처',
    '지점배송매입가', '개별배송매입가', '지점배송판매가', '개별배송판매가',
    '카톤단위', '택배비', '', '메모', '부가상품', '품절', '상태']
  const header2 = ['', '', '', '', '', '', '', '', '', '', '카톤단위', '카톤외', '', '', '', '']

  const aoa: (string | number | null)[][] = [
    header1,
    header2,
    ...rows.map(p => [
      p.category ?? '',
      p.item_code ?? '',
      p.item_name,
      p.option_name ?? '',
      p.purchase_vendor_name ?? '',
      p.purchase_price || 0,
      // 개별배송매입가 = 지점배송매입가 + 카톤외택배비 (파생, 참고용)
      p.purchase_price > 0 && p.loose_shipping_fee > 0 ? p.purchase_price + p.loose_shipping_fee : '',
      p.sale_price || 0,
      p.individual_sale_price || '',
      p.carton_unit ?? '',
      p.carton_shipping_fee || '',
      p.loose_shipping_fee || '',
      p.memo ?? '',
      p.is_addon ? 'Y' : '',
      p.is_soldout ? 'Y' : '',
      p.is_active ? '사용' : '중지',
    ]),
  ]

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [
    { wch: 10 }, { wch: 10 }, { wch: 40 }, { wch: 14 }, { wch: 14 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
    { wch: 8 }, { wch: 9 }, { wch: 9 }, { wch: 20 }, { wch: 8 }, { wch: 6 }, { wch: 6 },
  ]
  // 택배비 헤더 병합 (K1:L1) — 원가표 형식과 동일한 모양
  ws['!merges'] = [{ s: { r: 0, c: 10 }, e: { r: 0, c: 11 } }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '원가표')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())
  const filename = encodeURIComponent(`품목마스터_${today}.xlsx`)
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
    },
  })
}
