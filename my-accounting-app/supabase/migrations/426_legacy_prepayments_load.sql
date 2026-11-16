-- =====================================================
-- 426_legacy_prepayments_load.sql  (회계 트랙 — 1회성 데이터 적재, 마이그레이션 아님)
-- 기존 ERP 선결제 내역 → 신규 선결제 원장(erp_prepayments) 반영 (2026-11-16 사용자 승인 A안)
--
-- 원본: docs/data/legacy_prepayments_2026-11-16.xlsx (상세 141행 · 36지점). 사용자 결정:
--   · A안 = 지점별 2026-09-30 기준 잔액 1줄(이월) + 2026-10-01 이후 행 개별 (ERP 10-01 재시작 결정과 동일 기준)
--   · 33행 서린지점 · 111행 투자상품전략부: 한 줄의 결제+사용을 두 줄로 분리
--   · 28행 목동지점 결제 332,500: 일자 2026-12-29(미래) → 2025-12-29 로 정정 (→ 이월에 포함)
--   · 하나은행 연산동지점(잔액 −47,800): 내역 확인 중 — 이번 적재에서 제외 · 대기
-- 대상 테이블: erp_prepayments (direction 'customer', alias_id = 매출처 별칭 "은행명 지점명", order_id 없음, source_key 멱등)
-- 재실행 안전: source_key UNIQUE — ON CONFLICT DO NOTHING.
-- 검산(파일): 이월 28지점 합 5,413,900 · 10-01 이후 28행 (입금 16,259,750 · 사용 4,481,200)
--   → 적재 후 전체 잔액 = 17,192,450 (연산동 제외, 파일 잔액 17,144,650 + 47,800)
-- 이월 0원이라 이월 행을 만들지 않는 지점: 하나은행 관저동지점, 하나은행 남악지점, 하나은행 세종중앙금융센터, 하나은행 압구정금융센터, 하나은행 약수역지점, 하나은행 양재동지점, 하나은행 여의도금융센터, 하나은행 이매동지점, 하나은행 충주금융센터, 하나은행 태평동지점, 하나은행 현대모터금융센터, 하나은행 혜화동지점, 하나은행 화정역지점
-- 이월 음수 지점 없음
-- =====================================================

-- ── STEP 1. 드라이런 ──────────────────────────────────
-- ① 별칭 존재 · 거래처 연결 (36 − 연산동 = 35지점). alias_id 가 NULL 이면 별칭이 없어 적재 불가 → 별칭 생성 또는 이름 확인
WITH src(alias_name) AS (VALUES
  ('기업은행 중기산연구소'),
  ('기업은행 파주교하지점'),
  ('삼성화재 안양성남컨설팅영업단'),
  ('우리은행 공덕동효성금융센터'),
  ('우리은행 미래기업영업본부'),
  ('우리은행 브랜드전략부'),
  ('우리은행 아크로비스타금융센터'),
  ('하나은행 관저동지점'),
  ('하나은행 남악지점'),
  ('하나은행 동광주지점'),
  ('하나은행 목동골드클럽'),
  ('하나은행 목동지점'),
  ('하나은행 범어역VIPCLUB출장소'),
  ('하나은행 부산 International PB센터'),
  ('하나은행 사직동지점'),
  ('하나은행 서린지점'),
  ('하나은행 성남기업센터지점'),
  ('하나은행 세종중앙금융센터'),
  ('하나은행 센텀파크지점'),
  ('하나은행 압구정금융센터'),
  ('하나은행 약수역지점'),
  ('하나은행 양재동지점'),
  ('하나은행 여의도금융센터'),
  ('하나은행 영도지점'),
  ('하나은행 영업부'),
  ('하나은행 올림픽선수촌PB센터'),
  ('하나은행 이매동지점'),
  ('하나은행 충주금융센터'),
  ('하나은행 태평동지점'),
  ('하나은행 투자상품부'),
  ('하나은행 투자상품전략부'),
  ('하나은행 하나더넥스트사업부'),
  ('하나은행 현대모터금융센터'),
  ('하나은행 혜화동지점'),
  ('하나은행 화정역지점')
)
SELECT s.alias_name, a.id AS alias_id, a.vendor_id, v.name AS 거래처명,
       CASE WHEN a.id IS NULL THEN '별칭 없음' WHEN a.vendor_id IS NULL THEN '거래처 미연결' ELSE 'OK' END AS 판정
FROM src s
LEFT JOIN erp_vendor_aliases a ON a.alias_type = 'customer' AND a.erp_name = s.alias_name AND a.merged_into_alias_id IS NULL
LEFT JOIN vendors v ON v.id = a.vendor_id
ORDER BY 판정 DESC, s.alias_name;

-- ② 이 지점들에 신규 시스템이 이미 가진 선결제 원장(10-01 이후) — 겹치면 그 파일 행은 빼야 한다
WITH src(alias_name) AS (VALUES
  ('기업은행 중기산연구소'),
  ('기업은행 파주교하지점'),
  ('삼성화재 안양성남컨설팅영업단'),
  ('우리은행 공덕동효성금융센터'),
  ('우리은행 미래기업영업본부'),
  ('우리은행 브랜드전략부'),
  ('우리은행 아크로비스타금융센터'),
  ('하나은행 관저동지점'),
  ('하나은행 남악지점'),
  ('하나은행 동광주지점'),
  ('하나은행 목동골드클럽'),
  ('하나은행 목동지점'),
  ('하나은행 범어역VIPCLUB출장소'),
  ('하나은행 부산 International PB센터'),
  ('하나은행 사직동지점'),
  ('하나은행 서린지점'),
  ('하나은행 성남기업센터지점'),
  ('하나은행 세종중앙금융센터'),
  ('하나은행 센텀파크지점'),
  ('하나은행 압구정금융센터'),
  ('하나은행 약수역지점'),
  ('하나은행 양재동지점'),
  ('하나은행 여의도금융센터'),
  ('하나은행 영도지점'),
  ('하나은행 영업부'),
  ('하나은행 올림픽선수촌PB센터'),
  ('하나은행 이매동지점'),
  ('하나은행 충주금융센터'),
  ('하나은행 태평동지점'),
  ('하나은행 투자상품부'),
  ('하나은행 투자상품전략부'),
  ('하나은행 하나더넥스트사업부'),
  ('하나은행 현대모터금융센터'),
  ('하나은행 혜화동지점'),
  ('하나은행 화정역지점')
)
SELECT a.erp_name, p.entry_date, p.entry_type, p.amount, p.source_key, p.memo
FROM erp_prepayments p
JOIN erp_vendor_aliases a ON a.id = p.alias_id
JOIN src s ON s.alias_name = a.erp_name
WHERE p.direction = 'customer' AND p.entry_date >= DATE '2026-10-01'
ORDER BY a.erp_name, p.entry_date;

-- ③ 이미 적재된 legacy 행(재실행 시)
SELECT COUNT(*) AS 기존_legacy_행, COALESCE(SUM(CASE WHEN entry_type = 'deposit' THEN amount ELSE -amount END), 0) AS 잔액기여
FROM erp_prepayments WHERE source_key LIKE 'legacy:%';

-- ── STEP 2. 적재 (①에서 전부 OK 이고 ②의 겹침을 정리한 뒤 실행) ──
-- 2-1 이월 (2026-09-30 기준 잔액, 지점당 1줄 — 0원 지점 제외)
INSERT INTO erp_prepayments (direction, alias_id, entry_date, entry_type, amount, memo, source_key)
SELECT 'customer', a.id, DATE '2026-09-30', CASE WHEN v.amount >= 0 THEN 'deposit' ELSE 'deduction' END, ABS(v.amount), v.memo, v.source_key
FROM (VALUES
  ('기업은행 중기산연구소', 648000, '2026-09-30 기준 기존 ERP 선결제 잔액 이월 (상세 1행 합산)', 'legacy:open:기업은행 중기산연구소'),
  ('우리은행 공덕동효성금융센터', 1500, '2026-09-30 기준 기존 ERP 선결제 잔액 이월 (상세 1행 합산)', 'legacy:open:우리은행 공덕동효성금융센터'),
  ('우리은행 미래기업영업본부', 14000, '2026-09-30 기준 기존 ERP 선결제 잔액 이월 (상세 1행 합산)', 'legacy:open:우리은행 미래기업영업본부'),
  ('우리은행 브랜드전략부', 1424300, '2026-09-30 기준 기존 ERP 선결제 잔액 이월 (상세 3행 합산)', 'legacy:open:우리은행 브랜드전략부'),
  ('우리은행 아크로비스타금융센터', 4000, '2026-09-30 기준 기존 ERP 선결제 잔액 이월 (상세 1행 합산)', 'legacy:open:우리은행 아크로비스타금융센터'),
  ('하나은행 동광주지점', 520000, '2026-09-30 기준 기존 ERP 선결제 잔액 이월 (상세 1행 합산)', 'legacy:open:하나은행 동광주지점'),
  ('하나은행 목동골드클럽', 7000, '2026-09-30 기준 기존 ERP 선결제 잔액 이월 (상세 3행 합산)', 'legacy:open:하나은행 목동골드클럽'),
  ('하나은행 목동지점', 332500, '2026-09-30 기준 기존 ERP 선결제 잔액 이월 (상세 1행 합산)', 'legacy:open:하나은행 목동지점'),
  ('하나은행 범어역VIPCLUB출장소', 52000, '2026-09-30 기준 기존 ERP 선결제 잔액 이월 (상세 2행 합산)', 'legacy:open:하나은행 범어역VIPCLUB출장소'),
  ('하나은행 부산 International PB센터', 272500, '2026-09-30 기준 기존 ERP 선결제 잔액 이월 (상세 1행 합산)', 'legacy:open:하나은행 부산 International PB센터'),
  ('하나은행 사직동지점', 500000, '2026-09-30 기준 기존 ERP 선결제 잔액 이월 (상세 1행 합산)', 'legacy:open:하나은행 사직동지점'),
  ('하나은행 센텀파크지점', 200000, '2026-09-30 기준 기존 ERP 선결제 잔액 이월 (상세 1행 합산)', 'legacy:open:하나은행 센텀파크지점'),
  ('하나은행 영도지점', 34800, '2026-09-30 기준 기존 ERP 선결제 잔액 이월 (상세 7행 합산)', 'legacy:open:하나은행 영도지점'),
  ('하나은행 올림픽선수촌PB센터', 235000, '2026-09-30 기준 기존 ERP 선결제 잔액 이월 (상세 9행 합산)', 'legacy:open:하나은행 올림픽선수촌PB센터'),
  ('하나은행 하나더넥스트사업부', 1168300, '2026-09-30 기준 기존 ERP 선결제 잔액 이월 (상세 9행 합산)', 'legacy:open:하나은행 하나더넥스트사업부')
) AS v(alias_name, amount, memo, source_key)
JOIN erp_vendor_aliases a ON a.alias_type = 'customer' AND a.erp_name = v.alias_name AND a.merged_into_alias_id IS NULL
ON CONFLICT (source_key) DO NOTHING;

-- 2-2 2026-10-01 이후 개별 행 (28행)
INSERT INTO erp_prepayments (direction, alias_id, entry_date, entry_type, amount, memo, source_key)
SELECT 'customer', a.id, v.entry_date, v.entry_type, v.amount, v.memo, v.source_key
FROM (VALUES
  ('우리은행 브랜드전략부', DATE '2026-10-01', 'deposit', 1656000, '(출처: 선결제 반영표.xlsx)', 'legacy:15'),
  ('하나은행 하나더넥스트사업부', DATE '2026-10-02', 'deduction', 97500, '(출처: 선결제 반영표.xlsx)', 'legacy:123'),
  ('기업은행 중기산연구소', DATE '2026-10-12', 'deduction', 540000, '성화수 윤조 마스크 10개 × 54,000 (출처: 사용자 제공 이미지(2026-11-16))', 'legacy:2'),
  ('하나은행 여의도금융센터', DATE '2026-10-12', 'deposit', 1000000, '(출처: ★선결제.xlsx)', 'legacy:71'),
  ('하나은행 성남기업센터지점', DATE '2026-10-15', 'deposit', 850000, '(출처: ★선결제.xlsx)', 'legacy:39'),
  ('기업은행 중기산연구소', DATE '2026-10-16', 'deposit', 420000, '카드 선결제 (출처: 사용자 제공 이미지(2026-11-16))', 'legacy:3'),
  ('우리은행 브랜드전략부', DATE '2026-10-26', 'deduction', 570000, '(출처: 선결제 반영표.xlsx)', 'legacy:16'),
  ('하나은행 여의도금융센터', DATE '2026-10-26', 'deposit', 1000000, '(출처: ★선결제.xlsx)', 'legacy:72'),
  ('하나은행 영업부', DATE '2026-10-28', 'deposit', 1200000, '(출처: 선결제 반영표.xlsx)', 'legacy:89'),
  ('삼성화재 안양성남컨설팅영업단', DATE '2026-10-29', 'deposit', 1577650, '2026-10-29 기준 이월잔액 (출처: 사용자 요청(2026-11-16)) [이월]', 'legacy:5'),
  ('삼성화재 안양성남컨설팅영업단', DATE '2026-10-29', 'deduction', 240000, '과일선물세트 3개 × 80,000 (출처: 사용자 제공 이미지(2026-11-16))', 'legacy:6'),
  ('삼성화재 안양성남컨설팅영업단', DATE '2026-10-29', 'deduction', 49500, '퀵비용 (출처: 사용자 제공 이미지(2026-11-16))', 'legacy:7'),
  ('기업은행 파주교하지점', DATE '2026-10-30', 'deposit', 500000, '(출처: 선결제 반영표.xlsx)', 'legacy:4'),
  ('하나은행 투자상품전략부', DATE '2026-11-02', 'deposit', 297800, '뱅갈고무나무 (하나자산운용 김태우 사장님) (출처: 사용자 제공 이미지(2026-11-16)) [원본 111행 분리: 결제]', 'legacy:111a'),
  ('하나은행 투자상품전략부', DATE '2026-11-02', 'deduction', 150000, '뱅갈고무나무 (하나자산운용 김태우 사장님) (출처: 사용자 제공 이미지(2026-11-16)) [원본 111행 분리: 사용]', 'legacy:111b'),
  ('하나은행 여의도금융센터', DATE '2026-11-03', 'deposit', 1500000, '(출처: ★선결제.xlsx)', 'legacy:73'),
  ('하나은행 서린지점', DATE '2026-11-04', 'deposit', 3234300, '선결제 및 기존주문금액 차감 (출처: 사용자 제공 이미지(2026-11-16)) [원본 33행 분리: 결제]', 'legacy:33a'),
  ('하나은행 서린지점', DATE '2026-11-04', 'deduction', 684500, '선결제 및 기존주문금액 차감 (출처: 사용자 제공 이미지(2026-11-16)) [원본 33행 분리: 사용]', 'legacy:33b'),
  ('하나은행 서린지점', DATE '2026-11-04', 'deduction', 380000, '바자회 (출처: 사용자 제공 이미지(2026-11-16))', 'legacy:34'),
  ('하나은행 서린지점', DATE '2026-11-04', 'deduction', 100000, '축하화환 (김재세 상무님 딸) (출처: 사용자 제공 이미지(2026-11-16))', 'legacy:35'),
  ('하나은행 서린지점', DATE '2026-11-04', 'deduction', 300000, '보조밧데리 50개 × 6,000 (출처: 사용자 제공 이미지(2026-11-16))', 'legacy:36'),
  ('삼성화재 안양성남컨설팅영업단', DATE '2026-11-09', 'deduction', 240000, '과일선물세트 3개 × 80,000 (출처: 사용자 제공 이미지(2026-11-16))', 'legacy:8'),
  ('삼성화재 안양성남컨설팅영업단', DATE '2026-11-09', 'deduction', 50000, '퀵비용 (출처: 사용자 제공 이미지(2026-11-16))', 'legacy:9'),
  ('하나은행 서린지점', DATE '2026-11-09', 'deduction', 200000, '핫팩 500개 × 400 (출처: 사용자 제공 이미지(2026-11-16))', 'legacy:37'),
  ('하나은행 투자상품전략부', DATE '2026-11-10', 'deposit', 3000000, '선결제 (출처: 사용자 제공 이미지(2026-11-16))', 'legacy:112'),
  ('하나은행 서린지점', DATE '2026-11-11', 'deduction', 749700, '키엣수분크림 17개 × 44,100 (출처: 사용자 제공 이미지(2026-11-16))', 'legacy:38'),
  ('하나은행 투자상품전략부', DATE '2026-11-11', 'deduction', 130000, '뱅갈고무나무 (하나더넥스트 주엽역라운지, 11/6 미투입건 11일 반영) (출처: 사용자 제공 이미지(2026-11-16))', 'legacy:113'),
  ('하나은행 투자상품부', DATE '2026-11-16', 'deposit', 24000, '선결제 잔액 이월 (2026-11-16 기준) (출처: 사용자 요청(2026-11-16)) [이월]', 'legacy:110')
) AS v(alias_name, entry_date, entry_type, amount, memo, source_key)
JOIN erp_vendor_aliases a ON a.alias_type = 'customer' AND a.erp_name = v.alias_name AND a.merged_into_alias_id IS NULL
ON CONFLICT (source_key) DO NOTHING;

-- ── STEP 3. 검증 ──────────────────────────────────────
-- 적재 행수 · 잔액 (기대: 행 43, 잔액 17,192,450)
SELECT COUNT(*) AS legacy_행수,
       COALESCE(SUM(CASE WHEN entry_type = 'deposit' THEN amount ELSE 0 END), 0) AS 입금합,
       COALESCE(SUM(CASE WHEN entry_type = 'deduction' THEN amount ELSE 0 END), 0) AS 사용합,
       COALESCE(SUM(CASE WHEN entry_type = 'deposit' THEN amount ELSE -amount END), 0) AS 잔액
FROM erp_prepayments WHERE source_key LIKE 'legacy:%';

-- 지점별 잔액 (파일 요약표와 대조 — 연산동 제외)
SELECT a.erp_name, COALESCE(SUM(CASE WHEN p.entry_type = 'deposit' THEN p.amount ELSE -p.amount END), 0) AS 잔액
FROM erp_prepayments p JOIN erp_vendor_aliases a ON a.id = p.alias_id
WHERE p.source_key LIKE 'legacy:%'
GROUP BY a.erp_name ORDER BY 잔액 DESC;

-- 별칭을 못 찾아 빠진 행 (기대 0)
SELECT v.alias_name, COUNT(*) AS 빠진_행
FROM (VALUES
  ('우리은행 브랜드전략부'),
  ('하나은행 하나더넥스트사업부'),
  ('기업은행 중기산연구소'),
  ('하나은행 여의도금융센터'),
  ('하나은행 성남기업센터지점'),
  ('기업은행 중기산연구소'),
  ('우리은행 브랜드전략부'),
  ('하나은행 여의도금융센터'),
  ('하나은행 영업부'),
  ('삼성화재 안양성남컨설팅영업단'),
  ('삼성화재 안양성남컨설팅영업단'),
  ('삼성화재 안양성남컨설팅영업단'),
  ('기업은행 파주교하지점'),
  ('하나은행 투자상품전략부'),
  ('하나은행 투자상품전략부'),
  ('하나은행 여의도금융센터'),
  ('하나은행 서린지점'),
  ('하나은행 서린지점'),
  ('하나은행 서린지점'),
  ('하나은행 서린지점'),
  ('하나은행 서린지점'),
  ('삼성화재 안양성남컨설팅영업단'),
  ('삼성화재 안양성남컨설팅영업단'),
  ('하나은행 서린지점'),
  ('하나은행 투자상품전략부'),
  ('하나은행 서린지점'),
  ('하나은행 투자상품전략부'),
  ('하나은행 투자상품부'),
  ('기업은행 중기산연구소'),
  ('우리은행 공덕동효성금융센터'),
  ('우리은행 미래기업영업본부'),
  ('우리은행 브랜드전략부'),
  ('우리은행 아크로비스타금융센터'),
  ('하나은행 동광주지점'),
  ('하나은행 목동골드클럽'),
  ('하나은행 목동지점'),
  ('하나은행 범어역VIPCLUB출장소'),
  ('하나은행 부산 International PB센터'),
  ('하나은행 사직동지점'),
  ('하나은행 센텀파크지점'),
  ('하나은행 영도지점'),
  ('하나은행 올림픽선수촌PB센터'),
  ('하나은행 하나더넥스트사업부')
) AS v(alias_name)
LEFT JOIN erp_vendor_aliases a ON a.alias_type = 'customer' AND a.erp_name = v.alias_name AND a.merged_into_alias_id IS NULL
WHERE a.id IS NULL GROUP BY v.alias_name;
