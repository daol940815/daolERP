import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { normalizeName } from '@/lib/name-similarity'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// 거래처 연동 재정비 2단계 — ERP 별칭 "등록 대기" 관리.
// ERP 업로드가 만든 별칭 중 거래처 미연결(자동 연결 실패)만 모아,
// 자동 판정(신규 생성 / 기존 연결 / 제외 권장)과 함께 내려주고
// 사용자가 선택한 것을 일괄 생성·연결/제외 처리한다 (확정은 사용자).

type PendingRow = {
  id: string
  alias_type: string
  erp_name: string
  order_count: number
  order_total: number
  suggestion: { action: 'create' | 'link' | 'exclude'; vendorId?: string; vendorName?: string; reason: string }
}

export async function GET() {
  const admin = createAdminClient()

  // excluded 컬럼(066)이 아직 없으면 컬럼 없이 재시도
  let aliasResult = await fetchAllRows<{ id: string; alias_type: string; erp_name: string; excluded?: boolean | null }>((f, t) =>
    admin.from('erp_vendor_aliases')
      .select('id, alias_type, erp_name, excluded')
      .is('vendor_id', null)
      .is('merged_into_alias_id', null)
      .range(f, t),
  )
  if ('error' in aliasResult) {
    aliasResult = await fetchAllRows<{ id: string; alias_type: string; erp_name: string }>((f, t) =>
      admin.from('erp_vendor_aliases')
        .select('id, alias_type, erp_name')
        .is('vendor_id', null)
        .is('merged_into_alias_id', null)
        .range(f, t),
    )
  }
  if ('error' in aliasResult) return NextResponse.json({ error: aliasResult.error }, { status: 500 })
  const pending = aliasResult.data.filter(a => !a.excluded)

  const vendorsResult = await fetchAllRows<{ id: string; name: string }>((f, t) =>
    admin.from('vendors').select('id, name').eq('is_active', true).range(f, t),
  )
  if ('error' in vendorsResult) return NextResponse.json({ error: vendorsResult.error }, { status: 500 })

  // 주문 규모 (매출처 별칭)
  const ordersResult = await fetchAllRows<{ customer_alias_id: string | null; total_amount: number | null }>((f, t) =>
    admin.from('erp_orders').select('customer_alias_id, total_amount').range(f, t),
  )
  if ('error' in ordersResult) return NextResponse.json({ error: ordersResult.error }, { status: 500 })
  const stat = new Map<string, { count: number; total: number }>()
  for (const o of ordersResult.data) {
    if (!o.customer_alias_id) continue
    const s = stat.get(o.customer_alias_id) ?? { count: 0, total: 0 }
    s.count++; s.total += o.total_amount ?? 0
    stat.set(o.customer_alias_id, s)
  }

  // 판정: 정규화 포함관계 유일 후보면 기존 연결, '개인' 등 비실체면 제외, 그 외 신규 생성
  const vendorNorms = vendorsResult.data.map(v => ({ v, n: normalizeName(v.name) }))
  const suggest = (name: string): PendingRow['suggestion'] => {
    const trimmed = name.trim()
    if (trimmed === '개인') return { action: 'exclude', reason: '비실체 표기' }
    const n = normalizeName(trimmed)
    const cands = n.length >= 3
      ? vendorNorms.filter(x => (n.includes(x.n) || x.n.includes(n)) && Math.abs(x.n.length - n.length) <= 6)
      : []
    if (cands.length === 1) {
      return { action: 'link', vendorId: cands[0].v.id, vendorName: cands[0].v.name, reason: `'${cands[0].v.name}'와 이름 유사` }
    }
    return { action: 'create', reason: '동명 거래처 없음' }
  }

  const rows: PendingRow[] = pending
    .map(a => {
      const s = stat.get(a.id) ?? { count: 0, total: 0 }
      return {
        id: a.id, alias_type: a.alias_type, erp_name: a.erp_name,
        order_count: s.count, order_total: s.total,
        suggestion: suggest(a.erp_name),
      }
    })
    .sort((a, b) => b.order_total - a.order_total || a.erp_name.localeCompare(b.erp_name))

  return NextResponse.json({ data: rows, total: rows.length })
}

// POST body: { actions: [{ aliasId, action: 'create'|'link'|'exclude', vendorId? }] }
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => null) as {
    actions?: { aliasId: string; action: 'create' | 'link' | 'exclude'; vendorId?: string }[]
  } | null
  const actions = body?.actions ?? []
  if (!actions.length) return NextResponse.json({ error: '처리할 항목이 없습니다.' }, { status: 400 })

  // 별칭 정보 로드
  const ids = actions.map(a => a.aliasId)
  const aliasById = new Map<string, { id: string; alias_type: string; erp_name: string }>()
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await admin
      .from('erp_vendor_aliases')
      .select('id, alias_type, erp_name, vendor_id')
      .in('id', ids.slice(i, i + 100))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    for (const a of data ?? []) {
      if (!a.vendor_id) aliasById.set(a.id as string, a as { id: string; alias_type: string; erp_name: string })
    }
  }

  // 동명 거래처 재사용을 위한 이름 맵 (중복 생성 방지)
  const vendorsResult = await fetchAllRows<{ id: string; name: string }>((f, t) =>
    admin.from('vendors').select('id, name').eq('is_active', true).range(f, t),
  )
  if ('error' in vendorsResult) return NextResponse.json({ error: vendorsResult.error }, { status: 500 })
  const byName = new Map(vendorsResult.data.map(v => [v.name.trim(), v.id]))

  let created = 0, linked = 0, excluded = 0
  const errors: { aliasId: string; error: string }[] = []
  for (const act of actions) {
    const alias = aliasById.get(act.aliasId)
    if (!alias) continue // 이미 연결됐거나 없는 별칭 — 건너뜀 (기확정 보호)
    try {
      if (act.action === 'exclude') {
        await admin.from('erp_vendor_aliases').update({ excluded: true }).eq('id', alias.id)
        excluded++
      } else if (act.action === 'link' && act.vendorId) {
        await admin.from('erp_vendor_aliases').update({ vendor_id: act.vendorId }).eq('id', alias.id)
        linked++
      } else if (act.action === 'create') {
        const name = alias.erp_name.trim()
        let vendorId = byName.get(name)
        if (!vendorId) {
          const { data: v, error } = await admin
            .from('vendors')
            .insert({ name, type: alias.alias_type === 'customer' ? 'customer' : 'vendor', is_active: true })
            .select('id')
            .single()
          if (error) throw new Error(error.message)
          vendorId = v!.id as string
          byName.set(name, vendorId)
          created++
        }
        await admin.from('erp_vendor_aliases').update({ vendor_id: vendorId }).eq('id', alias.id)
        linked++
      }
    } catch (e) {
      errors.push({ aliasId: act.aliasId, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return NextResponse.json({ created, linked, excluded, failed: errors.length, errors: errors.slice(0, 5) })
}
