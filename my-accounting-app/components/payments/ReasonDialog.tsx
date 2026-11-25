'use client'

import { useCallback, useState } from 'react'
import ReasonPicker, { reasonReady, type ReasonValue } from './ReasonPicker'
import type { ReasonKind } from '@/lib/payment-reasons'
import { btnCls } from '@/components/ui/kit'

// 사유를 묻는 작은 창 (1307, 2026-11-18) — 매칭 해제처럼 "누르면 바로 실행"이던 조작에 사유 선택을 끼워 넣을 때 쓴다.
//   const { ask, node } = useReasonDialog()
//   const reason = await ask('release', '선결제 사용 해제', '선결제 잔액으로 되돌아갑니다.'); if (!reason) return
//   … fetch(…, { body: JSON.stringify({ reason }) }) …   화면 어딘가에 {node} 를 렌더한다.
export function useReasonDialog() {
  const [st, setSt] = useState<{ kind: ReasonKind; title: string; desc?: string; resolve: (v: ReasonValue | null) => void } | null>(null)
  const [value, setValue] = useState<ReasonValue | null>(null)
  const ask = useCallback((kind: ReasonKind, title: string, desc?: string) =>
    new Promise<ReasonValue | null>(resolve => { setValue(null); setSt({ kind, title, desc, resolve }) }), [])
  const close = (v: ReasonValue | null) => { st?.resolve(v); setSt(null) }
  const node = st ? (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-[70] p-4" onClick={() => close(null)}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-slate-900">{st.title}</h3>
        {st.desc && <p className="text-xs text-slate-700 mt-1 whitespace-pre-line">{st.desc}</p>}
        <p className="text-xs text-slate-500 mt-1 mb-3">사유 · 처리한 사람 · 시각이 이력에 남습니다.</p>
        <ReasonPicker kind={st.kind} value={value} onChange={setValue} label="사유" />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={() => close(null)} className="px-3 py-1.5 border border-slate-400 rounded-lg text-sm bg-white">닫기</button>
          <button onClick={() => close(value)} disabled={!reasonReady(value)}
            className={btnCls('primary', 'md')}>확인</button>
        </div>
      </div>
    </div>
  ) : null
  return { ask, node }
}
