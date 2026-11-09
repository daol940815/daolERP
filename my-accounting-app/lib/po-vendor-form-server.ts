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
