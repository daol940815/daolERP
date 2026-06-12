import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

const REVERSE_TYPE_LABEL: Record<string, string> = {
  '매출처':    'customer',
  '매입처':    'vendor',
  '매입+매출': 'both',
}

const cell = (row: Record<string, unknown>, key: string) => String(row[key] ?? '').trim()

const parseChips = (s: string): string[] =>
  s.split(/[,;]/).map(v => v.trim()).filter(Boolean)

const parseActive = (s: string): boolean | null => {
  if (!s) return null
  return s === 'Y' || s === 'y' || s === '예' || s === '활성'
}

type VendorRow = {
  id: string; name: string; type: string
  biz_number: string | null; contact_name: string | null; contact_phone: string | null
  email: string | null; note: string | null
  match_aliases: string[] | null; card_numbers: string[] | null; is_active: boolean
}

// POST /api/erp-aliases/import
// multipart/form-data: file (XLSX, export 포맷과 동일한 컬럼), type=customer|purchase
export async function POST(req: NextRequest) {
  const admin = createAdminClient()

  const formData = await req.formData().catch(() => null)
  const file = formData?.get('file') as File | null
  const type: 'customer' | 'purchase' = formData?.get('type') === 'purchase' ? 'purchase' : 'customer'
  if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const wsName = wb.SheetNames[0]
  if (!wsName) return NextResponse.json({ error: '시트가 없습니다.' }, { status: 400 })
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wsName])

  const { data: vendors, error: ve } = await admin
    .from('vendors')
    .select('id, name, type, biz_number, contact_name, contact_phone, email, note, match_aliases, card_numbers, is_active')
    .limit(5000)
  if (ve) return NextResponse.json({ error: ve.message }, { status: 500 })

  const { data: aliases, error: ae } = await admin
    .from('erp_vendor_aliases')
    .select('id, erp_name, vendor_id')
    .eq('alias_type', type)
    .limit(2000)
  if (ae) return NextResponse.json({ error: ae.message }, { status: 500 })

  const vendorByName = new Map<string, VendorRow>((vendors ?? []).map(v => [(v.name as string).trim(), v as VendorRow]))
  const aliasByName  = new Map((aliases ?? []).map(a => [(a.erp_name as string).trim(), a]))

  const defaultType = type === 'customer' ? 'customer' : 'vendor'

  const vendorPatches = new Map<string, Record<string, unknown>>()

  let aliasConnected = 0
  let aliasDisconnected = 0
  let vendorsCreated = 0
  let skipped = 0
  let total = 0

  for (const row of rows) {
    total++
    const erpName    = cell(row, 'ERP명')
    const vendorName = cell(row, '거래처명')
    if (!erpName && !vendorName) { skipped++; continue }

    let vendorId: string | null = null

    if (vendorName) {
      let v = vendorByName.get(vendorName)
      if (!v) {
        const typeLabel = cell(row, '유형')
        const { data: created, error: ce } = await admin
          .from('vendors')
          .insert({
            name: vendorName,
            type: REVERSE_TYPE_LABEL[typeLabel] ?? defaultType,
          })
          .select('id, name, type, biz_number, contact_name, contact_phone, email, note, match_aliases, card_numbers, is_active')
          .single()
        if (ce) return NextResponse.json({ error: `'${vendorName}' 거래처 생성 실패: ${ce.message}` }, { status: 500 })
        v = created as VendorRow
        vendorByName.set(vendorName, v)
        vendorsCreated++
      }
      vendorId = v.id

      const bizNumber    = cell(row, '사업자번호')
      const contactName  = cell(row, '담당자')
      const contactPhone = cell(row, '연락처')
      const email        = cell(row, '이메일')
      const note         = cell(row, '메모')
      const matchAliases = cell(row, '입금출금계좌명')
      const cardNumbers  = cell(row, '카드번호')
      const active       = parseActive(cell(row, '활성'))

      const patch = vendorPatches.get(vendorId) ?? {}
      if (bizNumber)        patch.biz_number    = bizNumber
      if (contactName)      patch.contact_name  = contactName
      if (contactPhone)     patch.contact_phone = contactPhone
      if (email)            patch.email         = email
      if (note)             patch.note          = note
      if (matchAliases)     patch.match_aliases = parseChips(matchAliases)
      if (cardNumbers)      patch.card_numbers  = parseChips(cardNumbers)
      if (active !== null)  patch.is_active     = active
      if (Object.keys(patch).length) vendorPatches.set(vendorId, patch)
    }

    if (erpName) {
      const alias = aliasByName.get(erpName)
      if (!alias) { skipped++; continue }
      const newVendorId = vendorName ? vendorId : null
      if (alias.vendor_id !== newVendorId) {
        const { error: pe } = await admin
          .from('erp_vendor_aliases')
          .update({ vendor_id: newVendorId })
          .eq('id', alias.id)
        if (pe) return NextResponse.json({ error: `'${erpName}' 연결 실패: ${pe.message}` }, { status: 500 })
        if (newVendorId) aliasConnected++
        else aliasDisconnected++
      }
    }
  }

  let vendorsUpdated = 0
  for (const [vendorId, patch] of Array.from(vendorPatches)) {
    const { error: ue } = await admin.from('vendors').update(patch).eq('id', vendorId)
    if (ue) return NextResponse.json({ error: `거래처 정보 저장 실패: ${ue.message}` }, { status: 500 })
    vendorsUpdated++
  }

  return NextResponse.json({
    total,
    aliasConnected,
    aliasDisconnected,
    vendorsCreated,
    vendorsUpdated,
    skipped,
  })
}
