-- =====================================================
-- 702_consultation_item_fields.sql
-- 상담일지 개선 2차 (사용자 확정 2026-08-18, 시안 승인)
--
-- ※ 품목별 상태·기타사항은 509(실무자 보완)에서 status·option_note로 이미
--    추가되어 이 파일에서는 다루지 않는다. 이 파일은 두 가지만:
--
-- 1) 배송비 행 구분 — 품목 배송비 열을 없애고 배송비를 옵션 행으로 입력
--    (배송비(카톤단위)/배송비(카톤외)). is_shipping으로 일반 품목과 구분.
--    주문 전환 시 본 상품 행의 배송비 컬럼으로 합산되어 접힌다 (하류 무변경).
-- 2) 지점명 보정 — branchLabel이 법인 접두("(주)" 등) 때문에 업체명을 못 떼서
--    부서(지점)에 전체 이름이 저장된 건 정리. 드라이런:
--    supabase/checks/branch_name_cleanup_dryrun.sql (자유입력 밖 0건 확인, 사용자 보고).
--    업로드 주문은 원본 보존 원칙상 제외 — 상담일지·직접 입력 주문만.
-- =====================================================

-- ── 1) 상담 품목: 배송비 행 구분 ──────────────────────
ALTER TABLE erp_consultation_items
  ADD COLUMN IF NOT EXISTS is_shipping BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN erp_consultation_items.is_shipping IS
  '배송비 행 (배송비(카톤단위)/배송비(카톤외)). 주문 전환 시 본 상품 배송비로 합산됨 (702)';

-- ── 2) 지점명 보정: 상담일지 ──────────────────────────
-- 규칙: 지점명·업체명 양쪽에서 법인 접두를 뗀 뒤, 거래처 전체 이름이 업체명으로
-- 시작하면 그 뒷부분만 남긴다. 드라이런의 보정 대상 정의와 동일.
WITH fix AS (
  SELECT c.id,
         trim(substr(
           regexp_replace(v.name, '^\s*(\(주\)|㈜|주식회사)\s*', ''),
           length(regexp_replace(g.name, '^\s*(\(주\)|㈜|주식회사)\s*', '')) + 1
         )) AS new_branch
    FROM erp_consultations c
    JOIN vendors v ON v.id = c.vendor_id
    JOIN vendor_groups g ON g.id = v.group_id
   WHERE c.branch_name IS NOT NULL
     AND regexp_replace(v.name, '^\s*(\(주\)|㈜|주식회사)\s*', '')
         LIKE regexp_replace(g.name, '^\s*(\(주\)|㈜|주식회사)\s*', '') || '%'
)
UPDATE erp_consultations c
   SET branch_name = fix.new_branch
  FROM fix
 WHERE c.id = fix.id
   AND NULLIF(fix.new_branch, '') IS NOT NULL
   AND c.branch_name IS DISTINCT FROM fix.new_branch;

-- ── 3) 지점명 보정: 직접 입력 주문 (업로드 주문 제외) ─
WITH fix AS (
  SELECT o.id,
         trim(substr(
           regexp_replace(v.name, '^\s*(\(주\)|㈜|주식회사)\s*', ''),
           length(regexp_replace(g.name, '^\s*(\(주\)|㈜|주식회사)\s*', '')) + 1
         )) AS new_branch
    FROM erp_orders o
    JOIN vendors v ON v.id = o.vendor_id
    JOIN vendor_groups g ON g.id = v.group_id
   WHERE o.source = 'direct'
     AND o.branch_name IS NOT NULL
     AND regexp_replace(v.name, '^\s*(\(주\)|㈜|주식회사)\s*', '')
         LIKE regexp_replace(g.name, '^\s*(\(주\)|㈜|주식회사)\s*', '') || '%'
)
UPDATE erp_orders o
   SET branch_name = fix.new_branch
  FROM fix
 WHERE o.id = fix.id
   AND NULLIF(fix.new_branch, '') IS NOT NULL
   AND o.branch_name IS DISTINCT FROM fix.new_branch;

-- [검증] 실행 후 드라이런 파일의 1)·3) 쿼리를 다시 실행 → "보정 대상" = 0 확인.
-- 참고: UPDATE 결과의 영향 행 수를 기록해 주세요 (검증 보고용).
