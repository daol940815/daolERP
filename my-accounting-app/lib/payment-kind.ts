// 결제 기록의 카드 결제 방식(단말기 · 수기) · 과세 구분(과세 · 면세) — 1304, 2026-11-18 사용자 확정
// (docs/payment-track.md · 시안 docs/mockups/결제기록_방식_과세구분_시안.html)
// 이전 ERP의 여섯 구분(카드단말기 과세 · 면세, 수기 과세 · 면세, 계산서 과세 · 면세)과 같은 정보.
//   카드결제   = 방식 + 과세 구분 / 계산서 발행 = 과세 구분만 / 계좌이체 = 받지 않는다(이체 자체에는 과세 · 면세가 없다)
// 규칙: 새 기록에는 필수, 1304 이전 기록은 '미기재'로 둔다(추정해 채우지 않는다).
//       기록과 원본의 구분이 다르면 매칭을 막는다 — 양쪽 값이 모두 있을 때만 비교한다(원본 구분을 모르면 막지 않는다).
// 클라이언트 화면에서도 쓰므로 서버 전용 모듈을 import 하지 않는다.
import { splitVat } from './card-sale-vat'

export type CardEntry = 'terminal' | 'manual'
export type RecVat = 'taxable' | 'exempt'
export interface PayKind { card_entry: CardEntry | null; vat_kind: RecVat | null }

export const CARD_ENTRY_LABEL: Record<CardEntry, string> = { terminal: '단말기', manual: '수기' }
export const REC_VAT_LABEL: Record<RecVat, string> = { taxable: '과세', exempt: '면세' }
export const CARD_ENTRIES: CardEntry[] = ['terminal', 'manual']
export const REC_VATS: RecVat[] = ['taxable', 'exempt']

// 표시: '수기 · 면세' / '면세' / null(미기재 또는 해당 없음)
export function kindLabel(k: Partial<PayKind> | null | undefined): string | null {
  const parts = [k?.card_entry ? CARD_ENTRY_LABEL[k.card_entry] : null, k?.vat_kind ? REC_VAT_LABEL[k.vat_kind] : null].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}
// 이 수단에 구분이 필요한데 비어 있는가 (계좌이체는 해당 없음)
export const kindMissing = (method: string, k: Partial<PayKind> | null | undefined) =>
  method === 'card' ? !k?.card_entry || !k?.vat_kind : method === 'invoice' ? !k?.vat_kind : false

// 카드 매출 원본의 구분: 수기결제(PG) 파일은 CPID가 있고, 단말기 파일은 공급가 · 세액 칸이 있다.
// 둘 다 없으면(427 이전에 올린 수기결제 행 등) 방식을 알 수 없다 → null. 과세 구분은 lib/card-sale-vat.ts 규칙.
export function kindOfCardSale(c: { cpid?: string | null; vat_kind?: string | null; amount?: number | null; supply_amount?: number | null; tax_amount?: number | null }): PayKind {
  const sup = Number(c.supply_amount ?? 0), tax = Number(c.tax_amount ?? 0)
  const entry: CardEntry | null = (c.cpid ?? '').trim() ? 'manual' : sup !== 0 || tax !== 0 ? 'terminal' : null
  const v = splitVat(Number(c.amount ?? 0), sup, tax, c.vat_kind ?? null).kind
  return { card_entry: entry, vat_kind: v === 'unknown' ? null : v }
}

// 기록과 원본이 다른 항목 (양쪽 모두 값이 있을 때만). 다르지 않으면 빈 배열.
export function kindDiff(rec: Partial<PayKind> | null | undefined, src: Partial<PayKind> | null | undefined): ('card_entry' | 'vat_kind')[] {
  const out: ('card_entry' | 'vat_kind')[] = []
  if (rec?.card_entry && src?.card_entry && rec.card_entry !== src.card_entry) out.push('card_entry')
  if (rec?.vat_kind && src?.vat_kind && rec.vat_kind !== src.vat_kind) out.push('vat_kind')
  return out
}
