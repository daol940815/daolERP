import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildHubDetail } from '@/lib/vendor-hub'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// GET /api/vendor-hub/[vendorId]?from=&to=  — 거래처 360° 상세 번들 (+can_edit)
export async function GET(
  req: NextRequest,
  { params }: { params: { vendorId: string } },
) {
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const result = await buildHubDetail(admin, params.vendorId, sp.get('from'), sp.get('to'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
  const me = await getCurrentUser()
  return NextResponse.json({ ...result, can_edit: !!me && can(me, 'customers', 'edit') })
}

// PATCH — 활동 메모(note) 저장 + 기본정보(name·biz_number·is_active) 수정
// 이름 변경 시 옛 이름은 match_aliases에 보존한다 (별칭 학습 관례 — 기존 업로드 매칭 유지).
export async function PATCH(
  req: NextRequest,
  { params }: { params: { vendorId: string } },
) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as {
    note?: string | null; name?: string; biz_number?: string | null; is_active?: boolean
  }
  const patch: Record<string, unknown> = {}
  if ('note' in body) patch.note = body.note?.trim() || null
  if ('biz_number' in body) patch.biz_number = body.biz_number?.trim() || null
  if ('is_active' in body && typeof body.is_active === 'boolean') patch.is_active = body.is_active

  if ('name' in body) {
    const name = body.name?.trim()
    if (!name) return NextResponse.json({ error: '매출처명은 비울 수 없습니다.' }, { status: 400 })
    const { data: cur, error: ce } = await admin.from('vendors')
      .select('name, match_aliases').eq('id', params.vendorId).single()
    if (ce) return NextResponse.json({ error: ce.message }, { status: 500 })
    if (cur.name !== name) {
      patch.name = name
      patch.match_aliases = Array.from(new Set([...((cur.match_aliases as string[] | null) ?? []), cur.name as string]))
        .filter(a => a && a !== name)
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: '수정할 항목이 없습니다.' }, { status: 400 })
  }
  const { error } = await admin.from('vendors').update(patch).eq('id', params.vendorId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE — 연결 데이터가 전혀 없을 때만 완전 삭제. 있으면 409 + 연결 요약을 돌려주고,
// 화면이 비활성 처리(PATCH is_active=false)를 제안한다 (이력 보존 원칙).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { vendorId: string } },
) {
  const admin = createAdminClient()
  const vid = params.vendorId

  const count = async (table: string, col: string) => {
    const { count: n, error } = await admin.from(table).select('id', { count: 'exact', head: true }).eq(col, vid)
    if (error) throw new Error(`${table}: ${error.message}`)
    return n ?? 0
  }
  try {
    const [aliases, taxInvoices, journal, transactions, assignments, staff, links] = await Promise.all([
      count('erp_vendor_aliases', 'vendor_id'),
      count('tax_invoices', 'vendor_id'),
      count('journal_lines', 'vendor_id'),
      count('transactions', 'vendor_id'),
      count('contact_assignments', 'vendor_id'),
      count('vendor_staff', 'vendor_id'),
      count('contact_name_links', 'vendor_id'),
    ])
    const linked = { 주문별칭: aliases, 계산서: taxInvoices, 분개: journal, 통장거래: transactions, 담당자배정: assignments, 담당직원: staff, 표기연결: links }
    const total = Object.values(linked).reduce((s, n) => s + n, 0)
    if (total > 0) {
      return NextResponse.json({
        error: '연결된 데이터가 있어 삭제할 수 없습니다. 비활성 처리를 사용하세요.',
        linked: Object.fromEntries(Object.entries(linked).filter(([, n]) => n > 0)),
      }, { status: 409 })
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '연결 검사 실패' }, { status: 500 })
  }

  const { error } = await admin.from('vendors').delete().eq('id', vid)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, deleted: true })
}
