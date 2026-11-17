-- 카드매출 수기결제 파일 전량 재업로드 뒤 점검 (427, 2026-11-17). 조회만.
-- 기대: ① 0행 ② CDA23814=taxable · CDA23815=exempt 두 줄만 ③ 0행 ④ 0행 ⑤ 0행 ⑥ 0행 ⑦ 0행 ⑧ 참고 ⑨ 0행 ⑩ 참고

-- ① 아직 분류 안 된 PG 건(공급가 · 세금 0인데 CPID 없음) — 기대 0
SELECT date_trunc('month', tx_date)::date AS 월, transaction_type, count(*) AS 건수, sum(amount) AS 금액
FROM card_sales WHERE supply_amount = 0 AND tax_amount = 0 AND cpid IS NULL
GROUP BY 1, 2 ORDER BY 1, 2;

-- ② CPID · 판정별 집계 — 모르는 CPID(vat_kind NULL)가 있으면 여기 보인다
SELECT cpid, vat_kind, transaction_type, count(*) AS 건수, sum(amount) AS 금액, min(tx_date) AS 첫날, max(tx_date) AS 끝날
FROM card_sales WHERE cpid IS NOT NULL
GROUP BY cpid, vat_kind, transaction_type ORDER BY cpid, transaction_type;

-- ③ 중복 의심: 같은 날 · 같은 카드번호 · 같은 금액의 승인이 2건 이상 (승인번호가 다른데 같은 결제일 수 있음 — 재결제 · 중복 결제 확인)
SELECT tx_date, card_number, amount, count(*) AS 건수, string_agg(approval_number || COALESCE(' [' || cpid || ']', ''), ', ' ORDER BY approval_number) AS 승인번호들
FROM card_sales WHERE transaction_type = 'approval' AND amount <> 0
GROUP BY tx_date, card_number, amount HAVING count(*) > 1 ORDER BY tx_date DESC;

-- ④ 취소 이상: 승인 없는 취소 · 취소 합이 승인 금액 초과 · 취소일이 승인일보다 앞
WITH a AS (SELECT approval_number, tx_date, amount FROM card_sales WHERE transaction_type = 'approval'),
     c AS (SELECT approval_number, min(tx_date) AS cancel_date, sum(abs(amount)) AS cancel_sum, count(*) AS cancel_cnt FROM card_sales WHERE transaction_type = 'cancel' GROUP BY approval_number)
SELECT c.approval_number, a.tx_date AS 승인일, a.amount AS 승인금액, c.cancel_date AS 취소일, c.cancel_sum AS 취소합, c.cancel_cnt AS 취소행수,
       CASE WHEN a.approval_number IS NULL THEN '승인 없음' WHEN c.cancel_sum > abs(a.amount) THEN '취소 초과' WHEN c.cancel_date < a.tx_date THEN '취소일이 앞섬' END AS 이상
FROM c LEFT JOIN a ON a.approval_number = c.approval_number
WHERE a.approval_number IS NULL OR c.cancel_sum > abs(a.amount) OR c.cancel_date < a.tx_date
ORDER BY c.cancel_date DESC;

-- ⑤ 금액 부호 이상: 승인인데 0 이하, 취소인데 0 이상
SELECT id, tx_date, transaction_type, approval_number, amount, cpid FROM card_sales
WHERE (transaction_type = 'approval' AND amount <= 0) OR (transaction_type = 'cancel' AND amount >= 0)
ORDER BY tx_date DESC;

-- ⑥ 면세 건 분개에 부가세예수금(2003)이 남아 있으면 안 된다 — 기대 0
SELECT c.tx_date, c.approval_number, c.amount, jl.amount AS 세액줄
FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
JOIN accounts a ON a.id = jl.account_id JOIN card_sales c ON c.id = je.source_id
WHERE je.source_type = 'card_sale' AND c.vat_kind = 'exempt' AND a.code = '2003';

-- ⑦ 분개 정합: 카드매출 분개마다 차변 합 = 대변 합, 매출채권(1101) = 결제금액 절대값 — 기대 0
WITH l AS (
  SELECT je.source_id, sum(CASE WHEN jl.side = 'debit' THEN jl.amount ELSE 0 END) AS dr,
         sum(CASE WHEN jl.side = 'credit' THEN jl.amount ELSE 0 END) AS cr,
         sum(CASE WHEN a.code = '1101' THEN jl.amount ELSE 0 END) AS ar
  FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id = je.id JOIN accounts a ON a.id = jl.account_id
  WHERE je.source_type = 'card_sale' GROUP BY je.source_id)
SELECT c.tx_date, c.approval_number, c.transaction_type, c.amount, l.dr, l.cr, l.ar
FROM l JOIN card_sales c ON c.id = l.source_id
WHERE l.dr <> l.cr OR l.ar <> abs(c.amount) ORDER BY c.tx_date DESC;

-- ⑧ 분개 없는 카드매출(검토 대상 — 매입사 인식 불가 · 금액 0 등). 재업로드로 늘지 않았는지 참고
SELECT c.tx_date, c.transaction_type, c.approval_number, c.acquirer, c.amount, c.cpid, c.vat_kind
FROM card_sales c LEFT JOIN journal_entries je ON je.source_type = 'card_sale' AND je.source_id = c.id
WHERE je.id IS NULL AND c.amount <> 0 ORDER BY c.tx_date DESC LIMIT 50;

-- ⑨ 재업로드로 거래처 연결이 풀린 건이 있으면 안 된다 — 오늘 갱신된 PG 행 중 거래처 없음 (카드번호 미등록 거래처면 원래부터 비어 있을 수 있음, 참고)
SELECT c.tx_date, c.approval_number, c.card_number, c.amount, c.cpid, c.updated_at
FROM card_sales c
WHERE c.cpid IS NOT NULL AND c.vendor_id IS NULL AND c.updated_at::date = current_date
ORDER BY c.tx_date DESC;

-- ⑩ 오늘 재업로드가 건드린 범위 (참고): 갱신 행 수 · 신규로 생긴 행 수(created_at 오늘) — 신규가 있으면 옛 파일에만 있던 승인번호
SELECT count(*) FILTER (WHERE updated_at::date = current_date) AS 오늘_갱신,
       count(*) FILTER (WHERE created_at::date = current_date) AS 오늘_신규,
       count(*) AS 전체
FROM card_sales;
