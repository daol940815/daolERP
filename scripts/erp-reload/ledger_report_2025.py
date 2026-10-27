# ERP 재적재 트랙 — 세무사 거래처별 잔액 현황(2025) 분석 보고서 엑셀 (2026-10-27).
# 사용: set -a && source sb.env && set +a && python3 -I ledger_report_2025.py <ledger.json> <출력폴더>
# 시트: 요약 / 세무사 계정체계·매핑 / 거래처 계정규칙 / 2025 판관비 검산 / 2025말 거래처 잔액 / 2026 미분류 매입계산서 힌트
import sys, os, re, json, collections, urllib.request, urllib.parse
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter as L
SRC, OUT = sys.argv[1], sys.argv[2].rstrip('/') + '/'
U = os.environ['SB_URL']; K = os.environ['SB_KEY']
num = lambda v: float(v or 0)
norm = lambda x: re.sub(r'\s|\(주\)|주식회사|㈜|\(유\)|유한회사', '', str(x or ''))
Lg = json.load(open(SRC)); rows = Lg['rows']
def fetch_all(path):
    out = []; start = 0
    while True:
        url = U + '/rest/v1/' + urllib.parse.quote(path + '&order=id', safe="=&?.,()*:/'%!")
        rq = urllib.request.Request(url, headers={'apikey': K, 'Authorization': 'Bearer ' + K, 'Range': f'{start}-{start + 999}'})
        with urllib.request.urlopen(rq) as res: got = json.loads(res.read())
        out += got
        if len(got) < 1000: break
        start += 1000
    return out
acc = {a['id']: a for a in fetch_all('accounts?select=id,code,name,type')}
our_by_name = {a['name']: a['code'] for a in acc.values()}
# 세무사 계정명 → 우리 계정 (이름 다른 것 수동 매핑, 없는 것은 '신설 검토')
MAP = {'상품': '5002 상품매입(세무사는 재고자산 14600으로 처리 후 결산 시 원가)', '지급임차료': '5109 임차료', '전력비': '5203 전기요금', '세금과공과금': '5111 세금과공과',
       '접대비(기업업무추진비)': '5107 접대비', '렌트료': '5114 차량유지비(또는 신설 렌트료)', '외상매입금': '2001 미지급금(우리는 미지급금 한 계정)', '임대료수입': '4005 임대료수익',
       '정부보조금': '4008 정부보조금수익', '이자수익': '4002 이자수익', '잡손실': '5303 잡손실', '단기대여금': '1202 단기대여금'}
FONT = '맑은 고딕'; f = lambda **kw: Font(name=FONT, **{'size': 10, **kw}); B = f(bold=True); NOTE = f(italic=True, color='555555')
HF = PatternFill('solid', fgColor='DDE3EA'); NUM = '#,##0;(#,##0);-'
wb = Workbook()
def sheet(title, note, header, data, widths, numcols=()):
    ws = wb.create_sheet(title) if wb.sheetnames != ['Sheet'] else wb.active
    ws.title = title; ws.cell(1, 1, note).font = NOTE
    for j, h in enumerate(header, 1):
        c = ws.cell(2, j, h); c.font = B; c.fill = HF; c.alignment = Alignment(wrap_text=True, vertical='center')
    for i, row in enumerate(data, 3):
        for j, v in enumerate(row, 1):
            c = ws.cell(i, j, v); c.font = f()
            if j in numcols: c.number_format = NUM
    for j, w in enumerate(widths, 1): ws.column_dimensions[L(j)].width = w
    ws.freeze_panes = 'A3'; ws.auto_filter.ref = f'A2:{L(len(header))}{max(3, len(data) + 2)}'
    return ws

# ── 계정 체계 ──
accs = collections.defaultdict(lambda: {'n': 0, 'debit': 0.0, 'credit': 0.0, 'open': 0.0, 'bal': 0.0})
for x in rows:
    a = accs[(x['acode'], x['aname'])]; a['n'] += 1; a['debit'] += x['debit']; a['credit'] += x['credit']; a['open'] += x['open']; a['bal'] += x['bal']
data = []
for (c, n), a in sorted(accs.items()):
    ours = (our_by_name.get(n) and f"{our_by_name[n]} {n}") or MAP.get(n) or '없음 — 신설 검토'
    data.append((c, n, a['n'], round(a['open']), round(a['debit']), round(a['credit']), round(a['bal']), ours))
ws = sheet('세무사 계정체계·매핑', f"세무사 거래처별 잔액 현황({Lg['period']})에 나타난 계정 51개와 우리 계정(accounts) 대응. '없음'은 우리 체계에 없는 계정 — 신설 여부 결정 필요.",
           ['세무사 코드', '세무사 계정명', '거래처 수', '초기이월 합', '차변 합', '대변 합', '기말잔액 합', '우리 계정(대응)'], data, [10, 20, 9, 14, 14, 14, 14, 44], numcols=(4, 5, 6, 7))
ours_only = [f"{a['code']} {a['name']}" for a in sorted(acc.values(), key=lambda a: a['code']) if a['name'] not in {n for (_, n) in accs} and a['name'] not in ('매출원가', '감가상각비')]
ws.cell(len(data) + 4, 1, '우리 계정 중 세무사 원장에 없는 것(세무사는 다른 계정으로 묶음): ' + ', '.join(ours_only)).font = NOTE

# ── 거래처 계정 규칙 ──
byv = collections.OrderedDict()
for x in rows: byv.setdefault((x['vcode'], x['vendor']), []).append(x)
def kind(c):
    c = int(c)
    if 40000 <= c < 50000: return '매출'
    if c == 14600: return '상품(매입)'
    if 80000 <= c < 90000 or c in (93100, 95000, 96000): return '비용'
    if 90000 <= c < 100000: return '영업외수익'
    return None
data = []
for (vc, vn), lst in byv.items():
    pl = sorted([x for x in lst if kind(x['acode'])], key=lambda x: -(x['debit'] + x['credit']))
    if not pl: continue
    main = pl[0]
    others = ' / '.join(f"{x['aname']} {round((x['debit'] + x['credit']) / 1e3):,}천" for x in pl[1:])
    data.append((vc, vn, kind(main['acode']), main['acode'], main['aname'], round(main['debit'] + main['credit']), others, MAP.get(main['aname'], (our_by_name.get(main['aname']) and f"{our_by_name[main['aname']]} {main['aname']}") or '')))
sheet('거래처 계정규칙', '거래처별로 세무사가 쓴 손익(매출·상품·비용) 계정. 주계정 = 금액이 가장 큰 계정. 우리 매입계산서·통장 분류의 기본 계정 규칙 원천으로 쓴다.',
      ['거래처코드', '거래처명', '구분', '주계정 코드', '주계정', '연간 금액', '기타 계정', '우리 계정(대응)'], data, [10, 30, 10, 10, 18, 14, 40, 36], numcols=(6,))

# ── 2025 판관비 검산 ──
tx25 = fetch_all('transactions?select=counterparty_name,amount_in,amount_out,confirmed_account_id,transfer_pair_id&tx_date=gte.2025-01-01&tx_date=lte.2025-12-31')
ti25 = fetch_all('tax_invoices?select=counterparty_name,direction,supply_amount,confirmed_account_id&issue_date=gte.2025-01-01&issue_date=lte.2025-12-31')
ce25 = fetch_all('card_expenses?select=approved_amount,cancel_amount,confirmed_account_id&tx_date=gte.2025-01-01&tx_date=lte.2025-12-31')
ours = collections.defaultdict(lambda: [0.0, 0.0, 0.0])
for t in tx25:
    if t['transfer_pair_id'] or not t['confirmed_account_id']: continue
    a = acc[t['confirmed_account_id']]
    if a['type'] == 'expense': ours[a['name']][0] += num(t['amount_out']) - num(t['amount_in'])
for c in ce25:
    if c['confirmed_account_id']: ours[acc[c['confirmed_account_id']]['name']][1] += num(c['approved_amount']) - num(c['cancel_amount'])
for t in ti25:
    if t['direction'] != 'sales' and t['confirmed_account_id']: ours[acc[t['confirmed_account_id']]['name']][2] += num(t['supply_amount'])
REV = {'지급임차료': '임차료', '전력비': '전기요금', '세금과공과금': '세금과공과', '접대비(기업업무추진비)': '접대비'}
data = []
for (c, n), a in sorted(accs.items(), key=lambda kv: -(kv[1]['debit'] - kv[1]['credit'])):
    if not (80000 <= int(c) < 90000 or int(c) in (93100, 95000, 96000)): continue
    on = REV.get(n, n); o = ours.get(on, [0, 0, 0])
    data.append((c, n, round(a['debit'] - a['credit']), on, round(o[0]), round(o[1]), round(o[2]), round(sum(o)), round(sum(o) - (a['debit'] - a['credit']))))
for n, o in sorted(ours.items(), key=lambda kv: -sum(kv[1])):
    if n not in {REV.get(x, x) for (_, x) in accs} and n not in ('상품매입', '매출원가'):
        data.append(('', '(세무사 없음)', 0, n, round(o[0]), round(o[1]), round(o[2]), round(sum(o)), round(sum(o))))
sheet('2025 판관비 검산', '세무사 2025 비용 계정 연간 금액 vs 우리 2025 확정 분류 합계(통장 출금-입금 · 카드 순액 · 매입계산서 공급가 단순 합 — 계산서 대금 통장 출금이 비용으로도 확정된 경우 이중 포함). 차이가 큰 계정 = 분류 규칙이 다른 곳.',
      ['세무사 코드', '세무사 계정', '세무사 금액', '우리 계정', '우리 통장', '우리 카드', '우리 매입계산서', '우리 합계', '차이(우리-세무사)'], data, [10, 20, 14, 14, 14, 14, 14, 14, 16], numcols=(3, 5, 6, 7, 8, 9))

# ── 2025말 거래처 잔액 ──
data = []
for x in rows:
    if x['acode'] in ('10800', '25100', '25300', '13100', '25900', '12000', '26200') and abs(x['bal']) >= 1:
        data.append((x['vcode'], x['vendor'], x['acode'], x['aname'], round(x['open']), round(x['debit']), round(x['credit']), round(x['bal'])))
data.sort(key=lambda r: (r[2], -abs(r[7])))
sheet('2025말 거래처 잔액', '2025-12-31 기준 거래처별 채권·채무 잔액(세무사). 외상매출금 = 미수, 외상매입금·미지급금·미지급비용 = 미지급, 선급금·선수금. 기준일(2026-10-01) 기초잔액 작성 시 출발점 — 2026년 입출금을 반영해야 함.',
      ['거래처코드', '거래처명', '계정 코드', '계정', '초기이월', '차변', '대변', '2025말 잔액'], data, [10, 30, 10, 14, 14, 14, 14, 14], numcols=(5, 6, 7, 8))

# ── 2026 미분류 매입계산서 힌트 ──
exp_rule = collections.defaultdict(list)
for x in rows:
    if kind(x['acode']) in ('상품(매입)', '비용'): exp_rule[norm(x['vendor'])].append((x['acode'], x['aname'], x['debit']))
for k in exp_rule: exp_rule[k].sort(key=lambda t: -t[2])
def look(name):
    n = norm(name)
    if not n: return None
    if n in exp_rule: return exp_rule[n]
    if len(n) >= 3:
        for k, v in exp_rule.items():
            if len(k) >= 3 and (n in k or k in n): return v
    return None
ti26 = fetch_all('tax_invoices?select=issue_date,counterparty_name,counterparty_biz_number,item_name,supply_amount,direction,confirmed_account_id&issue_date=gte.2026-01-01&issue_date=lte.2026-09-30')
data = []
for t in sorted(ti26, key=lambda t: t['issue_date']):
    if t['direction'] == 'sales' or t['confirmed_account_id']: continue
    r = look(t['counterparty_name'])
    hint = (MAP.get(r[0][1]) or (our_by_name.get(r[0][1]) and f"{our_by_name[r[0][1]]} {r[0][1]}") or r[0][1]) if r else ''
    data.append((t['issue_date'], t['counterparty_name'], t['counterparty_biz_number'], t['item_name'], round(num(t['supply_amount'])), r[0][1] if r else '', hint, '세무사 2025 거래처 규칙' if r else '규칙 없음(2025 거래 없음)'))
sheet('2026 미분류 매입계산서 힌트', '2026년 계정 미분류 매입 계산서 153건에 세무사 2025 거래처 규칙을 적용한 추정. 월별손익 워크북의 매입계산서 분류 시트에도 같은 힌트가 들어간다.',
      ['발행일', '거래처', '사업자번호', '품목', '공급가액', '세무사 주계정', '추정 우리 계정', '근거'], data, [11, 28, 14, 26, 14, 14, 40, 22], numcols=(5,))

# ── 요약 (맨 앞) ──
ws = wb.create_sheet('요약', 0)
lines = [
    ('세무사 2025 거래처별 잔액 현황 분석 — 2026-10-27 총괄', f(bold=True, size=13)),
    (f"파일 성격: 거래처 × 계정과목 연간 합계(초기이월·차변·대변·잔액). 기간 {Lg['period']}. 거래처 1,620 · 행 3,059 · 계정 51. 날짜·건별 거래 없음 → 건별 매칭은 불가, 거래처→계정 규칙과 연간 검산에 사용.", None),
    ('', None),
    ('1. 계정 체계: 세무사는 매입을 재고자산 "상품(14600)"으로, 매입 채무를 "외상매입금(25100)"으로 처리. 우리 체계에 없는 계정 21개(선수금·예수금·미지급비용·렌트료·퇴직급여·도서인쇄비 등). 이름만 다른 계정 4개(지급임차료·전력비·세금과공과금·접대비). → 시트 "세무사 계정체계·매핑".', None),
    ('2. 거래처 규칙: 손익 계정이 있는 거래처 1,118곳. 우리 2025 매입계산서 확정 분류와 비교하면 1,486건 일치 · 114건 불일치(93%). 불일치는 임차료↔상품, 통신비↔지급수수료, 청소비↔지급수수료, 소모품비↔도서인쇄비 등 계정 선택 차이. → 시트 "거래처 계정규칙".', None),
    ('3. 2026 미분류 매입계산서 153건 중 101건(3.27억/4.44억)에 규칙이 적용됨 — 92건이 상품(5002). 통장 미확정 819건은 64건만 거래처명이 맞음(은행 표기와 세무사 거래처명이 달라서). → 시트 "2026 미분류 매입계산서 힌트".', None),
    ('4. 2025 매출 검산: 세무사 상품매출 43.4억(+임대료 0.65억) vs 우리 2025 매출 계산서 공급가 29.8억. 차이 13.6억의 원인: 우리 DB에 2025년 카드 매출·현금영수증이 적재되어 있지 않음(0건). ERP 2025 매출(파일, 부가세 포함) 37.9억 → 공급가 환산 34.4억 — ERP 파일은 2025-01-16부터라 설 명절 앞부분이 빠져 있음.', None),
    ('5. 2025 판관비 검산: 이자비용 세무사 1.71억 vs 우리 0.53억(통장 이자 분류 누락) · 세금과공과 0.30억 vs 0 · 퇴직급여 0.76억 vs 0 · 운반비 1.61억 vs 2.74억(우리 이중 포함 또는 세무사가 상품 원가로) · 보험료 0.12억 vs 0.81억(우리는 4대보험·퇴직연금을 보험료로) · 차량유지비 0.08억 vs 0.86억(세무사는 렌트료 0.40억 등으로 분산). → 시트 "2025 판관비 검산".', None),
    ('6. 잔액 이상치: 상품(재고) 기말잔액 합 309.9억 — 요아럽 60.8억·다온글로비스 15.9억·유비코리아 15.4억·상품권 12.7억. 초기이월에 누적된 매입이 재고로 남아 있는 가결산 상태로 보임(매출원가 결산 미반영). 세무사에 확인 필요. 장기차입금 잔액 35.2억 vs 우리 대출 마스터 34.0억.', None),
    ('7. 2025말 거래처 잔액: 외상매출금 7.64억(420곳) · 외상매입금 1.10억 · 미지급금 0.13억 · 선급금 4.33억 · 선수금 0.87억 — 기준일 기초잔액의 출발점. → 시트 "2025말 거래처 잔액".', None),
    ('', None),
    ('데이터 출처: 사용자 제공 세무사 파일(2025년_(주)다올커머스_총괄원장.xlsx = 거래처별[잔액] 현황), daolERP DB(accounts·transactions·tax_invoices·card_expenses·card_sales 2025), 사용자 제공 2025 ERP 판매내역 파일.', None),
]
for i, (t, fnt) in enumerate(lines, 1):
    c = ws.cell(i, 1, t); c.font = fnt or f(); c.alignment = Alignment(wrap_text=True, vertical='top')
ws.column_dimensions['A'].width = 130
wb.save(OUT + '세무사원장_2025_분석_2026-10-27.xlsx'); print('saved')
