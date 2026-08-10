import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { ensureAlias } from '@/lib/orders-portal'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// 품목 마스터 엑셀 업로드 (manager/admin)
// 컬럼: 품번(선택) · 품명(필수) · 매입처 · 판매가 · 매입가
//  - 품번이 있으면 품번 기준 갱신(upsert), 없으면 품명+매입처 동일 행이 없을 때만 신규
//  - 헤더 행 자동 탐지 — 기존 주문 업로드 파서와 같은 방식

function norm(name: unknown): string {
  return String(name ?? '').replace(/\s+/g, '').trim()
}

function findCol(header: unknown[], ...names: string[]): number {
  const targets = names.map(norm)
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

  let header: unknown[] | null = null
  let dataRows: unknown[][] = []
  for (const wsName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wsName], { header: 1, raw: true, defval: '' })
    const headerIdx = rows.findIndex(row =>
      row.some(c => norm(c) === '품명') &&
      row.some(c => ['판매가', '판매가격'].includes(norm(c))),
    )
    if (headerIdx >= 0) {
      header = rows[headerIdx]
      dataRows = rows.slice(headerIdx + 1)
      break
    }
  }
  if (!header) {
    return NextResponse.json(
      { error: '인식할 수 없는 파일 형식입니다. 품명·판매가 컬럼이 있는 상품 엑셀을 업로드해주세요.' },
      { status: 400 },
    )
  }

  const col = {
    code:     findCol(header, '품번', '상품코드', '품목코드'),
    name:     findCol(header, '품명', '상품명', '품목명'),
    purchase: findCol(header, '매입처', '매입처이름', '매입처명'),
    sale:     findCol(header, '판매가', '판매가격'),
    cost:     findCol(header, '매입가', '매입가격'),
  }

  type Row = { item_code: string | null; item_name: string; purchase_vendor_name: string | null; sale_price: number; purchase_price: number }
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
    parsed.push({
      item_code: code,
      item_name: name,
      purchase_vendor_name: col.purchase >= 0 ? toStr(row[col.purchase]) : null,
      sale_price: col.sale >= 0 ? toNumber(row[col.sale]) : 0,
      purchase_price: col.cost >= 0 ? toNumber(row[col.cost]) : 0,
    })
  }
  if (!parsed.length) {
    return NextResponse.json({ error: '가져올 수 있는 행이 없습니다.', skipped }, { status: 400 })
  }

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
      purchase_vendor_name: r.purchase_vendor_name,
      purchase_alias_id: r.purchase_vendor_name ? (aliasByName.get(r.purchase_vendor_name) ?? null) : null,
      sale_price: r.sale_price,
      purchase_price: r.purchase_price,
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
    if (error) return NextResponse.json({ error: `품목 등록 실패: ${error.message}` }, { status: 500 })
    created += Math.min(CHUNK, inserts.length - i)
  }

  return NextResponse.json({ total_rows: dataRows.length, parsed: parsed.length, created, updated, skipped })
}
