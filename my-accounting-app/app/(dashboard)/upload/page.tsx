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
    type: 'numericColumn', valueFormatter: amountFmt,
    cellStyle: { color: '#6b7280' },
  },
  { field: 'source', headerName: '출처', width: 80 },
]

export default function UploadPage() {
  const [step, setStep]               = useState<UploadStep>('idle')
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [sourceType, setSourceType]   = useState<'bank' | 'card'>('bank')
  const [accountAlias, setAccountAlias] = useState('')
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
      setStep('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : '파일 파싱 중 오류가 발생했습니다.')
      setStep('error')
    }
  }, [sourceType])

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
          accountAlias,
          detectedFormat: parseResult.detectedFormat,
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
    setAccountAlias('')
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

          {/* 계좌 별칭 + 업로드 버튼 */}
          <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-end gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                계좌/카드 별칭{' '}
                <span className="text-gray-400 font-normal">(예: 신한은행 001-123456)</span>
              </label>
              <input
                type="text"
                value={accountAlias}
                onChange={e => setAccountAlias(e.target.value)}
                placeholder="선택사항"
                disabled={step === 'uploading'}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:bg-gray-50"
              />
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
