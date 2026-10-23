-- =====================================================
-- tax_invoice_upload_outcome_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 홈택스 매입 세금계산서 파일을 매출 화면에서 올린 결과 확인 (2026-10-12)
--
-- 질문: 매입(117_1) 파일이 '매입'으로 바르게 저장됐나, '매출'로 뒤집혀 저장됐나.
--   · 새 코드(3b6b341 배포 후): 파일 구분대로 purchase로 저장되고 화면에 "현재 탭과 다름" 표시
--   · 구 코드(배포 전 업로드): 화면 선택대로 sales로 저장 — 이때 거래처 자리에
--     공급받는자(= 우리 회사 701-88-00023)가 들어가므로 바로 티가 난다.
-- =====================================================

SELECT jsonb_pretty(jsonb_build_object(

  -- [1] 최근 2일 저장된 계산서 — 방향·유형별 건수와 금액
  '최근_저장', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t->>'구분'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        '구분', CASE direction WHEN 'sales' THEN '매출' ELSE '매입' END
                || ' ' || CASE tax_type WHEN 'taxable' THEN '세금계산서' ELSE '계산서' END,
        '건수', COUNT(*), '합계', SUM(total_amount),
        '작성일', MIN(issue_date) || ' ~ ' || MAX(issue_date),
        '거래처연결', COUNT(*) FILTER (WHERE vendor_id IS NOT NULL),
        '계정추천', COUNT(*) FILTER (WHERE confirmed_account_id IS NOT NULL),
        '수금지급확인', COUNT(*) FILTER (WHERE payment_status = 'matched')
      ) AS t
      FROM tax_invoices
      WHERE created_at >= now() - INTERVAL '2 days'
      GROUP BY direction, tax_type
    ) s
  ),

  -- [2] 방향이 뒤집힌 증거 — 거래처 자리에 우리 회사 사업자번호가 들어간 행
  '뒤집힌_행', (
    SELECT jsonb_build_object(
      '건수', COUNT(*),
      '합계', COALESCE(SUM(total_amount), 0),
      '저장된_방향', COALESCE(jsonb_agg(DISTINCT direction), '[]'::jsonb),
      '표본', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('승인번호', approval_number, '작성일', issue_date,
                                            '방향', direction, '유형', tax_type,
                                            '거래처명', counterparty_name, '합계', total_amount))
        FROM (SELECT * FROM tax_invoices
              WHERE counterparty_biz_number = '701-88-00023'
              ORDER BY created_at DESC LIMIT 5) x
      ), '[]'::jsonb)
    )
    FROM tax_invoices
    WHERE counterparty_biz_number = '701-88-00023'
  ),

  -- [3] 우리 회사가 거래처로 등록돼 버렸는지 (뒤집힌 업로드가 만든 부산물)
  '자사_거래처등록', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, '이름', name, '사업자번호', biz_number,
                                                 '유형', type, '생성', created_at)), '[]'::jsonb)
    FROM vendors
    WHERE biz_number = '701-88-00023' OR name ~ '다올커머스'
  ),

  -- [4] 117_1 파일(매입 세금계산서, 2026-10-01~10-09, 17건)이 어느 방향으로 들어갔나
  '매입세금계산서_17건', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('방향', direction, '건수', n, '합계', amt)), '[]'::jsonb)
    FROM (
      SELECT direction, COUNT(*) n, SUM(total_amount) amt
      FROM tax_invoices
      WHERE tax_type = 'taxable'
        AND issue_date BETWEEN DATE '2026-10-01' AND DATE '2026-10-09'
        AND created_at >= now() - INTERVAL '2 days'
      GROUP BY direction
    ) s
  )

)) AS check_result;
