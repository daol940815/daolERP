-- =====================================================
-- self_vendor_blockers_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 417 STEP 2가 "사람이 만든 기록 227건"으로 중단됨 (2026-10-26) — 어느 표의 무슨 기록인지 본다.
-- 네 표: vendor_ledger_entries(매입처 정산 원장: 기초/입금/조정) · purchase_cycle_reviews(매입 사이클 확인 이력)
--        · vendor_staff(담당 직원) · contact_assignments(거래처 담당자 배정)
-- =====================================================

WITH s AS (
  SELECT id, name FROM vendors
  WHERE biz_number = '701-88-00023'
     OR regexp_replace(name, '[\s（）()주식회사]', '', 'g') = '다올커머스'
)
SELECT jsonb_pretty(jsonb_build_object(

  '표별_건수', jsonb_build_object(
    '정산원장', (SELECT COUNT(*) FROM vendor_ledger_entries e WHERE e.vendor_id IN (SELECT id FROM s)),
    '매입검토', (SELECT COUNT(*) FROM purchase_cycle_reviews r WHERE r.vendor_id IN (SELECT id FROM s)),
    '담당직원', (SELECT COUNT(*) FROM vendor_staff v WHERE v.vendor_id IN (SELECT id FROM s)),
    '담당자배정', (SELECT COUNT(*) FROM contact_assignments c WHERE c.vendor_id IN (SELECT id FROM s))
  ),

  -- 정산 원장: 종류별 건수·합계·기간·통장 연결 여부
  '정산원장_요약', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t->>'종류'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object('거래처', v.name, '종류', e.entry_type, '건수', COUNT(*), '합계', SUM(e.amount),
                                '기간', MIN(e.entry_date) || ' ~ ' || MAX(e.entry_date),
                                '통장연결', COUNT(*) FILTER (WHERE e.transaction_id IS NOT NULL),
                                '입력시각범위', to_char(MIN(e.created_at), 'MM-DD HH24:MI') || ' ~ ' || to_char(MAX(e.created_at), 'MM-DD HH24:MI')) AS t
      FROM vendor_ledger_entries e JOIN s v ON v.id = e.vendor_id
      GROUP BY v.name, e.entry_type
    ) x
  ),
  '정산원장_표본', (
    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object('일자', e.entry_date, '종류', e.entry_type, '금액', e.amount, '메모', e.memo,
                                '통장적요', tx.description, '통장출금', tx.amount_out, '통장입금', tx.amount_in) AS t
      FROM vendor_ledger_entries e JOIN s v ON v.id = e.vendor_id
      LEFT JOIN transactions tx ON tx.id = e.transaction_id
      ORDER BY e.amount DESC LIMIT 10
    ) x
  ),

  '매입검토', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('월', r.month, '상태', r.status, '확인자', r.reviewed_by,
                                                 '확인시각', to_char(r.reviewed_at, 'YYYY-MM-DD HH24:MI'))), '[]'::jsonb)
    FROM purchase_cycle_reviews r JOIN s v ON v.id = r.vendor_id
  ),
  '담당직원', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('직원', em.name, '주담당', vs.is_primary, '종료', vs.ended_at)), '[]'::jsonb)
    FROM vendor_staff vs JOIN s v ON v.id = vs.vendor_id LEFT JOIN employees em ON em.id = vs.employee_id
  ),
  '담당자배정_요약', (
    SELECT jsonb_build_object('건수', COUNT(*), '현재', COUNT(*) FILTER (WHERE ca.ended_at IS NULL),
                              '입력시각범위', to_char(MIN(ca.created_at), 'MM-DD HH24:MI') || ' ~ ' || to_char(MAX(ca.created_at), 'MM-DD HH24:MI'))
    FROM contact_assignments ca JOIN s v ON v.id = ca.vendor_id
  ),
  '담당자배정_표본', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('이름', c.name, '직함', ca.title, '전화', c.phone, '대표', ca.is_representative)), '[]'::jsonb)
    FROM (SELECT * FROM contact_assignments ca2 JOIN s v2 ON v2.id = ca2.vendor_id ORDER BY ca2.created_at LIMIT 12) ca
    JOIN contacts c ON c.id = ca.contact_id
  )

)) AS check_result;
