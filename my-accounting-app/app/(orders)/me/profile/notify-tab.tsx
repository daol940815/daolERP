'use client'

// 내 정보 › 알림 설정 — PC 알림(Web Push) (업무요청 트랙 ⑦, 2026-11-03)
//  이 브라우저의 상태(허용 · 차단 · 미지원) + 허용/해제/테스트, 내 기기 목록(켜기·끄기·삭제), 기기별 받을 알림 종류.
//  PC·브라우저마다 허용이 따로 필요하다(회사 PC + 집 노트북 = 2회). 비밀번호처럼 민감한 정보는 없다.

import { useCallback, useEffect, useState } from 'react'
import { PUSH_KIND_LABEL, pushSticky, type PushKind, type PushPrefs, type PushSubRow, prefOn } from '@/lib/push'
import { currentSubscription, disablePush, enablePush, pushState, type PushState } from '@/lib/push-client'
import { fmtDT } from '@/lib/work-requests'

import { btnCls } from '@/components/ui/kit'
interface Resp { linked: boolean; vapidPublicKey: string; configured: boolean; approver: boolean; kinds: PushKind[]; subscriptions: PushSubRow[]; warning?: string; error?: string }

export default function NotifyTab() {
  const [data, setData] = useState<Resp | null>(null)
  const [state, setState] = useState<PushState>('unsupported')
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null)
  const [sel, setSel] = useState<string | null>(null)   // 받을 알림을 편집할 기기 id
  const flash = (t: string, ok = true) => { setMsg({ t, ok }); setTimeout(() => setMsg(null), 5000) }

  const load = useCallback(async () => {
    const [res, st, sub] = await Promise.all([fetch('/api/push/subscriptions', { cache: 'no-store' }), pushState(), currentSubscription()])
    const json = await res.json().catch(() => ({}))
    setData(json); setState(st); setEndpoint(sub?.endpoint ?? null)
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!data || sel) return
    const cur = data.subscriptions.find(s => s.endpoint === endpoint) ?? data.subscriptions[0]
    if (cur) setSel(cur.id)
  }, [data, endpoint, sel])

  const enable = async () => {
    setBusy(true)
    const err = await enablePush(data?.vapidPublicKey ?? '')
    setBusy(false)
    if (err) flash(err, false); else flash('이 PC에서 알림을 받습니다. 테스트 알림으로 확인해 보세요.')
    load()
  }
  const disable = async () => {
    if (!window.confirm('이 PC(브라우저)의 알림을 끌까요? 다시 켜려면 알림 허용을 다시 누르면 됩니다.')) return
    setBusy(true); await disablePush(); setBusy(false); flash('이 PC의 알림을 껐습니다.'); load()
  }
  const test = async (ep?: string) => {
    setBusy(true)
    const res = await fetch('/api/push/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test', endpoint: ep }) })
    const j = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(j.error ?? '테스트 실패', false); return }
    flash(j.sent ? `테스트 알림을 보냈습니다 (${j.sent}건). 몇 초 안에 PC 알림이 뜹니다.` : `보내지 못했습니다 (실패 ${j.failed} · 사라진 구독 ${j.removed}).`, !!j.sent)
    load()
  }
  const patch = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch('/api/push/subscriptions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) flash(j.error ?? '저장 실패', false)
    load()
  }
  const remove = async (s: PushSubRow) => {
    if (!window.confirm(`'${s.device_label ?? '기기'}' 구독을 삭제할까요? 그 PC에서는 다시 허용해야 알림이 옵니다.`)) return
    if (s.endpoint === endpoint) { await disablePush() } else {
      await fetch('/api/push/subscriptions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id }) })
    }
    load()
  }

  if (!data) return <div className="text-center py-20 text-slate-500">로딩 중...</div>
  if (data.error) return <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{data.error}</div>
  const subs = data.subscriptions
  const cur = subs.find(s => s.endpoint === endpoint) ?? null
  const selected = subs.find(s => s.id === sel) ?? cur ?? subs[0] ?? null
  const kinds = data.kinds.filter(k => k !== 'leave_approve' || data.approver)
  const stateText: Record<PushState, string> = {
    unsupported: '이 브라우저는 PC 알림을 지원하지 않습니다. Windows 크롬 · 엣지를 쓰세요. Mac Safari 는 독에 "앱으로 설치"한 뒤에만 됩니다.',
    denied: '브라우저에서 알림이 차단되어 있습니다. 주소창 왼쪽 자물쇠 → 알림 → 허용으로 바꾼 뒤 새로고침하세요.',
    subscribed: cur ? '이 PC에서 알림을 받고 있습니다.' : '이 브라우저에 구독은 있지만 내 계정에 저장되어 있지 않습니다. 알림 허용을 다시 누르세요.',
    ready: '아직 이 PC에서 알림을 허용하지 않았습니다.',
  }
  const card = 'bg-white border border-slate-300 rounded-xl p-5'

  return (
    <div className="space-y-4 max-w-3xl">
      {msg && <div className={`px-4 py-2.5 text-sm rounded-lg border ${msg.ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>{msg.t}</div>}
      {!data.configured && <div className="px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">서버에 알림 키(VAPID)가 아직 설정되지 않았습니다. ERP 관리자가 Vercel 환경변수를 넣으면 바로 동작합니다.</div>}
      {data.warning && <div className="px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">{data.warning}</div>}

      <div className={card}>
        <h2 className="text-sm font-bold text-slate-900">이 PC</h2>
        <p className="text-sm text-slate-800 mt-1">{stateText[state]}</p>
        <div className="flex gap-2 mt-3 flex-wrap">
          {(state === 'ready' || (state === 'subscribed' && !cur)) && <button onClick={enable} disabled={busy || !data.configured} className={btnCls('primary', 'md')}>이 PC에서 알림 받기</button>}
          {state === 'subscribed' && cur && <>
            <button onClick={() => test(cur.endpoint)} disabled={busy} className={btnCls('primary', 'md')}>테스트 알림 보내기</button>
            <button onClick={disable} disabled={busy} className={btnCls('secondary', 'md')}>이 PC 알림 끄기</button>
          </>}
        </div>
        <p className="text-xs text-slate-500 mt-3 leading-relaxed">
          Windows 크롬 · 엣지는 창을 닫아도 백그라운드로 실행되어 알림이 뜹니다. 브라우저를 완전히 종료했으면 다음 실행 때 도착합니다.
          PC · 브라우저마다 허용이 따로 필요합니다. 알림 내용은 제목 · 요청자 · 마감만 담고, 비공개 요청은 &quot;비공개 업무 요청&quot;으로만 표시됩니다.
        </p>
      </div>

      <div className={card}>
        <h2 className="text-sm font-bold text-slate-900 mb-2">내 기기 <span className="text-xs text-slate-500 font-normal">{subs.length}대</span></h2>
        {subs.length === 0 ? <p className="text-sm text-slate-500">허용한 기기가 없습니다.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-200"><th className="py-1.5 font-medium">기기</th><th className="py-1.5 font-medium">허용</th><th className="py-1.5 font-medium">마지막 발송</th><th className="py-1.5 font-medium">받기</th><th className="py-1.5 font-medium text-right"></th></tr></thead>
            <tbody>{subs.map(s => (
              <tr key={s.id} className={`border-b border-slate-200 ${sel === s.id ? 'bg-slate-50' : ''}`}>
                <td className="py-2">
                  <button onClick={() => setSel(s.id)} className="text-left">
                    <span className="font-semibold text-slate-900">{s.device_label ?? '기기'}</span>{s.endpoint === endpoint && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-slate-900 text-white">이 PC</span>}
                    {s.last_error && <span className="block text-xs text-red-600">최근 실패: {s.last_error}</span>}
                  </button>
                </td>
                <td className="py-2 text-xs text-slate-600 tabular-nums whitespace-nowrap">{fmtDT(s.created_at)}</td>
                <td className="py-2 text-xs text-slate-600 tabular-nums whitespace-nowrap">{s.last_used_at ? fmtDT(s.last_used_at) : '-'}</td>
                <td className="py-2"><label className="inline-flex items-center gap-1.5 text-xs"><input type="checkbox" checked={s.enabled} onChange={e => patch(s.id, { enabled: e.target.checked })} /> {s.enabled ? '켬' : '끔'}</label></td>
                <td className="py-2 text-right whitespace-nowrap">
                  <button onClick={() => test(s.endpoint)} disabled={busy || !s.enabled} className="px-2 py-1 text-xs border border-slate-400 rounded hover:bg-slate-50 disabled:opacity-40 mr-1">테스트</button>
                  <button onClick={() => remove(s)} disabled={busy} className={btnCls('danger', 'sm')}>삭제</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      {/* 받을 알림 — 기기가 없어도 종류와 화면에 남는 방식은 보이게 (2026-11-18: 기기 없을 때 목록이 통째로 숨어 있었음) */}
      <div className={card}>
        <h2 className="text-sm font-bold text-slate-900">받을 알림 {selected
          ? <span className="text-xs text-slate-500 font-normal">— {selected.device_label ?? '기기'}{selected.endpoint === endpoint ? ' (이 PC)' : ''}</span>
          : <span className="text-xs text-slate-500 font-normal">— 위에서 이 PC의 알림을 허용하면 종류별로 켜고 끌 수 있습니다</span>}</h2>
        <div className="mt-2 space-y-2">
          {kinds.map(k => (
            <label key={k} className={`flex items-center gap-2 text-sm ${selected ? 'text-slate-900' : 'text-slate-600'}`}>
              <input type="checkbox" disabled={!selected} checked={selected ? prefOn(selected.prefs, k) : true} onChange={e => { if (!selected) return; const prefs: PushPrefs = { ...selected.prefs, [k]: e.target.checked }; patch(selected.id, { prefs }) }} />
              {PUSH_KIND_LABEL[k]}
              <span className={`text-xs px-1.5 py-px rounded whitespace-nowrap ${pushSticky(k) ? 'bg-slate-100 text-slate-700' : 'bg-slate-50 text-slate-500'}`}>{pushSticky(k) ? '눌러야 내려감' : '몇 초 뒤 저절로 내려감'}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-3">기기마다 따로 저장됩니다. 눌러야 내려감은 Windows 화면 오른쪽 아래 알림이 누를 때까지 남는다는 뜻입니다(Windows 집중 모드 · 방해 금지가 켜져 있으면 바로 알림 센터로 갑니다). 로그인 중인 화면의 알림 종 · 토스트는 이 설정과 무관하게 계속 뜹니다.</p>
      </div>
    </div>
  )
}
