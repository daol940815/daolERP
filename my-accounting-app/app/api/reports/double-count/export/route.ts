import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildDoubleCount, CHECK_LABEL } from '@/lib/double-count'
import { xlsxResponseMulti } from '@/lib/xlsx-export'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// GET /api/reports/double-count/export — 이중계상 검사 결과를 엑셀로 (요약 시트 + 상세 시트)
export async function GET() {
  const admin = createAdminClient()
  const r = await buildDoubleCount(admin)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
  const { findings, summary } = r.result

  const detail = findings.map(f => ({
    '검사': `${f.check}. ${CHECK_LABEL[f.check]}`,
    '원천': f.source,
    '일자': f.date,
    '거래처/가맹점': f.label,
    '적요/가맹점명': f.description ?? '',
    '금액': f.amount,
    '확정 계정': f.account_name ?? '',
    '상대 계산서 작성일': f.invoice_date ?? '',
    '상대 계산서 금액': f.invoice_amount ?? '',
    '상대 계산서 계정': f.invoice_account ?? '',
    '상대 계산서 거래처': f.invoice_counterparty ?? '',
    '내용': f.detail,
    '권장 조치': f.action,
    '원천 ID': f.source_id,
  }))

  const summaryRows = [
    { '구분': `A. ${CHECK_LABEL.A}`, '건수': summary.A, '설명': '세금계산서와 결제 매칭된 통장 출금이 비용 계정으로도 확정됨 (확정 이중)' },
    { '구분': `B. ${CHECK_LABEL.B}`, '건수': summary.B, '설명': '비용으로 확정된 통장 출금과 같은 거래처·금액·35일 안의 분류된 매입 계산서 (유사 이중)' },
    { '구분': `C. ${CHECK_LABEL.C}`, '건수': summary.C, '설명': '법인카드 확정 건과 같은 사업자번호·금액·7일 안의 분류된 매입 계산서 (병행 발행 이중)' },
    { '구분': '의심 금액 합계', '건수': findings.length, '설명': summary.total_amount.toLocaleString('ko-KR') + '원' },
    { '구분': '검사 시각', '건수': '', '설명': new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC' },
  ]

  return xlsxResponseMulti([
    { name: '요약', rows: summaryRows, cols: [26, 8, 80] },
    { name: '상세', rows: detail.length ? detail : [{ '검사': '', '원천': '', '일자': '', '거래처/가맹점': '이중계상 의심 건 없음' }],
      cols: [24, 8, 11, 24, 30, 12, 16, 14, 14, 16, 24, 60, 60, 38] },
  ], '이중계상검사')
}
