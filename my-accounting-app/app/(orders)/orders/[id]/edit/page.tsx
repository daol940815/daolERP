import OrderForm from '../../order-form'

// 주문 수정 (당일: 직접 반영 / 익일 이후: 수정 요청 접수)
export default function EditOrderPage({ params }: { params: { id: string } }) {
  return <OrderForm orderId={params.id} />
}
