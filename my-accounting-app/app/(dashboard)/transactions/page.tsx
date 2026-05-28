'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AgGridReact } from 'ag-grid-react'
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type CellValueChangedEvent,
  type ICellRendererParams,
  type ValueGetterParams,
  type ValueSetterParams,
  type ValueFormatterParams,
} from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-quartz.css'
import type { Transaction, Account } from '@/types/transaction'
import type { BankAccount } from '@/types/bank-account'

ModuleRegistry.registerModules([AllCommunityModule])

// 금액 포맷터
const amountFmt = (p: ValueFormatterParams<Transaction, number>) =>
  p.value ? p.value.toLocaleString('ko-KR') + '원' : ''

// 상태 배지 렌더러
function StatusBadge(p: ICellRendererParams<Transaction>) {
  const map: Record<string, { label: string; cls: string }> = {
    pending:   { label: '미검토',  cls: 'bg-gray-100 text-gray-600' },
    reviewed:  { label: '검토완료', cls: 'bg-yellow-100 text-yellow-700' },
    confirmed: { label: '확정',    cls: 'bg-green-100 text-green-700' },
  }
  const s = map[p.value as string] ?? { label: p.value, cls: 'bg-gray-100 text-gray-500' }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  )
}

// 이번달 기본 날짜 범위 계산
function defaultDateRange() {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const to   = now.toISOString().slice(0, 10)
  return { from, to }
}

interface Filters {
  from: string
  to: string
  status: string
  source: string
  bankAccountId: string
}

function TransactionsContent() {
  const searchParams = useSearchParams()
  const bankAccountIdParam = searchParams.get('bankAccountId') ?? ''

  const gridRef = useRef<AgGridReact<Transaction>>(null)
  const [rowData,   setRowData]   = useState<Transaction[]>([])
  const [accounts,  setAccounts]  = useState<Account[]>([])
  const [banks,     setBanks]     = useState<BankAccount[]>([])
  const [loading,   setLoading]   = useState(false)
  const [classifying, setClassifying] = useState(false)
  const [selectedCount, setSelectedCount] = useState(0)
  const [filters, setFilters]     = useState<Filters>({
    ...defaultDateRange(),
    status: 'all',
    source: 'all',
    bankAccountId: bankAccountIdParam,
  })
  const [toast, setToast]         = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)

  // 토스트 메시지 (3초 후 자동 닫힘)
  const showToast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  // 계정과목 맵 (id → name)
  const accountMap = useMemo(
    () => Object.fromEntries(accounts.map(a => [a.id, a])),
    [accounts],
  )

  // URL param(bankAccountId) 변경 시 필터 동기화
  useEffect(() => {
    setFilters(f => ({ ...f, bankAccountId: bankAccountIdParam }))
  }, [bankAccountIdParam])

  // 계정과목 + 은행 계좌 목록 로드 (마운트 1회)
  useEffect(() => {
    fetch('/api/accounts')
      .then(r => r.json())
      .then(d => { if (d.data) setAccounts(d.data) })
      .catch(() => null)
    fetch('/api/bank-accounts')
      .then(r => r.json())
      .then(d => { if (d.data) setBanks(d.data) })
      .catch(() => null)
  }, [])

  // 거래 내역 조회
  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        status: filters.status,
        source: filters.source,
        ...(filters.from           && { from: filters.from }),
        ...(filters.to             && { to:   filters.to   }),
        ...(filters.bankAccountId  && { bankAccountId: filters.bankAccountId }),
      })
      const res  = await fetch(`/api/transactions?${params}`)
      const json = await res.json()
      if (json.data) setRowData(json.data)
      else showToast(json.error ?? '조회 실패', 'err')
    } catch {
      showToast('서버 연결 실패', 'err')
    } finally {
      setLoading(false)
    }
  }, [filters, showToast])

  // 초기 로드
  useEffect(() => { fetchTransactions() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 셀 편집 저장 (계정과목 / 메모)
  const onCellValueChanged = useCallback(async (event: CellValueChangedEvent<Transaction>) => {
    const { data, colDef } = event
    const colId = colDef.colId ?? colDef.field ?? ''

    let body: Record<string, unknown> = {}

    if (colId === 'account') {
      // valueSetter에서 confirmed_account_id를 이미 갱신해 둠
      body = {
        confirmed_account_id: data.confirmed_account_id ?? null,
        status: data.confirmed_account_id ? 'reviewed' : 'pending',
      }
      // 행 상태도 즉시 반영
      data.status = data.confirmed_account_id ? 'reviewed' : 'pending'
      event.api.refreshCells({ rowNodes: [event.node!], columns: ['status'], force: true })
    } else if (colDef.field === 'memo') {
      body = { memo: data.memo ?? null }
    } else {
      return
    }

    const res = await fetch(`/api/transactions/${data.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) showToast('저장 실패', 'err')
  }, [showToast])

  // 선택된 행 확정
  const handleBulkConfirm = useCallback(async () => {
    const selected = gridRef.current?.api.getSelectedRows() as Transaction[]
    if (!selected?.length) return

    const ids = selected.map(r => r.id)
    await Promise.all(ids.map(id =>
      fetch(`/api/transactions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      }),
    ))
    showToast(`${ids.length}건 확정 완료`)
    fetchTransactions()
  }, [fetchTransactions, showToast])

  // 자동 분류 실행
  const handleClassify = useCallback(async () => {
    setClassifying(true)
    try {
      const res  = await fetch('/api/transactions/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const json = await res.json()
      showToast(json.message ?? '분류 완료')
      fetchTransactions()
    } catch {
      showToast('자동 분류 실패', 'err')
    } finally {
      setClassifying(false)
    }
  }, [fetchTransactions, showToast])

  // 통계 계산
  const stats = useMemo(() => {
    const totalIn     = rowData.reduce((s, r) => s + (r.amount_in ?? 0), 0)
    const totalOut    = rowData.reduce((s, r) => s + (r.amount_out ?? 0), 0)
    const pending     = rowData.filter(r => r.status === 'pending').length
    const unclassified = rowData.filter(r => !r.confirmed_account_id && !r.suggested_account_id).length
    return { totalIn, totalOut, pending, unclassified, total: rowData.length }
  }, [rowData])

  // AG Grid 컬럼 정의 (accounts 로드 후 memo 필드 처리 포함)
  const colDefs = useMemo<ColDef<Transaction>[]>(() => [
    {
      headerCheckboxSelection: true,
      checkboxSelection: true,
      width: 48,
      pinned: 'left',
      resizable: false,
      sortable: false,
      filter: false,
    },
    {
      field: 'tx_date',
      headerName: '거래일자',
      width: 115,
      pinned: 'left',
      sort: 'desc',
    },
    {
      field: 'description',
      headerName: '내용/적요',
      flex: 1,
      minWidth: 180,
    },
    {
      field: 'amount_in',
      headerName: '입금액',
      width: 130,
      type: 'numericColumn',
      valueFormatter: amountFmt,
      cellStyle: { color: '#2563eb', fontWeight: 500 },
    },
    {
      field: 'amount_out',
      headerName: '출금액',
      width: 130,
      type: 'numericColumn',
      valueFormatter: amountFmt,
      cellStyle: { color: '#dc2626', fontWeight: 500 },
    },
    {
      // 계정과목 인라인 편집 컬럼
      colId: 'account',
      headerName: '계정과목',
      width: 155,
      editable: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: () => ({
        values: ['(미분류)', ...accounts.map(a => a.name)],
      }),
      // 표시: confirmed → 볼드, suggested → 이탤릭 회색, 없음 → 연회색
      valueGetter: (p: ValueGetterParams<Transaction>) => {
        const id = p.data?.confirmed_account_id ?? p.data?.suggested_account_id
        if (!id) return '(미분류)'
        return accountMap[id]?.name ?? '(미분류)'
      },
      // 편집 완료 시 이름 → ID 역변환하여 confirmed_account_id에 저장
      valueSetter: (p: ValueSetterParams<Transaction>) => {
        if (!p.data) return false
        const acct = accounts.find(a => a.name === p.newValue)
        p.data.confirmed_account_id = acct?.id ?? null
        return true
      },
      cellClass: (p) => {
        if (!p.data) return ''
        if (p.data.confirmed_account_id) return 'font-semibold text-gray-900'
        if (p.data.suggested_account_id) return 'italic text-gray-500'
        return 'text-gray-300'
      },
    },
    {
      field: 'memo',
      headerName: '메모',
      width: 150,
      editable: true,
      cellEditorParams: { maxLength: 200 },
    },
    {
      field: 'status',
      headerName: '상태',
      width: 100,
      cellRenderer: StatusBadge,
    },
    {
      field: 'source',
      headerName: '출처',
      width: 70,
      valueFormatter: (p) => p.value === 'bank' ? '은행' : p.value === 'card' ? '카드' : p.value,
    },
    {
      field: 'account_alias',
      headerName: '계좌',
      width: 140,
    },
  ], [accounts, accountMap])

  // 현재 선택된 은행 이름
  const activeBankName = useMemo(() => {
    if (!filters.bankAccountId) return null
    return banks.find(b => b.id === filters.bankAccountId)?.bank_name ?? null
  }, [filters.bankAccountId, banks])

  return (
    <div className="p-6 flex flex-col h-full">
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-2xl font-bold text-gray-900">거래 내역</h1>
        {activeBankName && (
          <span className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 text-slate-700 rounded-full text-sm font-medium">
            🏦 {activeBankName}
            <a
              href="/transactions"
              className="ml-1 text-slate-400 hover:text-slate-600 leading-none"
              title="필터 해제"
            >
              ✕
            </a>
          </span>
        )}
      </div>
      <p className="text-gray-500 text-sm mb-4">계정과목 클릭으로 직접 분류하거나, 자동 분류를 사용하세요.</p>

      {/* 필터 바 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="date" value={filters.from}
          onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
        <span className="text-gray-400 text-sm">~</span>
        <input
          type="date" value={filters.to}
          onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
        <select
          value={filters.status}
          onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
        >
          <option value="all">전체 상태</option>
          <option value="pending">미검토</option>
          <option value="reviewed">검토완료</option>
          <option value="confirmed">확정</option>
        </select>
        <select
          value={filters.source}
          onChange={e => setFilters(f => ({ ...f, source: e.target.value }))}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
        >
          <option value="all">전체 출처</option>
          <option value="bank">은행</option>
          <option value="card">카드</option>
        </select>
        <button
          onClick={fetchTransactions}
          disabled={loading}
          className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? '조회 중...' : '조회'}
        </button>
      </div>

      {/* 요약 + 액션 바 */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        {/* 통계 */}
        <div className="flex flex-wrap gap-4 text-sm">
          <span className="text-gray-500">총 <strong className="text-gray-900">{stats.total.toLocaleString()}건</strong></span>
          <span className="text-blue-600">입금 <strong>{stats.totalIn.toLocaleString()}원</strong></span>
          <span className="text-red-600">출금 <strong>{stats.totalOut.toLocaleString()}원</strong></span>
          {stats.pending > 0 && (
            <span className="text-orange-500">미검토 <strong>{stats.pending}건</strong></span>
          )}
          {stats.unclassified > 0 && (
            <span className="text-gray-400">미분류 <strong>{stats.unclassified}건</strong></span>
          )}
        </div>

        {/* 액션 버튼 */}
        <div className="flex gap-2">
          <button
            onClick={handleClassify}
            disabled={classifying}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {classifying ? '분류 중...' : '✨ 자동 분류'}
          </button>
          {selectedCount > 0 && (
            <button
              onClick={handleBulkConfirm}
              className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
            >
              선택 {selectedCount}건 확정
            </button>
          )}
        </div>
      </div>

      {/* AG Grid */}
      <div className="ag-theme-quartz flex-1 rounded-lg overflow-hidden border border-gray-200" style={{ minHeight: 400 }}>
        <AgGridReact<Transaction>
          ref={gridRef}
          rowData={rowData}
          columnDefs={colDefs}
          defaultColDef={{ sortable: true, resizable: true, filter: true }}
          rowSelection="multiple"
          suppressRowClickSelection
          onSelectionChanged={(e) => setSelectedCount(e.api.getSelectedRows().length)}
          onCellValueChanged={onCellValueChanged}
          getRowStyle={(p) => {
            if (p.data?.status === 'confirmed') return { background: '#f0fdf4' }
            if (p.data?.status === 'reviewed')  return { background: '#fefce8' }
            return undefined
          }}
          pagination
          paginationPageSize={50}
          suppressMovableColumns
          overlayNoRowsTemplate={
            loading
              ? '<span class="text-gray-400">조회 중...</span>'
              : '<span class="text-gray-400">조회된 거래가 없습니다. 필터를 확인하거나 파일을 업로드하세요.</span>'
          }
        />
      </div>

      {/* 안내 문구 */}
      <p className="text-xs text-gray-400 mt-2">
        계정과목 셀 클릭 → 드롭다운으로 분류 &nbsp;·&nbsp; 메모 셀 클릭 → 직접 입력 &nbsp;·&nbsp; 행 체크 후 선택 확정으로 일괄 확정
      </p>

      {/* 토스트 */}
      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-3 rounded-lg shadow-lg text-sm text-white z-50 transition-all ${
          toast.type === 'ok' ? 'bg-green-600' : 'bg-red-600'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

export default function TransactionsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400 text-sm">로딩 중...</div>}>
      <TransactionsContent />
    </Suspense>
  )
}
