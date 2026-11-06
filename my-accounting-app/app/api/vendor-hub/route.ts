import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildHubList } from '@/lib/vendor-hub'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// GET /api/vendor-hub?from=YYYY-MM-DD&to=YYYY-MM-DD[&mine=1]
// 매출처 허브 목록 — 기간 매출·수금·미수·담당·상태. mine=1이면 로그인 직원이 현재
// 담당(vendor_staff, ended_at IS NULL)인 거래처만 — "내 고객".
// can_edit = 고객·영업 그룹 수정 권한 (등록·수정·삭제 버튼 노출용 — 실제 차단은 미들웨어).
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  // ?groups=1 — 등록 창의 업체명 고르기용 업체 목록
  if (sp.get('groups') === '1') {
    const r = await fetchAllRows<{ id: string; name: string }>((f, t) =>
      admin.from('vendor_groups').select('id, name').eq('is_active', true).order('name').range(f, t))
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
    return NextResponse.json({ groups: r.data })
  }
  const result = await buildHubList(admin, sp.get('from'), sp.get('to'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
  const me = await getCurrentUser()
  const canEdit = !!me && can(me, 'customers', 'edit')
  if (sp.get('mine') === '1') {
    if (!me?.employeeId) return NextResponse.json({ ...result, rows: [], mine: true, mineLinked: false, can_edit: canEdit })
    const { data: vs } = await admin.from('vendor_staff').select('vendor_id')
      .eq('employee_id', me.employeeId).is('ended_at', null)
    const mineIds = new Set((vs ?? []).map(v => v.vendor_id as string))
    return NextResponse.json({ ...result, rows: result.rows.filter(r => mineIds.has(r.vendor_id)), mine: true, mineLinked: true, can_edit: canEdit })
  }
  return NextResponse.json({ ...result, can_edit: canEdit })
}

// POST /api/vendor-hub — 신규 매출처 등록 (미들웨어: customers 수정 권한 + 아르바이트 등록 차단)
// POST — 매출처 등록. 업체명 = 업체(vendor_groups), 지점명 = 지점 (2026-11-05 사용자 확정:
// 고객관리문서 은행명 칸 = 업체, 지점명 칸 = 지점). 지점명이 없는 단독 업체도 같은 이름의 업체에 연결한다.
// 매출처 이름 = '업체명 지점명' (지점명 없으면 업체명).
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as {
    group_name?: string; branch_name?: string; name?: string; biz_number?: string; note?: string
    billing_vendor_id?: string   // 계산서 발행처(청구처, 114) — 비우면 자기 자신
  }
  const groupName = (body.group_name ?? body.name ?? '').trim()
  const branchName = (body.branch_name ?? '').trim()
  if (!groupName) return NextResponse.json({ error: '업체명을 입력하세요.' }, { status: 400 })
  const name = branchName ? `${groupName} ${branchName}` : groupName

  // 개인 고객 업체(115): 고객은 주문 · 상담 입력의 '신규 개인 고객 등록'으로 만든다(고객 전용 매출처 자동 생성).
  // 여기서는 모임처럼 지점명이 있는 것만 등록한다.
  if (!branchName) {
    const { data: ig } = await admin.from('vendor_groups').select('id, name').eq('is_individual', true)
    const normG = (s: string) => s.replace(/\s+/g, '').toLowerCase()
    if ((ig ?? []).some(g => normG(g.name as string) === normG(groupName))) {
      return NextResponse.json({
        error: `'${groupName}' 고객은 주문 · 상담 입력에서 "신규 개인 고객 등록"으로 등록합니다 — 고객 전용 매출처가 자동으로 생깁니다. 모임은 지점명에 모임 이름을 넣어 등록하세요.`,
      }, { status: 400 })
    }
  }

  // 중복 검사: 병합되지 않은 거래처 전체의 이름·별칭 (법인 접두·공백 무시, 1,000행 제한 회피)
  const norm = (s: string) => s.replace(/^\s*(\(주\)|㈜|주식회사)\s*/, '').replace(/\s+/g, '').toLowerCase()
  const all = await fetchAllRows<{ id: string; name: string; match_aliases: string[] | null; is_active: boolean | null }>((f, t) =>
    admin.from('vendors').select('id, name, match_aliases, is_active').neq('status', 'merged').range(f, t))
  if ('error' in all) return NextResponse.json({ error: all.error }, { status: 500 })
  const hit = all.data.find(v => norm(v.name) === norm(name) || (v.match_aliases ?? []).some(a => norm(a) === norm(name)))
  if (hit) {
    const why = hit.is_active === false ? ' (비활성 상태 — 목록에서 "비활성 포함"을 켜고 재활성하세요)' : ''
    return NextResponse.json({ error: `같은 이름의 거래처가 이미 있습니다: ${hit.name}${why}`, vendor_id: hit.id }, { status: 409 })
  }

  // 업체 — 같은 이름(공백·법인 접두 무시)이 있으면 연결, 없으면 생성
  const groups = await fetchAllRows<{ id: string; name: string }>((f, t) =>
    admin.from('vendor_groups').select('id, name').range(f, t))
  if ('error' in groups) return NextResponse.json({ error: groups.error }, { status: 500 })
  let groupId = groups.data.find(g => norm(g.name) === norm(groupName))?.id ?? null
  if (!groupId) {
    const { data: g, error: ge } = await admin.from('vendor_groups').insert({ name: groupName }).select('id').single()
    if (ge) return NextResponse.json({ error: `업체 등록 실패: ${ge.message}` }, { status: 500 })
    groupId = g.id as string
  }

  const { data, error } = await admin.from('vendors')
    .insert({
      name,
      group_id: groupId,
      biz_number: body.biz_number?.trim() || null,
      note: body.note?.trim() || null,
      type: 'customer',
    })
    .select('id, name')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // 청구처는 별도 갱신 — 114 미적용 환경에서도 등록 자체는 성공하도록
  let billingWarning: string | null = null
  if (body.billing_vendor_id) {
    const { data: t } = await admin.from('vendors').select('billing_vendor_id').eq('id', body.billing_vendor_id).maybeSingle()
    if (t?.billing_vendor_id) billingWarning = '선택한 청구처가 다른 청구처를 가리키고 있어 지정하지 않았습니다.'
    else {
      const { error: be } = await admin.from('vendors').update({ billing_vendor_id: body.billing_vendor_id }).eq('id', data.id)
      if (be) billingWarning = '청구처 지정은 마이그레이션 114 실행 후 가능합니다 — 매출처는 등록됐습니다.'
    }
  }
  return NextResponse.json({ data, billing_warning: billingWarning })
}
