-- =====================================================
-- 담당자 연락처 소급 — 기존 상담일지의 핸드폰(phone) · 유선(tel)을 인물 마스터(contacts)의 빈 칸에 채운다
-- 사용자 승인 2026-11-09 ("현재 입력된 상담일지 번호도 소급해줘"). 116(contacts.tel) 적용 후 실행.
--
-- 규칙 (저장 시 자동 반영 lib/contact-phone-sync.ts 와 동일):
--  - 담당자가 마스터에 연결된(contact_id) 상담만. 이름만 적은 미연결 상담은 대상 아님.
--  - 마스터 칸이 **비어 있을 때만** 채운다. 이미 번호가 있으면 다르더라도 건드리지 않는다(기확정 값 보존).
--  - 같은 담당자에 상담이 여러 건이면 **가장 최근 상담**(상담일 → 작성시각)의 번호를 쓴다.
--  - 병합된 인물(merged_into_id 있음)은 제외.
-- 순서: [1] 드라이런 → 건수 확인 → [2] 실행 → [3] 검증(채움대상 0). 재실행해도 중복 반영 없음(빈 칸만).
-- =====================================================

-- ---------- [1] 드라이런 ----------
WITH src_phone AS (
  SELECT DISTINCT ON (contact_id) contact_id, btrim(phone) AS phone, consult_date
    FROM erp_consultations
   WHERE contact_id IS NOT NULL AND nullif(btrim(phone), '') IS NOT NULL
   ORDER BY contact_id, consult_date DESC, created_at DESC
), src_tel AS (
  SELECT DISTINCT ON (contact_id) contact_id, btrim(tel) AS tel, consult_date
    FROM erp_consultations
   WHERE contact_id IS NOT NULL AND nullif(btrim(tel), '') IS NOT NULL
   ORDER BY contact_id, consult_date DESC, created_at DESC
)
SELECT
  (SELECT count(*) FROM src_phone s JOIN contacts c ON c.id = s.contact_id
    WHERE c.merged_into_id IS NULL AND nullif(btrim(c.phone), '') IS NULL)                           AS "핸드폰_채움대상",
  (SELECT count(*) FROM src_phone s JOIN contacts c ON c.id = s.contact_id
    WHERE c.merged_into_id IS NULL AND nullif(btrim(c.phone), '') IS NOT NULL
      AND regexp_replace(c.phone, '\D', '', 'g') <> regexp_replace(s.phone, '\D', '', 'g'))          AS "핸드폰_마스터와다름_건드리지않음",
  (SELECT count(*) FROM src_tel s JOIN contacts c ON c.id = s.contact_id
    WHERE c.merged_into_id IS NULL AND nullif(btrim(c.tel), '') IS NULL)                             AS "유선_채움대상",
  (SELECT count(*) FROM src_tel s JOIN contacts c ON c.id = s.contact_id
    WHERE c.merged_into_id IS NULL AND nullif(btrim(c.tel), '') IS NOT NULL
      AND regexp_replace(c.tel, '\D', '', 'g') <> regexp_replace(s.tel, '\D', '', 'g'))              AS "유선_마스터와다름_건드리지않음",
  (SELECT count(*) FROM erp_consultations
    WHERE contact_id IS NULL AND (nullif(btrim(phone), '') IS NOT NULL OR nullif(btrim(tel), '') IS NOT NULL)) AS "미연결상담_번호있음_대상아님";

-- [1-b] 채워질 내용 표본 (담당자 · 번호 · 근거 상담일) — 최대 30건
WITH src_phone AS (
  SELECT DISTINCT ON (contact_id) contact_id, btrim(phone) AS phone, consult_date
    FROM erp_consultations
   WHERE contact_id IS NOT NULL AND nullif(btrim(phone), '') IS NOT NULL
   ORDER BY contact_id, consult_date DESC, created_at DESC
), src_tel AS (
  SELECT DISTINCT ON (contact_id) contact_id, btrim(tel) AS tel, consult_date
    FROM erp_consultations
   WHERE contact_id IS NOT NULL AND nullif(btrim(tel), '') IS NOT NULL
   ORDER BY contact_id, consult_date DESC, created_at DESC
)
SELECT c.name AS 담당자,
       CASE WHEN nullif(btrim(c.phone), '') IS NULL THEN p.phone END AS 채울_핸드폰,
       CASE WHEN nullif(btrim(c.tel), '')   IS NULL THEN t.tel   END AS 채울_유선,
       coalesce(p.consult_date, t.consult_date) AS 근거_상담일
  FROM contacts c
  LEFT JOIN src_phone p ON p.contact_id = c.id AND nullif(btrim(c.phone), '') IS NULL
  LEFT JOIN src_tel   t ON t.contact_id = c.id AND nullif(btrim(c.tel), '')   IS NULL
 WHERE c.merged_into_id IS NULL AND (p.contact_id IS NOT NULL OR t.contact_id IS NOT NULL)
 ORDER BY 근거_상담일 DESC
 LIMIT 30;

-- ---------- [2] 실행 (드라이런 건수 확인 후) ----------
WITH src_phone AS (
  SELECT DISTINCT ON (contact_id) contact_id, btrim(phone) AS phone
    FROM erp_consultations
   WHERE contact_id IS NOT NULL AND nullif(btrim(phone), '') IS NOT NULL
   ORDER BY contact_id, consult_date DESC, created_at DESC
)
UPDATE contacts c
   SET phone = s.phone
  FROM src_phone s
 WHERE c.id = s.contact_id AND c.merged_into_id IS NULL AND nullif(btrim(c.phone), '') IS NULL;

WITH src_tel AS (
  SELECT DISTINCT ON (contact_id) contact_id, btrim(tel) AS tel
    FROM erp_consultations
   WHERE contact_id IS NOT NULL AND nullif(btrim(tel), '') IS NOT NULL
   ORDER BY contact_id, consult_date DESC, created_at DESC
)
UPDATE contacts c
   SET tel = s.tel
  FROM src_tel s
 WHERE c.id = s.contact_id AND c.merged_into_id IS NULL AND nullif(btrim(c.tel), '') IS NULL;

-- ---------- [3] 검증 — 두 값 모두 0이어야 한다 ----------
WITH src_phone AS (
  SELECT DISTINCT ON (contact_id) contact_id, btrim(phone) AS phone
    FROM erp_consultations
   WHERE contact_id IS NOT NULL AND nullif(btrim(phone), '') IS NOT NULL
   ORDER BY contact_id, consult_date DESC, created_at DESC
), src_tel AS (
  SELECT DISTINCT ON (contact_id) contact_id, btrim(tel) AS tel
    FROM erp_consultations
   WHERE contact_id IS NOT NULL AND nullif(btrim(tel), '') IS NOT NULL
   ORDER BY contact_id, consult_date DESC, created_at DESC
)
SELECT
  (SELECT count(*) FROM src_phone s JOIN contacts c ON c.id = s.contact_id
    WHERE c.merged_into_id IS NULL AND nullif(btrim(c.phone), '') IS NULL) AS "핸드폰_남은대상_기대0",
  (SELECT count(*) FROM src_tel s JOIN contacts c ON c.id = s.contact_id
    WHERE c.merged_into_id IS NULL AND nullif(btrim(c.tel), '') IS NULL)   AS "유선_남은대상_기대0";
