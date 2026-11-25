// 엑셀형 입력 표 부품 (UI 통일 기준 2단계, 2026-11-25) — 상담 품목 · 주문 상품 · 발주 품목
// 칸 하나 = 둥근 입력 상자, 칸 사이 간격, 누른 칸은 진한 테두리. 묶음(품목 · 판매 · 매입 · 결과)마다 색이 다르다.
//  · 손으로 넣는 칸 = 흰 바탕 + 묶음 색 테두리(CellInput · CellSelect)
//  · 자동 계산 칸 = 묶음 색으로 칠한 칸 + 굵은 흰 글자(CellCalc)
//  · 경고 칸 = warn 'red'(할인 · 품절) · 'amber'(단가 변경)
// 표는 <table className={cellTableCls}> 로 만들고, 열 구성 · 너비(colgroup)는 화면이 정한다. 모양만 여기서 온다.
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, ThHTMLAttributes } from 'react'

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ')

export type CellGroup = 'item' | 'sale' | 'buy' | 'result'
export type CellWarn = 'red' | 'amber'
export const CELL_GROUP_LABEL: Record<CellGroup, string> = { item: '품목', sale: '판매', buy: '매입', result: '결과' }
// 파랑 / 주황은 색약에서도 갈린다. 초록은 결과(자동 계산)에만.
const HEAD: Record<CellGroup, string> = { item: 'bg-slate-600', sale: 'bg-blue-600', buy: 'bg-orange-700', result: 'bg-emerald-700' }
const BAND: Record<CellGroup, string> = { item: 'bg-slate-700', sale: 'bg-blue-700', buy: 'bg-orange-800', result: 'bg-emerald-800' }
const EDGE: Record<CellGroup, string> = { item: 'border-slate-500', sale: 'border-blue-600', buy: 'border-orange-700', result: 'border-emerald-700' }
const WARN: Record<CellWarn, string> = { red: 'bg-red-100 border-red-600 text-red-700', amber: 'bg-amber-100 border-amber-600 text-amber-900' }
const WARN_FILL: Record<CellWarn, string> = { red: 'bg-red-600', amber: 'bg-amber-600' }

/** 표 클래스 — 칸 사이 간격 4px. table-fixed · min-w 는 화면에서 덧붙인다. */
export const cellTableCls = 'border-separate border-spacing-1 text-[0.8125rem]'

// thead th 공통 규칙(globals.css)보다 여기 클래스가 이긴다 — 묶음 색 머리줄
const TH = 'px-1.5 py-1 rounded-md text-xs font-bold !text-white !border-0 whitespace-nowrap'
/** 묶음 띠(머리줄 윗줄) — colSpan 으로 묶음의 칸 수를 준다 */
export function CellBand({ group, children, className, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { group: CellGroup }) {
  return <th className={cx(TH, BAND[group], 'tracking-widest', className)} {...rest}>{children ?? CELL_GROUP_LABEL[group]}</th>
}
/** 열 머리 */
export function CellHead({ group, className, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { group: CellGroup }) {
  return <th className={cx(TH, HEAD[group], className)} {...rest} />
}

const CELL = 'block w-full h-8 rounded-md border-[1.5px] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 disabled:bg-slate-100 disabled:text-slate-600'
// 바탕 · 글자색 · 좌우 여백은 겹치지 않게 한 가지씩만 붙인다(같은 속성의 Tailwind 클래스 둘은 어느 쪽이 이길지 보장되지 않는다)
/** 입력 칸 클래스 — 자체 입력 부품(품번 검색 콤보 등)에 같은 모양을 줄 때 */
export const cellCls = (group: CellGroup, opts?: { num?: boolean; warn?: CellWarn | null; tight?: boolean; extra?: string }) =>
  cx(CELL, opts?.warn ? WARN[opts.warn] : `bg-white text-slate-900 ${EDGE[group]}`, opts?.tight ? 'px-1' : 'px-2', opts?.num && 'text-right tabular-nums', opts?.extra)

type CellOwn = { group: CellGroup; num?: boolean; warn?: CellWarn | null }
export function CellInput({ group, num, warn, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & CellOwn) {
  return <input className={cellCls(group, { num, warn, extra: className })} {...rest} />
}
export function CellSelect({ group, warn, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & Omit<CellOwn, 'num'>) {
  return <select className={cellCls(group, { warn, tight: true, extra: className })} {...rest} />
}
/** 자동 계산 칸(못 고침) — 묶음 색으로 칠한다 */
export function CellCalc({ group, warn, children, className, title }: { group: CellGroup; warn?: CellWarn | null; children: ReactNode; className?: string; title?: string }) {
  return (
    <div title={title} className={cx('flex items-center justify-end h-8 px-2 rounded-md font-extrabold tabular-nums text-white', warn ? WARN_FILL[warn] : HEAD[group], className)}>
      {children}
    </div>
  )
}

/** 표 위 요약 알약 — 판매합계 · 매입합계 · 마진 */
export function SummaryPill({ group, warn, label, children }: { group: CellGroup; warn?: CellWarn | null; label: ReactNode; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-baseline gap-1.5 px-3.5 py-1 rounded-full text-sm font-bold tabular-nums text-white', warn ? WARN_FILL[warn] : HEAD[group])}>
      <span className="font-normal opacity-90">{label}</span>{children}
    </span>
  )
}
