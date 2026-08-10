import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { ensureAlias } from '@/lib/orders-portal'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// 품목 마스터 엑셀 업로드 (manager/admin) — 회사 원가표 실물 형식 기준
//
// 원가표 형식 (시트명 '원가표', 2행 헤더):
//   카테고리 | *품번 | *상품명(카탈로그 표기용) | *상품명(원가표 등록용) | 옵션명 | *매입처 |
//   지점배송매입가 | 개별배송매입가 | 지점배송판매가 | 개별배송판매가 | 소비자가 | 구성 | 목차 |
//   마진율 | 카톤단위 | 택배비[카톤단위|카톤외] | ... | 메모
//   - 카탈로그 제작용 컬럼(카탈로그 표기용 상품명·소비자가·구성·재고·카탈로그)은 무시 (사용자 확인)
//   - 개별배송매입가는 지점매입가+카톤외택배비 파생 개념이라 저장하지 않음 (사용자 확인)
//   - '원가표' 외 시트(작업 중 페이지 등)는 무시
// 간이 형식도 지원: 품번(선택)·품명(필수)·매입처·지점판매가(판매가)·개별판매가·매입가·카톤단위·카톤배송비·카톤외택배비

function norm(name: unknown): string {
  return String(name ?? '').replace(/\s+/g, '').replace(/^\*/, '').trim()
}

function findCol(header: unknown[], ...names: string[]): number {
  const targets = names.map(n => norm(n))
  return header.findIndex(h => targets.includes(norm(h)))
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : 0
  const n = Number(String(v ?? '').replace(/,/g, '').trim())
  return Number.isFinite(n) ? Math.round(n) : 0
}

const toStr = (v: unknown): string | null => {
  const s = String(v ?? '').trim()
  return s || null
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (me.role === 'sales') {
    return NextResponse.json({ error: '품목 업로드는 관리자 권한이 필요합니다.' }, { status: 403 })
  }
  const admin = createAdminClient()

  const formData = await req.formData().catch(() => null)
  const file = formData?.get('file') as File | null
  if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())
  const wb = XLSX.read(buffer, { type: 'buffer' })

  // 시트 선택: '원가표' 시트 우선, 없으면 헤더가 인식되는 첫 시트
  let header: unknown[] | null = null
  let subHeader: unknown[] = []
  let dataRows: unknown[][] = []
  const sheetNames = wb.SheetNames.includes('원가표')
    ? ['원가표']
    : wb.SheetNames
  for (const wsName of sheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wsName], { header: 1, raw: true, defval: '' })
    const headerIdx = rows.findIndex(row =>
      // 원가표 형식: 상품명(원가표 등록용) / 간이 형식: 품명 + 판매가류
      row.some(c => norm(c).includes('상품명(원가표등록용)')) ||
      (row.some(c => norm(c) === '품명') &&
        row.some(c => ['지점판매가', '판매가', '판매가격'].includes(norm(c)))),
    )
    if (headerIdx >= 0) {
      header = rows[headerIdx]
      subHeader = rows[headerIdx + 1] ?? []   // 택배비 서브헤더(카톤단위/카톤외) 행
      // 서브헤더 행이 실제 데이터인 경우(간이 형식)를 구분: 카톤단위/카톤외 문자가 있으면 서브헤더
      const isSubHeader = subHeader.some(c => ['카톤단위', '카톤외'].includes(norm(c)))
      dataRows = rows.slice(headerIdx + (isSubHeader ? 2 : 1))
      if (!isSubHeader) subHeader = []
      break
    }
  }
  if (!header) {
    return NextResponse.json(
      { error: '인식할 수 없는 파일 형식입니다. 원가표 시트(품번·상품명(원가표 등록용)·매입처...) 또는 품명·판매가 컬럼이 있는 엑셀을 업로드해주세요.' },
      { status: 400 },
    )
  }

  const col = {
    code:     findCol(header, '품번', '상품코드', '품목코드'),
    name:     findCol(header, '상품명(원가표등록용)', '품명', '상품명', '품목명'),
    option:   findCol(header, '옵션명'),
    vendor:   findCol(header, '매입처', '매입처이름', '매입처명'),
    purchase: findCol(header, '지점배송매입가', '매입가', '매입가격'),
    sale:     findCol(header, '지점배송판매가', '지점판매가', '판매가', '판매가격'),
    indiv:    findCol(header, '개별배송판매가', '개별판매가', '개별가'),
    category: findCol(header, '목차', '분류'),
    carton:   findCol(header, '카톤단위', '카톤당수량', '카톤수량', '카톤입수', '카톤'),
    memo:     findCol(header, '메모'),
  }
  // 택배비 2종: 헤더의 첫 '택배비' 컬럼 + 서브헤더(카톤단위/카톤외)로 판별.
  // 서브헤더 없는 간이 형식은 '카톤배송비'/'카톤외택배비' 명시 컬럼 사용.
  let cartonFeeCol = findCol(header, '카톤배송비', '박스배송비')
  let looseFeeCol = findCol(header, '카톤외택배비', '낱개택배비', '개별택배비')
  if (cartonFeeCol < 0) {
    const feeIdx = header.findIndex(h => norm(h) === '택배비')
    if (feeIdx >= 0) {
      if (norm(subHeader[feeIdx]) === '카톤단위') cartonFeeCol = feeIdx
      if (norm(subHeader[feeIdx + 1]) === '카톤외') looseFeeCol = feeIdx + 1
      if (cartonFeeCol < 0) cartonFeeCol = feeIdx    // 서브헤더 없으면 단일 택배비=카톤 택배비
    }
  }

  if (col.name < 0 || col.vendor < 0) {
    return NextResponse.json({ error: '상품명·매입처 컬럼을 찾지 못했습니다.' }, { status: 400 })
  }

  type Row = {
    item_code: string | null; item_name: string; option_name: string | null
    purchase_vendor_name: string | null; category: string | null
    sale_price: number; individual_sale_price: number; purchase_price: number
    carton_unit: number | null; carton_shipping_fee: number; loose_shipping_fee: number
    memo: string | null
  }
  const parsed: Row[] = []
  let skipped = 0
  const seenCodes = new Set<string>()
  for (const row of dataRows) {
    const name = toStr(row[col.name])
    if (!name) { skipped++; continue }
    const code = col.code >= 0 ? toStr(row[col.code]) : null
    if (code) {
      if (seenCodes.has(code)) { skipped++; continue }   // 파일 내 품번 중복은 첫 행만
      seenCodes.add(code)
    }
    const cartonUnit = col.carton >= 0 ? toNumber(row[col.carton]) : 0
    // 원가표의 자리 채움 값('1'/'0')은 메모로 취급하지 않음
    const memoRaw = col.memo >= 0 ? toStr(row[col.memo]) : null
    parsed.push({
      item_code: code,
      item_name: name,
      option_name: col.option >= 0 ? toStr(row[col.option]) : null,
      purchase_vendor_name: col.vendor >= 0 ? toStr(row[col.vendor]) : null,
      category: col.category >= 0 ? toStr(row[col.category]) : null,
      sale_price: col.sale >= 0 ? toNumber(row[col.sale]) : 0,
      individual_sale_price: col.indiv >= 0 ? toNumber(row[col.indiv]) : 0,
      purchase_price: col.purchase >= 0 ? toNumber(row[col.purchase]) : 0,
      carton_unit: cartonUnit > 0 ? cartonUnit : null,
      carton_shipping_fee: cartonFeeCol >= 0 ? toNumber(row[cartonFeeCol]) : 0,
      loose_shipping_fee: looseFeeCol >= 0 ? toNumber(row[looseFeeCol]) : 0,
      memo: memoRaw && !/^[01]$/.test(memoRaw) ? memoRaw : null,
    })
  }
  if (!parsed.length) {
    return NextResponse.json({ error: '가져올 수 있는 행이 없습니다.', skipped }, { status: 400 })
  }

  // 원가표 검증 규칙: 개별판매가 = 지점판매가 + 카톤외택배비 — 어긋난 행은 수 집계(참고 보고)
  const relationMismatch = parsed.filter(r =>
    r.individual_sale_price > 0 && r.sale_price > 0 && r.loose_shipping_fee > 0 &&
    r.individual_sale_price !== r.sale_price + r.loose_shipping_fee,
  ).length

  // 매입처 별칭 일괄 확보
  const aliasByName = new Map<string, string | null>()
  for (const name of Array.from(new Set(parsed.map(r => r.purchase_vendor_name).filter(Boolean))) as string[]) {
    aliasByName.set(name, await ensureAlias(admin, 'purchase', name))
  }

  // 기존 품목 로드 (품번 / 품명+매입처 매칭)
  const existing = await fetchAllRows<{ id: string; item_code: string | null; item_name: string; purchase_vendor_name: string | null }>(
    (from, to) => admin.from('erp_products')
      .select('id, item_code, item_name, purchase_vendor_name').range(from, to),
  )
  if ('error' in existing) {
    const missing = /relation|erp_products|does not exist/i.test(existing.error)
    return NextResponse.json({
      error: missing ? '500 마이그레이션(품목 마스터)이 아직 적용되지 않았습니다.' : existing.error,
    }, { status: 500 })
  }
  const byCode = new Map(existing.data.filter(p => p.item_code).map(p => [p.item_code as string, p.id]))
  const byNameVendor = new Map(existing.data.map(p => [`${p.item_name}|${p.purchase_vendor_name ?? ''}`, p.id]))

  let created = 0, updated = 0
  const CHUNK = 200
  const inserts: Record<string, unknown>[] = []
  for (const r of parsed) {
    const fields = {
      item_code: r.item_code,
      item_name: r.item_name,
      option_name: r.option_name,
      purchase_vendor_name: r.purchase_vendor_name,
      purchase_alias_id: r.purchase_vendor_name ? (aliasByName.get(r.purchase_vendor_name) ?? null) : null,
      category: r.category,
      sale_price: r.sale_price,
      individual_sale_price: r.individual_sale_price,
      purchase_price: r.purchase_price,
      carton_unit: r.carton_unit,
      carton_shipping_fee: r.carton_shipping_fee,
      loose_shipping_fee: r.loose_shipping_fee,
      memo: r.memo,
    }
    const existingId = r.item_code
      ? byCode.get(r.item_code)
      : byNameVendor.get(`${r.item_name}|${r.purchase_vendor_name ?? ''}`)
    if (existingId) {
      const { error } = await admin.from('erp_products').update(fields).eq('id', existingId)
      if (error) return NextResponse.json({ error: `품목 갱신 실패: ${error.message}` }, { status: 500 })
      updated++
    } else {
      inserts.push(fields)
    }
  }
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const { error } = await admin.from('erp_products').insert(inserts.slice(i, i + CHUNK))
    if (error) {
      const missing = /column|loose_shipping_fee|category|option_name/i.test(error.message)
      return NextResponse.json({
        error: missing ? '503 마이그레이션(카톤외택배비·분류)이 아직 적용되지 않았습니다.' : `품목 등록 실패: ${error.message}`,
      }, { status: 500 })
    }
    created += Math.min(CHUNK, inserts.length - i)
  }

  return NextResponse.json({
    total_rows: dataRows.length, parsed: parsed.length, created, updated, skipped,
    relation_mismatch: relationMismatch,   // 개별판매가 ≠ 지점판매가+카톤외택배비 행 수 (참고)
  })
}
