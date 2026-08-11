import OrderForm from '../order-form'

// 신규 주문 입력 (2단계). ?consult=<id>면 상담일지 내용으로 미리 채워 전환 모드.
export default function NewOrderPage({ searchParams }: { searchParams: { consult?: string } }) {
  return <OrderForm consultId={searchParams.consult} />
}
