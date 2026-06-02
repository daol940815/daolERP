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
  isMinusAccount?: boolean
}

export async function POST(req: NextRequest) {
  // 일반 클라이언트로 로그인 사용자 확인
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // RLS 우회가 필요한 쓰기 작업은 관리자 클라이언트 사용
  const admin = createAdminClient()

  const body: UploadBody = await req.json()

  // ── 중복 파일 체크 (파일 해시 기준) ─────────────────────────
  const { data: existing } = await admin
    .from('upload_logs')
    .select('id, file_name, created_at')
    .eq('file_hash', body.fileHash)
    .eq('status', 'success')
    .maybeSingle()

  if (existing) {
    // 실제 거래 내역이 남아있는 경우에만 중복으로 처리
    const { count } = await admin
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('upload_log_id', existing.id)

    if ((count ?? 0) > 0) {
      return NextResponse.json(
        {
          isDuplicate: true,
          message: `동일한 파일이 이미 업로드되어 있습니다. (파일명: ${existing.file_name}, 업로드일: ${new Date(existing.created_at).toLocaleDateString('ko-KR')})`,
        },
        { status: 409 },
      )
    }

    // 거래 내역이 없는 고아 이력은 삭제 후 재업로드 허용
    await admin.from('upload_logs').delete().eq('id', existing.id)
  }

  // ── upload_logs 레코드 생성 (pending) ──────────────────────
  // ── 은행 계좌 자동 생성 (은행 명세서인 경우) ──────────────────
  let bankAccountId: string | null = null
  const bankNameTrimmed = body.bankName?.trim() || null
  const accountNumberTrimmed = body.accountNumber?.trim() || null

  if (bankNameTrimmed && body.source === 'bank') {
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

  const uploadLogId: string = uploadLog.id

  // ── transactions 배치 삽입 (1000건씩 나눠서) ───────────────
  const insertData = body.rows.map(row => ({
    tx_date: row.tx_date,
    description: row.description,
    amount_in: row.amount_in,
    amount_out: row.amount_out,
    balance: row.balance ?? null,
    source: row.source,
    account_alias: bankNameTrimmed || null,
    bank_account_id: bankAccountId,
    upload_log_id: uploadLogId,
    status: 'pending',
  }))

  const BATCH = 1000
  let insertedRows = 0
  let errorRows = 0

  for (let i = 0; i < insertData.length; i += BATCH) {
    const batch = insertData.slice(i, i + BATCH)
    const { error: insertError } = await admin.from('transactions').insert(batch)

    if (insertError) {
      errorRows += batch.length
    } else {
      insertedRows += batch.length
    }
  }

  // ── upload_logs 결과 업데이트 ────────────────────────────
  const finalStatus = errorRows === 0 ? 'success' : insertedRows > 0 ? 'partial' : 'failed'

  await admin
    .from('upload_logs')
    .update({
      inserted_rows: insertedRows,
      error_rows: errorRows,
      status: finalStatus,
      completed_at: new Date().toISOString(),
    })
    .eq('id', uploadLogId)

  // ── 업로드 완료 후 자동 분류 ────────────────────────────
  if (insertedRows > 0) {
    if (body.isMinusAccount) {
      // 마이너스 통장: 모든 거래를 단기차입금(부채)으로 기본 분류
      // (개별 거래는 거래 내역 화면에서 변경 가능)
      classifyAsBorrowing(admin, uploadLogId).catch(() => null)
    } else {
      // 일반: 키워드 기반 자동 분류 (실패해도 업로드 결과에는 영향 없음)
      classifyByKeywords(admin, uploadLogId).catch(() => null)
    }
  }

  const result: UploadResult = {
    uploadLogId,
    totalRows: body.rows.length,
    insertedRows,
    skippedRows: 0,
    errorRows,
  }

  return NextResponse.json(result)
}

// 마이너스 통장 거래를 단기차입금(부채)으로 기본 분류
// 입금(차입) → side_on_in(대변), 출금(상환) → side_on_out(차변)
async function classifyAsBorrowing(
  admin: ReturnType<typeof createAdminClient>,
  uploadLogId: string,
) {
  // 단기차입금 계정 조회 (마이그레이션 011 필요)
  const { data: account } = await admin
    .from('accounts')
    .select('id, side_on_in, side_on_out')
    .eq('code', '2002')
    .maybeSingle()

  if (!account) {
    // 계정이 없으면 일반 키워드 분류로 폴백
    await classifyByKeywords(admin, uploadLogId)
    return
  }

  const sideIn  = account.side_on_in  ?? 'credit'
  const sideOut = account.side_on_out ?? 'debit'

  // 입금(차입) 거래: amount_in > 0
  await admin
    .from('transactions')
    .update({
      suggested_account_id: account.id,
      suggested_side:       sideIn,
      ai_confidence:        0.9,
      ai_reason:            '마이너스 통장 기본 분류(차입)',
    })
    .eq('upload_log_id', uploadLogId)
    .gt('amount_in', 0)

  // 출금(상환) 거래: amount_in = 0 이면서 amount_out > 0
  await admin
    .from('transactions')
    .update({
      suggested_account_id: account.id,
      suggested_side:       sideOut,
      ai_confidence:        0.9,
      ai_reason:            '마이너스 통장 기본 분류(상환)',
    })
    .eq('upload_log_id', uploadLogId)
    .eq('amount_in', 0)
    .gt('amount_out', 0)
}
