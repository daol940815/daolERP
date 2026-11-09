import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { validateMapping } from '@/lib/po-vendor-form-fields'
import { loadFormFile, samplePo, generateWithForm } from '@/lib/po-vendor-form-server'
import { loadPo, currentStaff, assembleForm, formExtraOf } from '@/lib/po-assemble'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 업체 양식 시험 생성 (516) — 저장된 칸 연결로 파일을 만들어 돌려준다. 저장 · 발송 기록 없음(조회와 같음).
// GET ?po=<발주서 id> | ?po=sample(가상 주문) → xlsx. 확인 목록은 X-Po-Warnings 헤더(JSON, URI 인코딩)
export async function GET(req: NextRequest, { params }: { params: { vendorId: string; formId: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const poId = new URL(req.url).searchParams.get('po') ?? 'sample'

  const { data: form } = await admin.from('erp_po_forms').select('version, storage_path, mapping, vendor:vendors(name)')
    .eq('id', params.formId).eq('vendor_id', params.vendorId).maybeSingle()
  if (!form) return NextResponse.json({ error: '양식을 찾을 수 없습니다.' }, { status: 404 })
  const v = validateMapping(form.mapping)
  if (!v.ok) return NextResponse.json({ error: `칸 연결을 먼저 마쳐 주세요 — ${v.error}` }, { status: 400 })
  const template = await loadFormFile(admin, form.storage_path as string)
  if (!template) return NextResponse.json({ error: '양식 파일을 읽지 못했습니다.' }, { status: 500 })
  const vendorName = ((Array.isArray(form.vendor) ? form.vendor[0] : form.vendor) as { name: string } | null)?.name ?? '매입처'

  let input
  let label = '가상주문'
  if (poId === 'sample') input = samplePo(vendorName)
  else {
    const data = await loadPo(admin, poId)
    if (!data || data.po.vendor_id !== params.vendorId) return NextResponse.json({ error: '이 매입처의 발주서가 아닙니다.' }, { status: 400 })
    const staff = await currentStaff(admin, me.employeeId, data.po)
    const [po, extra] = await Promise.all([assembleForm(admin, data, staff), formExtraOf(admin, data, me.employeeId)])
    input = { po, extra }
    label = data.po.po_no
  }

  try {
    const out = await generateWithForm(template, v.mapping, input.po, input.extra)
    const fileName = `${vendorName}_양식시험_v${form.version}_${label}.xlsx`
    return new NextResponse(new Uint8Array(out.buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'X-Po-Warnings': encodeURIComponent(JSON.stringify(out.warnings)),
        'Access-Control-Expose-Headers': 'X-Po-Warnings',
      },
    })
  } catch (e) {
    return NextResponse.json({ error: `생성 실패: ${e instanceof Error ? e.message : '알 수 없음'}` }, { status: 500 })
  }
}
