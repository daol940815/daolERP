'use client'

// 미수금 관리 / 미지급금 관리 — 경과기간 분석(원본: ERP 주문·정산) + 거래처별 요약(매출처·매입처 관리와 같은 값)
// 을 한 화면에 (2026-09-30 UI 2차 정리, 통합 4 — 사용자 확정: 행은 연결 거래처 기준, 수금 대상(영업지원 작업
// 목록)은 분리 유지). 경과 구간은 경과기간 분석 API 그대로, 기간 매출·수금(매입·지급)·비율·상태·담당은
// 허브 API 그대로 가져와 거래처 id로 합친다. 연결되지 않은 ERP 별칭은 '미연결' 행으로 따로 보인다.

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ErpAgingRow, AgingBuckets } from '@/types/erp'
import { getPeriodRange } from '@/lib/period-presets'

const won = (n: number | null | undefined) => `${Math.round(n ?? 0).toLocaleString('ko-KR')}원`
const eok = (n: number) => {
  const a = Math.abs(n)
  if (a >= 1e8) return `${(n / 1e8).toFixed(2)}억`
  if (a >= 1e4) return `${Math.round(n / 1e4).toLocaleString('ko-KR')}만`
  return `${Math.round(n).toLocaleString('ko-KR')}원`
}
const emptyTotal: AgingBuckets = { bucket_30: 0, bucket_60: 0, bucket_90: 0, bucket_over: 0, total: 0 }
type BucketKey = 'bucket_30' | 'bucket_60' | 'bucket_90' | 'bucket_over'

// 허브(매출처 관리·매입처 관리) 행에서 이 화면이 쓰는 공통 모양
interface HubInfo {
  vendor_id: string
  vendor_name: string
  staff: string | null
  period_amount: number   // 기간 매출(ERP 순매출) / 기간 매입(계산서)
  settled: number         // 수금액 / 지급액
  last_date: string | null
  status: string
  href: string
}

interface MergedRow extends AgingBuckets {
  key: string
  vendor_id: string | null
  name: string
  erp_names: string[]     // 합쳐진 ERP 별칭 표기
  opening: number         // 기초이월 잔여 (경과 구간에 포함됨)
  hub: HubInfo | null
}

export interface AgingManageConfig {
  side: 'receivable' | 'payable'
  title: string
  description: string
  agingApi: string          // /api/reports/receivables-aging
  hubApi: string            // /api/vendor-hub
  hubLabel: string          // 매출처 관리
  hubDetailBase: string     // /sales-hub
  counterpartyLabel: string // 매출처 / 매입처
  amountLabel: string       // 기간 매출 / 기간 매입
  settledLabel: string      // 수금액 / 지급액
  ratioLabel: string        // 수금율 / 지급율
  balanceLabel: string      // 미수 잔액 / 미지급 잔액
  totalLabel: string        // 미수 총계 / 미지급 총계
  statusMeta: Record<string, { label: string; cls: string }>
  mapHubRow: (r: Record<string, unknown>) => HubInfo
  unlinkedHref: string      // 별칭 연결 화면
  workLink?: { label: string; href: string }   // 영업지원 작업 목록 바로가기 (수금 대상 등)
}

const RECEIVABLE_STATUS = {
  normal:      { label: '정상',           cls: 'bg-green-100 text-green-700' },
  outstanding: { label: '미수',           cls: 'bg-amber-100 text-amber-700' },
  late:        { label: '수금지연',       cls: 'bg-orange-100 text-orange-700' },
  over90:      { label: '미수 90일 초과', cls: 'bg-red-100 text-red-700' },
  dormant:     { label: '휴면 전환',      cls: 'bg-gray-100 text-gray-500' },
}
const PAYABLE_STATUS = {
  normal:   { label: '정상',             cls: 'bg-green-100 text-green-700' },
  unpaid:   { label: '미지급',           cls: 'bg-amber-100 text-amber-700' },
  over90:   { label: '미지급 90일 초과', cls: 'bg-red-100 text-red-700' },
  overpaid: { label: '과다지급',         cls: 'bg-violet-100 text-violet-700' },
  dormant:  { label: '휴면 전환',        cls: 'bg-gray-100 text-gray-500' },
  retail:   { label: '별도 구매처',      cls: 'bg-sky-100 text-sky-700' },
}

export const RECEIVABLE_CONFIG: AgingManageConfig = {
  side: 'receivable',
  title: '미수금 관리',
  description: '매출처별 미수 잔액을 기준일 기준 경과기간으로 나눠 확인합니다. 경과 구간은 ERP 주문일 기준, 기간 매출·수금·상태는 매출처 관리와 같은 값입니다.',
  agingApi: '/api/reports/receivables-aging',
  hubApi: '/api/vendor-hub',
  hubLabel: '매출처 관리',
  hubDetailBase: '/sales-hub',
  counterpartyLabel: '매출처',
  amountLabel: '기간 매출',
  settledLabel: '수금액',
  ratioLabel: '수금율',
  balanceLabel: '미수 잔액',
  totalLabel: '미수 총계',
  statusMeta: RECEIVABLE_STATUS,
  mapHubRow: r => ({
    vendor_id: r.vendor_id as string, vendor_name: r.vendor_name as string, staff: (r.staff_primary as string | null) ?? null,
    period_amount: (r.net as number) ?? 0, settled: (r.collected as number) ?? 0,
    last_date: (r.last_order_date as string | null) ?? null, status: (r.status as string) ?? 'normal',
    href: `/sales-hub/${r.vendor_id}`,
  }),
  unlinkedHref: '/erp-aliases?type=customer',
  workLink: { label: '수금 대상', href: '/reports/erp-receivables' },
}

export const PAYABLE_CONFIG: AgingManageConfig = {
  side: 'payable',
  title: '미지급금 관리',
  description: '매입처별 미지급 잔액을 기준일 기준 경과기간으로 나눠 확인합니다. 경과 구간은 정산월 말일 기준, 기간 매입·지급·상태는 매입처 관리와 같은 값입니다.',
  agingApi: '/api/reports/payables-aging',
  hubApi: '/api/purchase-hub',
  hubLabel: '매입처 관리',
  hubDetailBase: '/purchase-hub',
  counterpartyLabel: '매입처',
  amountLabel: '기간 매입',
  settledLabel: '지급액',
  ratioLabel: '지급율',
  balanceLabel: '미지급 잔액',
  totalLabel: '미지급 총계',
  statusMeta: PAYABLE_STATUS,
  mapHubRow: r => ({
    vendor_id: r.vendor_id as string, vendor_name: r.vendor_name as string, staff: (r.staff_primary as string | null) ?? null,
    period_amount: (r.invoice_total as number) ?? 0, settled: (r.paid_amount as number) ?? 0,
    last_date: (r.last_purchase_date as string | null) ?? null, status: (r.status as string) ?? 'normal',
    href: `/purchase-hub/${r.vendor_id}`,
  }),
  unlinkedHref: '/erp-aliases?type=purchase',
  workLink: { label: '결제 예외', href: '/purchase-hub?tab=exceptions' },
}

const BUCKETS: { key: BucketKey; label: string; cls: string; strong: string }[] = [
  { key: 'bucket_30',   label: '30일 이내', cls: 'text-gray-700',   strong: 'text-gray-900' },
  { key: 'bucket_60',   label: '31~60일',   cls: 'text-amber-600',  strong: 'text-amber-600' },
  { key: 'bucket_90',   label: '61~90일',   cls: 'text-orange-600', strong: 'text-orange-600' },
  { key: 'bucket_over', label: '90일 초과', cls: 'text-red-600',    strong: 'text-red-600' },
]

// 허브 정보가 없는(미연결) 행의 상태는 경과 구간으로 판정
const statusFromBuckets = (r: AgingBuckets, side: 'receivable' | 'payable') =>
  r.bucket_over > 0 ? 'over90' : r.bucket_90 > 0 ? (side === 'receivable' ? 'late' : 'unpaid') : (side === 'receivable' ? 'outstanding' : 'unpaid')

export default function AgingManage({ cfg }: { cfg: AgingManageConfig }) {
  const [aging, setAging] = useState<ErpAgingRow[]>([])
  const [total, setTotal] = useState<AgingBuckets>(emptyTotal)
  const [hub, setHub] = useState<Map<string, HubInfo>>(new Map())
  const [hubDenied, setHubDenied] = useState(false)
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)

  const [bucketFilter, setBucketFilter] = useState<BucketKey | 'opening' | null>(null)
  const [staffFilter, setStaffFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }
  const periodFrom = useMemo(() => getPeriodRange('당년').from, [])

  const load = useCallback(async () => {
    setLoading(true)
    const [ar, hr] = await Promise.all([
      fetch(`${cfg.agingApi}?asOf=${asOf}`).then(r => r.json()).catch(() => null),
      fetch(`${cfg.hubApi}?from=${periodFrom}&to=${asOf}`).then(async r => ({ ok: r.ok, status: r.status, json: await r.json().catch(() => null) })).catch(() => null),
    ])
    if (ar && Array.isArray(ar.data)) { setAging(ar.data); setTotal(ar.total ?? emptyTotal) }
    else showMsg(`조회 실패: ${ar?.error ?? '알 수 없는 오류'}`)
    if (hr?.ok && Array.isArray(hr.json?.rows)) {
      const m = new Map<string, HubInfo>()
      for (const r of hr.json.rows as Record<string, unknown>[]) { const h = cfg.mapHubRow(r); m.set(h.vendor_id, h) }
      setHub(m); setHubDenied(false)
    } else setHubDenied(true)
    setLoading(false)
  }, [cfg, asOf, periodFrom])

  useEffect(() => { load() }, [load])

  // 경과기간 행(ERP 별칭·기초이월)을 연결 거래처 기준으로 합친다. 미연결 별칭은 별칭 단위 행.
  const rows = useMemo<MergedRow[]>(() => {
    const m = new Map<string, MergedRow>()
    for (const r of aging) {
      const isOpening = r.alias_id === null && r.erp_name.endsWith('(기초이월)')
      const key = r.vendor_id ? `v:${r.vendor_id}` : `a:${r.alias_id ?? 'none'}`
      let g = m.get(key)
      if (!g) {
        g = { key, vendor_id: r.vendor_id, name: r.vendor_name ?? r.erp_name, erp_names: [], opening: 0, hub: r.vendor_id ? hub.get(r.vendor_id) ?? null : null, ...emptyTotal }
        m.set(key, g)
      }
      if (isOpening) g.opening += r.total
      else if (!g.erp_names.includes(r.erp_name)) g.erp_names.push(r.erp_name)
      for (const b of BUCKETS) g[b.key] += r[b.key]
      g.total += r.total
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total)
  }, [aging, hub])

  const openingTotal = useMemo(() => rows.reduce((s, r) => s + r.opening, 0), [rows])
  const staffNames = useMemo(() => Array.from(new Set(rows.map(r => r.hub?.staff).filter((s): s is string => !!s))).sort((a, b) => a.localeCompare(b, 'ko')), [rows])
  const statusOf = (r: MergedRow) => r.hub?.status ?? statusFromBuckets(r, cfg.side)

  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
  const visible = useMemo(() => rows.filter(r => {
    if (bucketFilter === 'opening' ? r.opening <= 0 : bucketFilter ? r[bucketFilter] <= 0 : false) return false
    if (staffFilter && r.hub?.staff !== staffFilter) return false
    if (statusFilter && statusOf(r) !== statusFilter) return false
    if (search) { const q = norm(search); if (!norm(r.name).includes(q) && !r.erp_names.some(n => norm(n).includes(q))) return false }
    return true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows, bucketFilter, staffFilter, statusFilter, search])

  const sum = (k: keyof AgingBuckets) => visible.reduce((s, r) => s + r[k], 0)
  const cardCls = (on: boolean) => `text-left border rounded-lg px-4 py-3 flex-1 min-w-[140px] transition-colors ${on ? 'border-slate-900 ring-1 ring-slate-900' : 'border-gray-200 hover:bg-gray-50'}`

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-1 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{cfg.title}</h1>
          <p className="text-sm mt-1 text-gray-500">{cfg.description}</p>
        </div>
        <button onClick={() => { const a = document.createElement('a'); a.href = `${cfg.agingApi}/export?asOf=${asOf}`; a.click() }}
          className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 whitespace-nowrap">↓ 엑셀</button>
      </div>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      {hubDenied && !loading && (
        <div className="mb-3 mt-2 px-4 py-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg">
          {cfg.hubLabel} 조회 권한이 없거나 조회에 실패해 {cfg.amountLabel}·{cfg.settledLabel}·담당·상태 열은 비어 있습니다. 경과 구간은 정상 표시됩니다.
        </div>
      )}

      {/* 필터 */}
      <div className="flex items-center gap-2 mb-4 mt-3 flex-wrap">
        <span className="text-sm text-gray-500">기준일</span>
        <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
        <span className="w-px h-5 bg-gray-200 mx-1" />
        <select value={staffFilter} onChange={e => setStaffFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">담당직원: 전체</option>
          {staffNames.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">상태: 전체</option>
          {Object.entries(cfg.statusMeta).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`${cfg.counterpartyLabel} · ERP 표기 검색`}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-slate-900" />
        {(bucketFilter || staffFilter || statusFilter || search) && (
          <button onClick={() => { setBucketFilter(null); setStaffFilter(''); setStatusFilter(''); setSearch('') }} className="text-xs text-gray-500 underline">필터 해제</button>
        )}
      </div>

      {/* 요약 카드 — 클릭하면 그 구간에 잔액이 있는 거래처만 */}
      <div className="flex gap-3 flex-wrap mb-5">
        <button onClick={() => setBucketFilter(null)} className={cardCls(bucketFilter === null)}>
          <p className="text-xs text-gray-400 mb-1">{cfg.totalLabel}</p>
          <p className="text-lg font-bold text-red-600">{won(total.total)}</p>
          <p className="text-xs text-gray-400">{rows.length.toLocaleString()}곳</p>
        </button>
        {BUCKETS.map(b => (
          <button key={b.key} onClick={() => setBucketFilter(f => f === b.key ? null : b.key)} className={cardCls(bucketFilter === b.key)}>
            <p className="text-xs text-gray-400 mb-1">{b.label}</p>
            <p className={`text-lg font-bold ${b.strong}`}>{won(total[b.key])}</p>
            <p className="text-xs text-gray-400">{rows.filter(r => r[b.key] > 0).length.toLocaleString()}곳</p>
          </button>
        ))}
        <button onClick={() => setBucketFilter(f => f === 'opening' ? null : 'opening')} className={cardCls(bucketFilter === 'opening')}>
          <p className="text-xs text-gray-400 mb-1">기초이월 잔여</p>
          <p className="text-lg font-bold text-gray-900">{won(openingTotal)}</p>
          <p className="text-xs text-gray-400">기초잔액(거래처) 미회수분 · 구간에 포함</p>
        </button>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : visible.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">{rows.length === 0 ? `${cfg.balanceLabel.replace(' 잔액', '')}이 없습니다.` : '조건에 맞는 거래처가 없습니다.'}</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 font-medium">{cfg.counterpartyLabel} (ERP 표기)</th>
                <th className="py-2.5 px-3 font-medium">담당직원</th>
                <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">{cfg.amountLabel} (당년)</th>
                <th className="py-2.5 px-3 font-medium text-right">{cfg.settledLabel}</th>
                <th className="py-2.5 px-3 font-medium w-28">{cfg.ratioLabel}</th>
                <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">{cfg.balanceLabel}</th>
                {BUCKETS.map(b => <th key={b.key} className="py-2.5 px-3 font-medium text-right whitespace-nowrap">{b.label}</th>)}
                <th className="py-2.5 px-3 font-medium whitespace-nowrap">최근 {cfg.side === 'receivable' ? '주문' : '매입'}</th>
                <th className="py-2.5 px-3 font-medium">상태</th>
                <th className="py-2.5 px-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, 300).map(r => {
                const h = r.hub
                const ratio = h && h.period_amount > 0 ? Math.min(1, h.settled / h.period_amount) : null
                const st = statusOf(r)
                const meta = cfg.statusMeta[st] ?? { label: st, cls: 'bg-gray-100 text-gray-600' }
                return (
                  <tr key={r.key} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {r.vendor_id
                          ? <Link href={`${cfg.hubDetailBase}/${r.vendor_id}`} className="font-semibold text-gray-900 hover:underline truncate max-w-[240px]">{r.name}</Link>
                          : <span className="font-semibold text-gray-900 truncate max-w-[240px]">{r.name}</span>}
                        {!r.vendor_id && <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">미연결</span>}
                      </div>
                      {r.erp_names.length > 0 && r.erp_names.join(', ') !== r.name && (
                        <p className="text-[11px] text-gray-400 truncate max-w-[260px]" title={r.erp_names.join(', ')}>{r.erp_names.join(', ')}</p>
                      )}
                      {r.opening > 0 && <p className="text-[11px] text-gray-400">기초이월 {eok(r.opening)} 포함</p>}
                    </td>
                    <td className="py-2 px-3 text-gray-600 whitespace-nowrap">{h?.staff ?? <span className="text-gray-300">-</span>}</td>
                    <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">{h ? won(h.period_amount) : <span className="text-gray-300">-</span>}</td>
                    <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">{h ? won(h.settled) : <span className="text-gray-300">-</span>}</td>
                    <td className="py-2 px-3">
                      {ratio === null ? <span className="text-gray-300 text-xs">-</span> : (
                        <div className="flex items-center gap-1.5">
                          <div className="h-1.5 w-14 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-slate-800 rounded-full" style={{ width: `${ratio * 100}%` }} /></div>
                          <span className="tabular-nums text-xs">{(ratio * 100).toFixed(0)}%</span>
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap font-semibold text-red-600">{won(r.total)}</td>
                    {BUCKETS.map(b => (
                      <td key={b.key} className={`py-2 px-3 text-right tabular-nums whitespace-nowrap ${r[b.key] > 0 ? b.cls : 'text-gray-300'}`}>{r[b.key] > 0 ? won(r[b.key]) : '-'}</td>
                    ))}
                    <td className="py-2 px-3 text-xs text-gray-500 tabular-nums whitespace-nowrap">{h?.last_date ?? '-'}</td>
                    <td className="py-2 px-3"><span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap ${meta.cls}`}>{meta.label}</span></td>
                    <td className="py-2 px-3 whitespace-nowrap text-xs">
                      {r.vendor_id ? (
                        <>
                          <Link href={`${cfg.hubDetailBase}/${r.vendor_id}`} className="text-blue-600 hover:underline mr-2">{cfg.hubLabel.replace(' 관리', '')}</Link>
                          {cfg.workLink && <Link href={cfg.side === 'payable' ? `${cfg.workLink.href}&vendor=${r.vendor_id}` : cfg.workLink.href} className="text-blue-600 hover:underline">{cfg.workLink.label}</Link>}
                        </>
                      ) : (
                        <Link href={cfg.unlinkedHref} className="text-blue-600 hover:underline">별칭 연결</Link>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 font-medium text-gray-900">
                <td className="py-2.5 px-3" colSpan={5}>합계 ({visible.length.toLocaleString()}곳{visible.length > 300 ? ', 상위 300곳 표시' : ''})</td>
                <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap text-red-700">{won(sum('total'))}</td>
                {BUCKETS.map(b => <td key={b.key} className={`py-2.5 px-3 text-right tabular-nums whitespace-nowrap ${b.strong}`}>{won(sum(b.key))}</td>)}
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-3">
        · 요약 카드를 누르면 그 구간에 잔액이 있는 거래처만 남습니다. · {cfg.balanceLabel}과 경과 구간은 기준일 기준 경과기간 분석 값이고,
        {cfg.amountLabel}·{cfg.settledLabel}·{cfg.ratioLabel}·상태는 {cfg.hubLabel}(당년 1월 1일 ~ 기준일)과 같은 값입니다.
        · 기초이월 잔여는 기초잔액(거래처) 탭의 잔여(기초잔액 - 회수 누계)로, 경과 구간에도 들어 있습니다.
        · 미연결 행은 ERP 표기가 거래처에 연결되지 않은 건 — 별칭 연결 후 거래처 행으로 합쳐집니다.
      </p>
    </div>
  )
}
