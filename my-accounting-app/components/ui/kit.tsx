// UI 통일 기준 공용 부품 (UI 디자인 트랙 2단계, 2026-11-25) — 시안 docs/mockups/UI_통일기준_시안.html, 견본 화면 /me/ui-kit
// 새 화면 · 고치는 화면은 버튼 · 입력 칸 · 배지 · 요약 카드 · 표 · 창을 여기서 가져다 쓴다(파일마다 inp · btn 상수를 새로 만들지 말 것).
// 훅이 없어 서버 · 클라이언트 컴포넌트 어디서나 쓸 수 있다. 엑셀형 입력 표는 cell-grid.tsx.
// 클래스 문자열은 이 파일(components/ 아래)에 둔다 — lib/ 는 Tailwind 가 읽지 않는다.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ')

// ───────── 화면 틀 ─────────
// 순서: PageHeader → PageTabs → 기간(PeriodPresets) → KpiGrid → FilterRow(검색 · 칩) → TableCard
// 목록 · 표 화면은 전체 폭, 글 · 설정 · 등록 양식 화면만 narrow.
export function Page({ narrow, children, className }: { narrow?: boolean; children: ReactNode; className?: string }) {
  return <div className={cx(narrow && 'max-w-5xl mx-auto', className)}>{children}</div>
}

/** 화면 제목 줄 — 제목 + 설명(아래 한 줄) + 오른쪽 위 버튼. 진한 버튼은 화면당 하나. */
export function PageHeader({ title, desc, actions, className }: { title: ReactNode; desc?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-start justify-between gap-3 mb-3', className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {desc && <p className="mt-0.5 text-sm text-slate-700">{desc}</p>}
      </div>
      {actions && <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">{actions}</div>}
    </div>
  )
}

/** 구역 제목(카드 안 · 카드 사이) */
export function SectionTitle({ children, hint, className }: { children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-baseline gap-2 mb-2', className)}>
      <h2 className="text-base font-bold text-slate-900">{children}</h2>
      {hint && <span className="text-xs text-slate-600">{hint}</span>}
    </div>
  )
}

export const cardCls = 'bg-white border border-slate-300 rounded-xl'
export function Card({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <div className={cx(cardCls, pad && 'p-4', className)}>{children}</div>
}

/** 검색 · 칩 · 필터 한 줄 */
export function FilterRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex items-center gap-1.5 flex-wrap my-2.5', className)}>{children}</div>
}

// ───────── 버튼 ─────────
// primary = 그 화면(또는 그 줄)의 주 작업 하나 · secondary = 그 밖의 조작 · danger = 삭제 · 해제 · link = 글자 버튼
export type BtnVariant = 'primary' | 'secondary' | 'danger' | 'link'
export type BtnSize = 'md' | 'sm'
const BTN_BASE = 'inline-flex items-center justify-center gap-1 font-semibold whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const BTN_SIZE: Record<BtnSize, string> = { md: 'h-9 px-3.5 text-sm rounded-lg', sm: 'h-7 px-2.5 text-xs rounded-md' }
const BTN_VARIANT: Record<BtnVariant, string> = {
  primary: 'bg-slate-900 text-white hover:bg-slate-700',
  secondary: 'bg-white text-slate-900 border border-slate-400 hover:bg-slate-100',
  danger: 'bg-white text-red-700 border border-red-400 hover:bg-red-50',
  link: 'text-blue-700 underline underline-offset-2 hover:text-blue-900',
}
/** 버튼 클래스 — `<a>` · `<Link>` 를 버튼 모양으로 만들 때 */
export const btnCls = (variant: BtnVariant = 'secondary', size: BtnSize = 'md', extra?: string) =>
  cx(BTN_BASE, variant === 'link' ? (size === 'sm' ? 'text-xs px-1' : 'text-sm px-1.5') : BTN_SIZE[size], BTN_VARIANT[variant], extra)

export function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize }) {
  return <button type={type} className={btnCls(variant, size, className)} {...rest} />
}

// ───────── 입력 칸 ─────────
// 테두리는 한 가지. 종류는 바탕으로: free 흰 = 직접 입력 · pick 옅은 노랑 = 목록에서 선택 · auto 회색 = 자동(못 고침)
export type FieldKind = 'free' | 'pick' | 'auto'
export type FieldSize = 'md' | 'sm'
const FIELD_BASE = 'w-full border rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 disabled:bg-slate-100 disabled:text-slate-600'
const FIELD_SIZE: Record<FieldSize, string> = { md: 'h-9 px-2.5 text-sm', sm: 'h-8 px-2 text-xs' }
const FIELD_KIND: Record<FieldKind, string> = {
  free: 'bg-white border-slate-400',
  pick: 'bg-amber-50 border-slate-400',
  auto: 'bg-slate-100 border-slate-300 text-slate-700',
}
/** 입력 칸 클래스 — 자체 입력 부품(SearchableSelect 등)에 같은 모양을 줄 때 */
export const fieldCls = (kind: FieldKind = 'free', size: FieldSize = 'md', extra?: string) => cx(FIELD_BASE, FIELD_SIZE[size], FIELD_KIND[kind], extra)

type FieldOwn = { kind?: FieldKind; fieldSize?: FieldSize }
export function Input({ kind = 'free', fieldSize = 'md', className, ...rest }: InputHTMLAttributes<HTMLInputElement> & FieldOwn) {
  return <input className={fieldCls(kind, fieldSize, className)} readOnly={kind === 'auto' ? true : rest.readOnly} {...rest} />
}
export function Select({ kind = 'free', fieldSize = 'md', className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & FieldOwn) {
  return <select className={fieldCls(kind, fieldSize, className)} {...rest} />
}
export function Textarea({ kind = 'free', className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { kind?: FieldKind }) {
  return <textarea className={cx(FIELD_BASE, FIELD_KIND[kind], 'px-2.5 py-2 text-sm', className)} {...rest} />
}
export const labelCls = 'block mb-1 text-xs font-bold text-slate-700'
/** 라벨(칸 위) + 입력 칸 묶음. 필수는 라벨의 빨간 별. */
export function Field({ label, required, hint, children, className }: { label: ReactNode; required?: boolean; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className={labelCls}>{label}{required && <span className="text-red-600"> *</span>}{hint && <span className="ml-1.5 font-normal text-slate-600">{hint}</span>}</span>
      {children}
    </label>
  )
}

// ───────── 상태 배지 · 칩 ─────────
// 색은 뜻이 있을 때만: red 위험 · 미수 / amber 주의 · 대기 / green 완료 · 정상 / blue 정보 · 진행 / gray 해당 없음
export type Tone = 'red' | 'amber' | 'green' | 'blue' | 'gray'
const BADGE_TONE: Record<Tone, string> = {
  red: 'bg-red-100 text-red-700', amber: 'bg-amber-100 text-amber-800', green: 'bg-emerald-100 text-emerald-700',
  blue: 'bg-blue-100 text-blue-700', gray: 'bg-slate-200 text-slate-700',
}
export const badgeCls = (tone: Tone = 'gray', extra?: string) => cx('inline-block px-2 py-px rounded text-xs font-bold whitespace-nowrap', BADGE_TONE[tone], extra)
export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={badgeCls(tone, className)}>{children}</span>
}

export const chipCls = (on: boolean, extra?: string) => cx(
  'inline-flex items-center h-7 px-3 rounded-full border text-xs font-semibold whitespace-nowrap transition-colors',
  on ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-400 text-slate-700 hover:bg-slate-100', extra)
/** 칩 필터 — 선택은 진한 알약. count 는 건수 꼬리. */
export function Chip({ on = false, count, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean; count?: ReactNode }) {
  return (
    <button type="button" className={chipCls(on, className)} {...rest}>
      {children}{count !== undefined && <span className="ml-1.5 font-normal opacity-80">{count}</span>}
    </button>
  )
}

// ───────── 요약 카드 ─────────
const KPI_TONE: Record<Tone | 'default', string> = { default: 'text-slate-900', red: 'text-red-700', amber: 'text-amber-700', green: 'text-emerald-700', blue: 'text-blue-700', gray: 'text-slate-600' }
const KPI_COLS: Record<number, string> = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4', 5: 'md:grid-cols-5', 6: 'md:grid-cols-6' }
export function KpiGrid({ cols = 4, children, className }: { cols?: 2 | 3 | 4 | 5 | 6; children: ReactNode; className?: string }) {
  return <div className={cx('grid grid-cols-2 gap-2.5 my-2.5', KPI_COLS[cols], className)}>{children}</div>
}
/** 요약 카드 — onClick 이 있으면 필터 버튼, 선택(active)은 진한 테두리. 숫자 색(tone)은 뜻이 있을 때만. */
export function KpiCard({ label, value, sub, tone = 'default', active, onClick, className }:
  { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone | 'default'; active?: boolean; onClick?: () => void; className?: string }) {
  const body = (
    <>
      <div className="text-xs font-bold text-slate-700">{label}</div>
      <div className={cx('text-xl font-extrabold tabular-nums', KPI_TONE[tone])}>{value}</div>
      {sub && <div className="text-xs text-slate-600">{sub}</div>}
    </>
  )
  const cls = cx('text-left bg-white rounded-xl px-3.5 py-2.5 border', active ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-300', onClick && 'hover:border-slate-500 cursor-pointer', className)
  return onClick ? <button type="button" onClick={onClick} className={cls}>{body}</button> : <div className={cls}>{body}</div>
}

// ───────── 조회 표 ─────────
// 머리줄 색은 globals.css 의 thead th 공통 규칙이 그린다 — 여기서는 여백 · 정렬 · 줄 구분만.
/** 표를 감싸는 카드(가로 스크롤) */
export function TableCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(cardCls, 'overflow-x-auto', className)}>{children}</div>
}
export const tbl = {
  table: 'w-full text-sm',
  th: 'px-3 py-2 text-left text-xs whitespace-nowrap',
  thNum: 'px-3 py-2 text-right text-xs whitespace-nowrap',
  tr: 'border-b border-slate-200 hover:bg-slate-50',
  td: 'px-3 py-2 align-top',
  tdNum: 'px-3 py-2 align-top text-right tabular-nums whitespace-nowrap',
  /** 줄의 첫 이름(거래처 · 품목) */
  name: 'font-semibold text-slate-900',
  /** 이름 아래 작은 부가 정보 한 줄 */
  sub: 'block text-xs text-slate-600',
  /** 합계 줄(tfoot tr) */
  foot: 'bg-slate-100 font-bold border-t-2 border-slate-400',
  /** 미수 · 음수 금액 */
  neg: 'text-red-700 font-semibold',
  empty: 'px-3 py-10 text-center text-sm text-slate-600',
} as const

// 창(모달)은 components/ui/modal.tsx (클라이언트 부품)
