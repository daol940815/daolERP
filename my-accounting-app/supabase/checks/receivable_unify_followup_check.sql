-- =====================================================
-- receivable_unify_followup_check.sql  (읽기 전용 — 데이터 변경 없음)
-- 미수 단일화 후속 진단 (2026-10-23) — receivable_unify_check 결과에서 나온 두 가지
--
-- [A] 컷오프 전제가 깨지는 주문 — "업로드 전 입금은 ERP 미수에 이미 반영됐다"는 전제로
--     컷오프 이전 매칭을 차감하지 않는데, ERP 원본미수가 총액 그대로인 주문에 컷오프 이전 매칭이
--     붙어 있다(표본 qucuhUn·3twVZPy: 1,500,000·1,350,000 전액 매칭인데 ERP는 전액 미수).
--     → ERP에 수금 입력이 안 된 주문(영업지원팀 작업 목록)이거나 매칭이 잘못된 것. 규모 약 620만.
-- [B] 순매출 0 주문 — 품목이 전부 취소·VIP·선결제라 순매출 0 → 미수 상한 0으로 미수가 통째로 사라짐
--     (7건 14,270,000). 실제로 입금이 안 된 선결제라면 어디에도 미수로 안 보인다. 사람이 판단할 것.
-- =====================================================

SELECT jsonb_pretty(jsonb_build_object(

  -- [A] 컷오프 이전 매칭이 있는데 ERP 미수가 남아 있는 미수금완료 주문
  'A_컷오프전매칭_미수잔존', jsonb_build_object(
    '요약', (
      SELECT jsonb_build_object('주문수', COUNT(*),
                                '표준미수', COALESCE(SUM(outstanding), 0),
                                '컷오프전_매칭액', COALESCE(SUM(matched_pre_cutoff), 0),
                                '전액매칭인데_전액미수', COUNT(*) FILTER (WHERE matched_pre_cutoff >= raw_outstanding AND raw_outstanding >= total_amount))
      FROM v_erp_order_receivable
      WHERE collect_status <> 'collected' AND matched_pre_cutoff > 0 AND outstanding > 0
    ),
    '목록', (
      SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'표준미수')::bigint DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          '주문번호', v.order_no, '주문일', v.order_date, '거래처', ven.name,
          '수금상태', v.collect_status, '총액', v.total_amount, '원본미수', v.raw_outstanding,
          '컷오프(업로드일)', v.upload_cutoff,
          '컷오프전_매칭', v.matched_pre_cutoff, '컷오프후_매칭', v.matched_deducted,
          '표준미수', v.outstanding,
          '매칭내역', (SELECT jsonb_agg(jsonb_build_object('입금일', m.paid_date, '금액', m.amount) ORDER BY m.paid_date)
                       FROM erp_payment_matches m WHERE m.order_id = v.order_id)
        ) AS t
        FROM v_erp_order_receivable v LEFT JOIN vendors ven ON ven.id = v.vendor_id
        WHERE v.collect_status <> 'collected' AND v.matched_pre_cutoff > 0 AND v.outstanding > 0
        ORDER BY v.outstanding DESC LIMIT 60
      ) s
    )
  ),

  -- [B] 순매출 0(전부 제외 품목)인데 ERP 미수가 남은 주문 — 품목 구성까지
  'B_순매출0_미수잔존', (
    SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'원본미수')::bigint DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        '주문번호', v.order_no, '주문일', v.order_date, '거래처', ven.name, '담당', v.staff_name,
        '수금상태', v.collect_status, '총액', v.total_amount, '원본미수', v.raw_outstanding,
        '매칭전체', v.matched_all,
        'VIP', v.has_vip, '선결제', v.has_prepayment, '취소', v.has_canceled,
        '품목', (SELECT jsonb_agg(jsonb_build_object('품명', i.item_name, '금액', i.line_total,
                                                     '취소', i.is_canceled, 'VIP', i.is_vip, '선결제', i.is_prepayment))
                 FROM erp_order_items i WHERE i.order_id = v.order_id)
      ) AS t
      FROM v_erp_order_receivable v LEFT JOIN vendors ven ON ven.id = v.vendor_id
      WHERE v.collect_status <> 'collected' AND v.net_sales <= 0
        AND GREATEST(0, v.raw_outstanding - v.matched_deducted) > 0
    ) s
  ),

  -- [C] 순매출 상한에 걸린 나머지 주문(순매출 > 0인데 원본미수가 더 큰 것) — 깎인 금액 확인
  'C_순매출상한_기타', (
    SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'깎임')::bigint DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        '주문번호', v.order_no, '주문일', v.order_date, '거래처', ven.name,
        '총액', v.total_amount, '품목합', v.item_total, '제외', v.excluded_amount, '순매출', v.net_sales,
        '원본미수', v.raw_outstanding, '표준미수', v.outstanding,
        '깎임', GREATEST(0, v.raw_outstanding - v.matched_deducted) - v.outstanding
      ) AS t
      FROM v_erp_order_receivable v LEFT JOIN vendors ven ON ven.id = v.vendor_id
      WHERE v.collect_status <> 'collected' AND v.net_sales > 0
        AND GREATEST(0, v.raw_outstanding - v.matched_deducted) > v.net_sales
    ) s
  )

)) AS check_result;
