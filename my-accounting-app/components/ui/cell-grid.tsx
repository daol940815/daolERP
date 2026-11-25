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

/** 표 클래스 — 칸 사이 간격 4px. 글자 크기(text-xs · text-[0.8125rem]) · table-fixed · min-w 는 화면에서 덧붙인다. */
export const cellTableCls = 'border-separate border-spacing-1'
/** 빈 머리 칸(삭제 버튼 열 등) — thead th 공통 규칙의 회색 바탕 · 밑줄을 지운다 */
export const cellBlankTh = 'bg-transparent border-0'

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

const CELL = 'block rounded-md border-[1.5px] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 disabled:opacity-60'
// 바탕 · 글자색 · 높이 · 너비 · 좌우 여백은 겹치지 않게 한 가지씩만 붙인다(같은 속성의 Tailwind 클래스 둘은 어느 쪽이 이길지 보장되지 않는다)
export interface CellOpts {
  num?: boolean                 // 숫자 칸 — 오른쪽 정렬
  warn?: CellWarn | null        // 경고 칸
  tight?: boolean               // 좌우 여백 좁게(select)
  short?: boolean               // 낮은 칸(칸 안의 작은 선택 · 둘째 줄 입력)
  auto?: boolean                // 높이를 내용에 맞춤(textarea)
  noWidth?: boolean             // 너비를 화면이 직접 줌(w-56 · flex-1 등을 extra 로)
  extra?: string
}
/** 입력 칸 클래스 — 자체 입력 부품(품번 검색 콤보 등)에 같은 모양을 줄 때 */
export const cellCls = (group: CellGroup, o: CellOpts = {}) => cx(CELL,
  o.warn ? WARN[o.warn] : `bg-white text-slate-900 ${EDGE[group]}`,
  o.auto ? 'min-h-8 py-1.5' : o.short ? 'h-6 text-xs' : 'h-8', !o.noWidth && 'w-full', o.tight ? 'px-1' : 'px-2',
  o.num && 'text-right tabular-nums', o.extra)
/** 자동 계산 칸 클래스 — tall = 안에 둘째 줄(할인 · 마진율)이 있는 칸 */
export const calcCls = (group: CellGroup, o: { warn?: CellWarn | null; tall?: boolean; extra?: string } = {}) => cx(
  'flex rounded-md px-2 font-extrabold tabular-nums text-white', o.warn ? WARN_FILL[o.warn] : HEAD[group],
  o.tall ? 'min-h-8 py-0.5 flex-col items-end justify-center leading-tight' : 'h-8 items-center justify-end', o.extra)

type CellOwn = { group: CellGroup; num?: boolean; warn?: CellWarn | null }
export function CellInput({ group, num, warn, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & CellOwn) {
  return <input className={cellCls(group, { num, warn, extra: className })} {...rest} />
}
export function CellSelect({ group, warn, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & Omit<CellOwn, 'num'>) {
  return <select className={cellCls(group, { warn, tight: true, extra: className })} {...rest} />
}
/** 자동 계산 칸(못 고침) — 묶음 색으로 칠한다 */
export function CellCalc({ group, warn, tall, children, className, title }: { group: CellGroup; warn?: CellWarn | null; tall?: boolean; children: ReactNode; className?: string; title?: string }) {
  return <div title={title} className={calcCls(group, { warn, tall, extra: className })}>{children}</div>
}

/** 표 위 요약 알약 — 판매합계 · 매입합계 · 마진 */
export function SummaryPill({ group, warn, label, children }: { group: CellGroup; warn?: CellWarn | null; label: ReactNode; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-baseline gap-1.5 px-3.5 py-1 rounded-full text-sm font-bold tabular-nums text-white', warn ? WARN_FILL[warn] : HEAD[group])}>
      <span className="font-normal opacity-90">{label}</span>{children}
    </span>
  )
}
