import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase-server'
import { classifyByKeywords } from '@/lib/classifier.server'
import type { ParsedRow, UploadResult } from '@/types/upload'

interface UploadBody {
  rows: ParsedRow[]
  fileHash: string
  fileName: string
  fileSize: number
  fileType: string
  source: 'bank' | 'card' | 'manual'
  bankName: string
  accountNumber: string
  detectedFormat: string
}

export async function POST(req: NextRequest) {
  // 일반 클라이언트로 로그인 사용자 확인
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // RLS 우회가 필요한 쓰기 작업은 관리자 클라이언트 사용
  const admin = createAdminClient()

  const body: UploadBody = await req.json()

  // ── 중복 파일 체크 (파일 해시 기준) ─────────────────────────
  // 동일 파일이어도 거절하지 않고 "행 단위 재검사"로 진행한다.
  // 행 중복 키(065: 시각 포함)가 정확하므로 멱등 — 기존 행은 전부 건너뛰고,
  // 과거에 잘못 건너뛰었던 행만 새로 들어온다 (재결제 누락 복구 경로).
  // 기존 업로드 이력을 재사용해 새 행도 같은 파일 소속으로 남긴다.
  let reuseLogId: string | null = null
  const { data: existing } = await admin
    .from('upload_logs')
    .select('id, file_name, created_at')
    .eq('file_hash', body.fileHash)
    .eq('status', 'success')
    .maybeSingle()

  if (existing) {
    const { count } = await admin
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('upload_log_id', existing.id)

    if ((count ?? 0) > 0) {
      reuseLogId = existing.id
    } else {
      // 거래 내역이 없는 고아 이력은 삭제 후 새 이력으로 재업로드
      await admin.from('upload_logs').delete().eq('id', existing.id)
    }
  }

  // ── upload_logs 레코드 생성 (pending) ──────────────────────
  // ── 통합계좌 파일 판정 ────────────────────────────────────
  // 행에 bank_name/account_number가 실려 있으면 한 파일에 계좌가 여러 개인
  // 통합계좌(멀티뱅킹) 파일이다. 이때는 화면에서 고른 계좌를 쓰지 않고
  // 행의 계좌로 각각 보낸다. 계좌번호는 표기(하이픈) 차이가 있어 숫자만 비교한다.
  const multiRows = body.rows.filter(r => r.account_number || r.bank_name)
  const isMulti = body.source === 'bank' && multiRows.length > 0
  const digitsOf = (v: string | null | undefined) => String(v ?? '').replace(/[^0-9]/g, '')
  const acctByDigits = new Map<string, { id: string; bank_name: string; created: boolean }>()

  // ── 은행 계좌 자동 생성 (단일 계좌 명세서인 경우) ──────────────
  let bankAccountId: string | null = null
  const bankNameTrimmed = body.bankName?.trim() || null
  const accountNumberTrimmed = body.accountNumber?.trim() || null

  if (bankNameTrimmed && body.source === 'bank' && !isMulti) {
    let existingBank: { id: string; account_number: string | null } | null = null

    if (accountNumberTrimmed) {
      // (은행명 + 계좌번호) 정확 일치 행만 재사용
      // — 계좌번호 없는 기존 행에 자동 병합하지 않음 (다른 계좌와 뒤섞임 방지)
      const { data } = await admin
        .from('bank_accounts')
        .select('id, account_number')
        .eq('bank_name', bankNameTrimmed)
        .eq('account_number', accountNumberTrimmed)
        .maybeSingle()
      existingBank = data
    } else {
      // 계좌번호 없음: 같은 은행명이면서 계좌번호도 없는 행만 재사용
      const { data } = await admin
        .from('bank_accounts')
        .select('id, account_number')
        .eq('bank_name', bankNameTrimmed)
        .is('account_number', null)
        .maybeSingle()
      existingBank = data
    }

    if (existingBank) {
      bankAccountId = existingBank.id
    } else {
      const { data: newBank } = await admin
        .from('bank_accounts')
        .insert({ bank_name: bankNameTrimmed, account_number: accountNumberTrimmed })
        .select('id')
        .single()
      if (newBank) bankAccountId = newBank.id
    }
  }

  if (isMulti) {
    const { data: accts } = await admin
      .from('bank_accounts')
      .select('id, bank_name, account_number')
    const existing = new Map<string, { id: string; bank_name: string }>()
    for (const a of accts ?? []) {
      const d = digitsOf(a.account_number as string | null)
      if (d && !existing.has(d)) existing.set(d, { id: a.id as string, bank_name: a.bank_name as string })
    }

    // 파일에 등장하는 계좌 목록 (숫자 키 기준)
    const fileAccts = new Map<string, { bank_name: string; account_number: string }>()
    for (const r of multiRows) {
      const d = digitsOf(r.account_number)
      if (!d || fileAccts.has(d)) continue
      fileAccts.set(d, { bank_name: (r.bank_name ?? '').trim(), account_number: (r.account_number ?? '').trim() })
    }

    for (const [d, f] of Array.from(fileAccts.entries())) {
      const hit = existing.get(d)
      if (hit) {
        acctByDigits.set(d, { id: hit.id, bank_name: hit.bank_name, created: false })
        continue
      }
      const { data: created } = await admin
        .from('bank_accounts')
        .insert({ bank_name: f.bank_name || '미지정', account_number: f.account_number || null })
        .select('id, bank_name')
        .single()
      if (created) {
        acctByDigits.set(d, { id: created.id as string, bank_name: created.bank_name as string, created: true })
      }
    }
  }

  let uploadLogId: string
  if (reuseLogId) {
    uploadLogId = reuseLogId
  } else {
    const { data: uploadLog, error: logError } = await admin
      .from('upload_logs')
      .insert({
        file_name: body.fileName,
        file_type: body.fileType,
        file_size: body.fileSize,
        file_hash: body.fileHash,
        source: body.source,
        account_alias: bankNameTrimmed || null,
        total_rows: body.rows.length,
        status: 'pending',
        uploaded_by: user?.id ?? null,
      })
      .select('id')
      .single()

    if (logError || !uploadLog) {
      return NextResponse.json(
        { error: '업로드 이력 생성 실패: ' + logError?.message },
        { status: 500 },
      )
    }
    uploadLogId = uploadLog.id
  }

  // ── transactions 배치 삽입 (1000건씩 나눠서) ───────────────
  const insertData = body.rows.map(row => {
    // 통합계좌 파일이면 행의 계좌로, 아니면 화면에서 지정한 계좌로
    const hit = isMulti ? acctByDigits.get(digitsOf(row.account_number)) : undefined
    return {
      tx_date: row.tx_date,
      tx_time: row.tx_time ?? null,
      description: row.description,
      counterparty_name: row.counterparty_name ?? null,
      amount_in: row.amount_in,
      amount_out: row.amount_out,
      balance: row.balance ?? null,
      source: row.source,
      account_alias: hit?.bank_name ?? bankNameTrimmed ?? null,
      bank_account_id: hit?.id ?? bankAccountId,
      upload_log_id: uploadLogId,
      status: 'pending',
    }
  })

  // 계좌를 못 찾은 행은 넣지 않는다 — 엉뚱한 계좌에 섞이는 것이 더 위험하다
  const unmatchedRows = isMulti ? insertData.filter(r => !r.bank_account_id).length : 0
  const sendData = isMulti ? insertData.filter(r => r.bank_account_id) : insertData

  const BATCH = 1000
  let insertedRows = 0
  let duplicateRows = 0
  let errorRows = 0

  for (let i = 0; i < sendData.length; i += BATCH) {
    const batch = sendData.slice(i, i + BATCH)
    // 행 단위 중복(dedup_key)은 건너뛰고 신규만 삽입 (멱등)
    const { data: ins, error: insertError } = await admin
      .from('transactions')
      .upsert(batch, { onConflict: 'dedup_key', ignoreDuplicates: true })
      .select('id')

    if (insertError) {
      errorRows += batch.length
    } else {
      const n = ins?.length ?? 0
      insertedRows += n
      duplicateRows += batch.length - n   // 중복으로 건너뛴 건
    }
  }

  // ── upload_logs 결과 업데이트 ────────────────────────────
  const finalStatus = errorRows === 0 ? 'success' : insertedRows > 0 ? 'partial' : 'failed'

  if (reuseLogId) {
    // 재검사: 기존 이력에 신규분만 누적 (원래 업로드 기록은 보존)
    const { data: cur } = await admin
      .from('upload_logs').select('inserted_rows').eq('id', uploadLogId).single()
    await admin
      .from('upload_logs')
      .update({
        inserted_rows: (cur?.inserted_rows ?? 0) + insertedRows,
        completed_at: new Date().toISOString(),
      })
      .eq('id', uploadLogId)
  } else {
    await admin
      .from('upload_logs')
      .update({
        inserted_rows: insertedRows,
        error_rows: errorRows,
        status: finalStatus,
        completed_at: new Date().toISOString(),
      })
      .eq('id', uploadLogId)
  }

  // ── 업로드 완료 후 자동 분류 ────────────────────────────
  // 키워드 기반 자동 분류 (실패해도 업로드 결과에는 영향 없음).
  // 마이너스통장(당좌차월)은 계좌의 account_type='overdraft' + GL=단기차입금으로
  // 처리되므로(분개 시 은행쪽 다리가 자동으로 단기차입금), 업로드 단계의
  // 별도 '마이너스통장' 분류는 두지 않는다(상쇄 분개 유발 방지).
  if (insertedRows > 0) {
    classifyByKeywords(admin, uploadLogId).catch(() => null)
  }

  const result: UploadResult = {
    uploadLogId,
    totalRows: body.rows.length,
    insertedRows,
    skippedRows: duplicateRows,
    errorRows: errorRows + unmatchedRows,
  }

  // 통합계좌 업로드: 계좌별로 몇 건을 보냈는지 돌려준다
  // (중복 제외 건수는 배치 단위로만 알 수 있어 계좌별 inserted는 보낸 건수 기준)
  if (isMulti) {
    const perAcct = new Map<string, { bank_name: string; account_number: string; inserted: number; skipped: number; created: boolean }>()
    for (const row of body.rows) {
      const d = digitsOf(row.account_number)
      const hit = acctByDigits.get(d)
      const key = hit?.id ?? `미등록:${d}`
      let a = perAcct.get(key)
      if (!a) {
        a = {
          bank_name: hit?.bank_name ?? (row.bank_name ?? ''),
          account_number: row.account_number ?? '',
          inserted: 0, skipped: 0,
          created: hit?.created ?? false,
        }
        perAcct.set(key, a)
      }
      if (hit) a.inserted++
      else a.skipped++
    }
    result.accountResults = Array.from(perAcct.values()).sort((x, y) => y.inserted - x.inserted)
  }

  // 재검사였음을 화면에 알림 (기존 파일 — 신규 행만 추가됨)
  return NextResponse.json(reuseLogId ? { ...result, recheckedExisting: true } : result)
}
