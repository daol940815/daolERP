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
  accountAlias: string
  detectedFormat: string
}

export async function POST(req: NextRequest) {
  // 일반 클라이언트로 로그인 사용자 확인
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // RLS 우회가 필요한 쓰기 작업은 관리자 클라이언트 사용
  const admin = await createAdminClient()

  const body: UploadBody = await req.json()

  // ── 중복 파일 체크 (파일 해시 기준) ─────────────────────────
  const { data: existing } = await admin
    .from('upload_logs')
    .select('id, file_name, created_at')
    .eq('file_hash', body.fileHash)
    .eq('status', 'success')
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      {
        isDuplicate: true,
        message: `동일한 파일이 이미 업로드되어 있습니다. (파일명: ${existing.file_name}, 업로드일: ${new Date(existing.created_at).toLocaleDateString('ko-KR')})`,
      },
      { status: 409 },
    )
  }

  // ── upload_logs 레코드 생성 (pending) ──────────────────────
  const { data: uploadLog, error: logError } = await admin
    .from('upload_logs')
    .insert({
      file_name: body.fileName,
      file_type: body.fileType,
      file_size: body.fileSize,
      file_hash: body.fileHash,
      source: body.source,
      account_alias: body.accountAlias || null,
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
    account_alias: body.accountAlias || null,
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

  // ── 업로드 완료 후 키워드 자동 분류 실행 ────────────────
  if (insertedRows > 0) {
    // 실패해도 업로드 결과에는 영향 없음
    classifyByKeywords(admin, uploadLogId).catch(() => null)
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
