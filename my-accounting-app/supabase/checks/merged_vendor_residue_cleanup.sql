-- =====================================================
-- 병합된 매출처에 남은 고객 쪽 데이터 정리 — 2026-11-19 (매출처 입력값 참조 원천 점검 A)
--
-- 진단 [0] 결과(사용자 실행 2026-11-19): 병합된 매출처에 남은 현재 배정 15 · 지점 담당 11 · 상담 2 · 주문처 2 · 별칭 1.
-- 원인: 2026-11-16 이전 '거래처 중복 정리' 병합은 merge_vendor(회계 연결)만 불러 고객 쪽 데이터를 흡수된 쪽에 남겼다.
-- 할 일: 매출처 합치기(lib/vendor-merge.ts executeVendorMerge)가 지금 옮기는 것과 같은 범위를 **최종 남은 매출처**로 옮긴다.
--   담당자 배정 · 지점 담당 · 영업일지 · 주문처 · 발주(= merge_vendor_extra_refs 그대로) +
--   상담 · 표기 연결(contact_name_links) · 과거 매출 스냅샷 · 고객 확인 이력 · ERP 별칭.
-- 규칙(합치기와 같음):
--   - 같은 사람이 남은 쪽에도 배정돼 있으면 흡수 쪽 배정 줄은 지운다(남은 쪽 줄 유지).
--   - 같은 직원이 남은 쪽 지점 담당이면 흡수 쪽 줄은 지운다. 주담당 · 대표 담당자가 남은 쪽에 있으면 흡수 쪽 표시를 내린다.
--   - 표기 연결은 남은 쪽에 같은 표기가 있으면 흡수 쪽 줄을 지운다(유니크).
--   - 병합이 여러 번 이어졌으면 끝까지 따라간다. 최종 매출처가 비활성이면 옮기지 않고 목록에만 보인다.
-- 원본(주문 · 상담에 저장된 글자)은 손대지 않는다.
--
-- 순서: STEP 1 드라이런(조회만) → 결과 검토 · 승인 → STEP 2 실행 → STEP 3 검증 (블록별로 따로 실행)
-- =====================================================


-- ── STEP 1. 드라이런 (조회만) ─────────────────────────────
WITH RECURSIVE ch AS (
  SELECT id AS root, id AS cur, 0 AS d FROM vendors WHERE status = 'merged'
  UNION ALL
  SELECT ch.root, v.merged_into_id, ch.d + 1
    FROM ch JOIN vendors v ON v.id = ch.cur
   WHERE v.status = 'merged' AND v.merged_into_id IS NOT NULL AND ch.d < 10
),
fin AS (SELECT DISTINCT ON (root) root AS from_id, cur AS into_id FROM ch ORDER BY root, d DESC)
SELECT m.name AS 병합된매출처, t.name AS 옮길곳, t.is_active AS 옮길곳_활성, t.status AS 옮길곳_상태,
       (SELECT max(merged_at)::date FROM vendor_merge_logs l WHERE l.from_id = m.id) AS 병합일,
       (SELECT count(*) FROM contact_assignments a WHERE a.vendor_id = m.id AND a.ended_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM contact_assignments b WHERE b.vendor_id = f.into_id AND b.contact_id = a.contact_id)) AS 현재배정_옮김,
       (SELECT count(*) FROM contact_assignments a WHERE a.vendor_id = m.id
           AND EXISTS (SELECT 1 FROM contact_assignments b WHERE b.vendor_id = f.into_id AND b.contact_id = a.contact_id)) AS 배정_중복삭제,
       (SELECT count(*) FROM contact_assignments a WHERE a.vendor_id = m.id AND a.ended_at IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM contact_assignments b WHERE b.vendor_id = f.into_id AND b.contact_id = a.contact_id)) AS 끝난배정_옮김,
       (SELECT string_agg(c.name, ', ') FROM contact_assignments a JOIN contacts c ON c.id = a.contact_id
         WHERE a.vendor_id = m.id AND a.ended_at IS NULL) AS 현재배정_사람,
       (SELECT count(*) FROM vendor_staff s WHERE s.vendor_id = m.id
           AND NOT EXISTS (SELECT 1 FROM vendor_staff b WHERE b.vendor_id = f.into_id AND b.employee_id = s.employee_id)) AS 지점담당_옮김,
       (SELECT count(*) FROM vendor_staff s WHERE s.vendor_id = m.id
           AND EXISTS (SELECT 1 FROM vendor_staff b WHERE b.vendor_id = f.into_id AND b.employee_id = s.employee_id)) AS 지점담당_중복삭제,
       (SELECT count(*) FROM erp_consultations c WHERE c.vendor_id = m.id) AS 상담,
       (SELECT count(*) FROM erp_orders o WHERE o.vendor_id = m.id) AS 주문처,
       (SELECT string_agg(o.order_no, ', ') FROM erp_orders o WHERE o.vendor_id = m.id) AS 주문번호,
       (SELECT count(*) FROM contact_activities t2 WHERE t2.vendor_id = m.id) AS 영업일지,
       (SELECT count(*) FROM erp_vendor_aliases al WHERE al.alias_type = 'customer' AND al.vendor_id = m.id) AS 별칭,
       (SELECT string_agg(al.erp_name, ', ') FROM erp_vendor_aliases al WHERE al.alias_type = 'customer' AND al.vendor_id = m.id) AS 별칭명,
       (SELECT count(*) FROM contact_name_links k WHERE k.vendor_id = m.id) AS 표기연결,
       (SELECT count(*) FROM doc_sales_snapshot k WHERE k.vendor_id = m.id) AS 매출스냅샷,
       (SELECT count(*) FROM contact_review_events k WHERE k.vendor_id = m.id) AS 확인이력
  FROM fin f
  JOIN vendors m ON m.id = f.from_id
  JOIN vendors t ON t.id = f.into_id
 WHERE EXISTS (SELECT 1 FROM contact_assignments a WHERE a.vendor_id = m.id)
    OR EXISTS (SELECT 1 FROM vendor_staff s WHERE s.vendor_id = m.id)
    OR EXISTS (SELECT 1 FROM erp_consultations c WHERE c.vendor_id = m.id)
    OR EXISTS (SELECT 1 FROM erp_orders o WHERE o.vendor_id = m.id)
    OR EXISTS (SELECT 1 FROM contact_activities t2 WHERE t2.vendor_id = m.id)
    OR EXISTS (SELECT 1 FROM erp_vendor_aliases al WHERE al.alias_type = 'customer' AND al.vendor_id = m.id)
    OR EXISTS (SELECT 1 FROM contact_name_links k WHERE k.vendor_id = m.id)
    OR EXISTS (SELECT 1 FROM doc_sales_snapshot k WHERE k.vendor_id = m.id)
    OR EXISTS (SELECT 1 FROM contact_review_events k WHERE k.vendor_id = m.id)
 ORDER BY 병합일 DESC NULLS LAST, m.name;


-- ── STEP 2. 실행 (승인 후 — 이 블록만 한 번에 실행. 끝에 스스로 검사해 남은 것이 있으면 전부 되돌린다) ─────────
DO $$
DECLARE r RECORD; n_total INT := 0; done_ids UUID[] := '{}'; left_cnt INT;
BEGIN
  FOR r IN
    WITH RECURSIVE ch AS (
      SELECT id AS root, id AS cur, 0 AS d FROM vendors WHERE status = 'merged'
      UNION ALL
      SELECT ch.root, v.merged_into_id, ch.d + 1
        FROM ch JOIN vendors v ON v.id = ch.cur
       WHERE v.status = 'merged' AND v.merged_into_id IS NOT NULL AND ch.d < 10
    ),
    fin AS (SELECT DISTINCT ON (root) root AS from_id, cur AS into_id FROM ch ORDER BY root, d DESC)
    SELECT f.from_id, f.into_id FROM fin f JOIN vendors t ON t.id = f.into_id
     WHERE t.status IS DISTINCT FROM 'merged' AND t.is_active
  LOOP
    -- 대표 담당자: 남은 쪽에 현재 대표가 있으면 흡수 쪽 대표 표시를 내린다 (uq_contact_asgn_rep)
    IF EXISTS (SELECT 1 FROM contact_assignments WHERE vendor_id = r.into_id AND is_representative AND ended_at IS NULL) THEN
      UPDATE contact_assignments SET is_representative = false WHERE vendor_id = r.from_id AND is_representative;
    END IF;
    -- 배정 · 지점 담당 · 영업일지 · 주문처 · 발주 (앱의 합치기와 같은 함수)
    PERFORM merge_vendor_extra_refs(r.from_id, r.into_id);
    -- 상담 · 스냅샷 · 확인 이력
    UPDATE erp_consultations     SET vendor_id = r.into_id WHERE vendor_id = r.from_id;
    UPDATE doc_sales_snapshot    SET vendor_id = r.into_id WHERE vendor_id = r.from_id;
    UPDATE contact_review_events SET vendor_id = r.into_id WHERE vendor_id = r.from_id;
    -- 표기 연결: 남은 쪽에 같은 표기가 있으면 흡수 쪽 줄 삭제 (UNIQUE vendor_id, raw_name)
    DELETE FROM contact_name_links a
     WHERE a.vendor_id = r.from_id
       AND EXISTS (SELECT 1 FROM contact_name_links b WHERE b.vendor_id = r.into_id AND b.raw_name = a.raw_name);
    UPDATE contact_name_links SET vendor_id = r.into_id WHERE vendor_id = r.from_id;
    -- ERP 별칭 (매출 집계 기준) — 병합된 매출처에 붙어 있으면 그 주문이 집계에서 빠진다
    UPDATE erp_vendor_aliases SET vendor_id = r.into_id WHERE vendor_id = r.from_id;
    done_ids := done_ids || r.from_id;
    n_total := n_total + 1;
  END LOOP;

  -- 자체 검사: 처리한 병합 매출처에 남은 참조가 하나라도 있으면 예외 → 이 블록의 변경 전부 취소
  SELECT (SELECT count(*) FROM contact_assignments   WHERE vendor_id = ANY(done_ids))
       + (SELECT count(*) FROM vendor_staff          WHERE vendor_id = ANY(done_ids))
       + (SELECT count(*) FROM erp_consultations     WHERE vendor_id = ANY(done_ids))
       + (SELECT count(*) FROM erp_orders            WHERE vendor_id = ANY(done_ids))
       + (SELECT count(*) FROM contact_activities    WHERE vendor_id = ANY(done_ids))
       + (SELECT count(*) FROM erp_vendor_aliases    WHERE vendor_id = ANY(done_ids))
       + (SELECT count(*) FROM contact_name_links    WHERE vendor_id = ANY(done_ids))
       + (SELECT count(*) FROM doc_sales_snapshot    WHERE vendor_id = ANY(done_ids))
       + (SELECT count(*) FROM contact_review_events WHERE vendor_id = ANY(done_ids))
    INTO left_cnt;
  IF left_cnt > 0 THEN
    RAISE EXCEPTION '남은 참조 %건 — 전부 되돌렸습니다. 결과를 ERP 담당에게 보내 주세요.', left_cnt;
  END IF;
  RAISE NOTICE '처리한 병합 매출처 %곳, 남은 참조 0', n_total;
END $$;


-- ── STEP 3. 검증 — 전부 0 이 기대값 (최종 매출처가 비활성인 건은 STEP 1 목록에 남는다) ──
SELECT
  (SELECT count(*) FROM contact_assignments a JOIN vendors v ON v.id = a.vendor_id WHERE v.status = 'merged') AS 배정_기대0,
  (SELECT count(*) FROM vendor_staff s JOIN vendors v ON v.id = s.vendor_id WHERE v.status = 'merged') AS 지점담당_기대0,
  (SELECT count(*) FROM erp_consultations c JOIN vendors v ON v.id = c.vendor_id WHERE v.status = 'merged') AS 상담_기대0,
  (SELECT count(*) FROM erp_orders o JOIN vendors v ON v.id = o.vendor_id WHERE v.status = 'merged') AS 주문처_기대0,
  (SELECT count(*) FROM contact_activities t JOIN vendors v ON v.id = t.vendor_id WHERE v.status = 'merged') AS 영업일지_기대0,
  (SELECT count(*) FROM erp_vendor_aliases al JOIN vendors v ON v.id = al.vendor_id WHERE al.alias_type = 'customer' AND v.status = 'merged') AS 별칭_기대0,
  (SELECT count(*) FROM contact_name_links k JOIN vendors v ON v.id = k.vendor_id WHERE v.status = 'merged') AS 표기연결_기대0,
  (SELECT count(*) FROM doc_sales_snapshot k JOIN vendors v ON v.id = k.vendor_id WHERE v.status = 'merged') AS 스냅샷_기대0,
  (SELECT count(*) FROM contact_review_events k JOIN vendors v ON v.id = k.vendor_id WHERE v.status = 'merged') AS 확인이력_기대0,
  (SELECT count(*) FROM (SELECT vendor_id FROM contact_assignments WHERE is_representative AND ended_at IS NULL GROUP BY vendor_id HAVING count(*) > 1) x) AS 대표중복_기대0,
  (SELECT count(*) FROM (SELECT contact_id, vendor_id FROM contact_assignments WHERE ended_at IS NULL GROUP BY 1, 2 HAVING count(*) > 1) x) AS 같은지점_현재배정중복;
