import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { getCurrentUser } from '@/lib/user-role'

const MIGRATION_801_MSG =
  '입력 계정 로그 컬럼이 없습니다. SQL 편집기에서 801_sample_stock_created_by.sql을 실행해 주세요.'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface LedgerRow {
  id: string
  move_date: string
  move_type: string
  product_id: string | null
  item_name_raw: string | null
  quantity: number
  unit_cost: number | null
  total_cost: number | null
  purpose: string | null
  dest_name: string | null
  staff_name: string | null
  employee_id: string | null
  note: string | null
  source: string
  created_by_name?: string | null
}

// GET /api/sample-stock/moves — 입출고 원장 전체 (화면에서 검색·칩 필터·페이지네이션)
export async function GET() {
  const admin = createAdminClient()

  // select('*'): 801(created_by 컬럼) 적용 전후 모두 동작하도록 컬럼을 명시하지 않는다
  const movesRes = await fetchAllRows<LedgerRow>((from, to) =>
    admin
      .from('erp_sample_moves')
      .select('*')
      .order('id')
      .range(from, to),
  )
  if ('error' in movesRes) return NextResponse.json({ error: movesRes.error }, { status: 500 })

  // 품명 표시는 마스터 연결 시 마스터 표기, 아니면 원본 표기
  const productIds = Array.from(new Set(movesRes.data.map((m) => m.product_id).filter((v): v is string => !!v)))
  const nameById = new Map<string, string>()
  for (let i = 0; i < productIds.length; i += 150) {
    const { data, error } = await admin
      .from('erp_products')
      .select('id, item_name')
      .in('id', productIds.slice(i, i + 150))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    for (const p of data ?? []) nameById.set(p.id, p.item_name)
  }

  const moves = movesRes.data
    .map((m) => ({
      ...m,
      display_name: (m.product_id && nameById.get(m.product_id)) || m.item_name_raw || '(품명 없음)',
    }))
    .sort((a, b) => b.move_date.localeCompare(a.move_date) || b.id.localeCompare(a.id))

  return NextResponse.json({ moves })
}

// POST /api/sample-stock/moves — 입고/출고/조정 직접 입력 (원장이 원본 — 수정 대신 행 추가)
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: '요청 본문이 필요합니다.' }, { status: 400 })

  const moveType = body.move_type as string
  const quantity = Number(body.quantity)
  const productId = (body.product_id as string) || null
  const itemNameRaw = ((body.item_name_raw as string) || '').trim() || null

  if (!['in', 'out', 'adjust'].includes(moveType)) {
    return NextResponse.json({ error: '구분(in/out/adjust)이 올바르지 않습니다.' }, { status: 400 })
  }
  if (!body.move_date) return NextResponse.json({ error: '날짜가 필요합니다.' }, { status: 400 })
  if (!productId && !itemNameRaw) {
    return NextResponse.json({ error: '품목 선택 또는 품명 입력이 필요합니다.' }, { status: 400 })
  }
  if (!Number.isInteger(quantity) || (moveType === 'adjust' ? quantity === 0 : quantity <= 0)) {
    return NextResponse.json(
      { error: moveType === 'adjust' ? '조정 수량은 0이 아닌 정수여야 합니다.' : '수량은 1 이상의 정수여야 합니다.' },
      { status: 400 },
    )
  }
  const purpose = moveType === 'out' ? ((body.purpose as string) || null) : null
  if (purpose && !['sales', 'gift'].includes(purpose)) {
    return NextResponse.json({ error: '용도(sales/gift)가 올바르지 않습니다.' }, { status: 400 })
  }

  // 매입가 스냅샷: 입력값 우선, 없으면 마스터 매입가
  let unitCost = body.unit_cost === '' || body.unit_cost == null ? null : Number(body.unit_cost)
  if (unitCost == null && productId) {
    const { data: p } = await admin.from('erp_products').select('purchase_price').eq('id', productId).maybeSingle()
    unitCost = p?.purchase_price ?? null
  }

  // 입력 계정 로그 (2026-08-24 사용자 확정: 전 직원 열람·입력, 누가 입력했는지 기록)
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const row = {
    move_date: body.move_date,
    move_type: moveType,
    product_id: productId,
    item_name_raw: itemNameRaw,
    quantity,
    unit_cost: unitCost,
    total_cost: unitCost != null && moveType !== 'adjust' ? unitCost * quantity : null,
    purpose,
    dest_name: ((body.dest_name as string) || '').trim() || null,
    staff_name: ((body.staff_name as string) || '').trim() || null,
    employee_id: (body.employee_id as string) || null,
    note: ((body.note as string) || '').trim() || null,
    source: 'manual',
    created_by_employee_id: me.employeeId,
    created_by_name: me.employeeName ?? me.email ?? '알 수 없음',
  }
  const { data, error } = await admin.from('erp_sample_moves').insert(row).select('id').single()
  if (error) {
    if (/created_by/.test(error.message)) {
      return NextResponse.json({ error: MIGRATION_801_MSG }, { status: 500 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, id: data.id })
}
