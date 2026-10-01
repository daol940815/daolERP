import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildHubList, type HubListRow } from '@/lib/vendor-hub'
import { getCurrentUser } from '@/lib/user-role'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const STATUS_LABEL: Record<string, string> = {
  normal: '정상', outstanding: '미수', late: '수금지연', over90: '미수 90일 초과', dormant: '휴면 전환',
}
const OTYPE_LABEL: Record<string, string> = {
  both: '명절+상시', regular_only: '상시만', season_only: '명절만', none: '주문없음',
}

interface Flag { vendor_id: string; is_new: boolean; is_churn: boolean; otype: string; tier: string }

// GET /api/vendor-hub/export — 매출처 관리 (지점) 목록을 화면 필터 그대로 XLSX로.
// Query: from, to, mine, q, staff, status, vip, outstanding, inactive, cat
// 미들웨어: GET = 고객·영업 조회 권한 (엑셀은 조회 권한자도 허용 — 2026-09-29 확정)
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams

  const result = await buildHubList(admin, sp.get('from'), sp.get('to'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
  let rows = result.rows

  // 내 고객 (화면과 동일 — 현재 담당 지정 기준)
  if (sp.get('mine') === '1') {
    const me = await getCurrentUser()
    if (!me?.employeeId) rows = []
    else {
      const { data: vs } = await admin.from('vendor_staff').select('vendor_id')
        .eq('employee_id', me.employeeId).is('ended_at', null)
      const mineIds = new Set((vs ?? []).map(v => v.vendor_id as string))
      rows = rows.filter(r => mineIds.has(r.vendor_id))
    }
  }

  // 고객관리 분류 (타일 필터·배지 열)
  const flagMap = new Map<string, Flag>()
  const { data: flags } = await admin.rpc('hub_customer_flags', { p_year: null })
  for (const f of ((flags?.vendors ?? []) as Flag[])) flagMap.set(f.vendor_id, f)

  // 화면 필터 재현
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
  const q = sp.get('q')?.trim() ?? ''
  const digits = q.replace(/\D/g, '')
  const staff = sp.get('staff') ?? ''
  const status = sp.get('status') ?? ''
  const cat = sp.get('cat') ?? ''
  const matchCat = (f: Flag | undefined): boolean => {
    if (!f) return false
    if (cat === 'new') return f.is_new
    if (cat === 'churn') return f.is_churn
    if (['t1', 't2', 't3', 't4'].includes(cat)) return f.tier === cat
    return f.otype === cat
  }
  rows = rows.filter((r: HubListRow) => {
    if (q) {
      const hit = norm(r.vendor_name).includes(norm(q))
        || r.alias_names.some(a => norm(a).includes(norm(q)))
        || (digits.length >= 3 && (r.biz_number ?? '').replace(/\D/g, '').includes(digits))
      if (!hit) return false
    }
    if (staff && r.staff_primary !== staff) return false
    if (status && r.status !== status) return false
    if (sp.get('vip') === '1' && r.vip_total <= 0) return false
    if (sp.get('outstanding') === '1' && r.outstanding <= 0) return false
    if (sp.get('inactive') !== '1' && r.is_active === false) return false
    if (cat && !matchCat(flagMap.get(r.vendor_id))) return false
    return true
  })

  const out = rows.map(r => {
    const f = flagMap.get(r.vendor_id)
    return {
      '매출처명': r.vendor_name,
      '활성': r.is_active === false ? '비활성' : '활성',
      '사업자번호': r.biz_number ?? '',
      '담당직원': r.staff_primary ?? '',
      '추가담당': r.staff_extra || '',
      '거래처 담당자': r.contact_rep ?? '',
      '주문수': r.order_count,
      '기간매출': r.net,
      '수금액': r.collected,
      '수금율(%)': r.net > 0 ? Math.round((r.collected / r.net) * 1000) / 10 : 100,
      '미수잔액': r.outstanding,
      '90일초과미수': r.over90,
      'VIP누적': r.vip_total,
      '최근주문일': r.last_order_date ?? '',
      '상태': STATUS_LABEL[r.status] ?? r.status,
      '주문유형': f ? (OTYPE_LABEL[f.otype] ?? '') : '',
      '신규': f?.is_new ? 'Y' : '',
      '이탈': f?.is_churn ? 'Y' : '',
    }
  })

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(out)
  ws['!cols'] = [
    { wch: 28 }, { wch: 6 }, { wch: 14 }, { wch: 10 }, { wch: 8 }, { wch: 16 },
    { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 9 }, { wch: 14 }, { wch: 12 },
    { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 6 }, { wch: 6 },
  ]
  XLSX.utils.book_append_sheet(wb, ws, '매출처 관리(지점)')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array
  const fname = `매출처관리_지점_${new Date().toISOString().slice(0, 10)}.xlsx`
  return new Response(buf.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`,
    },
  })
}
