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

// 거래일자 포맷터 — 시간 포함 시 "YYYY-MM-DD HH:MM" 표시
const txDateFmt = (p: ValueFormatterParams<Transaction, string>) => {
  if (!p.value) return ''
  if (p.value.length <= 10) return p.value  // DATE 형식 그대로
  const d = new Date(p.value)
  const hhmm = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
  return hhmm === '00:00' ? p.value.slice(0, 10) : `${p.value.slice(0, 10)} ${hhmm}`
}

// 기간별 조회 구간 계산
function getPeriodRange(period: string): { from: string; to: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()  // 0-based

  // toISOString()은 UTC 변환으로 KST(+9) 환경에서 날짜가 하루 밀리므로 로컬 기준으로 포맷
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  switch (period) {
    case '당월':
      return { from: fmt(new Date(y, m, 1)),     to: fmt(new Date(y, m + 1, 0)) }
    case '전월':
      return { from: fmt(new Date(y, m - 1, 1)), to: fmt(new Date(y, m, 0)) }
    case '당분기': {
      const q = Math.floor(m / 3)
      return { from: fmt(new Date(y, q * 3, 1)), to: fmt(new Date(y, q * 3 + 3, 0)) }
    }
    case '전분기': {
      const q = Math.floor(m / 3) - 1
      const aq = q < 0 ? 3 : q
      const ay = q < 0 ? y - 1 : y
      return { from: fmt(new Date(ay, aq * 3, 1)), to: fmt(new Date(ay, aq * 3 + 3, 0)) }
    }
    case '당반기': {
      const h = m < 6 ? 0 : 1
      return { from: fmt(new Date(y, h * 6, 1)), to: fmt(new Date(y, h * 6 + 6, 0)) }
    }
    case '전반기': {
      const h = m < 6 ? 1 : 0
      const ay = m < 6 ? y - 1 : y
      return { from: fmt(new Date(ay, h * 6, 1)), to: fmt(new Date(ay, h * 6 + 6, 0)) }
    }
    case '당년':
      return { from: fmt(new Date(y, 0, 1)),     to: fmt(new Date(y, 11, 31)) }
    case '전년':
      return { from: fmt(new Date(y - 1, 0, 1)), to: fmt(new Date(y - 1, 11, 31)) }
    default:
      return { from: fmt(new Date(y, m, 1)), to: fmt(now) }
  }
}
const PERIOD_PRESETS = ['당월', '전월', '당분기', '전분기', '당반기', '전반기', '당년', '전년'] as const

// 차변/대변 배지 렌더러
function SideBadge(p: ICellRendererParams<Transaction>) {
  if (p.value === '차변') return <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">차변</span>
  if (p.value === '대변') return <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">대변</span>
  return <span className="text-gray-300 text-xs">—</span>
}

// 이체쌍 배지 렌더러
function TransferPairBadge(p: ICellRendererParams<Transaction>) {
  if (!p.value) return <span className="text-gray-300 text-xs">—</span>
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700 cursor-default"
      title={`이체쌍 ID: ${p.value}`}
    >
      🔗 이체쌍
    </span>
  )
}

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
  const localFmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return {
    from: localFmt(new Date(now.getFullYear(), now.getMonth(), 1)),
    to:   localFmt(now),
  }
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
  const [matching,   setMatching]   = useState(false)
  const [selectedCount, setSelectedCount] = useState(0)
  const [autoFetchFlag, setAutoFetchFlag] = useState(0)
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

  // URL param(bankAccountId) 변경 시 필터 동기화 + 자동 조회
  useEffect(() => {
    setFilters(f => ({ ...f, bankAccountId: bankAccountIdParam }))
    // bankAccountId가 바뀌면 현재 필터(날짜·상태·출처)를 유지한 채 즉시 재조회
    setAutoFetchFlag(n => n + 1)
  }, [bankAccountIdParam])

  // 계정과목 + 은행 계좌 목록 로드 (마운트 1회)
  useEffect(() => {
    fetch('/api/accounts')
      .then(r => r.json())
      .then(d => { if (d.data) setAccounts(d.data) })
      .catch(() => null)
  }, [])

  // 은행 계좌 목록(잔액 포함) 조회 — 거래 변경 후 잔액 갱신에 재사용
  const fetchBanks = useCallback(() => {
    fetch('/api/bank-accounts', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (d.data) setBanks(d.data) })
      .catch(() => null)
  }, [])

  useEffect(() => { fetchBanks() }, [fetchBanks])

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

  // 초기 로드 + bankAccountId 변경 시 자동 재조회
  useEffect(() => { fetchTransactions() }, [autoFetchFlag]) // eslint-disable-line react-hooks/exhaustive-deps

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
    } else if (colId === 'side') {
      body = { suggested_side: data.suggested_side ?? null }
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

  // 선택된 행 삭제
  const handleBulkDelete = useCallback(async () => {
    const selected = gridRef.current?.api.getSelectedRows() as Transaction[]
    if (!selected?.length) return
    if (!window.confirm(`선택한 ${selected.length}건을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return

    const ids = selected.map(r => r.id)
    const res = await fetch('/api/transactions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    if (res.ok) {
      showToast(`${ids.length}건 삭제 완료`)
      fetchTransactions()
      fetchBanks()  // 거래 삭제로 최신 잔액이 바뀌므로 계좌 잔액도 갱신
    } else {
      showToast('삭제 실패', 'err')
    }
  }, [fetchTransactions, fetchBanks, showToast])

  // 자동 분류 실행
  const handleClassify = useCallback(async () => {
    setClassifying(true)
    try {
      const body = filters.bankAccountId ? { bank_account_id: filters.bankAccountId } : {}
      const res  = await fetch('/api/transactions/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      showToast(json.message ?? '분류 완료')
      fetchTransactions()
    } catch {
      showToast('자동 분류 실패', 'err')
    } finally {
      setClassifying(false)
    }
  }, [filters.bankAccountId, fetchTransactions, showToast])

  // 이체 거래 쌍 자동 매칭
  const handleMatchTransfers = useCallback(async () => {
    setMatching(true)
    try {
      const body = filters.bankAccountId ? { bank_account_id: filters.bankAccountId } : {}
      const res  = await fetch('/api/transactions/match-transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (json.matched > 0) {
        showToast(`${json.matched}쌍 이체 매칭 완료`)
        fetchTransactions()
      } else {
        showToast('매칭 가능한 이체 거래 없음')
      }
    } catch {
      showToast('이체 매칭 실패', 'err')
    } finally {
      setMatching(false)
    }
  }, [filters.bankAccountId, fetchTransactions, showToast])

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
      width: 145,
      pinned: 'left',
      sort: 'desc',
      valueFormatter: txDateFmt,
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
      field: 'balance',
      headerName: '잔액',
      width: 130,
      type: 'numericColumn',
      valueFormatter: (p) => p.value != null ? p.value.toLocaleString('ko-KR') + '원' : '',
      cellStyle: (p) => ({ color: (p.value ?? 0) < 0 ? '#dc2626' : '#6b7280' }),
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
      colId: 'side',
      headerName: '차/대변',
      width: 90,
      editable: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: { values: ['차변', '대변', '(초기화)'] },
      valueGetter: (p: ValueGetterParams<Transaction>) => {
        const s = p.data?.suggested_side
        if (s === 'debit')  return '차변'
        if (s === 'credit') return '대변'
        return null
      },
      valueSetter: (p: ValueSetterParams<Transaction>) => {
        if (!p.data) return false
        if (p.newValue === '차변')      p.data.suggested_side = 'debit'
        else if (p.newValue === '대변') p.data.suggested_side = 'credit'
        else                            p.data.suggested_side = null
        return true
      },
      cellRenderer: SideBadge,
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
      field: 'transfer_pair_id',
      headerName: '이체쌍',
      width: 95,
      cellRenderer: TransferPairBadge,
      sortable: false,
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

  // 현재 선택된 은행 정보 (이름 + 잔액)
  const activeBank = useMemo(() => {
    if (!filters.bankAccountId) return null
    return banks.find(b => b.id === filters.bankAccountId) ?? null
  }, [filters.bankAccountId, banks])

  return (
    <div className="p-6 flex flex-col h-full">
      <div className="flex items-center gap-3 mb-1 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">거래 내역</h1>
        {activeBank && (
          <span className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 text-slate-700 rounded-full text-sm font-medium">
            🏦 {activeBank.bank_name}
            {activeBank.current_balance !== null && (
              <span className="text-slate-500 font-normal">
                잔액 <strong className={activeBank.current_balance < 0 ? 'text-red-600' : 'text-slate-800'}>
                  {activeBank.current_balance.toLocaleString('ko-KR')}원
                </strong>
              </span>
            )}
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

      {/* 기간 빠른 선택 */}
      <div className="flex flex-wrap gap-1 mb-2">
        {PERIOD_PRESETS.map(p => (
          <button
            key={p}
            onClick={() => setFilters(f => ({ ...f, ...getPeriodRange(p) }))}
            className="px-2.5 py-1 text-xs border border-gray-300 rounded-md text-gray-600 hover:bg-slate-100 hover:border-slate-400 transition-colors"
          >
            {p}
          </button>
        ))}
      </div>

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
          <button
            onClick={handleMatchTransfers}
            disabled={matching}
            className="px-3 py-1.5 border border-purple-300 rounded-lg text-sm text-purple-700 hover:bg-purple-50 disabled:opacity-50"
          >
            {matching ? '매칭 중...' : '🔗 이체 매칭'}
          </button>
          {selectedCount > 0 && (
            <>
              <button
                onClick={handleBulkConfirm}
                className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
              >
                선택 {selectedCount}건 확정
              </button>
              <button
                onClick={handleBulkDelete}
                className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
              >
                선택 {selectedCount}건 삭제
              </button>
            </>
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
