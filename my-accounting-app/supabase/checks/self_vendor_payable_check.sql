-- =====================================================
-- self_vendor_payable_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 매입처 목록의 '주식회사 다올커머스'(자사) 미지급 잔액 476,501,197 원인 추적 (2026-10-23)
--
-- 매입처 허브 미지급 잔액 = 기초잔액(purchase_opening_balances)
--                          + 기준일 이후 매입 계산서(vendor_id 기준) − 기준일 이후 지급
-- 따라서 자사 거래처에 잔액이 잡히려면 ① 기초잔액 행이 있거나 ② 매입 계산서가 자사 거래처에
-- 붙어 있어야 한다(지급은 잔액을 줄이기만 한다). 둘 중 어느 쪽인지, 그 원본이 무엇인지 본다.
-- 배경: 자사 거래처 2건은 2026-06-29·07-20 계산서 업로드 방향 뒤집힘의 부산물(411에서 뒤집힌 계산서 38건 삭제).
-- =====================================================

WITH self_v AS (
  SELECT id, name, biz_number, type, status, purchase_kind, created_at, note
  FROM vendors
  WHERE biz_number = '701-88-00023' OR name ~ '다올커머스'
)
SELECT jsonb_pretty(jsonb_build_object(

  -- [1] 자사 거래처 행
  '자사거래처', (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.created_at), '[]'::jsonb) FROM self_v s),

  -- [2] 매입처 허브 함수가 내는 값 (화면 숫자의 출처) — 분해
  '허브_집계', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      '거래처', v.name, 'vendor_id', h.vendor_id,
      '계산서건수', h.invoice_count, '계산서총액', h.invoice_total, 'ERP발주', h.erp_amount,
      '지급', h.paid_amount, '미지급잔액', h.outstanding, '90일초과', h.over90,
      '기초이월잔여', h.opening_remain, '마지막매입일', h.last_purchase_date)), '[]'::jsonb)
    FROM hub_purchase_summary(NULL, NULL) h JOIN self_v v ON v.id = h.vendor_id
  ),

  -- [3] 기초잔액 행
  '기초잔액', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('거래처', v.name, '기준일', b.as_of_date, '금액', b.amount,
                                                 '메모', b.note, '입력', b.created_at)), '[]'::jsonb)
    FROM purchase_opening_balances b JOIN self_v v ON v.id = b.vendor_id
  ),

  -- [4] 자사 거래처에 붙은 계산서 — 방향·유형·업로드 묶음별
  '계산서_요약', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t->>'업로드시각'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        '거래처', v.name, '방향', i.direction, '유형', i.tax_type,
        '업로드시각', to_char(i.created_at, 'YYYY-MM-DD HH24:MI'),
        '건수', COUNT(*), '합계', SUM(i.total_amount),
        '작성일범위', MIN(i.issue_date) || ' ~ ' || MAX(i.issue_date),
        '상대사업자번호_종류', COUNT(DISTINCT i.counterparty_biz_number),
        '상대가_자사', COUNT(*) FILTER (WHERE i.counterparty_biz_number = '701-88-00023'),
        '확인됨', COUNT(*) FILTER (WHERE i.payment_status = 'matched')
      ) AS t
      FROM tax_invoices i JOIN self_v v ON v.id = i.vendor_id
      GROUP BY v.name, i.direction, i.tax_type, to_char(i.created_at, 'YYYY-MM-DD HH24:MI')
    ) s
  ),

  -- [4b] 표본 12건 — 상대방이 누구로 적혀 있는지
  '계산서_표본', (
    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object('방향', i.direction, '작성일', i.issue_date, '승인번호', i.approval_number,
                                '상대명', i.counterparty_name, '상대사업자번호', i.counterparty_biz_number,
                                '총액', i.total_amount, '지급상태', i.payment_status,
                                '업로드', to_char(i.created_at, 'MM-DD HH24:MI')) AS t
      FROM tax_invoices i JOIN self_v v ON v.id = i.vendor_id
      ORDER BY i.total_amount DESC LIMIT 12
    ) s
  ),

  -- [5] 계산서 연결 지급
  '계산서연결지급', (
    SELECT jsonb_build_object('건수', COUNT(*), '합계', COALESCE(SUM(p.amount), 0))
    FROM tax_invoice_payments p JOIN tax_invoices i ON i.id = p.tax_invoice_id
    JOIN self_v v ON v.id = i.vendor_id
  ),

  -- [6] 자사 거래처가 붙은 통장 거래 (자사 계좌 간 이체가 거래처로 붙었는지)
  '통장거래', (
    SELECT jsonb_build_object(
      '건수', COUNT(*), '입금합', COALESCE(SUM(t.amount_in), 0), '출금합', COALESCE(SUM(t.amount_out), 0),
      '이체쌍', COUNT(*) FILTER (WHERE t.transfer_pair_id IS NOT NULL),
      '상태별', (SELECT jsonb_object_agg(s, n) FROM (SELECT t2.status s, COUNT(*) n FROM transactions t2 JOIN self_v v2 ON v2.id = t2.vendor_id GROUP BY t2.status) x),
      '확정계정별', (SELECT COALESCE(jsonb_object_agg(COALESCE(a.name, '(없음)'), n), '{}'::jsonb)
                     FROM (SELECT t3.confirmed_account_id aid, COUNT(*) n FROM transactions t3 JOIN self_v v3 ON v3.id = t3.vendor_id GROUP BY 1) y
                     LEFT JOIN accounts a ON a.id = y.aid),
      '표본', (SELECT COALESCE(jsonb_agg(jsonb_build_object('일자', t4.tx_date, '적요', t4.description, '입금', t4.amount_in, '출금', t4.amount_out)), '[]'::jsonb)
               FROM (SELECT * FROM transactions t5 JOIN self_v v5 ON v5.id = t5.vendor_id ORDER BY GREATEST(t5.amount_in, t5.amount_out) DESC LIMIT 8) t4))
    FROM transactions t JOIN self_v v ON v.id = t.vendor_id
  ),

  -- [7] 그 밖의 참조
  '기타참조', (
    SELECT jsonb_build_object(
      '별칭', (SELECT COALESCE(jsonb_agg(jsonb_build_object('종류', a.alias_type, '표기', a.alias_name)), '[]'::jsonb)
               FROM erp_vendor_aliases a JOIN self_v v ON v.id = a.vendor_id),
      '분개라인', (SELECT COUNT(*) FROM journal_lines jl JOIN self_v v ON v.id = jl.vendor_id),
      '카드사연결', (SELECT COUNT(*) FROM card_accounts c JOIN self_v v ON v.id = c.vendor_id),
      '원장이월(vendor_opening_balances)', (SELECT COALESCE(jsonb_agg(to_jsonb(o)), '[]'::jsonb)
               FROM vendor_opening_balances o JOIN self_v v ON v.id = o.vendor_id))
  )

)) AS check_result;
