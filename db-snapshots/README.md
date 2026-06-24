# DB 스냅샷 & 롤백 아티팩트

운영 Supabase(`accounting / main`, PRODUCTION) 변경에 대한 복원 기준점과 롤백 도구.

## 파일
- `erp_orders_customer_alias__2026-06-24.json` — erp_orders 전체 (order_no, customer_alias_id) 스냅샷.
  2026-06-23 customer_alias_id 백필(454건) **이후** 상태 = 전 6,153건 정상 연결된 기준선.
  향후 erp_orders 매칭 변경을 이 기준으로 비교/복원할 때 사용.
- `accounts_keywords__2026-06-24.json` — accounts 전체(36개) keywords 스냅샷 (키워드 정리 **이전** 값 포함, code별).
- `keyword_cleanup_rollback__2026-06-24.json` — 2026-06-24 키워드 정리 대상 9개 계정의 변경 전/후 keywords + id.
- `rollback_keyword_cleanup__2026-06-24.sql` — keywords가 jsonb일 때 롤백 SQL.
- `rollback_keyword_cleanup.py` — 컬럼 타입 무관 REST 기반 롤백(권장).

## 2026-06-24 키워드 정리 내역 (오탐 제거)
1001 보통예금: 키워드 전체 제거(은행명/입출금어 → 보통예금 오탐 근절)
5111 세금과공과: 전기세·전기·수도·가스·한전·한국전력 제거(5203 전기요금과 중복/범용어)
5113 잡비: 기타·잡·잡손실 제거 / 4001 매출: 입금·수금·결제대금 제거
5104 통신비: 통신 제거 / 5108 지급수수료: 세무·회계 → 회계법인·세무회계
5110 보험료: 보험·손해보험·보장·공제 제거 → 보험료·보험납입
5107 접대비: 거래처·고객·미팅·회의·식사·선물 제거
5102 복리후생비: 카페·커피·음식·직원 제거

드라이런(최근 307건): 매칭 57→31, 변경 27건 전부 오탐 제거(정상 매칭 손실 0).

## 롤백 방법
키워드 정리만 되돌리기:
```
SB_URL=https://<ref>.supabase.co SB_KEY=<service_role> \
  python3 db-snapshots/rollback_keyword_cleanup.py
```
또는 `rollback_keyword_cleanup__2026-06-24.sql` 실행(jsonb인 경우).
