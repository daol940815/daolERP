# ERP 재적재 트랙 — 세무사 '거래처별[잔액] 현황'(2025) 파싱 + 우리 DB 대조 (2026-10-27).
# 사용: set -a && source sb.env && set +a && python3 -I ledger_vendor_balance_2025.py <원장 xlsx> <출력폴더>
# 산출: ledger.json(파싱 결과), 콘솔 요약(계정 체계·거래처 규칙·2025 검산·2026 힌트 증가량)
import sys, os, re, json, collections, urllib.request, urllib.parse
import openpyxl
SRC, OUT = sys.argv[1], sys.argv[2].rstrip('/') + '/'
U = os.environ.get('SB_URL'); K = os.environ.get('SB_KEY')
num = lambda v: float(v or 0)
norm = lambda x: re.sub(r'\s|\(주\)|주식회사|㈜|\(유\)|유한회사|\(사\)|사단법인|\(재\)', '', str(x or ''))

# ── 1) 파싱 ──
wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True); ws = wb.worksheets[0]
rows = []; code = name = None; period = None
for r in ws.iter_rows(values_only=True):
    if r[4] and '~' in str(r[4]) and '년' in str(r[4]): period = str(r[4])
    if r[0] == '코드': continue
    if r[2] is None or not str(r[2]).strip().isdigit(): continue
    if r[0] not in (None, ''): code = str(r[0]).strip(); name = str(r[1] or '').strip()
    rows.append({'vcode': code, 'vendor': name, 'acode': str(r[2]).strip(), 'aname': str(r[3] or '').strip(),
                 'open': num(r[4]), 'debit': num(r[5]), 'credit': num(r[6]), 'bal': num(r[7])})
vendors = collections.OrderedDict()
for x in rows: vendors.setdefault((x['vcode'], x['vendor']), []).append(x)
print('기간', period, '| 행', len(rows), '| 거래처', len(vendors))
accs = collections.defaultdict(lambda: {'n': 0, 'debit': 0.0, 'credit': 0.0, 'open': 0.0, 'bal': 0.0, 'vendors': 0})
for x in rows:
    a = accs[(x['acode'], x['aname'])]; a['n'] += 1; a['debit'] += x['debit']; a['credit'] += x['credit']; a['open'] += x['open']; a['bal'] += x['bal']; a['vendors'] += 1
print('\n세무사 계정 체계 (코드 · 계정명 · 거래처 수 · 차변 · 대변 · 기말잔액 합, 백만 원)')
for (c, n), a in sorted(accs.items()):
    print(f"  {c} {n:12s} {a['vendors']:4d}  {a['debit']/1e6:10.1f} {a['credit']/1e6:10.1f} {a['bal']/1e6:10.1f}")
cnt_per_vendor = collections.Counter(len(v) for v in vendors.values())
print('\n거래처당 계정 수 분포', sorted(cnt_per_vendor.items()))

# ── 2) 거래처 → 손익 계정 규칙 (손익 계정만: 4xxxx 매출, 45~46xxx 원가, 8xxxx 판관비, 9xxxx 영업외) ──
def pl_kind(acode):
    c = int(acode)
    if 40000 <= c < 45000: return '매출'
    if 45000 <= c < 50000: return '매출원가'
    if 80000 <= c < 90000: return '판관비'
    if 90000 <= c < 100000: return '영업외'
    return None
rules = {}
for (vc, vn), lst in vendors.items():
    pl = [x for x in lst if pl_kind(x['acode'])]
    if not pl: continue
    pl.sort(key=lambda x: -(x['debit'] + x['credit']))
    rules[vn] = {'vcode': vc, 'accounts': [(x['acode'], x['aname'], round(x['debit'] + x['credit'])) for x in pl]}
multi = sum(1 for r in rules.values() if len(r['accounts']) > 1)
print(f'\n손익 계정이 있는 거래처 {len(rules)} (계정 2개 이상 {multi})')
json.dump({'period': period, 'rows': rows, 'rules': rules}, open(OUT + 'ledger.json', 'w'), ensure_ascii=False)

if not U: sys.exit(0)
# ── 3) DB 대조 ──
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
our_acc = {a['id']: a for a in fetch_all('accounts?select=id,code,name,type')}
our_names = {a['name']: a['code'] for a in our_acc.values()}
print('\n세무사 계정명 → 우리 계정 매핑 (이름 기준)')
missing = []
for (c, n), a in sorted(accs.items()):
    hit = our_names.get(n) or our_names.get(n.replace('지급', '')) or our_names.get(n.replace('비', '비'))
    if not hit: missing.append((c, n, round(a['debit'] / 1e6, 1), round(a['credit'] / 1e6, 1)))
print('  우리 계정에 없는 세무사 계정:', missing)

# 2025 우리 분류 vs 세무사 (거래처명 기준) — 통장·카드·계산서 확정 계정
tx25 = fetch_all('transactions?select=counterparty_name,amount_in,amount_out,confirmed_account_id,transfer_pair_id&tx_date=gte.2025-01-01&tx_date=lte.2025-12-31')
ti25 = fetch_all('tax_invoices?select=counterparty_name,direction,supply_amount,confirmed_account_id&issue_date=gte.2025-01-01&issue_date=lte.2025-12-31')
ce25 = fetch_all('card_expenses?select=merchant_name,approved_amount,cancel_amount,confirmed_account_id&tx_date=gte.2025-01-01&tx_date=lte.2025-12-31')
rule_by_norm = {norm(k): v for k, v in rules.items()}
def lookup(name):
    n = norm(name)
    if not n: return None
    if n in rule_by_norm: return rule_by_norm[n]
    if len(n) >= 3:
        for k, v in rule_by_norm.items():
            if len(k) >= 3 and (n in k or k in n): return v
    return None
agree = disagree = nomatch = 0; dis = collections.Counter()
for t in ti25:
    if t['direction'] == 'sales' or not t['confirmed_account_id']: continue
    r = lookup(t['counterparty_name'])
    if not r: nomatch += 1; continue
    ours = our_acc[t['confirmed_account_id']]['name']; theirs = r['accounts'][0][1]
    if ours == theirs or (ours == '상품매입' and theirs in ('상품', '상품매입', '매입')): agree += 1
    else: disagree += 1; dis[(ours, theirs)] += 1
print(f'\n2025 매입 계산서 확정 계정 vs 세무사 거래처 주계정: 일치 {agree} · 불일치 {disagree} · 세무사 원장에 거래처 없음 {nomatch}')
print('  불일치 상위', dis.most_common(12))
agree = disagree = nomatch = 0; dis = collections.Counter()
for t in tx25:
    if t['transfer_pair_id'] or not t['confirmed_account_id'] or not num(t['amount_out']): continue
    a = our_acc[t['confirmed_account_id']]
    if a['type'] != 'expense': continue
    r = lookup(t['counterparty_name'])
    if not r: nomatch += 1; continue
    theirs = r['accounts'][0][1]
    if a['name'] == theirs: agree += 1
    else: disagree += 1; dis[(a['name'], theirs)] += 1
print(f'2025 통장 비용 확정 vs 세무사: 일치 {agree} · 불일치 {disagree} · 거래처 없음 {nomatch}')
print('  불일치 상위', dis.most_common(12))

# 2026 미확정 통장에 세무사 규칙 적용 시 힌트 증가
matched = set(p['transaction_id'] for p in fetch_all('tax_invoice_payments?select=transaction_id')) | set(t['matched_transaction_id'] for t in fetch_all('tax_invoices?select=matched_transaction_id&matched_transaction_id=not.is.null') if t['matched_transaction_id'])
tx26 = fetch_all('transactions?select=id,counterparty_name,amount_in,amount_out,confirmed_account_id,transfer_pair_id,suggested_account_id&tx_date=gte.2026-01-01&tx_date=lte.2026-09-30')
unc = [t for t in tx26 if not t['confirmed_account_id'] and not t['transfer_pair_id'] and t['id'] not in matched]
hit = [t for t in unc if lookup(t['counterparty_name'])]
kinds = collections.Counter(pl_kind(lookup(t['counterparty_name'])['accounts'][0][0]) for t in hit)
print(f'\n2026 미확정 통장(이체·매칭 제외) {len(unc)}건 중 세무사 원장 거래처와 이름이 맞는 건 {len(hit)}건 — 주계정 종류 {dict(kinds)}')
nosug = [t for t in hit if not t['suggested_account_id']]
print(f'  그중 시스템 추천도 없던 건 {len(nosug)}건 (새로 힌트가 생기는 양)')

# 2025 검산: 세무사 상품매출 vs 우리 2025 매출 계산서+카드+현금영수증
sales_ledger = sum(a['credit'] - a['debit'] for (c, n), a in accs.items() if pl_kind(c) == '매출')
inv25 = sum(num(t['supply_amount']) for t in ti25 if t['direction'] == 'sales')
cs25 = fetch_all('card_sales?select=amount,supply_amount,tax_amount,transaction_type,cancelled_at&tx_date=gte.2025-01-01&tx_date=lte.2025-12-31')
card25 = sum((-1 if c['transaction_type'] == 'cancel' else 1) * (num(c['supply_amount']) if num(c['tax_amount']) > 0 else num(c['amount'])) for c in cs25 if not (c['cancelled_at'] and c['transaction_type'] != 'cancel'))
print(f'\n2025 검산 — 세무사 매출(4xxxx 순액) {sales_ledger/1e6:.1f}백만 vs 우리 2025 매출 계산서 공급가 {inv25/1e6:.1f} + 카드 매출 공급가 {card25/1e6:.1f} = {(inv25+card25)/1e6:.1f}백만')
exp_ledger = {n: a['debit'] - a['credit'] for (c, n), a in accs.items() if pl_kind(c) in ('판관비', '영업외')}
ours25 = collections.Counter()
for t in tx25:
    if t['transfer_pair_id'] or not t['confirmed_account_id']: continue
    a = our_acc[t['confirmed_account_id']]
    if a['type'] == 'expense': ours25[a['name']] += num(t['amount_out']) - num(t['amount_in'])
for c in ce25:
    if c['confirmed_account_id']: a = our_acc[c['confirmed_account_id']]; ours25[a['name']] += num(c['approved_amount']) - num(c['cancel_amount'])
for t in ti25:
    if t['direction'] != 'sales' and t['confirmed_account_id']: a = our_acc[t['confirmed_account_id']]; ours25[a['name']] += num(t['supply_amount'])
print('\n2025 판관비 검산 (세무사 vs 우리 확정 분류 합계, 백만 원 — 우리 쪽은 통장+카드+계산서 단순 합, 이중 포함 가능)')
for n, v in sorted(exp_ledger.items(), key=lambda x: -x[1])[:20]:
    print(f"  {n:12s} 세무사 {v/1e6:9.1f}  우리 {ours25.get(n, 0)/1e6:9.1f}")
