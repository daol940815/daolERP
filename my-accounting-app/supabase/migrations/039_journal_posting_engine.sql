-- =====================================================
-- 039_journal_posting_engine.sql
-- 회계 엔진 토대: 분개 범용 출처(source_type/source_id) + 전표번호 채번 +
-- 은행계좌 GL 매핑 + 확정 감사필드 + Posting Engine(post_journal / unpost_journal)
-- 설계: docs/journal-design.md
-- =====================================================

-- ── 1) journal_entries 범용 출처 ─────────────────────
-- 기존 transaction_id는 호환 위해 유지. source_type/source_id로 은행 외 카드·세금계산서·수동도 지원.
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS source_id   UUID;

-- 같은 문서(source) 1건당 분개 1건 — 멱등성 보장
CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entries_source
  ON journal_entries(source_type, source_id)
  WHERE source_id IS NOT NULL;

-- ── 2) 전표번호 채번 테이블 ──────────────────────────
CREATE TABLE IF NOT EXISTS document_sequences (
  prefix   TEXT   PRIMARY KEY,   -- 예: 'JV-20260626'
  last_no  BIGINT NOT NULL DEFAULT 0
);

-- ── 3) 은행계좌 ↔ GL 계정 매핑 ───────────────────────
ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS gl_account_id UUID REFERENCES accounts(id);
-- 기본값: 보통예금(1001). 마이너스통장 등은 추후 개별 매핑(단기차입금 등).
UPDATE bank_accounts
   SET gl_account_id = (SELECT id FROM accounts WHERE code = '1001' LIMIT 1)
 WHERE gl_account_id IS NULL;

-- ── 4) 확정 감사필드 (이력추천·AI 학습 데이터) ───────
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS confirmed_by          UUID,
  ADD COLUMN IF NOT EXISTS confirmed_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS account_changed_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prev_account_id       UUID REFERENCES accounts(id);

ALTER TABLE card_expenses
  ADD COLUMN IF NOT EXISTS confirmed_by          UUID,
  ADD COLUMN IF NOT EXISTS confirmed_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS account_changed_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prev_account_id       UUID REFERENCES accounts(id);

-- ── 5) Posting Engine: post_journal ─────────────────
-- JournalDraft를 받아 균형검증 + 멱등 + 채번 + 원자적 저장. 회계 판단은 하지 않는다.
-- p_lines: [{ "account_id": uuid, "side": "debit|credit", "amount": int, "vendor_id": uuid|null, "note": text|null }, ...]
CREATE OR REPLACE FUNCTION post_journal(
  p_source_type TEXT,
  p_source_id   UUID,
  p_entry_date  DATE,
  p_description TEXT,
  p_entry_type  TEXT,
  p_lines       JSONB
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_debit    BIGINT := 0;
  v_credit   BIGINT := 0;
  v_line     JSONB;
  v_entry_id UUID;
  v_entry_no TEXT;
  v_prefix   TEXT;
  v_seq      BIGINT;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'post_journal: 분개 라인은 최소 2개여야 합니다';
  END IF;

  -- 균형 검증 (RPC가 직접 계산하는 유일한 회계-무관 불변식)
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF (v_line->>'side') = 'debit' THEN
      v_debit := v_debit + (v_line->>'amount')::BIGINT;
    ELSIF (v_line->>'side') = 'credit' THEN
      v_credit := v_credit + (v_line->>'amount')::BIGINT;
    ELSE
      RAISE EXCEPTION 'post_journal: 잘못된 side 값 %', v_line->>'side';
    END IF;
  END LOOP;

  IF v_debit <> v_credit OR v_debit = 0 THEN
    RAISE EXCEPTION 'post_journal: 차/대변 불균형 (debit=%, credit=%)', v_debit, v_credit;
  END IF;

  -- 멱등: 기존 분개 조회
  SELECT id, entry_no INTO v_entry_id, v_entry_no
  FROM journal_entries
  WHERE source_type = p_source_type AND source_id = p_source_id;

  IF v_entry_id IS NULL THEN
    -- 신규: 전표번호 채번 (동시성 안전)
    v_prefix := 'JV-' || to_char(p_entry_date, 'YYYYMMDD');
    INSERT INTO document_sequences(prefix, last_no) VALUES (v_prefix, 1)
      ON CONFLICT (prefix) DO UPDATE SET last_no = document_sequences.last_no + 1
      RETURNING last_no INTO v_seq;
    v_entry_no := v_prefix || '-' || lpad(v_seq::text, 4, '0');

    INSERT INTO journal_entries(source_type, source_id, transaction_id, entry_no, entry_date, description, entry_type)
    VALUES (
      p_source_type, p_source_id,
      CASE WHEN p_source_type = 'bank' THEN p_source_id ELSE NULL END,  -- 호환: 은행은 transaction_id도 채움(거래 삭제 시 cascade)
      v_entry_no, p_entry_date, p_description, COALESCE(NULLIF(p_entry_type, ''), 'normal')
    )
    RETURNING id INTO v_entry_id;
  ELSE
    -- 재전기: 헤더 갱신(전표번호 유지) + 라인 교체
    UPDATE journal_entries
       SET entry_date  = p_entry_date,
           description = p_description,
           entry_type  = COALESCE(NULLIF(p_entry_type, ''), 'normal'),
           updated_at  = now()
     WHERE id = v_entry_id;
    DELETE FROM journal_lines WHERE journal_entry_id = v_entry_id;
  END IF;

  INSERT INTO journal_lines(journal_entry_id, account_id, side, amount, vendor_id, note)
  SELECT v_entry_id,
         (l->>'account_id')::UUID,
         l->>'side',
         (l->>'amount')::BIGINT,
         NULLIF(l->>'vendor_id', '')::UUID,
         l->>'note'
  FROM jsonb_array_elements(p_lines) AS l;

  RETURN v_entry_id;
END;
$$;

-- ── 6) Posting Engine: unpost_journal ───────────────
-- 확정 해제/원천 삭제 시 분개 제거(라인은 FK CASCADE로 함께 삭제).
CREATE OR REPLACE FUNCTION unpost_journal(
  p_source_type TEXT,
  p_source_id   UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE v_cnt INT;
BEGIN
  DELETE FROM journal_entries
   WHERE source_type = p_source_type AND source_id = p_source_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  RETURN v_cnt > 0;
END;
$$;
