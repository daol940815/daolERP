import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 품목 마스터 엑셀 다운로드 — 실무 원가표 29열 + 서식 완전 재현 (2026-10-02 사용자 확정).
// 원본 파일에서 셀 단위로 추출한 서식(헤더 색 구분·세로 병합 2행 헤더·열 너비·행 높이·
// 자동 필터·틀 고정·회계 표시형식·상품 그룹 병합)을 exceljs로 그대로 만든다.
//  - 상품 그룹 병합: 카탈로그 표기용 상품명(B)·구성(L)은 옵션 행들에 걸쳐 세로 병합 —
//    첫 행에만 값이 있는 저장 구조를 그대로 병합으로 복원 (품번순 정렬 전제)
//  - 수기 강조색(특정 행에 칠한 녹색·노랑·빨강, 회색 글씨)은 데이터가 아니라 재현 불가
//  - 개별배송매입가·마진율은 파생값 — 계산해서 채움, 재업로드 시 무시
//  - 상태: 저장된 메모 원문, 메모 없이 플래그만 있으면 '품절'/'사용중지', 정상은 빈 칸
//  - 매입처 담당자·연락처1·이메일1은 매입처 마스터(vendors)에서 채움
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

// 원본 원가표에서 추출한 서식 상수 (테마색은 RGB 환산: th3 tint.75 → C3C9D0 등)
const FONT = '맑은 고딕'
const PINK = 'FFFF9999'        // 핵심 입력 열
const GRAY = 'FFC3C9D0'        // 참고·파생 열
const YELLOW = 'FFFFFF00'      // 상태·매입처 정보 열
const ORANGE = 'FFF2AA84'      // 마진율·택배비 열
const ACCT = '_-* #,##0_-;\\-* #,##0_-;_-* "-"_-;_-@_-'
// 열별 정의: [헤더 1행 문구, 너비, 헤더 배경, 데이터 표시형식, 데이터 정렬]
const COLS: [string, number, string, string | null, 'left' | 'center'][] = [
  ['*품번', 15.5, PINK, null, 'center'],
  ['*상품명(카탈로그 표기용)', 47.75, GRAY, null, 'left'],
  ['*상품명(원가표 등록용)', 51.25, PINK, null, 'left'],
  ['옵션명', 10.62, PINK, null, 'center'],
  ['상태', 13.88, YELLOW, null, 'center'],
  ['*매입처', 11, PINK, null, 'center'],
  ['지점배송\n매입가', 9.01, PINK, ACCT, 'center'],
  ['개별배송\n매입가', 9.01, PINK, ACCT, 'center'],
  ['지점배송\n판매가', 9.01, GRAY, ACCT, 'center'],
  ['개별배송\n판매가', 9.01, PINK, ACCT, 'center'],
  ['소비자가', 10, GRAY, ACCT, 'center'],
  ['구성', 34.88, GRAY, null, 'left'],
  ['목차', 10.62, GRAY, null, 'center'],
  ['마진율', 9.01, ORANGE, '0.0%', 'center'],
  ['카톤단위', 9.01, GRAY, null, 'center'],
  ['택배비', 13, ORANGE, ACCT, 'center'],
  ['', 13, ORANGE, ACCT, 'center'],
  ['재고품여부', 9.01, PINK, null, 'center'],
  ['재고', 13, PINK, null, 'center'],
  ['택배비', 13, PINK, null, 'center'],
  ['카탈로그', 12.62, PINK, null, 'left'],
  ['매입처\n담당자', 13.88, YELLOW, null, 'center'],
  ['매입처\n연락처1', 12, YELLOW, null, 'center'],
  ['매입처\n연락처2', 16.5, YELLOW, null, 'center'],
  ['매입처\n연락처3', 9.01, YELLOW, null, 'center'],
  ['매입처\n이메일1', 18.88, YELLOW, null, 'center'],
  ['매입처\n이메일2', 9.01, YELLOW, null, 'center'],
  ['매입처\n이메일3', 13, YELLOW, null, 'center'],
  ['메모', 13, YELLOW, null, 'left'],
]

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

  // ── exceljs로 원본 서식 재현 ──────────────────────────
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('원가표', {
    views: [{ state: 'frozen', ySplit: 2 }],   // 헤더 2행 틀 고정
    properties: { defaultRowHeight: 13.5 },
  })
  ws.columns = COLS.map(([, w]) => ({ width: w }))
  const thin = { style: 'thin' as const }
  const box = { top: thin, bottom: thin, left: thin, right: thin }
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })

  // 헤더 2행: 세로 병합 (택배비만 1행 가로 병합 + 2행 카톤단위/카톤외 서브헤더)
  ws.getRow(1).height = 20.1
  ws.getRow(2).height = 20.1
  COLS.forEach(([label, , bg], i) => {
    const c = i + 1
    if (c === 16) { ws.mergeCells(1, 16, 1, 17) }        // 택배비 P1:Q1
    else if (c !== 17) ws.mergeCells(1, c, 2, c)         // 나머지 열은 1~2행 세로 병합
    const targets = c === 16 ? [ws.getCell(1, 16), ws.getCell(2, 16)]
      : c === 17 ? [ws.getCell(2, 17)]
      : [ws.getCell(1, c)]
    const values = c === 16 ? [label, '카톤단위'] : c === 17 ? ['카톤외'] : [label]
    targets.forEach((cell, j) => {
      cell.value = values[j]
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FF000000' } }
      cell.fill = fill(bg)
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    })
    for (let r = 1; r <= 2; r++) ws.getCell(r, c).border = box
  })
  ws.autoFilter = 'A2:AC2'

  // 데이터 행
  rows.forEach((p, i) => {
    const r = i + 3
    ws.getRow(r).height = 20.1
    const v = vendorOf(p)
    const status = p.status_note ?? (p.is_soldout ? '품절' : !p.is_active ? '사용중지' : '')
    const values: (string | number)[] = [
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
      // 마진율 = (지점판매가 - 지점매입가) / 지점판매가 (파생)
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
    values.forEach((val, ci) => {
      const cell = ws.getCell(r, ci + 1)
      cell.value = val
      cell.font = { name: FONT, size: 10, color: { argb: 'FF000000' } }
      cell.alignment = { horizontal: COLS[ci][4], vertical: 'middle' }
      const fmt = COLS[ci][3]
      if (fmt) cell.numFmt = fmt
    })
  })

  // 상품 그룹 병합: 카탈로그 표기용 상품명(B)·구성(L)은 값이 있는 행부터
  // 다음 값 전까지의 옵션 행들을 세로 병합 (원본 원가표와 동일한 모양)
  for (const colIdx of [2, 12]) {
    let start = -1
    const valAt = (i: number) => colIdx === 2 ? rows[i].catalog_name : rows[i].composition
    for (let i = 0; i <= rows.length; i++) {
      const has = i < rows.length && !!valAt(i)
      if (has || i === rows.length) {
        if (start >= 0 && i - start > 1) {
          ws.mergeCells(start + 3, colIdx, i + 2, colIdx)
          ws.getCell(start + 3, colIdx).alignment = { horizontal: 'left', vertical: 'middle' }
        }
        start = has ? i : -1
      } else if (start < 0) {
        start = -1   // 값 없는 행으로 시작하는 구간은 병합하지 않음
      }
    }
  }

  const buf = Buffer.from(await wb.xlsx.writeBuffer())
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())
  const filename = encodeURIComponent(`원가표_${today}.xlsx`)
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
    },
  })
}
