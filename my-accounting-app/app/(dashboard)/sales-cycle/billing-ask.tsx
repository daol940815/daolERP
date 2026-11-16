'use client'

// 다른 거래처 명의 계산서를 연결할 때 묻는 창 + 연결 저장 도우미 (2026-11-17, 시안 docs/mockups/계산서연결_다른거래처_시안.html)
// 출장소 주문의 계산서가 지점 명의로 발행되는 경우: 연결하면서 "청구처로 지정"하면 다음부터 연결 창 추천에 바로 뜬다.
// 청구처 지정은 기존 API(/api/vendor-hub/billing, 거래처 관리 수정 권한)를 그대로 쓴다 — 계산서 원본 · 계산서의 거래처는 바뀌지 않는다.

export interface InvoiceLink { orderId: string; taxInvoiceId: string; amount: number; issueDate: string }
export interface BillingAsk {
  orderVendorId: string
  orderVendorName: string
  invoiceVendorId: string | null       // null = 거래처 미연결 계산서
  invoiceVendorName: string
  canSetBilling: boolean               // 청구처 없음 + 권한 있음 + 계산서에 거래처가 있음
  whyNot?: string                      // 청구처 지정을 못 묻는 이유 (안내용)
}

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

// 연결 저장(+ 선택 시 청구처 지정). 반환: 화면에 보여 줄 문구
export async function saveInvoiceLinks(links: InvoiceLink[], billing?: { vendorId: string; billingVendorId: string }): Promise<{ ok: boolean; message: string }> {
  const res = await fetch('/api/sales-cycle/invoice-candidates', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ links }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, message: json.error ?? '연결 실패' }
  const prop = json.propagated as { count: number; amount: number } | undefined
  let message = `연결 ${json.linked}건 확정 (${won(json.amount ?? 0)})`
    + (prop && prop.count > 0 ? ` · 계산서에 매칭된 입금 ${prop.count}건(${won(prop.amount)})을 수금배분으로 이월했습니다.` : '')
  if (billing) {
    const br = await fetch('/api/vendor-hub/billing', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set', vendor_ids: [billing.vendorId], billing_vendor_id: billing.billingVendorId }),
    })
    const bj = await br.json().catch(() => ({}))
    message += br.ok ? ` · 청구처를 ${bj.billing_name ?? ''}(으)로 지정했습니다.` : ` · 청구처 지정은 실패했습니다(${bj.error ?? '권한 또는 설정 확인'}). 연결은 저장됐습니다.`
  }
  return { ok: true, message }
}

export function BillingAskDialog({ ask, amount, busy, onChoose }: {
  ask: BillingAsk; amount: number; busy: boolean; onChoose: (c: 'cancel' | 'link' | 'link_set') => void
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => !busy && onChoose('cancel')}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-gray-200 font-semibold text-gray-900">계산서의 거래처가 다릅니다</div>
        <div className="px-5 py-4 text-sm text-gray-700 leading-relaxed">
          <p>주문은 <b>{ask.orderVendorName}</b>, 계산서는 <b>{ask.invoiceVendorName}</b> 명의입니다. 연결 금액 {won(amount)}.</p>
          {ask.canSetBilling ? (
            <>
              <p className="mt-2">{ask.orderVendorName}의 계산서가 앞으로도 {ask.invoiceVendorName} 명의로 발행된다면 <b>청구처로 지정</b>하세요. 다음부터 연결 창에 그쪽 계산서가 함께 나오고 자동으로 추천됩니다.</p>
              <p className="mt-2 text-xs text-gray-400">두 매출처는 합쳐지지 않습니다. 주문 · 고객 관리는 지금 단위 그대로이고, 청구처는 매출처 관리 › 청구처 지정에서 언제든 해제할 수 있습니다.</p>
            </>
          ) : (
            <p className="mt-2 text-xs text-gray-500">{ask.whyNot ?? '이번 연결만 저장합니다.'}</p>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex justify-end gap-2 flex-wrap">
          <button onClick={() => onChoose('cancel')} disabled={busy} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white disabled:opacity-40">취소</button>
          <button onClick={() => onChoose('link')} disabled={busy} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white hover:bg-gray-50 disabled:opacity-40">이번만 연결</button>
          {ask.canSetBilling && (
            <button onClick={() => onChoose('link_set')} disabled={busy}
              className="px-3 py-1.5 rounded-lg text-sm bg-slate-900 text-white font-semibold hover:bg-slate-700 disabled:opacity-40">{busy ? '저장 중...' : '연결하고 청구처로 지정'}</button>
          )}
        </div>
      </div>
    </div>
  )
}
