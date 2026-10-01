import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildContactManagerBundle } from '@/lib/contact-manager'
import { contactLabel } from '@/lib/contact-label'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const STATUS_LABEL: Record<string, string> = {
  normal: '정상', recent_move: '최근 이동', no_order_90: '미주문(90일)',
  no_order_180: '미주문(180일)', unassigned: '소속 없음', no_history: '주문 이력 없음',
}

// GET /api/contact-manager/export — 매출처 관리 (고객) 목록을 화면 필터 그대로 XLSX로.
// Query: q, status, staff
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const bundle = await buildContactManagerBundle(admin)
  if ('error' in bundle) return NextResponse.json({ error: bundle.error }, { status: 500 })

  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toLowerCase()
  const q = sp.get('q')?.trim() ?? ''
  const status = sp.get('status') ?? ''
  const staff = sp.get('staff') ?? ''

  const rows = bundle.contacts.filter(c => {
    if (status && status !== 'all' && c.status !== status) return false
    if (staff && staff !== 'all' && !c.staff_names.includes(staff)) return false
    if (q) {
      const hay = norm(`${c.name}${c.vendor_name ?? ''}${c.title ?? ''}${c.phone ?? ''}${c.ended_note ?? ''}`)
      if (!hay.includes(norm(q))) return false
    }
    return true
  })

  const out = rows.map(c => ({
    '담당자': contactLabel(c.name, c.title),
    '소속 거래처': c.vendor_name ?? (c.ended_note ? `배정 종료 ${c.ended_note}` : '소속 미지정'),
    '직함': c.title ?? '',
    '대표담당자': c.is_representative ? 'Y' : '',
    '연락처': c.phone ?? '',
    '담당 거래처 수': c.vendor_count,
    '주 상담 직원': c.staff_names.join(' · '),
    '누적 매출': c.total_sales,
    '미수': c.outstanding,
    '최근 주문일': c.last_order_date ?? '',
    '상태': STATUS_LABEL[c.status] ?? c.status,
  }))

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(out)
  ws['!cols'] = [
    { wch: 16 }, { wch: 28 }, { wch: 10 }, { wch: 9 }, { wch: 15 },
    { wch: 12 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
  ]
  XLSX.utils.book_append_sheet(wb, ws, '매출처 관리(고객)')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array
  const fname = `매출처관리_고객_${new Date().toISOString().slice(0, 10)}.xlsx`
  return new Response(buf.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`,
    },
  })
}
