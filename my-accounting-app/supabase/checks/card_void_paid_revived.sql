-- 2026-11-24 규칙 변경(중복해제 + 처리현황 입금완료 = 정산으로 봄) 뒤 되살아나는 카드매출 행 · 같은 카드 · 같은 금액 · 같은 날의 짝 승인
-- 읽기 전용. 짝이 정산완료로 따로 있는 행은 매출 · 수금 후보가 두 번 잡힐 수 있으니 주문 매칭 전 확인용.
select v.tx_date, v.approval_number, right(coalesce(v.card_number,''),4) as card4, v.amount, v.processing_status,
       ven.name as vendor,
       (select count(*) from card_sales p
         where p.id <> v.id and p.transaction_type = 'approval' and p.tx_date = v.tx_date
           and p.amount = v.amount and right(coalesce(p.card_number,''),4) = right(coalesce(v.card_number,''),4)
           and coalesce(p.settlement_status,'') <> '중복해제') as pair_settled,
       exists(select 1 from journal_entries j where j.source_type = 'card_sale' and j.source_id = v.id::text) as posted
from card_sales v left join vendors ven on ven.id = v.vendor_id
where v.transaction_type = 'approval' and trim(v.settlement_status) = '중복해제' and trim(v.processing_status) = '입금완료'
order by v.tx_date desc;
