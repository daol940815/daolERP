'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import PoDetail from '../../po-detail'
import PoReviseModal from '../../po-revise-modal'
import { fillMailTemplate, poMailVars, type PoExcelData } from '@/lib/po-form'

import { btnCls, fieldBox } from '@/components/ui/kit'
// 발주서 발송 페이지 (시안 v3, 2026-08-20 사용자 확정) — 발송 업무 전용 화면.
// 흐름: 1 발주서 확인(다운로드 우선) → 2 첨부(수정본 업로드 시 자동 생성본 대체)
//      → 3 메일 작성(프리셋·치환 변수) → 4 발송(실제 발송 내용은 로그로 보존).
// 배송(송장번호)은 이 화면에 없다 — 4페이즈에서 주문서 내역에 구현 (사용자 확정).

interface Po {
  id: string; po_no: string; order_id: string; vendor_name: string
  total_amount: number; delivery_note: string | null; email_to: string | null
  send_method: string | null; sent_at: string | null; status: string; created_at: string
  uses_custom_po?: boolean; po_use_sale_price?: boolean
}
interface Preset {
  id: string; name: string; subject: string; body: string
  is_default: boolean; editor_name: string | null; updated_at: string
}
interface Attachment {
  id: string; kind: 'replace' | 'extra'; file_name: string; size_bytes: number
  created_at: string; uploader_name: string | null
}
interface SendLog {
  id: string; method: string; email_to: string | null; subject: string | null
  attachment_names: string[] | null; ok: boolean; error: string | null
  sent_at: string; sender_name: string | null
}

const won = (n: number) => (n ?? 0).toLocaleString('ko-KR')
const kb = (n: number) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`
const VARS = ['{발주번호}', '{매입처명}', '{주문번호}', '{주문처}', '{은행명}', '{지점명}',
  '{상품명}', '{품목목록}', '{품목수}', '{합계금액}', '{출고요청일}', '{발주담당자}']

export default function PoSendPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  // 돌아가기 (2026-11-24 사용자 결정 — 나안): 주문 상세에서 들어왔으면(?from=order) 주문 상세로, 그 밖(발주서 이력 등)은 발주서 이력으로
  const fromOrder = useSearchParams().get('from') === 'order'

  const [po, setPo] = useState<Po | null>(null)
  const [order, setOrder] = useState<{ order_no: string | null } | null>(null)
  const [form, setForm] = useState<PoExcelData | null>(null)
  const [itemCount, setItemCount] = useState(0)
  const [smtpReady, setSmtpReady] = useState(false)
  const [logs, setLogs] = useState<SendLog[]>([])
  // 수정 내용 반영 (519): 주문 수정으로 바뀐 발주서 줄 수 · 반영 이력 · 창
  const [brokenCount, setBrokenCount] = useState(0)
  const [revisions, setRevisions] = useState<{ revised_at: string; reviser_name: string | null; summary: string; total_before: number; total_after: number }[]>([])
  const [revising, setRevising] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachHint, setAttachHint] = useState<string | null>(null)
  const [presets, setPresets] = useState<Preset[]>([])

  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [mailBody, setMailBody] = useState('')
  const [presetId, setPresetId] = useState<string | null>(null)
  const [mailTouched, setMailTouched] = useState(false)

  const [showPreview, setShowPreview] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // 출력 양식 (2026-11-09): vendor = 업체 업로드 양식(사용 중) · code = 코드 자체 양식 · standard = 자사 기본
  const [output, setOutput] = useState<{
    kind: 'vendor' | 'code' | 'standard'; vendor_form: { id: string; version: number; file_name: string } | null
    warnings: string[]; error: string | null; draft_version?: number | null; vendor_id?: string | null
    file_name?: string   // 자동 생성본 파일 이름 (2026-11-12 — 서버 poFileName과 같은 값)
  } | null>(null)

  // 프리셋 관리 모달
  const [managing, setManaging] = useState(false)
  const [editing, setEditing] = useState<{ id: string | null; name: string; subject: string; body: string } | null>(null)

  const vars = form ? poMailVars(form, order?.order_no ?? null) : {}
  const applyPreset = useCallback((p: Preset, force?: boolean) => {
    if (!force && mailTouched && !confirm('작성 중인 제목·본문을 프리셋 내용으로 덮어쓸까요?')) return
    setPresetId(p.id)
    setSubject(fillMailTemplate(p.subject, vars))
    setMailBody(fillMailTemplate(p.body, vars))
    setMailTouched(false)
  }, [mailTouched, vars])   // eslint-disable-line react-hooks/exhaustive-deps

  const loadPresets = useCallback(async () => {
    const res = await fetch('/api/orders-portal/po-presets')
    const json = await res.json()
    if (res.ok) setPresets(json.presets ?? [])
    return res.ok ? (json.presets ?? []) as Preset[] : []
  }, [])

  const loadAttachments = useCallback(async () => {
    const res = await fetch(`/api/orders-portal/purchase-orders/${id}/attachments`)
    const json = await res.json()
    if (res.ok) { setAttachments(json.attachments ?? []); setAttachHint(json.hint ?? null) }
  }, [id])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const res = await fetch(`/api/orders-portal/purchase-orders/${id}`)
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? '조회 실패'); setLoading(false); return }
    setPo(json.po); setOrder(json.order ?? null); setForm(json.form ?? null)
    setOutput(json.output ?? null)
    setItemCount((json.items ?? []).length)
    setSmtpReady(!!json.smtp_ready)
    setLogs(json.send_logs ?? [])
    setRevisions(json.revisions ?? [])
    setBrokenCount(json.po?.status === 'active'
      ? ((json.items ?? []) as { order_item_id: string | null; order_item_canceled?: boolean }[]).filter(it => !it.order_item_id || it.order_item_canceled).length
      : 0)
    setTo(prev => prev || (json.po?.email_to ?? ''))
    const ps = await loadPresets()
    // 기본 프리셋 자동 적용 (아직 작성 전일 때만)
    if (json.form) {
      const def = ps.find(p => p.is_default) ?? ps[0]
      if (def) {
        const v = poMailVars(json.form, json.order?.order_no ?? null)
        setPresetId(def.id)
        setSubject(s => s || fillMailTemplate(def.subject, v))
        setMailBody(b => b || fillMailTemplate(def.body, v))
      }
    }
    await loadAttachments()
    setLoading(false)
  }, [id, loadPresets, loadAttachments])
  useEffect(() => { load() }, [load])

  const upload = async (file: File, kind: 'replace' | 'extra') => {
    setBusy(true); setError(null); setNotice(null)
    const fd = new FormData()
    fd.append('file', file); fd.append('kind', kind)
    const res = await fetch(`/api/orders-portal/purchase-orders/${id}/attachments`, { method: 'POST', body: fd })
    const json = await res.json()
    setBusy(false)
    if (!res.ok) { setError(json.error ?? '업로드 실패'); return }
    setNotice(kind === 'replace'
      ? '수정본이 업로드되었습니다 — 발송 시 자동 생성본 대신 이 파일이 첨부됩니다.'
      : '추가 자료가 첨부되었습니다.')
    loadAttachments()
  }

  const removeAttachment = async (a: Attachment) => {
    if (!confirm(`첨부를 제거할까요? ${a.file_name}`)) return
    setBusy(true)
    const res = await fetch(`/api/orders-portal/purchase-orders/${id}/attachments?aid=${a.id}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? '삭제 실패'); return }
    loadAttachments()
  }

  const patch = async (bodyObj: Record<string, unknown>, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return false
    setBusy(true); setError(null); setNotice(null)
    const res = await fetch(`/api/orders-portal/purchase-orders/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(json.error ?? '처리 실패'); await load(); return false }
    return true
  }

  const sendMail = async () => {
    const addr = to.trim()
    if (!addr || !addr.includes('@')) { setError('받는 이메일을 확인해주세요.'); return }
    const replaced = attachments.filter(a => a.kind === 'replace').length
    const attDesc = replaced
      ? `수정본 ${replaced}건${attachments.length > replaced ? ` + 추가 ${attachments.length - replaced}건` : ''} (자동 생성본 제외)`
      : `자동 생성 발주서${attachments.length ? ` + 추가 ${attachments.length}건` : ''}`
    const ok = await patch(
      { action: 'send_email', to: addr, subject, mail_body: mailBody },
      `${addr} 주소로 발송할까요?\n첨부: ${attDesc}${po?.sent_at ? '\n(재발송)' : ''}`)
    if (ok) { setNotice('메일이 발송되었습니다.'); await load() }
  }

  const manualSent = async () => {
    const ok = await patch({ action: 'manual_sent' },
      po?.sent_at ? '발송 기록을 지금 시각으로 다시 남길까요?' : '수동 발송(메일 외 방법)으로 기록할까요?')
    if (ok) { setNotice('수동 발송으로 기록되었습니다.'); await load() }
  }

  const cancelPo = async () => {
    const ok = await patch({ action: 'cancel' }, '이 발주서를 취소할까요? 담긴 품목은 미발주로 돌아갑니다.')
    // 취소하면 품목이 주문 상세에서 미발주로 돌아가므로 다시 발주할 수 있게 그 주문 상세로 (2026-11-24 사용자 결정)
    if (ok) router.push(po?.order_id ? `/orders/${po.order_id}` : '/orders/purchase')
  }

  // 프리셋 저장 (관리 모달)
  const savePreset = async () => {
    if (!editing) return
    const action = editing.id ? 'update' : 'create'
    setBusy(true); setError(null)
    const res = await fetch('/api/orders-portal/po-presets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id: editing.id ?? undefined, name: editing.name, subject: editing.subject, body: editing.body }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(json.error ?? '저장 실패'); return }
    setEditing(null)
    loadPresets()
  }
  const presetAct = async (action: 'delete' | 'set_default', p: Preset) => {
    if (action === 'delete' && !confirm(`프리셋을 삭제할까요? ${p.name}\n(과거 발송 이력에는 영향 없음)`)) return
    setBusy(true)
    const res = await fetch('/api/orders-portal/po-presets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id: p.id }),
    })
    setBusy(false)
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? '처리 실패'); return }
    loadPresets()
  }

  if (loading) return <div className="text-center py-16 text-slate-500">로딩 중...</div>
  if (error && !po) return <div className="px-4 py-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>
  if (!po) return null

  const active = po.status === 'active'
  const badge = (cls: string, label: string, title?: string) => (
    <span title={title} className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>{label}</span>
  )
  const secTitle = 'text-sm font-bold text-slate-900 flex items-center gap-2 flex-wrap'
  const stepNo = 'inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-900 text-white text-xs shrink-0'
  const sub = 'text-xs font-normal text-slate-500'
  const inputCls = fieldBox()

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        {fromOrder
          ? <Link href={`/orders/${po.order_id}`} className="text-sm text-slate-500 hover:text-slate-700">← 주문 상세{order?.order_no ? ` (${order.order_no})` : ''}</Link>
          : <Link href="/orders/purchase" className="text-sm text-slate-500 hover:text-slate-700">← 발주서 이력</Link>}
        <h1 className="text-2xl font-bold text-slate-900">발주서 {po.po_no}</h1>
        <span className="text-slate-700 text-sm">{po.vendor_name}</span>
        {output?.kind === 'vendor' && output.vendor_form
          ? badge('bg-violet-100 text-violet-700', `업체 양식 v${output.vendor_form.version}`, `매입처 상세 › 발주서 양식에서 사용 중인 업체 양식(${output.vendor_form.file_name})으로 다운로드 · 메일 첨부됩니다`)
          : po.uses_custom_po && badge('bg-violet-50 text-violet-600', '자체 양식', '자체 발주서 양식을 쓰는 매입처 — 수정본 업로드·수동 발송 기록 권장')}
        {po.po_use_sale_price && badge('bg-blue-50 text-blue-600', '판매가 발주', '발주서 금액이 매입가 대신 판매가로 기재됩니다')}
        {po.status === 'canceled'
          ? badge('bg-slate-100 text-slate-500', '취소됨')
          : po.sent_at
            ? badge('bg-emerald-100 text-emerald-700', po.send_method === 'email' ? '메일 발송됨' : '수동 발송됨')
            : badge('bg-amber-100 text-amber-800', '미발송')}
        {active && (
          <button onClick={cancelPo} disabled={busy}
            className={btnCls('danger', 'md', 'ml-auto')}>발주 취소</button>
        )}
      </div>

      {error && <div className="mt-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}
      {notice && <div className="mt-3 px-4 py-2.5 bg-emerald-50 text-emerald-700 text-sm rounded-lg">{notice}</div>}
      {active && brokenCount > 0 && (
        <div className="mt-3 flex items-center gap-2 flex-wrap px-4 py-2.5 bg-red-50 rounded-lg">
          <span className="text-sm font-semibold text-red-700">주문 수정됨 — 품목 {brokenCount}건 바뀜</span>
          <span className="text-sm text-slate-700">수정본을 보내거나 수동 발송 기록을 남긴 뒤 &lsquo;수정 내용 반영&rsquo;을 누르세요. 다시 보내지 않을 거면 발주 취소 후 재발주.</span>
          <button onClick={() => setRevising(true)} className="ml-auto px-3 py-1.5 bg-blue-700 text-white rounded-lg text-sm font-semibold">수정 내용 반영</button>
        </div>
      )}
      {!smtpReady && active && (
        <div className="mt-3 px-4 py-2.5 bg-amber-50 text-amber-800 text-sm rounded-lg">
          메일 발송 미설정(SMTP 환경변수) — 엑셀 다운로드 후 수동 발송 기록으로 처리하세요.
        </div>
      )}

      {/* 1. 발주서 확인 */}
      <div className="bg-white border border-slate-300 rounded-xl p-4 mt-4">
        <div className={secTitle}>
          <span className={stepNo}>1</span>발주서 확인
          <span className={sub}>작성된 발주서를 내려받아 검토하세요</span>
        </div>
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <a href={`/api/orders-portal/purchase-orders/${po.id}?excel=1`}
            className="px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold">발주서 엑셀 다운로드</a>
          <button onClick={() => setShowPreview(v => !v)}
            className={btnCls('secondary', 'md')}>
            {showPreview ? '미리보기 접기' : '화면 미리보기'}
          </button>
          <span className="text-xs text-slate-500">
            주문 <Link href={`/orders/${po.order_id}`} className="text-blue-700 hover:underline tabular-nums">{order?.order_no ?? '(주문 상세)'}</Link>
            {' · '}{form?.customer ?? '-'} · 품목 {itemCount}건 · 합계 {won(po.total_amount)}원
          </span>
        </div>
        {output?.kind === 'vendor' && output.vendor_form && (
          <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${output.error ? 'bg-red-50 text-red-700' : output.warnings.length ? 'bg-amber-50 text-amber-800' : 'bg-violet-50 text-violet-800'}`}>
            <div>
              업체 양식 <b>버전 {output.vendor_form.version}</b>({output.vendor_form.file_name})으로 다운로드 · 메일 첨부됩니다.
              {showPreview && ' 아래 화면 미리보기는 자사 양식 기준의 데이터 확인용입니다.'}
            </div>
            {output.error && <div className="mt-1 font-semibold">{output.error}</div>}
            {output.warnings.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs space-y-0.5">{output.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            )}
          </div>
        )}
        {/* 자사 기본 양식의 확인 알림 — 택배비 수량 확인 필요 등 (2026-11-12) */}
        {output && output.kind === 'standard' && output.warnings.length > 0 && (
          <div className="mt-3 rounded-lg px-3 py-2 text-sm bg-amber-50 text-amber-800">
            <ul className="list-disc pl-5 text-xs space-y-0.5">{output.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}
        {output && output.kind !== 'vendor' && output.draft_version != null && (
          <div className="mt-3 rounded-lg px-3 py-2 text-sm bg-amber-50 text-amber-800">
            업체 양식 버전 {output.draft_version}이 아직 &lsquo;작성 중&rsquo;이라 {output.kind === 'code' ? '코드 자체 양식' : '자사 기본 양식'}으로 나갑니다.
            {' '}매입처 상세 › 발주서 양식에서 <b>사용 시작</b>을 누르면 그 양식으로 바뀝니다.
            {output.vendor_id && <> <Link href={`/orders/purchase-hub/${output.vendor_id}`} className="underline">매입처 상세로</Link></>}
          </div>
        )}
        {showPreview && <div className="mt-3"><PoDetail poId={po.id} /></div>}
      </div>

      {/* 2. 첨부 파일 */}
      <div className="bg-white border border-slate-300 rounded-xl p-4 mt-3">
        <div className={secTitle}>
          <span className={stepNo}>2</span>첨부 파일
          <span className={sub}>기본은 자동 생성 발주서 — 수정본을 올리면 그 파일로 발송</span>
        </div>
        {attachHint ? (
          <div className="mt-3 text-sm text-amber-700">{attachHint}</div>
        ) : (
          <div className="mt-3 space-y-2">
            {/* 자동 생성본: 수정본 없을 때만 발송 대상 */}
            <div className={`flex items-center gap-2.5 border rounded-lg px-3 py-2 text-sm ${
              attachments.some(a => a.kind === 'replace') ? 'border-slate-200 bg-slate-50 text-slate-500' : 'border-slate-300 bg-slate-50/60'}`}>
              {badge('bg-slate-200/70 text-slate-700', '자동')}
              <span className="font-medium break-all">{output?.file_name ?? `발주서_${po.po_no}_${po.vendor_name}.xlsx`}</span>
              {output?.kind === 'vendor' && output.vendor_form && badge('bg-violet-100 text-violet-700', `업체 양식 v${output.vendor_form.version}`)}
              <span className="text-xs text-slate-500">
                {attachments.some(a => a.kind === 'replace')
                  ? '수정본이 있어 발송에서 제외됩니다'
                  : '발송 시점의 발주 데이터로 자동 생성'}
              </span>
            </div>
            {attachments.map(a => (
              <div key={a.id} className={`flex items-center gap-2.5 border rounded-lg px-3 py-2 text-sm ${
                a.kind === 'replace' ? 'border-blue-200 bg-blue-50/50' : 'border-slate-300'}`}>
                {badge(a.kind === 'replace' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200/70 text-slate-700',
                  a.kind === 'replace' ? '수정본' : '추가')}
                <span className="font-medium">{a.file_name}</span>
                <span className="text-xs text-slate-500">
                  {kb(a.size_bytes)}{a.uploader_name ? ` · ${a.uploader_name}` : ''} · {a.created_at.slice(5, 16).replace('T', ' ')}
                </span>
                <span className="ml-auto flex gap-1.5">
                  <a href={`/api/orders-portal/purchase-orders/${po.id}/attachments?download=${a.id}`}
                    className={btnCls('secondary', 'sm')}>다운로드</a>
                  {active && (
                    <button onClick={() => removeAttachment(a)} disabled={busy}
                      className={btnCls('danger', 'sm')}>제거</button>
                  )}
                </span>
              </div>
            ))}
            {active && (
              <div className="flex items-center gap-2 flex-wrap pt-1">
                <label className="px-3.5 py-1.5 border border-blue-300 text-blue-700 rounded-lg text-xs cursor-pointer hover:bg-blue-50">
                  발주서 수정본 업로드 (자동 생성본 대체)
                  <input type="file" className="hidden" disabled={busy}
                    onChange={e => { const f = e.target.files?.[0]; if (f) upload(f, 'replace'); e.target.value = '' }} />
                </label>
                <label className="px-3.5 py-1.5 border border-slate-400 text-slate-700 rounded-lg text-xs cursor-pointer hover:bg-slate-50">
                  + 추가 자료 첨부
                  <input type="file" className="hidden" disabled={busy}
                    onChange={e => { const f = e.target.files?.[0]; if (f) upload(f, 'extra'); e.target.value = '' }} />
                </label>
                <span className="text-xs text-slate-500">파일당 10MB 이하 · 엑셀·PDF·이미지 등</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. 메일 작성 */}
      <div className="bg-white border border-slate-300 rounded-xl p-4 mt-3">
        <div className={secTitle}>
          <span className={stepNo}>3</span>메일 작성
          <span className={sub}>프리셋을 고르면 제목·본문이 채워지고, 자유롭게 수정해 발송</span>
        </div>
        <div className="grid md:grid-cols-2 gap-3 mt-3">
          <div>
            <label className="block text-xs text-slate-600 mb-0.5">받는 이메일</label>
            <input value={to} onChange={e => setTo(e.target.value)} disabled={!active} type="email"
              placeholder="매입처 발주 이메일" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-0.5">프리셋</label>
            <div className="flex items-center gap-1.5">
              <select value={presetId ?? ''} disabled={!active}
                onChange={e => { const p = presets.find(x => x.id === e.target.value); if (p) applyPreset(p) }}
                className={fieldBox({ noWidth: true, extra: 'flex-1' })}>
                {!presets.length && <option value="">프리셋 없음</option>}
                {presets.map(p => (
                  <option key={p.id} value={p.id}>{p.name}{p.is_default ? ' (기본)' : ''}</option>
                ))}
              </select>
              {active && (
                <button onClick={() => setEditing({ id: null, name: '', subject, body: mailBody })}
                  title="현재 제목·본문을 새 프리셋으로 저장"
                  className={btnCls('secondary', 'sm', 'whitespace-nowrap')}>프리셋 저장</button>
              )}
              <button onClick={() => setManaging(true)}
                className={btnCls('secondary', 'sm', 'whitespace-nowrap')}>프리셋 관리</button>
            </div>
          </div>
        </div>
        <div className="mt-3">
          <label className="block text-xs text-slate-600 mb-0.5">제목</label>
          <input value={subject} disabled={!active}
            onChange={e => { setSubject(e.target.value); setMailTouched(true) }} className={inputCls} />
        </div>
        <div className="mt-3">
          <label className="block text-xs text-slate-600 mb-0.5">본문</label>
          <textarea value={mailBody} rows={7} disabled={!active}
            onChange={e => { setMailBody(e.target.value); setMailTouched(true) }}
            className={fieldBox({ area: true })} />
        </div>
        <div className="mt-2 text-xs text-slate-500">
          치환 변수 {VARS.map(v => (
            <code key={v} className="mx-0.5 px-1 py-0.5 bg-blue-50 text-blue-700 rounded">{v}</code>
          ))} — 발송 시 실제 값으로 바뀝니다. 프리셋은 전 직원 공용.
        </div>
      </div>

      {/* 4. 발송 */}
      <div className="bg-white border border-slate-300 rounded-xl p-4 mt-3">
        <div className={secTitle}><span className={stepNo}>4</span>발송</div>
        {active && (
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <button onClick={sendMail} disabled={busy || !smtpReady}
              title={smtpReady ? undefined : 'SMTP 환경변수 설정 후 사용 가능'}
              className="px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-40">
              {busy ? '처리 중...' : po.sent_at && po.send_method === 'email' ? '메일 재발송' : '메일 발송'}
            </button>
            <button onClick={manualSent} disabled={busy}
              className={btnCls('secondary', 'md')}>수동 발송 기록</button>
            <span className="text-xs text-slate-500">발송하면 실제 발송된 제목·본문·첨부 파일명이 이력으로 남습니다</span>
          </div>
        )}
        <div className="mt-3 divide-y divide-slate-200">
          {logs.map(l => (
            <div key={l.id} className="py-2 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                {l.ok
                  ? badge('bg-emerald-100 text-emerald-700', l.method === 'email' ? '메일 발송' : '수동 발송')
                  : badge('bg-red-100 text-red-700', '발송 실패')}
                <span className="tabular-nums text-slate-600">{l.sent_at.slice(0, 16).replace('T', ' ')}</span>
                {l.sender_name && <span className="text-slate-600">{l.sender_name}</span>}
                {l.email_to && <span className="text-slate-500">→ {l.email_to}</span>}
              </div>
              {l.subject && <div className="mt-0.5 text-slate-700">{l.subject}</div>}
              {l.attachment_names?.length ? (
                <div className="mt-0.5 text-slate-500">첨부: {l.attachment_names.join(', ')}</div>
              ) : null}
              {l.error && <div className="mt-0.5 text-red-600">{l.error}</div>}
            </div>
          ))}
          {!logs.length && <div className="py-2 text-xs text-slate-500">발송 이력 없음 — 아직 발송 전입니다</div>}
          {revisions.map((r, i) => (
            <div key={`rev-${i}`} className="py-2 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                {badge('bg-blue-50 text-blue-700', '수정 반영')}
                <span className="tabular-nums text-slate-600">{new Date(r.revised_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                {r.reviser_name && <span className="text-slate-600">{r.reviser_name}</span>}
              </div>
              <div className="mt-0.5 text-slate-700">{r.summary}{r.total_before !== r.total_after ? ` (합계 ${won(r.total_before)} → ${won(r.total_after)}원)` : ''}</div>
            </div>
          ))}
        </div>
      </div>

      {revising && (
        <PoReviseModal poId={po.id} onClose={() => setRevising(false)}
          onDone={msg => { setRevising(false); setNotice(msg); load() }} />
      )}

      {/* 프리셋 관리 모달 */}
      {managing && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => { setManaging(false); setEditing(null) }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mt-10 p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <div className="text-sm font-bold text-slate-900">프리셋 관리</div>
              <span className="text-xs text-slate-500">전 직원 공용 · 기본 프리셋이 발송 화면에 자동 적용</span>
              <button onClick={() => { setManaging(false); setEditing(null) }}
                className="ml-auto text-slate-500 hover:text-slate-700 text-sm">닫기 ✕</button>
            </div>
            <div className="mt-3 divide-y divide-slate-200">
              {presets.map(p => (
                <div key={p.id} className="py-2 flex items-center gap-2 text-sm flex-wrap">
                  <span className="font-semibold">{p.name}</span>
                  {p.is_default
                    ? badge('bg-blue-100 text-blue-700', '기본')
                    : <button onClick={() => presetAct('set_default', p)} disabled={busy}
                        className={btnCls('secondary', 'sm')}>기본 지정</button>}
                  <span className="text-xs text-slate-500 truncate max-w-[16rem]" title={p.subject}>{p.subject}</span>
                  <span className="ml-auto flex gap-1.5 items-center">
                    {p.editor_name && <span className="text-xs text-slate-400">{p.editor_name} · {p.updated_at.slice(5, 10)}</span>}
                    <button onClick={() => setEditing({ id: p.id, name: p.name, subject: p.subject, body: p.body })}
                      className={btnCls('secondary', 'sm')}>수정</button>
                    <button onClick={() => setEditing({ id: null, name: `${p.name} (복제)`, subject: p.subject, body: p.body })}
                      className={btnCls('secondary', 'sm')}>복제</button>
                    <button onClick={() => presetAct('delete', p)} disabled={busy}
                      className={btnCls('danger', 'sm')}>삭제</button>
                  </span>
                </div>
              ))}
              {!presets.length && <div className="py-3 text-xs text-slate-500">프리셋이 없습니다 — 새 프리셋을 만들어보세요.</div>}
            </div>
            {!editing && (
              <button onClick={() => setEditing({ id: null, name: '', subject: '', body: '' })}
                className={btnCls('primary', 'sm', 'mt-3')}>+ 새 프리셋</button>
            )}
            {editing && (
              <div className="mt-3 border-t border-slate-300 pt-3 space-y-2.5">
                <div className="text-xs font-semibold text-slate-800">{editing.id ? '프리셋 수정' : '새 프리셋'}</div>
                <div>
                  <label className="block text-xs text-slate-600 mb-0.5">이름</label>
                  <input value={editing.name} onChange={e => setEditing(v => v ? { ...v, name: e.target.value } : v)}
                    placeholder="예: 명절 발주 (납기 강조)" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 mb-0.5">제목</label>
                  <input value={editing.subject} onChange={e => setEditing(v => v ? { ...v, subject: e.target.value } : v)}
                    className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 mb-0.5">본문</label>
                  <textarea value={editing.body} rows={6}
                    onChange={e => setEditing(v => v ? { ...v, body: e.target.value } : v)}
                    className={fieldBox({ area: true })} />
                </div>
                <div className="text-xs text-slate-500">
                  치환 변수 사용 가능: {VARS.join(' ')}
                </div>
                <div className="flex gap-2">
                  <button onClick={savePreset} disabled={busy}
                    className={btnCls('primary', 'sm')}>저장</button>
                  <button onClick={() => setEditing(null)}
                    className={btnCls('secondary', 'sm')}>취소</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
