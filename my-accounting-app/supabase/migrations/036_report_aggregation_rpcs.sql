-- 무거운 리포트(대형 테이블 앱-사이드 집계)를 DB 집계로 옮기기 위한 RPC들.
-- lib/vendor-analysis.ts(035)와 동일한 방식. 코드는 RPC 우선 + 미적용 시 앱-집계 폴백.

-- ① 매입처 미지급현황: 정산월×매입처 품목 집계 (취소/VIP/선결제 제외)
--   p_from / p_to 는 'YYYY-MM' 정산월 문자열(NULL이면 제한 없음).
CREATE OR REPLACE FUNCTION erp_payable_item_summary(p_from TEXT, p_to TEXT)
RETURNS TABLE (
  purchase_alias_id UUID,
  settlement_month  TEXT,
  item_count        BIGINT,
  purchase_total    BIGINT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    i.purchase_alias_id,
    i.settlement_month,
    COUNT(*)::BIGINT,
    COALESCE(SUM(i.purchase_total), 0)::BIGINT
  FROM erp_order_items i
  WHERE i.is_canceled   = false
    AND i.is_vip        = false
    AND i.is_prepayment = false
    AND i.purchase_alias_id IS NOT NULL
    AND (p_from IS NULL OR i.settlement_month >= p_from)
    AND (p_to   IS NULL OR i.settlement_month <= p_to)
  GROUP BY i.purchase_alias_id, i.settlement_month
$$;

-- ② 매입처 분석(목록): 매입처(purchase alias)별 누적/당월 판매·매입 집계
--   p_current_month 는 'YYYY-MM' (당월 판매/매입 계산용).
CREATE OR REPLACE FUNCTION vendor_purchase_analysis(p_current_month TEXT)
RETURNS TABLE (
  alias_id       UUID,
  erp_name       TEXT,
  vendor_id      UUID,
  vendor_name    TEXT,
  cum_sales      BIGINT,
  cum_purchase   BIGINT,
  month_sales    BIGINT,
  month_purchase BIGINT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    i.purchase_alias_id,
    a.erp_name,
    a.vendor_id,
    v.name,
    COALESCE(SUM(i.line_total), 0)::BIGINT,
    COALESCE(SUM(i.purchase_total), 0)::BIGINT,
    COALESCE(SUM(i.line_total)     FILTER (WHERE i.settlement_month = p_current_month), 0)::BIGINT,
    COALESCE(SUM(i.purchase_total) FILTER (WHERE i.settlement_month = p_current_month), 0)::BIGINT
  FROM erp_order_items i
  LEFT JOIN erp_vendor_aliases a ON a.id = i.purchase_alias_id
  LEFT JOIN vendors v            ON v.id = a.vendor_id
  WHERE i.is_canceled   = false
    AND i.is_vip        = false
    AND i.is_prepayment = false
  GROUP BY i.purchase_alias_id, a.erp_name, a.vendor_id, v.name
$$;
