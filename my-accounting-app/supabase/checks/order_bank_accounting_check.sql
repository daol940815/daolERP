-- 2026-11-25 주문 1건의 통장 수금이 회계에 어떻게 잡혔는지 (읽기 전용). 주문번호만 바꿔서 쓴다.
-- 한 줄 = 이 주문에 붙은 수금 매칭 1건. 통장 입금이면 그 입금의 분류 계정 · 확정 여부 · 분개 계정을 함께 보여 준다.
with o as (
  select v.order_id, v.order_no, v.order_date, v.net_sales, v.billable, v.outstanding
  from v_erp_order_receivable v where v.order_no = 'D261110-011'
)
select
  o.order_no, o.order_date, o.net_sales, o.billable, o.outstanding,
  (select count(*) from erp_order_invoices i where i.order_id = o.order_id)          as invoice_links,
  m.source_type, m.amount as matched_amount, m.paid_date, m.record_id is not null as via_record,
  t.counterparty_name, t.amount_in, t.status as tx_status,
  ca.code || ' ' || ca.name as confirmed_account,
  sa.code || ' ' || sa.name as suggested_account,
  (select count(*) from tax_invoice_payments p where p.transaction_id = t.id)         as tx_invoice_links,
  (select count(*) from cash_receipt_payments p where p.transaction_id = t.id)        as tx_receipt_links,
  (select string_agg(ja.code || ' ' || ja.name || ' ' || jl.side || ' ' || jl.amount, ' / ' order by jl.side desc)
     from journal_entries je join journal_lines jl on jl.journal_entry_id = je.id join accounts ja on ja.id = jl.account_id
    where je.source_type = 'bank' and je.source_id = t.id)                           as journal
from o
left join erp_payment_matches m on m.order_id = o.order_id
left join transactions t on m.source_type = 'bank' and t.id = m.source_id
left join accounts ca on ca.id = t.confirmed_account_id
left join accounts sa on sa.id = t.suggested_account_id;
