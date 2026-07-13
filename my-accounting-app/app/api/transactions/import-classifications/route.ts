import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

// POST /api/transactions/import-classifications
// multipart/form-data: file (XLSX)
// Sheet 1 컬럼: id, 계정과목 (계정과목명을 입력하면 confirmed_account_id로 변환)
export async function POST(req: NextRequest) {
  const admin = createAdminClient()

  const formData = await req.formData().catch(() => null)
  const file = formData?.get('file') as File | null
  if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())
  const wb = XLSX.read(buffer, { type: 'buffer' })

  const wsName = wb.SheetNames[0]
  if (!wsName) return NextResponse.json({ error: '시트가 없습니다.' }, { status: 400 })

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wsName])

  // 계정과목 목록: 이름(소문자) → id
  const { data: accounts } = await admin.from('accounts').select('id, name')
  const acctByName = Object.fromEntries(
    (accounts ?? []).map(a => [(a.name as string).trim().toLowerCase(), a.id as string])
  )

  // 계정과목이 입력된 행만 추출하고 계정 ID별로 묶기
  const byAcct = new Map<string, string[]>()   // acctId → txId[]
  const unknownNames = new Set<string>()
  let skipped = 0

  for (const row of rows) {
    const id       = String(row['id'] ?? '').trim()
    const acctName = String(row['계정과목'] ?? '').trim()

    if (!id || !acctName) { skipped++; continue }

    const acctId = acctByName[acctName.toLowerCase()]
    if (!acctId) { unknownNames.add(acctName); continue }

    if (!byAcct.has(acctId)) byAcct.set(acctId, [])
    byAcct.get(acctId)!.push(id)
  }

  // 계정과목별 일괄 UPDATE
  let updated = 0
  for (const [acctId, ids] of Array.from(byAcct)) {
    const { data } = await admin
      .from('transactions')
      .update({ confirmed_account_id: acctId, status: 'reviewed' })
      .in('id', ids)
      .neq('status', 'confirmed')  // 이미 확정된 건 보호
      .select('id')
    updated += data?.length ?? 0
  }

  return NextResponse.json({
    updated,
    skipped,
    unknownAccounts: Array.from(unknownNames),
    total: rows.length,
  })
}
