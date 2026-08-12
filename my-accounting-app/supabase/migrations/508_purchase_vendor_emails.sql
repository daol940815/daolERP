-- =====================================================
-- 508_purchase_vendor_emails.sql
-- 매입처 발주 이메일 적재 — 원가표(사용자 제공, 2,358행)에서 추출
-- 매입처명 -> purchase 별칭 -> vendors 연결로 매칭, 기존 이메일은 덮어쓰지 않음.
--
-- 실행 순서: 1) 드라이런 SELECT로 반영 대상 확인  2) UPDATE 실행  3) 검증 SELECT
-- =====================================================

-- 임시 매핑 (원가표 추출 112곳)
CREATE TEMP TABLE _po_emails (vendor_name TEXT PRIMARY KEY, email TEXT NOT NULL);
INSERT INTO _po_emails (vendor_name, email) VALUES
  ('(주)다이아', 'daiya1991@naver.com'),
  ('(주)소셜빈', 'kisung@socialbean.co.kr'),
  ('AtoZ', 'k398551@naver.com'),
  ('DMC미디어', 'kkw2954@dmcmedia.co.kr'),
  ('GB컴퍼니', 'gb-support@golfboom.com'),
  ('JW아이엔씨', '7013355@jwinc.shop'),
  ('JW컴퍼니', 'karismapark48@hanmail.net'),
  ('THE SG', 'thesg0_s@naver.com'),
  ('㈜다이아', 'daiya1991@naver.com'),
  ('㈜소셜빈', 'kisung@socialbean.co.kr'),
  ('㈜에벤에셀기업', 'ebes@ebes.co.kr'),
  ('골프맥스', 'golmac@naver.com'),
  ('괴산꿀벌랜드', 'golcan@hanmail.net'),
  ('구씨공방', 'jongseok1188@hanmail.net'),
  ('기프트넷', 'gift@giftnet.co.kr'),
  ('나래티앤씨', 'admin@naraetnc.com'),
  ('나비스토리', 'ahj0417@sknabi.com'),
  ('남양유업', 'clc0718@namyangi.com'),
  ('네오프라자', 'neoplaza@neoplaza.co.kr'),
  ('네이처프라임', 'sales@nprime.co.kr'),
  ('뉴샵', 'newshop2026@naver.com'),
  ('느티나무의사랑', 'huz@huz.co.kr'),
  ('다온글로비스', 'daonglovis@daum.net'),
  ('다올에프앤지', 'daolfng@gmail.com'),
  ('다올커머스', 'daol87456@hanmail.net'),
  ('다즐코리아', 'doskoi@naver.com'),
  ('대길', '9477848@naver.com'),
  ('대상크리스탈', 'leebo99@hanmail.net'),
  ('대왕크린', 'dwtissue@naver.com'),
  ('대현상회', 'dhoil1970@naver.com'),
  ('도기야', 'new@livingnara.com'),
  ('동양키친나라', 'kcnr@hanmail.net'),
  ('두일지엘', 'ub3@ubkorea.co.kr'),
  ('라인플러스', 'sales@lineplus.com'),
  ('락앤락', 'hyuckgyu.kwon@locknlock.com'),
  ('렌켄', 'moondaeho1@naver.com'),
  ('로얄오피스', 'royalinkr@hanmail.net'),
  ('롯데택배', 'yoaluv@naver.com'),
  ('루체컴퍼니', 'luce-co@naver.com'),
  ('루치펠로', 'bavscd@rucipello.com'),
  ('리버191', 'evergreenkch@hanmail.net'),
  ('리베로앤', 'liberon4992200@daum.net'),
  ('명성', 'zerodrom21@gift.co.kr'),
  ('모든컴퍼니', 'admin@moduen.com'),
  ('무아스', 'offline@mooas.com'),
  ('무한타올우정상사', 'woojungtowel@naver.com'),
  ('바르미식품', 'barmifd@naver.com'),
  ('반디상사', 'queen-made@naver.com'),
  ('베스트라인', 'bestlinee@naver.com'),
  ('벨라코리아', 'help@bellakorea.kr'),
  ('브랜즈컴퍼니', 'b2b@brandz.co.kr'),
  ('브로스앤컴퍼니', 'yjseo@brosncompany.com'),
  ('비앤디', 'bndsa001@bndkorea.com'),
  ('비오인터내셔널', 'bointl1@naver.com'),
  ('비즈모아코리아', 'bizmoakorea@naver.com'),
  ('비즈엠넷코리아', 'thinking@bizmnet.co.kr'),
  ('비타그램', 'vitagram001@naver.com'),
  ('샘빌', 'yoonki@semvill.com'),
  ('서우글로벌', 'seowoo.njy@gmail.com'),
  ('선명농수산', 'sm22@sunnuts.co.kr'),
  ('선학', 'mblco@naver.com'),
  ('성진코아', 'whyun@sungjincore.co.kr'),
  ('세정CCR', 'sejungccr@naver.com'),
  ('솔트바이오', 'sbhmudsalt@saltbio.com'),
  ('송월타올수건이야기', 'towel79@naver.com'),
  ('쉔코리아', 'schoenkorea1@schoenkorea.co.kr'),
  ('승일', 'thinking@bizmnet.co.kr'),
  ('시즈넬', 'tfsdiffuser@gmail.com'),
  ('신성트레이드', 'kyuil9191@hanmail.net'),
  ('신영인터내셔널', 'syglc@naver.com'),
  ('신영종합상사', 'sypen@naver.com'),
  ('실리만', 'pjh@sillymann.com'),
  ('씨엘피에스', 'hbk0609@hanmail.net'),
  ('아로마코에스', 'ceo01@aromacos.kr'),
  ('아이랩코퍼레이션', 'order@ilabcorp.co.kr'),
  ('아이템허브', 'itemhub-laaon@naver.com'),
  ('아임커머스', 'gnews8@imcommerce.kr'),
  ('알로코리아', 'seunghun.lee@allokorea.com'),
  ('알리오코리아', 'nys8634@hanmail.net'),
  ('알토디자인', 'icechang00@naver.com'),
  ('에벤에셀기업', 'ebes@ebes.co.kr'),
  ('에스랜드', 'boyasland1@hanmail.net'),
  ('에스엔티코프', 'rmswleo@hanmail.net'),
  ('에스피플', 'mj@speople.kr'),
  ('에이치앤씨', 'hnc_0001@naver.com'),
  ('엠테크윈', 'mtechwin@naver.com'),
  ('영도금속', 'leejh0908@nate.com'),
  ('오성우산', 'ktec0880@naver.com'),
  ('와이컨텐츠', 'sjkim@ycontents.co.kr'),
  ('요아럽', 'yoaluv@naver.com'),
  ('웰크리', 'mblco@naver.com'),
  ('위드컴퍼니', 'withcom5694@naver.com'),
  ('윈스타', 'winstarmat@naver.com'),
  ('윌케이', 'ysaa8504@naver.com'),
  ('유비코리아', 'ub3@ubkorea.co.kr'),
  ('유비콜아', 'ub3@ubkorea.co.kr'),
  ('유케이특판', 'kw2023@unclekim.net'),
  ('이음전산', 'tp@eeumcorp.co.kr'),
  ('제이피글로벌', 'jpglo5954@daum.net'),
  ('지이켐텍', 'siliconeman@hanmail.net'),
  ('카파클락', 'ys.lee@kappaclock.com'),
  ('커스텀플레이스', 'custom@customplace.net'),
  ('코스맥스코리아', 'doskoi@naver.com'),
  ('쿨디자인', 'cool-design@naver.com'),
  ('큐브디컴퍼니', 'gdcmaster@gmail.com'),
  ('투엘컴퍼니', 'twobro@twolc.co.kr'),
  ('파인갤러리', 'spoart2000@daum.net'),
  ('퍼니메이드', 'funnymade@daum.net'),
  ('퍼스트비', 'fb@firstb.co.kr'),
  ('포트메리온', 'hm9389@hanmail.net'),
  ('협성트레이드', 'hst2503@hanmail.net'),
  ('혜토', 'rh360@hanmail.net');

-- ── 드라이런: 반영될 거래처 목록 (실행 전 확인) ──
-- SELECT p.vendor_name, p.email, v.id, v.name AS vendors_name, v.email AS 기존이메일
-- FROM _po_emails p
-- JOIN erp_vendor_aliases a ON a.alias_type = 'purchase' AND a.erp_name = p.vendor_name
-- JOIN vendors v ON v.id = a.vendor_id
-- ORDER BY p.vendor_name;

-- ── 적재: 별칭으로 연결된 거래처에 이메일 채움 (기존 값 보존) ──
UPDATE vendors v
SET email = p.email
FROM _po_emails p
JOIN erp_vendor_aliases a ON a.alias_type = 'purchase' AND a.erp_name = p.vendor_name
WHERE a.vendor_id = v.id
  AND (v.email IS NULL OR trim(v.email) = '');

-- ── 검증 ──
SELECT
  (SELECT count(*) FROM _po_emails) AS 원가표_이메일_매입처,
  (SELECT count(DISTINCT a.vendor_id) FROM _po_emails p
    JOIN erp_vendor_aliases a ON a.alias_type='purchase' AND a.erp_name=p.vendor_name
    WHERE a.vendor_id IS NOT NULL) AS 별칭연결됨,
  (SELECT count(*) FROM _po_emails p
    LEFT JOIN erp_vendor_aliases a ON a.alias_type='purchase' AND a.erp_name=p.vendor_name
    WHERE a.vendor_id IS NULL) AS 미연결_별칭없거나_거래처미연결,
  (SELECT count(*) FROM vendors WHERE email IS NOT NULL AND trim(email)<>'') AS 이메일_보유_거래처_총;

DROP TABLE _po_emails;
