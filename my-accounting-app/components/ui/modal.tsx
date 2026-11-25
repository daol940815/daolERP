'use client'
// 창(모달) 공용 부품 (UI 통일 기준 2단계, 2026-11-25) — 배경 어둡기 · 모서리 · 그림자 한 가지.
// 제목 → 설명 → 내용 → 오른쪽 아래 버튼(취소 왼쪽, 실행 오른쪽). 바깥을 누르면 onClose.
import type { ReactNode } from 'react'

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ')

const MODAL_W = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl' } as const
export function Modal({ title, desc, children, footer, onClose, size = 'md' }:
  { title: ReactNode; desc?: ReactNode; children?: ReactNode; footer?: ReactNode; onClose?: () => void; size?: keyof typeof MODAL_W }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className={cx('w-full bg-white rounded-xl shadow-xl p-5 max-h-[90vh] overflow-y-auto', MODAL_W[size])} role="dialog" aria-modal="true">
        <div className="text-base font-bold text-slate-900">{title}</div>
        {desc && <div className="mt-0.5 text-sm text-slate-700">{desc}</div>}
        {children && <div className="mt-3">{children}</div>}
        {footer && <div className="mt-4 flex justify-end gap-1.5">{footer}</div>}
      </div>
    </div>
  )
}
