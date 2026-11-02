# 고객관리문서 매출이력 스냅샷 적재 (111_doc_sales_snapshot.sql 적용 후 실행)
#
# 사용법: python3 load_doc_sales_snapshot.py <고객관리문서.xlsx> <sb.env>
#   sb.env: SB_URL=https://... / SB_KEY=sb_secret_... (저장소에 두지 말 것)
#
# 문서의 모든 담당자 행(보류 포함 — 스냅샷은 문서 보존이 목적)을
# doc_sales_snapshot에 넣는다. vendor/contact 연결은 정비된 마스터와
# 이름 기준으로 매칭하고, 실패하면 NULL + 원문 표기로 남긴다.
# 재실행 시 같은 source 행을 지우고 다시 넣는다(멱등).
import sys, json, re, urllib.request, urllib.parse, datetime
from collections import defaultdict
try:
    from openpyxl import load_workbook
except ImportError:
    sys.path.insert(0, '/usr/local/lib/python3.13/site-packages')
    from openpyxl import load_workbook

DOC, ENVF = sys.argv[1], sys.argv[2]
SOURCE = '고객관리문서 2026-11-02'
ENV = dict(l.strip().split('=', 1) for l in open(ENVF) if '=' in l)
URL, KEY = ENV['SB_URL'], ENV['SB_KEY']
HDR = {'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}

def rest(method, path, body=None):
    req = urllib.request.Request(f"{URL}/rest/v1/{path}", method=method,
        data=json.dumps(body).encode() if body is not None else None, headers=HDR)
    with urllib.request.urlopen(req) as r:
        raw = r.read(); return json.loads(raw) if raw else None

def fetch_all(table, select, extra=''):
    out, start = [], 0
    while True:
        h = dict(HDR); h['Range'] = f'{start}-{start+999}'
        req = urllib.request.Request(
            f"{URL}/rest/v1/{table}?select={urllib.parse.quote(select, safe=',()!*')}{extra}&order=id", headers=h)
        with urllib.request.urlopen(req) as r: batch = json.loads(r.read())
        out.extend(batch)
        if len(batch) < 1000: return out
        start += 1000

norm = lambda s: re.sub(r'\s+', '', (s or '')).lower()
def to_date(v):
    if v is None or v == '': return None
    if isinstance(v, datetime.datetime): return v.date().isoformat()
    if isinstance(v, datetime.date): return v.isoformat()
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', str(v))
    return m.group(0) if m else None
def to_int(v):
    try: return int(float(v))
    except (TypeError, ValueError): return 0
def pure_name(raw):
    s = (raw or '').strip().rstrip('님').strip()
    return s.split()[0] if s.split() else ''

vendors = fetch_all('vendors', 'id,name,type,status,match_aliases')
asgs = fetch_all('contact_assignments', 'contact_id,vendor_id,ended_at,contacts(name)')
by_name = defaultdict(list); by_alias = defaultdict(list)
for v in vendors:
    if v.get('status') == 'merged' or v['type'] not in ('customer', 'both'): continue
    by_name[norm(v['name'])].append(v)
    for a in (v.get('match_aliases') or []): by_alias[norm(a)].append(v)
contact_at = defaultdict(dict)   # vendor_id -> name -> contact_id (활성 우선)
for a in asgs:
    nm = ((a.get('contacts') or {}).get('name') or '').strip()
    if not nm: continue
    cur = contact_at[a['vendor_id']]
    if nm not in cur or not a['ended_at']: cur[nm] = a['contact_id']

wb = load_workbook(DOC, read_only=True, data_only=True)
BANKS = ['하나은행', '우리은행', '기업은행', '국민은행', '신한은행', '기타업체']
MONTH_NAMES = [f'{m}월' for m in range(1, 13)]
rows_out = []
for s in BANKS:
    ws = wb[s]; hr = None; cols = {}; m2025 = []; m2026 = []
    for i, row in enumerate(ws.iter_rows(values_only=True), 1):
        vals = list(row)
        svals = [('' if v is None else str(v).strip()) for v in vals]
        if hr is None and '은행명' in svals and '지점명' in svals and '담당자' in svals:
            hr = i
            for j, v in enumerate(svals):
                if v in ('은행명', '지점명', '담당자', '다올 담당', '최초 주문일', '마지막 주문일',
                         '부서 이동', '메모', '매출 합계', '25 설', '25 추석', '26 설', '26 추석',
                         '주문유형') and v not in cols:
                    cols[v] = j
            month_idx = [j for j, v in enumerate(svals) if v in MONTH_NAMES]
            m2025, m2026 = month_idx[:12], month_idx[12:24]
            continue
        if not hr or i <= hr: continue
        g = lambda c: (vals[cols[c]] if c in cols and cols[c] < len(vals) else None)
        gs = lambda c: ('' if g(c) is None else str(g(c)).strip())
        bank, br, mg = gs('은행명'), gs('지점명'), gs('담당자')
        if not (bank or br or mg): continue
        want = f"{bank} {br}".strip() if br else bank
        pool = by_name.get(norm(want)) or by_alias.get(norm(want))
        vid = pool[0]['id'] if pool else None
        cid = contact_at.get(vid, {}).get(pure_name(mg)) if vid else None
        monthly = {}
        for yi, (year, idxs) in enumerate(((2025, m2025), (2026, m2026))):
            for mi, j in enumerate(idxs, 1):
                amt = to_int(vals[j] if j < len(vals) else 0)
                if amt: monthly[f'{year}-{mi:02d}'] = amt
        season = {k.replace(' ', ''): to_int(g(k)) for k in ('25 설', '25 추석', '26 설', '26 추석') if to_int(g(k))}
        rows_out.append({
            'vendor_id': vid, 'contact_id': cid,
            'bank_name': bank or None, 'branch_name': br or None, 'manager_name': mg or None,
            'daol_staff': gs('다올 담당') or None,
            'first_order_date': to_date(g('최초 주문일')), 'last_order_date': to_date(g('마지막 주문일')),
            'move_history': gs('부서 이동') or None, 'memo': gs('메모') or None,
            'order_type': gs('주문유형') or None,
            'total_sales': to_int(g('매출 합계')), 'season': season, 'monthly': monthly,
            'source': SOURCE,
        })

rest('DELETE', f"doc_sales_snapshot?source=eq.{urllib.parse.quote(SOURCE)}")
for i in range(0, len(rows_out), 200):
    rest('POST', 'doc_sales_snapshot', rows_out[i:i+200])
linked_v = sum(1 for r in rows_out if r['vendor_id'])
linked_c = sum(1 for r in rows_out if r['contact_id'])
total = sum(r['total_sales'] for r in rows_out)
print(f"적재 {len(rows_out)}행 / 거래처 연결 {linked_v} / 인물 연결 {linked_c} / 매출 합계 {total:,}원")
