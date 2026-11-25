// 택배 박스 구성 (2026-11-17 사용자 확정) — 주문서 · 상담일지의 택배비(판매) 박스 수와 자사 기본 발주서 택배비 줄이 같은 계산을 쓴다.
//
// 1) 매입배송비가 품목 관리 값으로 자동 계산된 그대로면, 수량으로 박스를 직접 센다:
//    꽉 찬 카톤 수 × 카톤택배비 + (낱개가 있으면) 1박스 × 카톤외택배비 — 금액이 다르면 발주서 줄을 나눈다
//    (25개 · 카톤 10 → 택배비 2 × 4,000 / 택배비 1 × 3,500). 박스 수 = 택배비가 있는 카톤 수 + 낱개 1박스(3박스).
//    택배비가 0원인 묶음은 발주서 줄도 만들지 않고 박스 수에도 세지 않는다(2026-11-25 사용자 확정 — 박스 수 = 매입배송비가 나오는 박스 수.
//    예: 25개 · 카톤 16 · 카톤택배비 0 · 카톤외 4,000 → 1박스. 전에는 0원 카톤까지 세어 2박스로 나왔다).
// 2) 사람이 매입배송비를 고친 경우(합포장 등) · 카톤 정보가 없는 품목: 박스당 택배비(카톤택배비, 없으면 카톤외택배비)로
//    나누어떨어지면 그 박스 수, 아니면 박스 수 불명(null) — 발주서는 수량 · 단가 빈칸 + 알림.
// 순수 함수만 (화면 · 서버 공용).

export interface ShipBoxInput {
  quantity: number
  carton_unit: number | null | undefined
  carton_shipping_fee: number | null | undefined
  loose_shipping_fee: number | null | undefined
  purchase_shipping: number | null | undefined   // 박스 수를 셀 실제 매입배송비
}
export interface ShipBoxResult {
  boxes: number | null                  // 박스 수 (택배비(판매) 계산용) — null = 셀 수 없음
  lines: { qty: number; fee: number }[] // 발주서 택배비 줄 (금액 0인 묶음 제외)
  composed: boolean                     // 1) 수량으로 센 경우
}

export function shipBoxes(it: ShipBoxInput): ShipBoxResult {
  const ps = Number(it.purchase_shipping) || 0
  const unit = Number(it.carton_unit) || 0
  const cf = Number(it.carton_shipping_fee) || 0
  const lf = Number(it.loose_shipping_fee) || 0
  const qty = Number(it.quantity) || 0
  if (ps <= 0) return { boxes: null, lines: [], composed: false }

  if (unit > 0 && qty > 0) {
    const cartons = Math.floor(qty / unit)
    const loose = qty % unit > 0 ? 1 : 0
    if (cartons * cf + loose * lf === ps) {
      const lines: { qty: number; fee: number }[] = []
      if (cartons > 0 && cf > 0) lines.push({ qty: cartons, fee: cf })
      if (loose > 0 && lf > 0) lines.push({ qty: 1, fee: lf })
      return { boxes: (cf > 0 ? cartons : 0) + (lf > 0 ? loose : 0), lines, composed: true }
    }
  }
  const fee = cf > 0 ? cf : lf   // 고친 값은 지난번 규칙 그대로 (2026-11-12) — 카톤택배비, 없으면 카톤외택배비
  if (fee > 0 && ps % fee === 0) return { boxes: ps / fee, lines: [{ qty: ps / fee, fee }], composed: false }
  return { boxes: null, lines: [], composed: false }
}
