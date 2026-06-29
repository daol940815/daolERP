import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// ERP 주문 파일 식별용 필수 컬럼 (두 가지 다운로드 형식 공통)
const REQUIRED_COLS = ['주문번호', '주문일', '품명', '매입처이름', '합계금액', '총금액']

// 컬럼명 정규화: 공백 제거 ('책임자 연락처' ↔ '책임자연락처' 차이 흡수)
function norm(name: unknown): string {
  return String(name ?? '').replace(/\s+/g, '').trim()
}

function findCol(header: unknown[], ...names: string[]): number {
  const targets = names.map(norm)
  return header.findIndex(h => targets.includes(norm(h)))
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : 0
  const s = String(v ?? '').replace(/,/g, '').trim()
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : 0
}

// 주문일: Date 객체 / 엑셀 시리얼 / 'YYYY-MM-DD' / 'M/D/YY' 모두 처리
function toDateStr(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10)
  }
  if (typeof v === 'number' && v > 20000) {
    // 엑셀 날짜 시리얼 (1900-01-00 기준)
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000)
    return d.toISOString().slice(0, 10)
  }
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) {
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${yy}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  }
  return null
}

function toStr(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return s || null
}

const STATUS_MAP: Record<string, 'collected' | 'outstanding' | 'in_progress'> = {
  '수금완료':   'collected',
  '미수금':     'outstanding',
  '수금진행중': 'in_progress',
}

const CHUNK = 500

// POST /api/erp-orders/import
// multipart/form-data: file (ERP 주문 다운로드 파일, 여러 형식 자동 인식)
export async function POST(req: NextRequest) {
  const admin = createAdminClient()

  const formData = await req.formData().catch(() => null)
  const file     = formData?.get('file') as File | null
  if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())
  const wb     = XLSX.read(buffer, { type: 'buffer', cellDates: true })

  let header:   unknown[] | null = null
  let dataRows: unknown[][]      = []

  for (const wsName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wsName], { header: 1, raw: true, defval: '' })
    const headerIdx = rows.findIndex(row =>
      REQUIRED_COLS.every(col => row.some(cell => norm(cell) === norm(col)))
    )
    if (headerIdx >= 0) {
      header   = rows[headerIdx]
      dataRows = rows.slice(headerIdx + 1)
      break
    }
  }

  if (!header) {
    return NextResponse.json(
      { error: '인식할 수 없는 파일 형식입니다. ERP에서 다운로드한 주문 파일을 업로드해주세요.' },
      { status: 400 },
    )
  }

  const col = {
    canceled:    findCol(header, '취소여부'),
    status:      findCol(header, '주문상태'),
    orderNo:     findCol(header, '주문번호'),
    orderDate:   findCol(header, '주문일'),
    bank:        findCol(header, '은행명'),
    branch:      findCol(header, '지점명'),
    manager:     findCol(header, '담당자'),
    staff:       findCol(header, '다올직원'),
    contact:     findCol(header, '연락처'),
    phone:       findCol(header, '핸드폰'),
    introducer:  findCol(header, '소개자'),
    supervisor:  findCol(header, '책임자'),
    supContact:  findCol(header, '책임자연락처', '책임자 연락처'),
    totalAmount: findCol(header, '총금액'),
    outstanding: findCol(header, '미수금'),   // 첫 번째 미수금 = 주문 단위
    orderMemo:   findCol(header, '메모'),     // 첫 번째 메모 = 주문 단위
    etc:         findCol(header, '기타'),
    itemCode:    findCol(header, '품번'),
    itemName:    findCol(header, '품명'),
    orderKind:   findCol(header, '지점/개별/샘플'),
    purchase:    findCol(header, '매입처이름'),
    salePrice:   findCol(header, '판매가'),
    qty:         findCol(header, '갯수'),
    shipping:    findCol(header, '배송비'),
    discount:    findCol(header, '할인금액'),
    lineTotal:   findCol(header, '합계금액'),
    purPrice:    findCol(header, '매입가'),
    purShipping: findCol(header, '매입배송비'),
    channel:     findCol(header, '채널', '상담자'),
  }
  // 두 번째 미수금(품목 단위) / 두 번째 메모(품목 단위): 같은 이름 컬럼의 마지막 인덱스
  const lineOutstandingCol = header.reduce<number>((acc, h, i) => norm(h) === '미수금' ? i : acc, -1)
  const itemMemoCol        = header.reduce<number>((acc, h, i) => norm(h) === '메모'   ? i : acc, -1)

  // ── 1) 행 파싱 → 주문별 그룹핑 ──────────────────────
  type ItemRow = {
    line_no: number
    is_canceled: boolean
    is_vip: boolean
    is_prepayment: boolean
    item_code: string | null
    item_name: string | null
    order_kind: string | null
    purchase_vendor_name: string | null
    sale_price: number
    quantity: number
    shipping_fee: number
    discount_amount: number
    line_total: number
    line_outstanding: number
    purchase_price: number
    purchase_shipping: number
    purchase_total: number
    channel: string | null
    memo: string | null
  }
  type OrderGroup = {
    order_no: string
    order_date: string
    bank_name: string | null
    branch_name: string | null
    manager_name: string | null
    staff_name: string | null
    contact: string | null
    phone: string | null
    introducer: string | null
    supervisor: string | null
    supervisor_contact: string | null
    total_amount: number
    outstanding_amount: number
    collect_status: 'collected' | 'outstanding' | 'in_progress'
    memo: string | null
    etc: string | null
    items: ItemRow[]
  }

  const orders = new Map<string, OrderGroup>()
  let skipped = 0

  for (const row of dataRows) {
    const orderNo   = String(row[col.orderNo] ?? '').trim()
    const orderDate = toDateStr(row[col.orderDate])
    if (!orderNo || !orderDate) { skipped++; continue }

    let g = orders.get(orderNo)
    if (!g) {
      const statusRaw = String(row[col.status] ?? '').trim()
      g = {
        order_no: orderNo,
        order_date: orderDate,
        bank_name:   toStr(row[col.bank]),
        branch_name: toStr(row[col.branch]),
        manager_name: toStr(row[col.manager]),
        staff_name:   toStr(row[col.staff]),
        contact:      toStr(row[col.contact]),
        phone:        toStr(row[col.phone]),
        introducer:   toStr(row[col.introducer]),
        supervisor:   toStr(row[col.supervisor]),
        supervisor_contact: toStr(row[col.supContact]),
        total_amount:       toNumber(row[col.totalAmount]),
        outstanding_amount: toNumber(row[col.outstanding]),
        collect_status: STATUS_MAP[statusRaw] ?? 'outstanding',
        memo: toStr(row[col.orderMemo]),
        etc:  toStr(row[col.etc]),
        items: [],
      }
      orders.set(orderNo, g)
    }

    const itemName  = toStr(row[col.itemName])
    const salePrice = toNumber(row[col.salePrice])
    const purPrice  = toNumber(row[col.purPrice])
    const qty       = toNumber(row[col.qty])
    const purShip   = toNumber(row[col.purShipping])
    const isCanceled = String(row[col.canceled] ?? '').trim().toLowerCase() === 'cancel'
    const isVip      = itemName === 'VIP' && salePrice === purPrice
    const isPrepay   = itemName === '선결제'

    g.items.push({
      line_no: g.items.length + 1,
      is_canceled: isCanceled,
      is_vip: isVip,
      is_prepayment: isPrepay,
      item_code: toStr(row[col.itemCode]),
      item_name: itemName,
      order_kind: toStr(row[col.orderKind]),
      purchase_vendor_name: toStr(row[col.purchase]),
      sale_price: salePrice,
      quantity: qty,
      shipping_fee: toNumber(row[col.shipping]),
      discount_amount: toNumber(row[col.discount]),
      line_total: toNumber(row[col.lineTotal]),
      line_outstanding: toNumber(row[lineOutstandingCol]),
      purchase_price: purPrice,
      purchase_shipping: purShip,
      purchase_total: purPrice * qty + purShip,
      channel: toStr(row[col.channel]),
      memo: toStr(row[itemMemoCol]),
    })
  }

  if (!orders.size) {
    return NextResponse.json({ error: '가져올 수 있는 데이터가 없습니다.', skipped }, { status: 400 })
  }

  // ── 2) 별칭 확보 (매출처: 은행+지점 / 매입처: 매입처이름) ──
  const customerNames = new Set<string>()
  const purchaseNames = new Set<string>()
  for (const g of Array.from(orders.values())) {
    const cname = [g.bank_name, g.branch_name].filter(Boolean).join(' ').trim()
    if (cname) customerNames.add(cname)
    for (const it of g.items) {
      if (it.purchase_vendor_name) purchaseNames.add(it.purchase_vendor_name)
    }
  }

  const aliasMap = new Map<string, string>()  // `${type}|${name}` → alias id
  const wanted = [
    ...Array.from(customerNames).map(n => ({ alias_type: 'customer', erp_name: n })),
    ...Array.from(purchaseNames).map(n => ({ alias_type: 'purchase', erp_name: n })),
  ]
  for (let i = 0; i < wanted.length; i += CHUNK) {
    const batch = wanted.slice(i, i + CHUNK)
    const { error } = await admin
      .from('erp_vendor_aliases')
      .upsert(batch, { onConflict: 'alias_type,erp_name', ignoreDuplicates: true })
    if (error) return NextResponse.json({ error: `별칭 등록 실패: ${error.message}` }, { status: 500 })
  }
  {
    // 매입처/매출처명에 괄호·쉼표·따옴표 등이 섞여 있으면 .in() 필터 구문이
    // 깨질 수 있으므로, 전체 별칭을 가져와 메모리에서 매칭한다.
    const result = await fetchAllRows<{ id: string; alias_type: string; erp_name: string }>((from, to) =>
      admin.from('erp_vendor_aliases').select('id, alias_type, erp_name').range(from, to),
    )
    if ('error' in result) return NextResponse.json({ error: `별칭 조회 실패: ${result.error}` }, { status: 500 })
    for (const a of result.data) aliasMap.set(`${a.alias_type}|${a.erp_name}`, a.id)
  }

  // ── 3) 주문 upsert ──────────────────────────────────
  const orderList = Array.from(orders.values())
  const orderRows = orderList.map(g => ({
    order_no: g.order_no,
    order_date: g.order_date,
    bank_name: g.bank_name,
    branch_name: g.branch_name,
    customer_alias_id: aliasMap.get(`customer|${[g.bank_name, g.branch_name].filter(Boolean).join(' ').trim()}`) ?? null,
    manager_name: g.manager_name,
    staff_name: g.staff_name,
    contact: g.contact,
    phone: g.phone,
    introducer: g.introducer,
    supervisor: g.supervisor,
    supervisor_contact: g.supervisor_contact,
    total_amount: g.total_amount,
    outstanding_amount: g.outstanding_amount,
    collect_status: g.collect_status,
    memo: g.memo,
    etc: g.etc,
  }))
  // 신규 vs 기존갱신(중복) — upsert 전 기존 주문번호 조회
  const existingOrderNos = new Set<string>()
  {
    const nos = orderList.map(g => g.order_no)
    for (let i = 0; i < nos.length; i += CHUNK) {
      const { data } = await admin.from('erp_orders').select('order_no').in('order_no', nos.slice(i, i + CHUNK))
      for (const o of data ?? []) existingOrderNos.add(o.order_no as string)
    }
  }

  for (let i = 0; i < orderRows.length; i += CHUNK) {
    const { error } = await admin
      .from('erp_orders')
      .upsert(orderRows.slice(i, i + CHUNK), { onConflict: 'order_no' })
    if (error) return NextResponse.json({ error: `주문 저장 실패: ${error.message}` }, { status: 500 })
  }

  // order_no → id 매핑
  const orderIdMap = new Map<string, string>()
  {
    const nos = orderList.map(g => g.order_no)
    for (let i = 0; i < nos.length; i += CHUNK) {
      const { data, error } = await admin
        .from('erp_orders')
        .select('id, order_no')
        .in('order_no', nos.slice(i, i + CHUNK))
      if (error) return NextResponse.json({ error: `주문 조회 실패: ${error.message}` }, { status: 500 })
      for (const o of data ?? []) orderIdMap.set(o.order_no as string, o.id as string)
    }
  }

  // ── 4) 기존 품목의 정산월 보정값 보존 후 재삽입 ──────
  // 키: order_id|품번|품명|동일키 내 순번 → settlement_month
  const orderIds = Array.from(orderIdMap.values())
  const preservedMonths = new Map<string, string>()
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const { data } = await admin
      .from('erp_order_items')
      .select('order_id, item_code, item_name, line_no, settlement_month')
      .in('order_id', orderIds.slice(i, i + CHUNK))
      .order('line_no')
    const seq = new Map<string, number>()
    for (const it of data ?? []) {
      const base = `${it.order_id}|${it.item_code ?? ''}|${it.item_name ?? ''}`
      const n = (seq.get(base) ?? 0) + 1
      seq.set(base, n)
      if (it.settlement_month) preservedMonths.set(`${base}|${n}`, it.settlement_month as string)
    }
  }

  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const { error } = await admin
      .from('erp_order_items')
      .delete()
      .in('order_id', orderIds.slice(i, i + CHUNK))
    if (error) return NextResponse.json({ error: `기존 품목 삭제 실패: ${error.message}` }, { status: 500 })
  }

  const itemRows: Record<string, unknown>[] = []
  for (const g of orderList) {
    const orderId = orderIdMap.get(g.order_no)
    if (!orderId) continue
    const seq = new Map<string, number>()
    for (const it of g.items) {
      const base = `${orderId}|${it.item_code ?? ''}|${it.item_name ?? ''}`
      const n = (seq.get(base) ?? 0) + 1
      seq.set(base, n)
      itemRows.push({
        ...it,
        order_id: orderId,
        purchase_alias_id: it.purchase_vendor_name
          ? (aliasMap.get(`purchase|${it.purchase_vendor_name}`) ?? null)
          : null,
        settlement_month: preservedMonths.get(`${base}|${n}`) ?? g.order_date.slice(0, 7),
      })
    }
  }
  for (let i = 0; i < itemRows.length; i += CHUNK) {
    const { error } = await admin.from('erp_order_items').insert(itemRows.slice(i, i + CHUNK))
    if (error) return NextResponse.json({ error: `품목 저장 실패: ${error.message}` }, { status: 500 })
  }

  // ── 5) 선결제 입금 자동 등록 (멱등: source_key) ──────
  const prepayRows: Record<string, unknown>[] = []
  for (const g of orderList) {
    const orderId = orderIdMap.get(g.order_no)
    const aliasId = aliasMap.get(`customer|${[g.bank_name, g.branch_name].filter(Boolean).join(' ').trim()}`)
    if (!orderId || !aliasId) continue
    let occ = 0
    for (const it of g.items) {
      if (!it.is_prepayment || it.is_canceled || it.line_total <= 0) continue
      occ += 1
      prepayRows.push({
        direction: 'customer',
        alias_id: aliasId,
        entry_date: g.order_date,
        entry_type: 'deposit',
        amount: it.line_total,
        order_id: orderId,
        source_key: `pre:${g.order_no}:${occ}`,
        memo: '업로드 자동 등록 (품명: 선결제)',
      })
    }
  }
  for (let i = 0; i < prepayRows.length; i += CHUNK) {
    const { error } = await admin
      .from('erp_prepayments')
      .upsert(prepayRows.slice(i, i + CHUNK), { onConflict: 'source_key' })
    if (error) return NextResponse.json({ error: `선결제 등록 실패: ${error.message}` }, { status: 500 })
  }

  const updated = existingOrderNos.size
  const created = orderList.length - updated

  return NextResponse.json({
    imported_orders: orderList.length,
    created,
    updated,
    imported_items: itemRows.length,
    prepay_deposits: prepayRows.length,
    skipped,
    total_rows: dataRows.length,
  })
}
