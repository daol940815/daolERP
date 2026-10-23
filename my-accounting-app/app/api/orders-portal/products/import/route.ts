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
// 원가표 완전 왕복 (512, B안 — 2026-10-01 사용자 확정):
//   *품번 | *상품명(카탈로그 표기용) | *상품명(원가표 등록용) | 옵션명 | 상태 | *매입처 |
//   지점배송매입가 | 개별배송매입가 | 지점배송판매가 | 개별배송판매가 | 소비자가 | 구성 | 목차 |
//   마진율 | 카톤단위 | 택배비[카톤단위|카톤외] | 재고품여부 | 재고 | 택배비(보조) | 카탈로그 |
//   매입처담당자 | 매입처연락처1~3 | 매입처이메일1~3 | 메모
//   - 카탈로그 컬럼들(표기용 상품명·소비자가·구성·카탈로그·재고)도 저장해 다운로드로 재생성
//   - 개별배송매입가·마진율은 파생값이라 저장하지 않음 (다운로드 시 계산)
//   - 상태: 자유 메모 원문 보존. '품절' 시작 → 품절 / '단종'·'사용중지' 시작 → 사용중지 /
//     그 외(빈 칸 포함) → 사용. 상태 컬럼이 있는 파일은 빈 칸 = 정상(메모 삭제)
//   - 매입처 담당자·연락처1·이메일1은 매입처 마스터(vendors)에 반영 — 값 있으면 갱신, 빈 값 보존
//   - 자리 채움 값('1'/'0')은 텍스트 칸에서 빈 값으로 취급
//   - '원가표' 시트 우선, 없으면 헤더가 인식되는 첫 시트 ('단가변동' 등 무시)
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

// 원가표의 자리 채움 값('1'/'0')은 빈 값으로 취급 (메모·연락처·이메일 등 텍스트 칸)
const cleanStr = (v: unknown): string | null => {
  const s = toStr(v)
  return s && !/^[01]$/.test(s) ? s : null
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
    // ── 원가표 왕복 컬럼 (512) ──
    catalogName: findCol(header, '상품명(카탈로그표기용)', '카탈로그표기용상품명'),
    consumer:    findCol(header, '소비자가'),
    composition: findCol(header, '구성'),
    catalogText: findCol(header, '카탈로그'),
    stockFlag:   findCol(header, '재고품여부'),
    stockQty:    findCol(header, '재고'),
    // 매입처 정보 — 품목이 아니라 매입처 마스터(vendors)로 반영
    vendorMgr:   findCol(header, '매입처담당자'),
    vendorTel:   findCol(header, '매입처연락처1', '매입처연락처'),
    vendorEmail: findCol(header, '매입처이메일1', '매입처이메일'),
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
  // 원가표의 보조 택배비 열 (서브헤더 없는 두 번째 '택배비') — 왕복 보존용
  const fee2Col = header.reduce<number>((acc, h, i) =>
    norm(h) === '택배비' && i !== cartonFeeCol && i !== looseFeeCol ? i : acc, -1)

  if (col.name < 0 || col.vendor < 0) {
    return NextResponse.json({ error: '상품명·매입처 컬럼을 찾지 못했습니다.' }, { status: 400 })
  }

  // ── 품절·상태 해석 ──────────────────────────────────
  // '품절' 컬럼(구 다운로드 양식): Y·O·1·품절 → 품절 / X·N·0·해제 → 해제, 빈 칸 = 변경 안 함
  const soldoutCol = findCol(header, '품절')
  const parseSoldout = (v: unknown): boolean | null => {
    const s = norm(v).toLowerCase()
    if (!s) return null
    if (['y', 'o', '1', 'true', '품절'].includes(s)) return true
    if (['x', 'n', '0', 'false', '해제', '정상'].includes(s)) return false
    return null
  }
  // '상태' 컬럼(원가표): 자유 메모 원문 보존 + 시작 일치로 판정 (2026-10-01 사용자 확정)
  //  '품절...' → 품절 / '단종...'·'사용중지...'·'중지...' → 사용중지 / 그 외(빈 칸 포함) → 사용.
  //  상태 컬럼이 있는 파일이 원본이므로 빈 칸 = 정상 판매 + 기존 메모 삭제.
  //  '블랙 품절'·'재고소진 후 단종예정' 같은 메모는 사용 판정 + 원문 표시 (실데이터 151건 검증)
  const activeCol = findCol(header, '상태')
  const parseStatus = (v: unknown): { note: string | null; soldout: boolean; active: boolean } => {
    const note = cleanStr(v)
    const t = (note ?? '').trim()
    return {
      note,
      soldout: t.startsWith('품절'),
      active: !(t.startsWith('단종') || t.startsWith('사용중지') || t.startsWith('중지')),
    }
  }

  type Row = {
    item_code: string | null; item_name: string; option_name: string | null
    purchase_vendor_name: string | null; category: string | null
    sale_price: number; individual_sale_price: number; purchase_price: number
    carton_unit: number | null; carton_shipping_fee: number; loose_shipping_fee: number
    is_addon: boolean; memo: string | null
    is_soldout: boolean | null; is_active: boolean | null; status_note: string | null   // null 플래그 = 변경 안 함
    catalog_name: string | null; consumer_price: number | null; composition: string | null
    catalog_text: string | null; stock_flag: string | null; stock_qty: number | null
    shipping_fee_extra: number | null
  }
  const parsed: Row[] = []
  const vendorInfo = new Map<string, { mgr: string | null; tel: string | null; email: string | null }>()
  let skipped = 0, statusMarked = 0
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
    // 부가상품 자동 표시: 품번 XX-01 대역(기타 부자재 페이지), VIP·선결제 제외 — 화면에서 수정 가능
    const isAddon = !!code && /^\d{2}-01(-|$)/.test(code) && !['VIP', '선결제'].includes(name)

    // 상태 판정 — '상태' 컬럼이 있으면 모든 행 확정(빈 칸=사용), '품절' 컬럼은 명시 값 우선
    const st = activeCol >= 0 ? parseStatus(row[activeCol]) : null
    if (st?.note || (soldoutCol >= 0 && parseSoldout(row[soldoutCol]) != null)) statusMarked++
    const soldoutExplicit = soldoutCol >= 0 ? parseSoldout(row[soldoutCol]) : null

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
      is_addon: isAddon,
      memo: col.memo >= 0 ? cleanStr(row[col.memo]) : null,
      is_soldout: soldoutExplicit ?? (st ? st.soldout : null),
      is_active: st ? st.active : null,
      status_note: st ? st.note : null,
      catalog_name: col.catalogName >= 0 ? cleanStr(row[col.catalogName]) : null,
      consumer_price: col.consumer >= 0 && toStr(row[col.consumer]) != null ? toNumber(row[col.consumer]) : null,
      composition: col.composition >= 0 ? cleanStr(row[col.composition]) : null,
      catalog_text: col.catalogText >= 0 ? cleanStr(row[col.catalogText]) : null,
      stock_flag: col.stockFlag >= 0 ? cleanStr(row[col.stockFlag]) : null,
      stock_qty: col.stockQty >= 0 && toStr(row[col.stockQty]) != null ? toNumber(row[col.stockQty]) : null,
      shipping_fee_extra: fee2Col >= 0 && toStr(row[fee2Col]) != null ? toNumber(row[fee2Col]) : null,
    })
    // 매입처 정보: 매입처별 첫 유효 값 (자리 채움 '1'/'0' 제외)
    const vName = parsed[parsed.length - 1].purchase_vendor_name
    if (vName && (col.vendorMgr >= 0 || col.vendorTel >= 0 || col.vendorEmail >= 0)) {
      const cur = vendorInfo.get(vName) ?? { mgr: null, tel: null, email: null }
      vendorInfo.set(vName, {
        mgr: cur.mgr ?? (col.vendorMgr >= 0 ? cleanStr(row[col.vendorMgr]) : null),
        tel: cur.tel ?? (col.vendorTel >= 0 ? cleanStr(row[col.vendorTel]) : null),
        email: cur.email ?? (col.vendorEmail >= 0 ? cleanStr(row[col.vendorEmail]) : null),
      })
    }
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

  // 기존 품목 로드 — 전 컬럼 비교로 "바뀐 행만" 갱신 (원가표 전체 재업로드가 일상이 되므로)
  type ExistingRow = Record<string, unknown> & { id: string }
  const BASE_COLS = 'id, item_code, item_name, option_name, purchase_vendor_name, purchase_alias_id, category, sale_price, individual_sale_price, purchase_price, carton_unit, carton_shipping_fee, loose_shipping_fee, is_addon, memo'
  const V509 = `${BASE_COLS}, is_soldout, is_active`
  const V512 = `${V509}, status_note, catalog_name, consumer_price, composition, catalog_text, stock_flag, stock_qty, shipping_fee_extra`
  let has512 = true, has509 = true
  let existing = await fetchAllRows<ExistingRow>(
    (from, to) => admin.from('erp_products').select(V512).range(from, to) as unknown as PromiseLike<{ data: ExistingRow[] | null; error: { message: string } | null }>,
  )
  if ('error' in existing) {
    has512 = false
    existing = await fetchAllRows<ExistingRow>(
      (from, to) => admin.from('erp_products').select(V509).range(from, to) as unknown as PromiseLike<{ data: ExistingRow[] | null; error: { message: string } | null }>,
    )
  }
  if ('error' in existing) {
    has509 = false
    existing = await fetchAllRows<ExistingRow>(
      (from, to) => admin.from('erp_products').select(`${BASE_COLS}, is_active`).range(from, to) as unknown as PromiseLike<{ data: ExistingRow[] | null; error: { message: string } | null }>,
    )
  }
  if ('error' in existing) {
    const missing = /relation|erp_products|does not exist/i.test(existing.error)
    return NextResponse.json({
      error: missing ? '500 마이그레이션(품목 마스터)이 아직 적용되지 않았습니다.' : existing.error,
    }, { status: 500 })
  }
  // 원가표 형식(512 컬럼 포함)인데 512 미적용이면 안내 — 반쪽 반영 방지
  const needs512 = col.catalogName >= 0 || col.consumer >= 0 || col.composition >= 0
  if (needs512 && !has512) {
    return NextResponse.json({
      error: '512 마이그레이션(원가표 왕복)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.',
    }, { status: 400 })
  }
  const byId = new Map(existing.data.map(p => [p.id, p]))
  const byCode = new Map(existing.data.filter(p => p.item_code).map(p => [p.item_code as string, p.id]))
  const byNameVendor = new Map(existing.data.map(p => [`${p.item_name}|${p.purchase_vendor_name ?? ''}`, p.id]))

  let created = 0, updated = 0, unchanged = 0
  const CHUNK = 200
  const inserts: Record<string, unknown>[] = []
  const updates: { id: string; fields: Record<string, unknown> }[] = []
  for (const r of parsed) {
    const fields: Record<string, unknown> = {
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
      is_addon: r.is_addon,
      memo: r.memo,
      // 상태 — 컬럼이 있는 파일만 반영 (키 존재 여부는 파일 단위로 균일해야 bulk insert 가능)
      ...(has509 && (soldoutCol >= 0 || activeCol >= 0) ? { is_soldout: r.is_soldout ?? false } : {}),
      ...(activeCol >= 0 ? { is_active: r.is_active ?? true } : {}),
      ...(has512 && activeCol >= 0 ? { status_note: r.status_note } : {}),
      // 원가표 왕복 컬럼 (512) — 해당 컬럼이 있는 파일만
      ...(has512 && col.catalogName >= 0 ? { catalog_name: r.catalog_name } : {}),
      ...(has512 && col.consumer >= 0 ? { consumer_price: r.consumer_price } : {}),
      ...(has512 && col.composition >= 0 ? { composition: r.composition } : {}),
      ...(has512 && col.catalogText >= 0 ? { catalog_text: r.catalog_text } : {}),
      ...(has512 && col.stockFlag >= 0 ? { stock_flag: r.stock_flag } : {}),
      ...(has512 && col.stockQty >= 0 ? { stock_qty: r.stock_qty } : {}),
      ...(has512 && fee2Col >= 0 ? { shipping_fee_extra: r.shipping_fee_extra } : {}),
    }
    const existingId = r.item_code
      ? byCode.get(r.item_code)
      : byNameVendor.get(`${r.item_name}|${r.purchase_vendor_name ?? ''}`)
    if (existingId) {
      // 값이 전부 같으면 갱신 생략 — 구 양식('품절' 컬럼) 빈 칸은 "변경 안 함"이라 비교에서 제외
      const prev = byId.get(existingId)
      const compare = { ...fields }
      if (soldoutCol >= 0 && activeCol < 0 && r.is_soldout == null) delete compare.is_soldout
      const changed = Object.entries(compare).some(([k, v]) => {
        const old = prev?.[k]
        return (old ?? null) !== (v ?? null)
      })
      if (changed) updates.push({ id: existingId, fields: compare })
      else unchanged++
    } else {
      inserts.push(fields)
    }
  }

  // 갱신 — 20개 병렬 청크 (2천여 행 전체 재업로드 대비)
  for (let i = 0; i < updates.length; i += 20) {
    const results = await Promise.all(updates.slice(i, i + 20).map(u =>
      admin.from('erp_products').update(u.fields).eq('id', u.id),
    ))
    const err = results.find(res => res.error)?.error
    if (err) {
      return NextResponse.json({
        error: /status_note|catalog_name|consumer_price/i.test(err.message)
          ? '512 마이그레이션(원가표 왕복)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
          : /is_soldout/i.test(err.message)
            ? '509 마이그레이션(품절)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
            : `품목 갱신 실패: ${err.message}`,
      }, { status: 500 })
    }
    updated += Math.min(20, updates.length - i)
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

  // ── 매입처 마스터 반영 (2026-10-01 확정): 값 있으면 갱신, 빈 값은 보존 ──
  let vendorUpdated = 0
  const vendorWarnings: string[] = []
  if (vendorInfo.size) {
    const aliasIds = Array.from(vendorInfo.keys())
      .map(n => aliasByName.get(n)).filter(Boolean) as string[]
    const aliasVendor = new Map<string, string>()   // alias id → vendor id
    for (let i = 0; i < aliasIds.length; i += 150) {
      const { data } = await admin.from('erp_vendor_aliases')
        .select('id, vendor_id').in('id', aliasIds.slice(i, i + 150)).not('vendor_id', 'is', null)
      for (const a of data ?? []) aliasVendor.set(a.id as string, a.vendor_id as string)
    }
    const vendorIds = Array.from(new Set(aliasVendor.values()))
    const vendorRows = new Map<string, { contact_name: string | null; contact_phone: string | null; email: string | null }>()
    for (let i = 0; i < vendorIds.length; i += 150) {
      const { data } = await admin.from('vendors')
        .select('id, contact_name, contact_phone, email').in('id', vendorIds.slice(i, i + 150))
      for (const v of data ?? []) {
        vendorRows.set(v.id as string, {
          contact_name: (v.contact_name as string) ?? null,
          contact_phone: (v.contact_phone as string) ?? null,
          email: (v.email as string) ?? null,
        })
      }
    }
    for (const [name, info] of Array.from(vendorInfo.entries())) {
      const aliasId = aliasByName.get(name)
      const vendorId = aliasId ? aliasVendor.get(aliasId) : null
      if (!vendorId) {
        if (info.mgr || info.tel || info.email) vendorWarnings.push(name)   // 매입처 마스터 미연결 — 반영 불가
        continue
      }
      const cur = vendorRows.get(vendorId)
      const patch: Record<string, string> = {}
      if (info.mgr && info.mgr !== cur?.contact_name) patch.contact_name = info.mgr
      if (info.tel && info.tel !== cur?.contact_phone) patch.contact_phone = info.tel
      if (info.email && info.email !== cur?.email) patch.email = info.email
      if (Object.keys(patch).length) {
        const { error } = await admin.from('vendors').update(patch).eq('id', vendorId)
        if (!error) vendorUpdated++
      }
    }
  }

  return NextResponse.json({
    total_rows: dataRows.length, parsed: parsed.length, created, updated, unchanged, skipped,
    status_marked: statusMarked,           // 상태·품절 표기가 있는 행 수 (원문 메모 포함)
    vendor_updated: vendorUpdated,         // 매입처 마스터(담당자·연락처·이메일) 갱신 수
    vendor_unlinked: vendorWarnings.length,   // 매입처 마스터 미연결로 반영 못한 매입처 수
    relation_mismatch: relationMismatch,   // 개별판매가 ≠ 지점판매가+카톤외택배비 행 수 (참고)
  })
}
