-- =====================================================
-- 050_fix_transactions_dedup_index.sql
-- 049의 통장 중복 방지 인덱스를 ON CONFLICT 가능하도록 수정.
--
-- 문제: 049는 부분 UNIQUE 인덱스(WHERE dedup_key IS NOT NULL)를 만들었다.
--   PostgreSQL은 `ON CONFLICT (dedup_key)` 로 부분 인덱스를 추론(infer)하지
--   못한다 → 업로드 시 supabase-js 의 upsert(onConflict:'dedup_key') 가
--   42P10 "there is no unique or exclusion constraint matching the
--   ON CONFLICT specification" 로 전부 실패 → "신규 0건" 으로 표시됐다.
--
-- 해결: dedup_key 는 트리거(set_transaction_dedup_key)가 INSERT/UPDATE 마다
--   항상 채우므로 NULL 일 수 없다. 따라서 부분 조건이 불필요하다.
--   부분 인덱스를 일반(non-partial) UNIQUE 인덱스로 교체하면
--   ON CONFLICT (dedup_key) 가 정상 매칭된다.
-- =====================================================

-- 만약을 위해 NULL 잔여가 있으면 트리거가 다시 채우도록 강제 (no-op이 정상)
UPDATE transactions SET dedup_key = dedup_key WHERE dedup_key IS NULL;

DROP INDEX IF EXISTS uq_transactions_dedup;

CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_dedup
  ON transactions(dedup_key);
