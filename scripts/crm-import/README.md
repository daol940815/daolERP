# CRM 초기 이행 스크립트

엑셀 「(주)다올커머스 고객관리」 → CRM 테이블(069·070) 이행 도구.
설계: `docs/customer-management-design.md` §5 · 검증: `reports/crm-validation-2026-07-24.md`

## 파일

- `build_seed.py` — 엑셀에서 이행 SQL 3개 생성 (`out/`, git 제외)
  - `01_contacts.sql` 고객 + 매칭 키 (통계 시트 3,011 + 원장에만 있던 키 자동 생성)
  - `02_legacy_2024.sql` 2024년 매출 집계 → `crm_legacy_sales` (DB 미보유 기간)
  - `03_season_backfill.sql` 구분(24설~26설) → `erp_orders.season_code` 백필
- `validation/sim_load_orders.py` — **검증 전용.** 엑셀 2025~26 라인을 가상 주문으로 적재 (운영 금지)
- `validation/validate.py` — 3단 검증 (엑셀 재현 / DB 전수 대조 / 규칙 영향)

## 적용 순서 (테스트 → 운영 동일)

```bash
python3 build_seed.py <엑셀경로>
# 1. 01_contacts.sql 실행 (Supabase SQL Editor 또는 psql)
# 2. 02_legacy_2024.sql 실행
# 3. erp_orders 업로드 완료 상태에서 03_season_backfill.sql 실행
# 4. SELECT crm_match_orders();   -- 멱등, 재업로드 후에도 재실행
# 5. SELECT crm_snapshot_grades(); -- 월 1회 등급 스냅샷
```

멱등성: 고객 id는 키 기반 uuid5 고정 — 재실행해도 중복 생성 없음.
`crm_match_orders()`는 매번 전체 재유도 — ERP 재업로드 후 실행하면 키 변경 건도 재평가.
