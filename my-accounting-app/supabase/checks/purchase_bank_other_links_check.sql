-- 매입처 통장 대사 — "이 매입처 밖의 계산서에 연결"된 출금이 어느 계산서로 갔는지 (2026-11-12, 다온글로비스 사례)
-- 결과 해석: inv_vendor 가 NULL 이면 거래처 미연결 계산서(상호만 있음) → 418 재연결 대상.
--            inv_vendor 가 다른 이름이면 중복 거래처(통합) 또는 오매칭.
-- :vendor_name 자리에 매입처 이름을 넣어 실행 (기본 (주)다온글로비스)
WITH me AS (
  SELECT id, name FROM vendors WHERE name = '(주)다온글로비스'
)
SELECT tx.tx_date, tx.description, tx.amount_out,
       p.amount                          AS 연결금액,
       ti.issue_date                     AS 계산서일,
       ti.counterparty_name              AS 계산서_상호,
       ti.counterparty_biz_number        AS 계산서_사업자번호,
       ti.vendor_id                      AS 계산서_vendor_id,
       iv.name                           AS 계산서_거래처명,
       CASE WHEN ti.vendor_id IS NULL THEN '거래처 미연결'
            WHEN ti.vendor_id = me.id THEN '이 매입처'
            ELSE '다른 거래처' END        AS 판정
FROM me
JOIN transactions tx ON tx.vendor_id = me.id AND tx.transfer_pair_id IS NULL AND COALESCE(tx.amount_out, 0) > 0
JOIN tax_invoice_payments p ON p.transaction_id = tx.id
JOIN tax_invoices ti ON ti.id = p.tax_invoice_id
LEFT JOIN vendors iv ON iv.id = ti.vendor_id
WHERE ti.vendor_id IS DISTINCT FROM me.id
ORDER BY tx.tx_date DESC;

-- 같은 이름·같은 사업자번호의 거래처가 둘 이상인지 (중복 거래처 확인)
SELECT id, name, biz_number, status, is_active, purchase_kind
FROM vendors
WHERE regexp_replace(lower(name), '\s|\(주\)|㈜|주식회사', '', 'g') = regexp_replace(lower('(주)다온글로비스'), '\s|\(주\)|㈜|주식회사', '', 'g')
   OR biz_number = (SELECT biz_number FROM vendors WHERE name = '(주)다온글로비스' LIMIT 1)
ORDER BY created_at;

-- 거래처 미연결 매입 계산서 전체 규모 (418 대상)
SELECT COUNT(*) AS 미연결_매입계산서, COALESCE(SUM(total_amount), 0) AS 합계
FROM tax_invoices WHERE direction = 'purchase' AND vendor_id IS NULL;
