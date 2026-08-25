import OrderForm from '../order-form'

// 신규 주문 — consult: 상담일지 전환 프리필 / reissue: 취소·재등록 프리필 (511)
export default function NewOrderPage({ searchParams }: { searchParams: { consult?: string; reissue?: string } }) {
  return <OrderForm consultId={searchParams.consult} reissueId={searchParams.reissue} />
}
