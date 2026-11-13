// 업체 발주서 양식 서버 공용 (516) — route 파일은 핸들러만 export 해야 하므로 여기에 둔다
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PoExcelData } from './po-form'
import type { FormMapping } from './po-vendor-form-fields'
import { buildFormContext, fillVendorForm, type FormExtra } from './po-vendor-form'

export const PO_FORMS_BUCKET = 'po-forms'
export const PO_FORM_MAX_BYTES = 10 * 1024 * 1024
export const PO_FORM_HINT = '516 마이그레이션(업체 발주서 양식)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
export const poFormMissing = (msg: string) => /erp_po_forms|relation|does not exist|bucket/i.test(msg)

export interface PoFormRow {
  id: string; vendor_id: string; version: number; file_name: string; storage_path: string
  status: 'draft' | 'active' | 'archived'; mapping: FormMapping; recognized: unknown; memo: string | null
  uploaded_by: string | null; uploaded_at: string; activated_by: string | null; activated_at: string | null; updated_at: string
}

export async function loadFormFile(admin: SupabaseClient, path: string): Promise<Buffer | null> {
  const { data, error } = await admin.storage.from(PO_FORMS_BUCKET).download(path)
  if (error || !data) return null
  return Buffer.from(await data.arrayBuffer())
}

// 시험 생성용 가상 주문 — 실제 고객 정보 없이 칸 연결만 확인 (개별 배송 명단 3명 포함)
export function samplePo(vendorName: string): { po: PoExcelData; extra: FormExtra } {
  const po: PoExcelData = {
    po_no: 'P000000-000',
    order_date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()),
    ship_request: null,
    vendor_name: vendorName,
    customer: '가상은행 시험지점',
    customer_bank: '가상은행',
    customer_branch: '시험지점',
    customer_manager: '김가상 과장님',
    customer_phone: '02-000-0000',
    staff_name: '이시험',
    staff_phone: '010-0000-0000',
    total_amount: 0,
    delivery_note: '부재 시 경비실',
    ship: { ship_name: '김가상', ship_phone: '02-000-0000', ship_zip: '00000', ship_addr1: '서울시 가상구 시험로 1', ship_addr2: '1층' },
    items: [
      { item_code: 'T-001', item_name: '가상 선물세트 A', order_kind: '지점', quantity: 2, purchase_price: 10000, purchase_shipping: 0, purchase_total: 20000, memo: null, role: null },
      { item_code: 'T-002', item_name: '가상 선물세트 B', order_kind: '개별', quantity: 3, purchase_price: 15000, purchase_shipping: 0, purchase_total: 45000, memo: '빨강', role: null },
    ],
    roster_rows: [1, 2, 3].map(i => ({
      recipient_name: `가상수령${i}`, phone: `010-0000-000${i}`, zip: '00000', addr1: `서울시 가상구 시험로 ${i + 1}`, addr2: `${i}0${i}호`,
      item_name_raw: '가상 선물세트 B', product_id: null, item_code: 'T-002', item_name: '가상 선물세트 B', quantity: 1, memo: null, seq: i,
    })),
  }
  po.total_amount = po.items.reduce((s, it) => s + it.purchase_total, 0)
  return { po, extra: { sender_name: '가상은행 시험지점장', staff_title: '대리', manager_plain: '김가상 과장' } }
}

export async function generateWithForm(template: Buffer, mapping: FormMapping, po: PoExcelData, extra: FormExtra) {
  const { ctx, warnings } = buildFormContext(po, extra)
  return fillVendorForm(template, mapping, ctx, warnings)
}

// ── 발주서 출력 연동 (2026-11-09 — 2차: 다운로드 · 메일 첨부가 '사용 중' 업체 양식으로) ──────────
// 분기: ① 매입처의 사용 중(active) 업로드 양식 → ② 코드 양식(lib/custom-po.ts, 대경사과) → ③ 자사 기본 발주서. ②③은 route가 처리
export interface VendorFormRef { id: string; version: number; file_name: string; storage_path: string; mapping: FormMapping }

export async function activeVendorForm(admin: SupabaseClient, vendorId: string | null | undefined): Promise<VendorFormRef | null> {
  if (!vendorId) return null
  const { data, error } = await admin.from('erp_po_forms')
    .select('id, version, file_name, storage_path, mapping')
    .eq('vendor_id', vendorId).eq('status', 'active').maybeSingle()
  if (error || !data) return null          // 516 미적용 · 양식 없음 → 기존 분기 그대로
  return data as VendorFormRef
}

// 사용 시작 전(작성 중) 버전 — 발주서 화면 안내용
export async function draftVendorForm(admin: SupabaseClient, vendorId: string | null | undefined): Promise<{ id: string; version: number } | null> {
  if (!vendorId) return null
  const { data } = await admin.from('erp_po_forms').select('id, version')
    .eq('vendor_id', vendorId).eq('status', 'draft').order('version', { ascending: false }).limit(1).maybeSingle()
  return (data as { id: string; version: number } | null) ?? null
}

// 사용 중 양식으로 발주서 파일 만들기. 양식 파일을 못 읽으면 기본 양식으로 몰래 바꾸지 않고 오류(잘못된 양식이 업체로 나가지 않게)
export async function buildWithVendorForm(admin: SupabaseClient, vf: VendorFormRef, po: PoExcelData, extra: FormExtra):
  Promise<{ ok: true; buffer: Buffer; warnings: string[] } | { ok: false; error: string }> {
  const template = await loadFormFile(admin, vf.storage_path)
  if (!template) return { ok: false, error: `업체 양식 파일(버전 ${vf.version} · ${vf.file_name})을 읽지 못했습니다. 매입처 상세 › 발주서 양식에서 확인해 주세요.` }
  try {
    const out = await generateWithForm(template, vf.mapping, po, extra)
    return { ok: true, buffer: out.buffer, warnings: out.warnings }
  } catch (e) {
    return { ok: false, error: `업체 양식으로 발주서를 만들지 못했습니다: ${e instanceof Error ? e.message : '알 수 없음'}` }
  }
}

// 이 발주서가 어느 양식 버전으로 나갔는지 기록 (516 form_id) — 실패해도 출력은 막지 않는다
export async function recordFormUsed(admin: SupabaseClient, poId: string, formId: string | null) {
  await admin.from('erp_purchase_orders').update({ form_id: formId }).eq('id', poId).then(() => undefined, () => undefined)
}
