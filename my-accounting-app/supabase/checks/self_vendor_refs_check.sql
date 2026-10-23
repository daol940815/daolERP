-- =====================================================
-- self_vendor_refs_check.sql  (읽기 전용)
-- 자사 거래처 2건('주식회사 다올커머스' 701-88-00023 · '다올커머스')이 어디서 쓰이는지
-- 411로 뒤집힌 계산서를 지운 뒤에도 참조가 남아 있으면 지우지 않는다.
-- =====================================================
SELECT v.id, v.name, v.biz_number, v.type, v.created_at,
       (SELECT COUNT(*) FROM tax_invoices t WHERE t.vendor_id = v.id)      AS 계산서_참조,
       (SELECT COUNT(*) FROM transactions tx WHERE tx.vendor_id = v.id)    AS 통장_참조,
       (SELECT COUNT(*) FROM erp_vendor_aliases a WHERE a.vendor_id = v.id) AS 별칭_참조,
       (SELECT COUNT(*) FROM card_accounts c WHERE c.vendor_id = v.id)     AS 카드사_참조,
       (SELECT COUNT(*) FROM journal_lines jl WHERE jl.vendor_id = v.id)   AS 분개_참조
FROM vendors v
WHERE v.biz_number = '701-88-00023' OR v.name ~ '다올커머스'
ORDER BY v.created_at;
