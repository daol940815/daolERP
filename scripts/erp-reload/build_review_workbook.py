# ERP 재적재 트랙 — 검수 보조 엑셀 생성 (2026-10-21 총괄). analyze_review_files.py 실행 후 사용.
# 사용: python3 -I build_review_workbook.py <업로드폴더> <출력폴더>
#   출력폴더에 summary.json과 employees.json(REST: employees?select=name,team,employment_type,auth_user_id)이 있어야 한다.
#   결과: <출력폴더>/ERP_검수보조_<날짜>.xlsx
import sys
import openpyxl, re, json, collections, difflib
FILES_ERP = ['0171b981-2025_ERP_____.xlsx', '5e6e20ac-2026_ERP_____.xlsx']  # 사용자 업로드 파일명으로 수정
FILE_DOC = 'cb9d73b3-2026___________25_.xlsx'
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter
UP = sys.argv[1].rstrip('/') + '/'
OUT = sys.argv[2].rstrip('/') + '/'
S = json.load(open(OUT + 'summary.json'))
EMP = set(e['name'] for e in json.load(open(OUT + 'employees.json')))
C = collections.Counter
def s(v): return '' if v is None else str(v).strip()

erp = []
for fn in [*FILES_ERP]:
    wb = openpyxl.load_workbook(UP + fn, read_only=True, data_only=True)
    for ws in wb.worksheets:
        rows = ws.iter_rows(values_only=True); next(rows)
        for r in rows:
            if all(c is None for c in r): continue
            erp.append({'bank': s(r[4]), 'branch': s(r[5]), 'mgr': s(r[6]), 'ch': s(r[21]), 'gubun': s(r[23]),
                        'ymd': f"{s(r[1])}-{s(r[2]).zfill(2)}-{s(r[3]).zfill(2)}", 'amt': r[16] or 0, 'cancel': s(r[0]) == 'cancel'})
doc = {(r['bank'], r['branch'], r['mgr']): r for r in S['docrows']}
bb_doc = collections.defaultdict(list)
for r in S['docrows']: bb_doc[(r['bank'], r['branch'])].append(r)
bank_doc = collections.defaultdict(set)
for r in S['docrows']: bank_doc[r['bank']].add(r['branch'])

combos = collections.defaultdict(lambda: {'n': 0, 'ch': C(), 'first': '9999', 'last': '0000', 'amt': 0})
for d in erp:
    k = (d['bank'], d['branch'], d['mgr']); c = combos[k]
    c['n'] += 1; c['ch'][d['ch']] += 1; c['first'] = min(c['first'], d['ymd']); c['last'] = max(c['last'], d['ymd'])
    if not d['cancel']: c['amt'] += d['amt'] if isinstance(d['amt'], (int, float)) else 0

wb = openpyxl.Workbook()
HFILL = PatternFill('solid', fgColor='DDE3EA'); HF = Font(bold=True)
def sheet(title, header, rows, widths=None, note=None):
    ws = wb.create_sheet(title)
    r0 = 1
    if note:
        ws.cell(1, 1, note).font = Font(italic=True, color='555555'); r0 = 3
    for j, h in enumerate(header, 1):
        c = ws.cell(r0, j, h); c.fill = HFILL; c.font = HF
    for i, row in enumerate(rows, r0 + 1):
        for j, v in enumerate(row, 1): ws.cell(i, j, v)
    ws.freeze_panes = ws.cell(r0 + 1, 1)
    ws.auto_filter.ref = f"A{r0}:{get_column_letter(len(header))}{r0 + max(len(rows), 1)}"
    for j, w in enumerate(widths or [14] * len(header), 1): ws.column_dimensions[get_column_letter(j)].width = w
    return ws

# ── 0 요약 ──
ws = wb.active; ws.title = '요약'
n = len(erp); ncancel = sum(1 for d in erp if d['cancel'])
lines = [
    ('ERP 파일 행(품목 단위)', n, '2025_01~2026_09 21개 시트, 취소(cancel) 행 ' + str(ncancel) + ' 포함'),
    ('기간', '2025-01-16 ~ 2026-09-16', '현재 DB 업로드 주문은 2025-01-01 ~ 2026-07-15 (2026-07-16 이후 DB 6건) — 파일에 8·9월 약 4,000행이 더 있음'),
    ('양식', '판매내역 양식(27열, 주문번호 없음)', '기존 업로드 양식(주문번호·주문상태·미수금·연락처·다올직원 포함)이 아님 — 이 파일로는 재적재 불가, 검수용으로만'),
    ('은행|지점|담당자 조합', len(combos), '검수 단위를 행(26,258)이 아니라 조합(2,370)으로 하면 작업량이 1/10'),
    ('고객관리문서 행', len(S['docrows']), '2026-08-27 기준, 은행|지점|담당자 1,401 (중복 없음), 다올 담당 8명'),
    ('문서 일치 조합 / 행', f"{sum(1 for k in combos if k in doc)} / {sum(c['n'] for k, c in combos.items() if k in doc)}", '행 기준 62%'),
    ('문서 미일치 행', n - sum(c['n'] for k, c in combos.items() if k in doc), '담당자만 없음 4,239 · 지점 없음 2,409 · 은행 없음 3,301 (문서_미일치 시트)'),
    ('채널 = 문서 다올담당 (일치 조합 내)', '13,553 일치 / 2,756 불일치', '불일치 = 응대자(김주연·김대희·병원몰 등)가 채널에 들어간 경우가 대부분 (채널_전환표 시트)'),
    ('구분 값 종류', len(S['gubun']), '정규값 7개(상시·25설·25추석·26설·26추석·샘플·선결제·VIP·매입) 외 오타·잡값 약 50종 110행 (구분_분류 시트)'),
    ('은행명 오탈자 후보', f"띄어쓰기 변형 {len(S['bank_var'])}그룹 · 유사 쌍 {len(S['bank_fz'])}", '은행명_후보 시트 — 판정 열에 정정값 기입'),
    ('지점명 오탈자 후보', f"변형 {len(S['br_norm'])}그룹 · 유사 쌍 {len(S['br_fz'])}", '지점명_후보 시트 — 실제 다른 지점(경기2GA/경기3GA 등)이 섞여 있어 사람이 판정'),
    ('담당자 오탈자 후보', f"변형 {len(S['mg_norm'])}그룹 · 유사 쌍 {len(S['mg_fz'])}", '담당자_후보 시트 — 직함 변경(승진)과 오타(강병진/강변진)를 구분해야 함'),
    ('빈 값', '지점명 7,920행 · 담당자 591행', '지점 없는 거래처(병원지부·회사·개인)는 정상 — 빈 담당자 591행은 확인 대상'),
]
ws.cell(1, 1, 'ERP 데이터 검수 보조 — 2026-10-21 총괄 분석 (파일: 2025 ERP, 2026 ERP, 2026 고객관리문서 25)').font = Font(bold=True, size=12)
for j, h in enumerate(['항목', '값', '설명'], 1):
    c = ws.cell(3, j, h); c.fill = HFILL; c.font = HF
for i, (a, b, c) in enumerate(lines, 4):
    ws.cell(i, 1, a); ws.cell(i, 2, b); ws.cell(i, 3, c)
ws.column_dimensions['A'].width = 34; ws.column_dimensions['B'].width = 36; ws.column_dimensions['C'].width = 110

# ── 1 구분 분류 ──
def guess(g):
    x = g.strip()
    if x in ('상시', '성시', '상시시', 'ㅌ상시', '상', '25상시', '26상시'): return '상시'
    if x.lower() in ('tkdtl', '26tjf', '26 설', '26섧', '26살', '26츠삭', '26추서', '26추', '95추석', '15설', '25추설', '26명절', '명절', '추석'):
        if 'tjf' in x.lower() or '설' in x or '섧' in x or '살' in x: return '26설(확인)' if x.startswith('26') else ('25설(확인)' if x.startswith('25') or x.startswith('15') else '설(연도 확인)')
        if x.lower() == 'tkdtl': return '상시'
        return '추석(연도 확인)' if '추' in x or '츠' in x else '명절(연도·종류 확인)'
    if x.lower() == 'vip': return 'VIP'
    if x in ('샘', '샘픔'): return '샘플'
    if x in ('상시', '25설', '25추석', '26설', '26추석', '샘플', '선결제', 'VIP', '매입'): return x
    if x in ('지점', '개별', '25개별', '26추석 개별'): return '열 착오(유형 값) — 날짜로 판정'
    if x in ('옥광일', '홍창의'): return '열 착오(직원명) — 날짜로 판정'
    if x in ('선매입', '도매', '상사', '성사', '바우처몰', '후원', '화훼', '배송비', '도기야', '제니오'): return '기타(의미 확인)'
    if x == '': return '빈 값 — 날짜로 판정'
    return '불명 — 날짜로 판정'
sheet('구분_분류', ['구분 값', '행 수', '제안 정규값', '판정(기입)'],
      [(g, c, guess(g), '') for g, c in S['gubun']], [18, 10, 34, 20],
      '구분 열 값 전체. 제안 정규값은 총괄 추정 — 명절 값은 DB의 season_code(확정 명절 코드) 원천으로 쓸 수 있다(현재 DB 확정 0건, 날짜 기반 추천만).')

# ── 2 은행명 후보 ──
rows = []
for k, v in S['bank_var'].items():
    cnts = C(d['bank'] for d in erp)
    rows.append(('띄어쓰기 변형', ' | '.join(f"{x}({cnts[x]})" for x in v), '', '', '', ''))
for a, na, b, nb, r in sorted(S['bank_fz'], key=lambda x: -x[4]):
    rows.append(('유사', a, na, b, nb, r))
sheet('은행명_후보', ['유형', 'A', 'A 행수', 'B', 'B 행수', '유사도', '정정값(기입)'], rows, [12, 30, 8, 30, 8, 8, 30],
      '같은 은행의 다른 표기 후보. 실제로 다른 곳(127ROTC/117ROTC 등)이 섞여 있다. 기준 표기는 고객관리문서의 은행명.')

# ── 3 지점명 후보 ──
rows = []
for b, lst in S['br_norm']:
    rows.append((b, '띄어쓰기·접미 변형', ' | '.join(f"{x}({n})" for x, n in lst), '', '', '', ''))
for b, a, na, c, nc, r in sorted(S['br_fz'], key=lambda x: (x[0], -x[5])):
    rows.append((b, '유사', a, na, c, nc, r))
sheet('지점명_후보', ['은행', '유형', 'A', 'A 행수', 'B', 'B 행수', '유사도', '정정값(기입)'], rows, [16, 14, 28, 8, 28, 8, 8, 28],
      '같은 은행 안에서 비슷한 지점명. 문서에 있는 표기를 기준으로 통일. 실제 다른 지점(경기2GA/경기3GA, 울산AM/남울산AM)은 그대로.')

# ── 4 담당자 후보 ──
rows = []
for (b, br), lst in S['mg_norm']:
    rows.append((b, br, '님·띄어쓰기 변형', ' | '.join(f"{x}({n})" for x, n in lst), '', '', '', ''))
for (b, br), a, na, c, nc, r in sorted(S['mg_fz'], key=lambda x: (x[0][0], x[0][1], -x[5])):
    rows.append((b, br, '유사', a, na, c, nc, r))
sheet('담당자_후보', ['은행', '지점', '유형', 'A', 'A 행수', 'B', 'B 행수', '유사도', '정정값(기입)'], rows, [16, 20, 14, 22, 8, 22, 8, 8, 24],
      '같은 은행+지점 안에서 비슷한 담당자. 직함만 다른 경우(부지점장→지점장)는 승진일 수 있으니 문서의 "부서 이동" 열과 대조.')

# ── 5 문서 미일치 조합 ──
rows = []
for k, c in sorted(combos.items(), key=lambda x: -x[1]['n']):
    if k in doc: continue
    b, br, m = k
    if (b, br) in bb_doc:
        typ = '담당자 없음'
        cands = [r['mgr'] for r in bb_doc[(b, br)]]
        best = difflib.get_close_matches(m, cands, n=2, cutoff=0.6) if m else []
        hint = ' | '.join(best) if best else ('문서 담당자: ' + ', '.join(cands[:4]) + (' 외' if len(cands) > 4 else ''))
    elif b in bank_doc:
        typ = '지점 없음'
        best = difflib.get_close_matches(br, list(bank_doc[b]), n=2, cutoff=0.6) if br else []
        hint = ' | '.join(best)
    else:
        typ = '은행 없음'
        best = difflib.get_close_matches(b, list(bank_doc.keys()), n=2, cutoff=0.75)
        hint = ' | '.join(best)
    ch = ', '.join(f"{x or '(빈값)'}({n})" for x, n in c['ch'].most_common(3))
    rows.append((b, br, m, c['n'], typ, hint, ch, c['first'], c['last'], int(c['amt']), '', '', '', ''))
sheet('문서_미일치', ['은행', '지점', '담당자', '행 수', '미일치 유형', '문서의 비슷한 값(참고)', '채널 분포', '첫 주문', '마지막 주문', '매출 합계(취소 제외)',
                   '정정 은행', '정정 지점', '정정 담당자', '다올 담당(기입)'], rows, [18, 22, 20, 8, 12, 34, 30, 11, 11, 14, 16, 18, 18, 12],
      'ERP 조합 중 고객관리문서(2026-08-27)에 없는 것. 다올커머스(내부 주문)·병원지부·요아럽·2026-09 신규가 큰 몫. 오타면 정정값, 신규면 다올 담당만 기입.')

# ── 6 채널 전환표 ──
rows = []
for k, c in sorted(combos.items(), key=lambda x: -x[1]['n']):
    if k not in doc: continue
    r = doc[k]; daol = r['daol']
    match = c['ch'].get(daol, 0)
    ch = ', '.join(f"{x or '(빈값)'}({n})" for x, n in c['ch'].most_common(4))
    rows.append((k[0], k[1], k[2], c['n'], daol, r['prev'], ch, match, c['n'] - match, '전부 일치' if match == c['n'] else '', ''))
sheet('채널_전환표', ['은행', '지점', '담당자', '행 수', '문서 다올 담당', '문서 예전 담당', '채널 분포(현재)', '일치 행', '불일치 행', '자동 판정', '전환 판정(기입)'],
      rows, [18, 22, 20, 8, 12, 12, 36, 8, 8, 10, 14],
      '문서와 일치한 조합의 채널 값 분포. 불일치 행은 대부분 응대자(영업지원)가 채널에 들어간 경우 — 전환하면 응대자 정보가 사라지므로 덮어쓰기 대신 열 추가 권고.')

# ── 7 채널 값 목록 ──
rows = [(x or '(빈값)', n, '직원 마스터' if x in EMP else '', '') for x, n in S['channel']]
sheet('채널_값', ['채널 값', '행 수', '직원 마스터 일치', '정정값(기입)'], rows, [20, 10, 14, 20],
      '채널 열의 값 전체. 직원 마스터(employees 14명)에 없는 이름: 퇴사자·아르바이트·오타(옥과일·옥광잂·홍창읩)·잡값(상담자·날짜·숫자).')

wb.save(OUT + 'ERP_검수보조_2026-10-21.xlsx')
print('saved', len(combos))
