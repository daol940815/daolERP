'use client'

import { useCallback, useRef, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community'
import type { ColDef, ValueFormatterParams } from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-quartz.css'
import { parseFile } from '@/lib/file-parser'
import type { ParsedRow, ParseResult, UploadResult, UploadStep } from '@/types/upload'

// AG Grid 커뮤니티 모듈 등록 (전역 1회)
ModuleRegistry.registerModules([AllCommunityModule])

// 금액 포맷터 (0은 빈 칸으로 표시)
const amountFmt = (p: ValueFormatterParams<ParsedRow, number>) =>
  p.value ? p.value.toLocaleString('ko-KR') + '원' : ''

// 잔액 포맷터 (0 및 음수 포함 표시)
const balanceFmt = (p: ValueFormatterParams<ParsedRow, number | undefined>) =>
  p.value != null ? p.value.toLocaleString('ko-KR') + '원' : ''

// AG Grid 컬럼 정의
const COL_DEFS: ColDef<ParsedRow>[] = [
  { field: 'tx_date',     headerName: '거래일자', width: 120, pinned: 'left' },
  { field: 'description', headerName: '내용/적요', flex: 1, minWidth: 180 },
  {
    field: 'amount_in', headerName: '입금액', width: 140,
    type: 'numericColumn', valueFormatter: amountFmt,
    cellStyle: { color: '#2563eb', fontWeight: 500 },
  },
  {
    field: 'amount_out', headerName: '출금액', width: 140,
    type: 'numericColumn', valueFormatter: amountFmt,
    cellStyle: { color: '#dc2626', fontWeight: 500 },
  },
  {
    field: 'balance', headerName: '잔액', width: 140,
    type: 'numericColumn', valueFormatter: balanceFmt,
    cellStyle: (p) => ({ color: (p.value ?? 0) < 0 ? '#dc2626' : '#6b7280' }),
  },
  { field: 'source', headerName: '출처', width: 80 },
]

export default function UploadPage() {
  const [step, setStep]               = useState<UploadStep>('idle')
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [sourceType, setSourceType]   = useState<'bank' | 'card'>('bank')
  const [bankName, setBankName]       = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [isMinusAccount, setIsMinusAccount] = useState(false)
  const [isDragging, setIsDragging]   = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 파일을 받아서 파싱
  const handleFile = useCallback(async (file: File) => {
    setError(null)
    setStep('parsing')
    try {
      const result = await parseFile(file, sourceType)
      if (result.rows.length === 0) {
        setError('파싱된 거래 데이터가 없습니다. 파일 형식을 확인해주세요.')
        setStep('error')
        return
      }
      setParseResult(result)
      // 은행 명세서인 경우 감지된 은행명/계좌번호를 기본값으로 설정
      if (sourceType === 'bank') {
        if (!bankName) {
          const detected = result.detectedFormat
          if (!detected.includes('일반') && !detected.includes('카드') && !detected.includes('명세서')) {
            setBankName(detected)
          }
        }
        if (!accountNumber && result.suggestedAccountNumber) {
          setAccountNumber(result.suggestedAccountNumber)
        }
      }
      setStep('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : '파일 파싱 중 오류가 발생했습니다.')
      setStep('error')
    }
  }, [sourceType])

  // 마이너스 통장 토글 — 입금/출금 컬럼이 반대로 표기된 명세서 교정
  // (들어온 돈이 출금, 나간 돈이 입금으로 적힌 형식 → 실제 현금 방향으로 스왑)
  const handleToggleMinus = (checked: boolean) => {
    setIsMinusAccount(checked)
    setParseResult(prev => prev ? {
      ...prev,
      rows: prev.rows.map(r => ({
        ...r,
        amount_in:  r.amount_out,
        amount_out: r.amount_in,
      })),
    } : prev)
  }

  // 드래그 앤 드롭 핸들러
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true) }
  const onDragLeave = () => setIsDragging(false)

  // 파일 input 변경
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  // 업로드 실행
  const handleUpload = async () => {
    if (!parseResult) return
    setStep('uploading')
    setError(null)

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: parseResult.rows,
          fileHash: parseResult.fileHash,
          fileName: parseResult.fileName,
          fileSize: parseResult.fileSize,
          fileType: parseResult.fileType,
          source: sourceType,
          bankName,
          accountNumber,
          detectedFormat: parseResult.detectedFormat,
          isMinusAccount,
        }),
      })

      if (res.status === 409) {
        const data = await res.json()
        setError(data.message)
        setStep('error')
        return
      }

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? '업로드 중 오류가 발생했습니다.')
      }

      const result: UploadResult = await res.json()
      setUploadResult(result)
      setStep('success')
    } catch (e) {
      setError(e instanceof Error ? e.message : '업로드 중 오류가 발생했습니다.')
      setStep('error')
    }
  }

  // 초기화
  const handleReset = () => {
    setStep('idle')
    setParseResult(null)
    setUploadResult(null)
    setError(null)
    setBankName('')
    setAccountNumber('')
    setIsMinusAccount(false)
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">파일 업로드</h1>
      <p className="text-gray-500 text-sm mb-5">
        은행 명세서 또는 카드 내역 파일(CSV, XLSX, XLS)을 업로드하세요.
      </p>

      {/* 단계 인디케이터 */}
      <StepBar step={step} />

      {/* 에러 배너 */}
      {error && step === 'error' && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-start justify-between gap-4">
          <span>{error}</span>
          <button onClick={handleReset} className="shrink-0 underline hover:no-underline">
            다시 시도
          </button>
        </div>
      )}

      {/* ── IDLE: 파일 선택 ── */}
      {step === 'idle' && (
        <div className="mt-5">
          {/* 출처 선택 버튼 */}
          <div className="flex gap-2 mb-4">
            {(['bank', 'card'] as const).map(t => (
              <button
                key={t}
                onClick={() => setSourceType(t)}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  sourceType === t
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-slate-500'
                }`}
              >
                {t === 'bank' ? '🏦 은행 명세서' : '💳 카드 내역'}
              </button>
            ))}
          </div>

          {/* 드래그 앤 드롭 존 */}
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl py-20 text-center cursor-pointer transition-colors select-none ${
              isDragging
                ? 'border-slate-700 bg-slate-50'
                : 'border-gray-300 hover:border-slate-400 hover:bg-gray-50'
            }`}
          >
            <div className="text-4xl mb-3">📂</div>
            <p className="text-gray-700 font-medium">파일을 드래그하거나 클릭해서 선택하세요</p>
            <p className="text-gray-400 text-sm mt-1">CSV · XLSX · XLS 지원</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={onFileChange}
            className="hidden"
          />
        </div>
      )}

      {/* ── PARSING: 파싱 중 ── */}
      {step === 'parsing' && (
        <div className="mt-12 text-center py-12">
          <div className="text-4xl mb-3 animate-pulse">⏳</div>
          <p className="text-gray-500">파일 분석 중...</p>
        </div>
      )}

      {/* ── PREVIEW / UPLOADING: AG Grid 미리보기 ── */}
      {(step === 'preview' || step === 'uploading') && parseResult && (
        <div className="mt-5">
          {/* 파일 정보 요약 */}
          <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span><span className="text-gray-400">파일</span> <strong>{parseResult.fileName}</strong></span>
            <span><span className="text-gray-400">감지 형식</span> <strong>{parseResult.detectedFormat}</strong></span>
            <span>
              <span className="text-gray-400">총 건수</span>{' '}
              <strong className="text-blue-600">{parseResult.rows.length.toLocaleString()}건</strong>
            </span>
            <span><span className="text-gray-400">크기</span> <strong>{(parseResult.fileSize / 1024).toFixed(1)} KB</strong></span>
          </div>

          {/* 경고 메시지 */}
          {parseResult.warnings.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 mb-4 text-sm text-yellow-800">
              <strong>⚠ 파싱 경고 ({parseResult.warnings.length}건)</strong>
              <ul className="mt-1 list-disc list-inside space-y-0.5">
                {parseResult.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
                {parseResult.warnings.length > 5 && (
                  <li className="text-yellow-600">...외 {parseResult.warnings.length - 5}건 더</li>
                )}
              </ul>
            </div>
          )}

          {/* AG Grid 미리보기 */}
          <div className="ag-theme-quartz rounded-lg overflow-hidden border border-gray-200" style={{ height: 380 }}>
            <AgGridReact<ParsedRow>
              rowData={parseResult.rows}
              columnDefs={COL_DEFS}
              defaultColDef={{ sortable: true, resizable: true, filter: true }}
              pagination
              paginationPageSize={15}
            />
          </div>

          {/* 마이너스 통장 옵션 (은행 명세서 전용) */}
          {sourceType === 'bank' && (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isMinusAccount}
                  onChange={e => handleToggleMinus(e.target.checked)}
                  disabled={step === 'uploading'}
                  className="mt-0.5 w-4 h-4 accent-amber-600"
                />
                <span className="text-sm text-amber-900">
                  <strong>마이너스 통장(한도대출)입니다</strong>
                  <span className="block text-amber-700 text-xs mt-0.5">
                    들어온 돈이 출금, 나간 돈이 입금으로 반대 표기된 명세서를 교정합니다.
                    체크하면 입금/출금이 서로 바뀌어 표시되고, 거래는 <strong>단기차입금</strong>으로 자동 분류됩니다.
                    (거래 내역에서 개별 변경 가능)
                  </span>
                </span>
              </label>
            </div>
          )}

          {/* 은행명/카드명 + 업로드 버튼 */}
          <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-end gap-4">
            <div className="flex-1 flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {sourceType === 'bank' ? '은행명' : '카드사/카드명'}{' '}
                  <span className="text-gray-400 font-normal">
                    {sourceType === 'bank' ? '(예: 우리은행)' : '(예: 신한카드)'}
                  </span>
                </label>
                <input
                  type="text"
                  value={bankName}
                  onChange={e => setBankName(e.target.value)}
                  placeholder={sourceType === 'bank' ? '은행명 입력' : '카드사명 (선택)'}
                  disabled={step === 'uploading'}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:bg-gray-50"
                />
              </div>
              {sourceType === 'bank' && (
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    계좌번호{' '}
                    <span className="text-gray-400 font-normal">(예: 1005-804-575410)</span>
                  </label>
                  <input
                    type="text"
                    value={accountNumber}
                    onChange={e => setAccountNumber(e.target.value)}
                    placeholder="자동 감지 또는 직접 입력"
                    disabled={step === 'uploading'}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:bg-gray-50"
                  />
                </div>
              )}
            </div>
            <div className="flex gap-2 sm:mb-0">
              <button
                onClick={handleReset}
                disabled={step === 'uploading'}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                취소
              </button>
              <button
                onClick={handleUpload}
                disabled={step === 'uploading'}
                className="px-6 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {step === 'uploading'
                  ? '업로드 중...'
                  : `${parseResult.rows.length.toLocaleString()}건 업로드`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SUCCESS: 완료 ── */}
      {step === 'success' && uploadResult && (
        <div className="mt-10 max-w-sm mx-auto">
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center shadow-sm">
            <div className="text-5xl mb-4">✅</div>
            <h2 className="text-xl font-bold text-gray-900 mb-5">업로드 완료</h2>
            <div className="grid grid-cols-2 gap-3 text-sm mb-6">
              <StatCard label="총 건수"  value={uploadResult.totalRows} />
              <StatCard label="저장 완료" value={uploadResult.insertedRows} color="blue" />
              <StatCard label="건너뜀"   value={uploadResult.skippedRows} />
              <StatCard label="오류"     value={uploadResult.errorRows} color={uploadResult.errorRows > 0 ? 'red' : undefined} />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleReset}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
              >
                추가 업로드
              </button>
              <a
                href="/transactions"
                className="flex-1 px-3 py-2 bg-slate-900 text-white rounded-lg text-sm text-center hover:bg-slate-700"
              >
                거래 내역 보기
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 단계 인디케이터 ──────────────────────────────────────
const STEPS: { key: UploadStep; label: string }[] = [
  { key: 'idle',      label: '파일 선택' },
  { key: 'parsing',   label: '분석' },
  { key: 'preview',   label: '미리보기' },
  { key: 'uploading', label: '저장' },
  { key: 'success',   label: '완료' },
]

function StepBar({ step }: { step: UploadStep }) {
  const activeIdx = STEPS.findIndex(s => s.key === step)

  return (
    <div className="flex items-center gap-1.5 text-xs">
      {STEPS.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1.5">
          <div className={`w-5 h-5 rounded-full flex items-center justify-center font-bold ${
            i < activeIdx  ? 'bg-green-500 text-white' :
            i === activeIdx ? 'bg-slate-900 text-white' :
                              'bg-gray-200 text-gray-400'
          }`}>
            {i < activeIdx ? '✓' : i + 1}
          </div>
          <span className={i === activeIdx ? 'text-gray-900 font-medium' : 'text-gray-400'}>
            {s.label}
          </span>
          {i < STEPS.length - 1 && <span className="text-gray-300 mx-0.5">›</span>}
        </div>
      ))}
    </div>
  )
}

// ── 통계 카드 ──────────────────────────────────────────
function StatCard({ label, value, color }: { label: string; value: number; color?: 'blue' | 'red' }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-gray-400 text-xs mb-0.5">{label}</p>
      <p className={`text-xl font-bold ${
        color === 'blue' ? 'text-blue-600' :
        color === 'red'  ? 'text-red-600'  :
                           'text-gray-900'
      }`}>
        {value.toLocaleString()}
      </p>
    </div>
  )
}
