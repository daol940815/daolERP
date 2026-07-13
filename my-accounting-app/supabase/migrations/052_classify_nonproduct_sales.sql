-- =====================================================
-- 052_classify_nonproduct_sales.sql
-- 비상품 매출 세금계산서 구분 분류 (2025 원장 대사에서 규명된 건)
--
-- 대사 결과 세금계산서 매출 중 상품매출이 아닌 것 2종이 확인됐다:
--   ① 임대료: 요아럽 앞 분기별 4건 × 16,363,637 = 65,454,548 (품목 '임대료')
--      → 더존 원장의 임대료수입 65,454,548 과 원 단위 일치
--   ② 차량 매각: 피알앤디리볼트 앞 1건 38,545,454 (품목 '차량(43어5774)')
--      → 더존: 차량운반구 78,000,000 − 감가상각 55,900,000 + 처분이익 16,445,454
--        = 매각 공급가 38,545,454, 미수금 42,400,000(=×1.1) 과 정합
-- 이 5건을 각각 임대료수익(4005)·유형자산처분이익(4006)으로 확정 분류한다.
-- (5건 모두 현재 미분류 → 분개 미전기 상태. 분류 후 '분개 백필' 실행 시 전기됨)
-- =====================================================

-- 1) 유형자산처분이익 계정 신설 (멱등)
INSERT INTO accounts (code, name, type, side_on_in, side_on_out, is_active)
VALUES ('4006', '유형자산처분이익', 'income', 'credit', 'debit', true)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name, type = EXCLUDED.type;

-- 2) 임대료 4건 → 임대료수익(4005)
UPDATE tax_invoices
   SET confirmed_account_id = (SELECT id FROM accounts WHERE code = '4005' LIMIT 1)
 WHERE direction = 'sales'
   AND counterparty_name ILIKE '%요아럽%'
   AND item_name = '임대료'
   AND supply_amount = 16363637
   AND issue_date BETWEEN '2025-01-01' AND '2025-12-31'
   AND confirmed_account_id IS NULL;

-- 3) 차량 매각 1건 → 유형자산처분이익(4006)
UPDATE tax_invoices
   SET confirmed_account_id = (SELECT id FROM accounts WHERE code = '4006' LIMIT 1)
 WHERE direction = 'sales'
   AND counterparty_name ILIKE '%피알앤디%'
   AND supply_amount = 38545454
   AND issue_date = '2025-06-30'
   AND confirmed_account_id IS NULL;

-- 검증용: 적용 후 아래가 4건/1건이어야 함
-- SELECT count(*) FROM tax_invoices ti JOIN accounts a ON a.id=ti.confirmed_account_id WHERE a.code='4005';
-- SELECT count(*) FROM tax_invoices ti JOIN accounts a ON a.id=ti.confirmed_account_id WHERE a.code='4006';
