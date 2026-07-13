-- 2026-06-24 키워드 정리 롤백 (변경 전 값으로 복원)
-- keywords 컬럼이 jsonb일 때. text[]이면 rollback_keyword_cleanup.py 사용.
BEGIN;
UPDATE accounts SET keywords = '["보통예금", "입금", "출금", "이체", "신한", "국민", "KB", "하나", "우리", "기업", "IBK", "농협", "축협", "수협", "SC", "씨티", "카카오뱅크", "토스뱅크", "케이뱅크"]'::jsonb WHERE id = 'cf5f7cdc-b045-4acc-9632-6b69f95e96ee';  -- 1001
UPDATE accounts SET keywords = '["세금", "부가세", "법인세", "소득세", "취득세", "재산세", "주민세", "종합부동산세", "관세", "공과금", "전기세", "수도세", "가스비", "전기", "수도", "가스", "도시가스", "한전", "한국전력"]'::jsonb WHERE id = 'b96fd1e0-46b2-401c-ac1b-90b45b77080d';  -- 5111
UPDATE accounts SET keywords = '["잡비", "기타", "잡", "소액", "기타비용", "잡손실"]'::jsonb WHERE id = '71dcd8a2-1d94-4604-b8ce-f750e37100c1';  -- 5113
UPDATE accounts SET keywords = '["입금", "매출", "판매", "수입", "수금", "결제대금", "세금계산서"]'::jsonb WHERE id = '4f31d98f-e220-4911-9d7c-fba09ceb818e';  -- 4001
UPDATE accounts SET keywords = '["통신", "휴대폰", "핸드폰", "SKT", "KT", "LG유플러스", "LGU+", "인터넷", "전화", "팩스"]'::jsonb WHERE id = 'ee160b45-414d-4671-b255-b94000884059';  -- 5104
UPDATE accounts SET keywords = '["수수료", "대행", "용역", "프리랜서", "외주", "컨설팅", "법무", "세무", "회계", "변호사", "세무사", "공인중개사", "중개", "플랫폼수수료", "카드수수료", "결제수수료", "PG", "페이", "간편결제"]'::jsonb WHERE id = 'c56729ac-bcac-4ad3-96a1-10108ec826a5';  -- 5108
UPDATE accounts SET keywords = '["보험", "화재보험", "자동차보험", "산재보험", "고용보험", "국민연금", "건강보험", "생명보험", "손해보험", "보장", "공제"]'::jsonb WHERE id = '7607b230-6955-4429-82b1-4c456fc95a96';  -- 5110
UPDATE accounts SET keywords = '["접대", "거래처", "고객", "미팅", "회의", "식사", "골프", "선물", "경조사", "조의금", "축의금", "화환", "케이터링", "접대식사"]'::jsonb WHERE id = '53d58bee-003c-4b0e-a8bf-36cff7db52fb';  -- 5107
UPDATE accounts SET keywords = '["복리후생", "식대", "중식", "식비", "구내식당", "카페", "커피", "음식", "점심", "저녁", "야식", "회식", "직원", "의료비", "건강검진", "명절선물", "동호회"]'::jsonb WHERE id = 'a5380e5e-c555-4651-a48d-2439d8971a77';  -- 5102
COMMIT;
