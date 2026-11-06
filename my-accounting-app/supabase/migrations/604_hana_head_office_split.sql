-- 604: 하나은행 본점 번호(202-81-14695) 데이터를 '하나은행 창원지점'에서 '주식회사 하나은행'으로 이관 (2026-11-06, 사용자 승인)
--
-- 배경 (docs/purchase-hub-track.md '하나은행 창원지점 후속 조사'):
--   - 본점 사업자번호 202-81-14695로 발행된 계산서 162건(매출 158 · 434,009,200 / 매입 4 · 공인인증서 17,600)이
--     창원지점 레코드에 붙어 있었다. 입금자는 본점 부서(영업기획부·채널전략부·정책금융부 …), '창원' 입금은 0건.
--   - '주식회사 하나은행'(5047a122)은 2026-08-25 계산서 업로드의 1000행 절단 버그로 생긴 중복 레코드다(매입처로 등록한 적 없음).
--     08-25~10-12 업로드분 계산서 23건(매출 21 · 매입 2 = 2026-07-13 인증서)이 붙었다가 10-22 회계 트랙 413(같은 사업자번호
--     자동 병합)으로 이 레코드에 흡수돼 status='merged'였다(당시 이 레코드 이름도 '주식회사 하나은행'). 병합을 풀어 본점 레코드로 쓴다.
--   - 이관 뒤 역할: 매출처 허브 = 하나은행 본점 매출처 / 매입처 관리 = '경비성' 탭에만(인증서 수수료). 같은 레코드, 화면별 역할.
--   - 창원지점 레코드는 실제 지점(하나은행 그룹, 담당자 · 담당직원 연결)이라 이름을 바꾸지 않고 그대로 둔다.
--
-- 옮기는 것: 본점 번호 계산서 · 그 계산서에 연결된 통장(창원 태깅분) · 인증서 수수료 출금 · 그 원천의 분개 라인 ·
--           거래처원장 항목 · 매입 별칭 '하나은행' · 매입 기초잔액 행 · 본점 부서 자동 태깅 키워드(match_aliases)
-- 그대로 두는 것: 창원지점 담당자 · 담당직원 · 고객 별칭(창원·서면·동래·서산) · 카드번호 · 카드매출 24건 ·
--           계산서와 연결 안 된 다른 지점 입금 247건(별도 정리 과제) · 고객관리문서 스냅샷
-- 원본(금액·날짜·상대방)은 건드리지 않는다. vendor_id(연결 정보)만 바꾼다.
--
-- 실행: 아래 전체를 한 번에 실행 (BEGIN~COMMIT). 대상 건수가 드라이런과 다르면 오류로 멈추고 아무것도 바뀌지 않는다.
--   그 경우 오류 메시지의 건수를 알려주면 다시 확인한다.
-- 드라이런(2026-11-06): 계산서 162 / 통장 86 / 분개 라인 213 / 거래처원장 3 / 별칭 1 / 기초잔액 1 / 키워드 23

BEGIN;

-- ① 대상 집합
CREATE TEMP TABLE m604_inv ON COMMIT DROP AS
SELECT id FROM tax_invoices
WHERE vendor_id = '9fcbe202-42f4-4f2b-b328-7da86cb0d4b7'
  AND counterparty_biz_number = '202-81-14695';

CREATE TEMP TABLE m604_tx ON COMMIT DROP AS
SELECT tx.id FROM transactions tx
WHERE tx.vendor_id = '9fcbe202-42f4-4f2b-b328-7da86cb0d4b7'
  AND (
    EXISTS (SELECT 1 FROM tax_invoice_payments p
            WHERE p.transaction_id = tx.id AND p.tax_invoice_id IN (SELECT id FROM m604_inv))
    OR (COALESCE(tx.amount_out, 0) > 0
        AND (tx.description LIKE '%발급수수료%' OR tx.counterparty_name LIKE '%인증서%'))
  );

CREATE TEMP TABLE m604_jl ON COMMIT DROP AS
SELECT jl.id FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id
WHERE jl.vendor_id = '9fcbe202-42f4-4f2b-b328-7da86cb0d4b7'
  AND (je.source_id IN (SELECT id FROM m604_inv) OR je.source_id IN (SELECT id FROM m604_tx));

-- 본점 부서 · 인증서 수수료 키워드 (지점 이름이 든 영업부·문정동·시화·아산은 판단 보류로 창원지점에 남긴다)
CREATE TEMP TABLE m604_kw ON COMMIT DROP AS
SELECT unnest(ARRAY[
  'PB사업부','경영지원실','경인영업본부','공동인증서발급수수료','발급수수료납부','영업기획부','인재개발부',
  '정책금융부','종로영업본부','중앙영업본부','중앙영업추진지원부','채널전략부','투자상품부','하나경영지원',
  '하나더넥스트전략부','하나영남영추부','하나은행 경인영업본','하나은행 영업기획부','하나은행PB사업부',
  '하나은행신탁부','하나은행영남','홍보부','주식회사 하나은행'
]) AS kw;

-- ② 드라이런 대조 — 다르면 멈춘다
DO $$
DECLARE n_inv INT; n_tx INT; n_jl INT; n_vle INT;
BEGIN
  SELECT COUNT(*) INTO n_inv FROM m604_inv;
  SELECT COUNT(*) INTO n_tx  FROM m604_tx;
  SELECT COUNT(*) INTO n_jl  FROM m604_jl;
  SELECT COUNT(*) INTO n_vle FROM vendor_ledger_entries
   WHERE vendor_id = '9fcbe202-42f4-4f2b-b328-7da86cb0d4b7' AND transaction_id IN (SELECT id FROM m604_tx);
  RAISE NOTICE '604 대상: 계산서 % / 통장 % / 분개 라인 % / 거래처원장 %', n_inv, n_tx, n_jl, n_vle;
  IF n_inv <> 162 OR n_tx <> 86 OR n_jl <> 213 OR n_vle <> 3 THEN
    RAISE EXCEPTION '604 중단: 대상 건수가 드라이런과 다릅니다 (계산서 % / 통장 % / 분개 라인 % / 거래처원장 %, 기대 162/86/213/3)',
      n_inv, n_tx, n_jl, n_vle;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vendors WHERE id = '5047a122-0eb8-4eeb-93b7-a7a9395c1155') THEN
    RAISE EXCEPTION '604 중단: 주식회사 하나은행(5047a122) 레코드가 없습니다';
  END IF;
END $$;

-- ③ 본점 레코드 되살리기 (413 병합 해제)
UPDATE vendors SET
  status         = 'active',
  merged_into_id = NULL,
  is_active      = true,
  type           = 'both',
  purchase_kind  = 'expense',
  group_id       = (SELECT group_id FROM vendors WHERE id = '9fcbe202-42f4-4f2b-b328-7da86cb0d4b7'),
  match_aliases  = ARRAY(SELECT kw FROM m604_kw),
  note           = '본점(사업자 202-81-14695). 604(2026-11-06): 413 병합 해제 + 창원지점에 붙어 있던 본점 번호 계산서·통장 이관'
WHERE id = '5047a122-0eb8-4eeb-93b7-a7a9395c1155';

-- ④ 연결 정보 이관
UPDATE tax_invoices  SET vendor_id = '5047a122-0eb8-4eeb-93b7-a7a9395c1155' WHERE id IN (SELECT id FROM m604_inv);
UPDATE transactions  SET vendor_id = '5047a122-0eb8-4eeb-93b7-a7a9395c1155' WHERE id IN (SELECT id FROM m604_tx);
UPDATE journal_lines SET vendor_id = '5047a122-0eb8-4eeb-93b7-a7a9395c1155' WHERE id IN (SELECT id FROM m604_jl);
UPDATE vendor_ledger_entries SET vendor_id = '5047a122-0eb8-4eeb-93b7-a7a9395c1155'
 WHERE vendor_id = '9fcbe202-42f4-4f2b-b328-7da86cb0d4b7' AND transaction_id IN (SELECT id FROM m604_tx);
UPDATE erp_vendor_aliases SET vendor_id = '5047a122-0eb8-4eeb-93b7-a7a9395c1155'
 WHERE id = '283629f4-82c0-4a65-848e-527cde53beec' AND vendor_id = '9fcbe202-42f4-4f2b-b328-7da86cb0d4b7';

INSERT INTO purchase_opening_balances (vendor_id, as_of_date, amount, note)
SELECT '5047a122-0eb8-4eeb-93b7-a7a9395c1155', as_of_date, amount,
       COALESCE(note, '') || ' / 604: 하나은행 창원지점에서 이관'
FROM purchase_opening_balances WHERE vendor_id = '9fcbe202-42f4-4f2b-b328-7da86cb0d4b7'
ON CONFLICT (vendor_id) DO NOTHING;
DELETE FROM purchase_opening_balances WHERE vendor_id = '9fcbe202-42f4-4f2b-b328-7da86cb0d4b7';

-- ⑤ 창원지점 정리 — 본점 번호를 비워 이후 본점 계산서가 본점 레코드에 붙게 한다
UPDATE vendors SET
  biz_number    = NULL,
  type          = 'customer',
  purchase_kind = 'partner',
  match_aliases = ARRAY(SELECT a FROM unnest(match_aliases) a WHERE a NOT IN (SELECT kw FROM m604_kw))
WHERE id = '9fcbe202-42f4-4f2b-b328-7da86cb0d4b7';

COMMIT;

-- ⑥ 검증 (COMMIT 뒤 따로 실행) — 기대: 본점 계산서 162 · 통장 86 / 창원지점 계산서 0 · 사업자번호 NULL /
--    202-81-14695 활성 거래처 1곳
SELECT v.name, v.status, v.type, v.purchase_kind, v.biz_number,
       (SELECT COUNT(*) FROM tax_invoices t WHERE t.vendor_id = v.id)                         AS 계산서,
       (SELECT COUNT(*) FROM tax_invoices t WHERE t.vendor_id = v.id AND t.direction = 'sales') AS 매출계산서,
       (SELECT COUNT(*) FROM transactions x WHERE x.vendor_id = v.id)                          AS 통장,
       (SELECT COUNT(*) FROM purchase_opening_balances o WHERE o.vendor_id = v.id)            AS 매입기초,
       COALESCE(array_length(v.match_aliases, 1), 0)                                          AS 키워드
FROM vendors v
WHERE v.id IN ('5047a122-0eb8-4eeb-93b7-a7a9395c1155', '9fcbe202-42f4-4f2b-b328-7da86cb0d4b7')
UNION ALL
SELECT '202-81-14695 활성 거래처 수', NULL, NULL, NULL, NULL,
       (SELECT COUNT(*) FROM vendors WHERE biz_number = '202-81-14695' AND status = 'active'), NULL, NULL, NULL, NULL;
