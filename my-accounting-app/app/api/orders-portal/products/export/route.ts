import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 품목 마스터 엑셀 다운로드 — 실무 원가표 형식 완전 재현 (512, B안 — 2026-10-01 확정).
// 실무자가 쓰는 29열 원가표(2행 헤더)를 그대로 내려주므로, 이 파일을 수정해 다시
// 업로드하면 품번 기준으로 갱신된다 (완전 왕복 — 수기 원가표 원본을 대체 가능).
//  - 개별배송매입가(지점매입가+카톤외택배비)·마진율은 파생값 — 계산해서 채움, 재업로드 시 무시
//  - 상태: 저장된 메모 원문 그대로, 메모 없이 화면 버튼으로만 처리한 품목은 '품절'/'사용중지',
//    정상은 빈 칸 (원가표 관례와 동일)
//  - 매입처 담당자·연락처1·이메일1은 매입처 마스터(vendors)에서 채움 — 연락처2·3,
//    이메일2·3은 저장처가 없어 빈 칸 (사용자 확정: 마스터에 있는 값만)
//
// GET ?filter=active|inactive|addon|all&q= — 품목 마스터 화면의 현재 필터 그대로
//     (원가표 원본 재생성 용도는 filter=all 권장 — 단종·사용중지 포함)

interface P {
  item_code: string | null
  item_name: string
  option_name: string | null
  purchase_vendor_name: string | null
  purchase_alias_id: string | null
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
  status_note?: string | null
  catalog_name?: string | null
  consumer_price?: number | null
  composition?: string | null
  catalog_text?: string | null
  stock_flag?: string | null
  stock_qty?: number | null
  shipping_fee_extra?: number | null
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const filter = sp.get('filter') ?? 'active'
  const q = (sp.get('q') ?? '').trim().toLowerCase()

  const BASE = 'item_code, item_name, option_name, purchase_vendor_name, purchase_alias_id, category, sale_price, individual_sale_price, purchase_price, carton_unit, carton_shipping_fee, loose_shipping_fee, is_addon, is_active, memo'
  const V509 = `${BASE}, is_soldout`
  const V512 = `${V509}, status_note, catalog_name, consumer_price, composition, catalog_text, stock_flag, stock_qty, shipping_fee_extra`
  const load = (cols: string) => fetchAllRows<P>((from, to) =>
    admin.from('erp_products').select(cols)
      .order('item_code', { ascending: true, nullsFirst: false })
      .range(from, to) as unknown as PromiseLike<{ data: P[] | null; error: { message: string } | null }>,
  )
  // 512 → 509 → 기본 순 폴백 (미적용 환경은 해당 칸 빈 값)
  let result = await load(V512)
  if ('error' in result) result = await load(V509)
  if ('error' in result) result = await load(BASE)
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

  // 매입처 정보 — 별칭 → vendors 마스터 (담당자·연락처·이메일)
  const aliasIds = Array.from(new Set(rows.map(p => p.purchase_alias_id).filter(Boolean))) as string[]
  const aliasVendor = new Map<string, string>()
  for (let i = 0; i < aliasIds.length; i += 150) {
    const { data } = await admin.from('erp_vendor_aliases')
      .select('id, vendor_id').in('id', aliasIds.slice(i, i + 150)).not('vendor_id', 'is', null)
    for (const a of data ?? []) aliasVendor.set(a.id as string, a.vendor_id as string)
  }
  const vendorIds = Array.from(new Set(aliasVendor.values()))
  const vendorById = new Map<string, { mgr: string; tel: string; email: string }>()
  for (let i = 0; i < vendorIds.length; i += 150) {
    const { data } = await admin.from('vendors')
      .select('id, contact_name, contact_phone, email').in('id', vendorIds.slice(i, i + 150))
    for (const v of data ?? []) {
      vendorById.set(v.id as string, {
        mgr: (v.contact_name as string) ?? '',
        tel: (v.contact_phone as string) ?? '',
        email: (v.email as string) ?? '',
      })
    }
  }
  const vendorOf = (p: P) => {
    const vid = p.purchase_alias_id ? aliasVendor.get(p.purchase_alias_id) : null
    return (vid ? vendorById.get(vid) : null) ?? { mgr: '', tel: '', email: '' }
  }

  // 실무 원가표 29열 2행 헤더 그대로 (업로드 파서 왕복 호환)
  const header1 = ['*품번', '*상품명(카탈로그 표기용)', '*상품명(원가표 등록용)', '옵션명', '상태',
    '*매입처', '지점배송매입가', '개별배송매입가', '지점배송판매가', '개별배송판매가',
    '소비자가', '구성', '목차', '마진율', '카톤단위', '택배비', '',
    '재고품여부', '재고', '택배비', '카탈로그',
    '매입처담당자', '매입처연락처1', '매입처연락처2', '매입처연락처3',
    '매입처이메일1', '매입처이메일2', '매입처이메일3', '메모']
  const header2 = header1.map((_, i) => (i === 15 ? '카톤단위' : i === 16 ? '카톤외' : ''))

  const aoa: (string | number)[][] = [
    header1,
    header2,
    ...rows.map(p => {
      const v = vendorOf(p)
      // 상태: 메모 원문 우선, 없으면 플래그 기준 표기, 정상은 빈 칸 (원가표 관례)
      const status = p.status_note ?? (p.is_soldout ? '품절' : !p.is_active ? '사용중지' : '')
      return [
        p.item_code ?? '',
        p.catalog_name ?? '',
        p.item_name,
        p.option_name ?? '',
        status,
        p.purchase_vendor_name ?? '',
        p.purchase_price || 0,
        // 개별배송매입가 = 지점배송매입가 + 카톤외택배비 (파생, 참고용)
        p.purchase_price > 0 && p.loose_shipping_fee > 0 ? p.purchase_price + p.loose_shipping_fee : '',
        p.sale_price || 0,
        p.individual_sale_price || '',
        p.consumer_price ?? '',
        p.composition ?? '',
        p.category ?? '',
        // 마진율 = (지점판매가 - 지점매입가) / 지점판매가 (파생, 소수 셋째 자리)
        p.sale_price > 0 ? Math.round((p.sale_price - p.purchase_price) / p.sale_price * 1000) / 1000 : '',
        p.carton_unit ?? '',
        p.carton_shipping_fee || '',
        p.loose_shipping_fee || '',
        p.stock_flag ?? '',
        p.stock_qty ?? '',
        p.shipping_fee_extra ?? '',
        p.catalog_text ?? '',
        v.mgr, v.tel, '', '',
        v.email, '', '',
        p.memo ?? '',
      ]
    }),
  ]

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [
    { wch: 10 }, { wch: 34 }, { wch: 34 }, { wch: 12 }, { wch: 12 },
    { wch: 14 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 },
    { wch: 10 }, { wch: 30 }, { wch: 10 }, { wch: 8 }, { wch: 8 },
    { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 8 }, { wch: 8 }, { wch: 24 },
    { wch: 13 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 20 },
  ]
  // 택배비 헤더 병합 (P1:Q1) — 원가표 형식과 동일한 모양
  ws['!merges'] = [{ s: { r: 0, c: 15 }, e: { r: 0, c: 16 } }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '원가표')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())
  const filename = encodeURIComponent(`원가표_${today}.xlsx`)
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
    },
  })
}
