-- 수기결제 재업로드 점검 요약 — 한 문장이라 SQL 편집기에서 결과가 한 표로 나온다 (2026-11-17). 조회만.
-- 기대: ①③④⑤⑥⑦⑨ = 0. 0이 아닌 항목은 card_sales_cpid_reupload_check.sql 에서 그 번호 블록만 선택해 실행하면 목록이 나온다.
WITH a AS (SELECT approval_number, tx_date, amount FROM card_sales WHERE transaction_type = 'approval'),
     c AS (SELECT approval_number, min(tx_date) AS cancel_date, sum(abs(amount)) AS cancel_sum FROM card_sales WHERE transaction_type = 'cancel' GROUP BY approval_number),
     jl AS (
       SELECT je.source_id,
              sum(CASE WHEN l.side = 'debit' THEN l.amount ELSE 0 END) AS dr,
              sum(CASE WHEN l.side = 'credit' THEN l.amount ELSE 0 END) AS cr,
              sum(CASE WHEN ac.code = '1101' THEN l.amount ELSE 0 END) AS ar,
              sum(CASE WHEN ac.code = '2003' THEN l.amount ELSE 0 END) AS vat
       FROM journal_entries je JOIN journal_lines l ON l.journal_entry_id = je.id JOIN accounts ac ON ac.id = l.account_id
       WHERE je.source_type = 'card_sale' GROUP BY je.source_id)
SELECT * FROM (
  SELECT '① 분류 안 된 PG(공급가·세금 0, CPID 없음)' AS 점검, count(*) AS 건수, COALESCE(sum(amount), 0) AS 금액
  FROM card_sales WHERE supply_amount = 0 AND tax_amount = 0 AND cpid IS NULL
  UNION ALL
  SELECT '② CPID 규칙 밖(vat_kind 없음)', count(*), COALESCE(sum(amount), 0) FROM card_sales WHERE cpid IS NOT NULL AND vat_kind IS NULL
  UNION ALL
  SELECT '③ 같은 날·같은 카드·같은 금액 승인 2건 이상(그룹 수)', count(*), COALESCE(sum(amount * cnt), 0)
  FROM (SELECT tx_date, card_number, amount, count(*) AS cnt FROM card_sales WHERE transaction_type = 'approval' AND amount <> 0
        GROUP BY tx_date, card_number, amount HAVING count(*) > 1) d
  UNION ALL
  SELECT '④ 취소 이상(승인 없음·초과·날짜 앞섬)', count(*), COALESCE(sum(c.cancel_sum), 0)
  FROM c LEFT JOIN a ON a.approval_number = c.approval_number
  WHERE a.approval_number IS NULL OR c.cancel_sum > abs(a.amount) OR c.cancel_date < a.tx_date
  UNION ALL
  SELECT '⑤ 금액 부호 이상', count(*), COALESCE(sum(amount), 0) FROM card_sales
  WHERE (transaction_type = 'approval' AND amount <= 0) OR (transaction_type = 'cancel' AND amount >= 0)
  UNION ALL
  SELECT '⑥ 면세 건 분개에 부가세예수금 남음', count(*), COALESCE(sum(jl.vat), 0)
  FROM jl JOIN card_sales cs ON cs.id = jl.source_id WHERE cs.vat_kind = 'exempt' AND jl.vat > 0
  UNION ALL
  SELECT '⑦ 분개 정합 깨짐(차대 불일치·매출채권≠금액)', count(*), COALESCE(sum(cs.amount), 0)
  FROM jl JOIN card_sales cs ON cs.id = jl.source_id WHERE jl.dr <> jl.cr OR jl.ar <> abs(cs.amount)
  UNION ALL
  SELECT '⑧ 분개 없는 카드매출(금액 있음) — 검토 대상', count(*), COALESCE(sum(cs.amount), 0)
  FROM card_sales cs LEFT JOIN journal_entries je ON je.source_type = 'card_sale' AND je.source_id = cs.id
  WHERE je.id IS NULL AND cs.amount <> 0
  UNION ALL
  SELECT '⑨ 오늘 갱신된 PG 행 중 거래처 없음(참고)', count(*), COALESCE(sum(amount), 0)
  FROM card_sales WHERE cpid IS NOT NULL AND vendor_id IS NULL AND updated_at::date = current_date
  UNION ALL
  SELECT '⑩-1 면세(exempt) 전체', count(*), COALESCE(sum(amount), 0) FROM card_sales WHERE vat_kind = 'exempt'
  UNION ALL
  SELECT '⑩-2 과세(taxable, CPID)', count(*), COALESCE(sum(amount), 0) FROM card_sales WHERE vat_kind = 'taxable'
  UNION ALL
  SELECT '⑩-3 11/16 CPID 없는 신규 6건 중 공급가·세금 채워진 건(단말기면 6)', count(*), COALESCE(sum(amount), 0)
  FROM card_sales WHERE created_at::date = current_date AND cpid IS NULL AND (supply_amount <> 0 OR tax_amount <> 0)
) t;
