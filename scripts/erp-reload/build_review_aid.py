# ERP 재적재 트랙 — 1차 검수 보조 엑셀 생성 (2026-10-21, 재적재 세션). docs/erp-reload-track.md 참고.
# 목적: 매출처(은행+지점)·고객(담당자) 표기 오타를 정리해 매출처별 고객 주문·구분 금액·다올 담당·부서 이동을 확인할 수 있게 한다.
# 사용: python3 -I build_review_aid.py <업로드폴더> <출력폴더> [직원명단.txt]
#   업로드폴더: 2025 ERP·2026 ERP(판매내역 양식 27열)·고객관리문서 xlsx (파일명은 FILES_ERP / FILE_DOC 수정)
#   직원명단.txt(선택): 한 줄에 직원 이름 하나. 없으면 문서 다올 담당 + ERP 작성자(20행 이상) + 기본 명단으로 대체.
#   결과: <출력폴더>/ERP_검수보조_v2_<날짜>.xlsx
# 원칙: 시스템은 추천만, 확정은 검수자가 '기입' 열에. 부서 이동이면 옛 지점명은 고치지 않는다(주문 당시 지점이 맞음).
import sys, os, re, json, datetime, collections, difflib
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

FILES_ERP = ['90bf59d2-2025_ERP_____.xlsx', '6940fb55-2026_ERP_____.xlsx']
FILE_DOC = '7dc0eb83-2026___________25_.xlsx'
BASE_STAFF = ['홍창의', '옥광일', '김재형', '김보현', '김승현', '강시현', '조현수', '오철준', '김주연', '한정호']

UP = sys.argv[1].rstrip('/') + '/'
OUT = sys.argv[2].rstrip('/') + '/'
STAFF_FILE = sys.argv[3] if len(sys.argv) > 3 else None
C = collections.Counter
def s(v): return '' if v is None else str(v).strip()
def ratio(a, b):
    m = difflib.SequenceMatcher(None, a, b)
    return m.ratio() if m.real_quick_ratio() >= 0.7 and m.quick_ratio() >= 0.7 else 0.0
def nz(x): return re.sub(r'[\s`\'"]', '', x).replace('(주)', '').replace('주식회사', '').lower()

# ── 고객관리문서 ──
doc = []
wb = openpyxl.load_workbook(UP + FILE_DOC, read_only=True, data_only=True)
for ws in wb.worksheets:
    if ws.title == '집계': continue
    started = False
    for r in ws.iter_rows(values_only=True):
        rr = [s(c) for c in r]
        if not started:
            if rr[1] == '은행명' and rr[2] == '지점명': started = True
            continue
        if not rr[1] and not rr[2] and not rr[3]: continue
        hist = []
        for part in rr[8].split('→'):                       # 날짜 없는 이력("브라보사업단→원사업단")도 포함
            part = part.strip()
            if not part: continue
            m = re.fullmatch(r'(.*?)\s*\((\d{4}-\d{2}-\d{2})\)', part)
            h, dt = (m.group(1).strip(), m.group(2)) if m else (part, '')
            if rr[1] and h.startswith(rr[1]): h = h[len(rr[1]):].strip()   # 기타업체 시트는 이력에 거래처명이 접두로 붙음
            if h: hist.append((h, dt))
        doc.append({'sheet': ws.title, 'bank': rr[1], 'branch': rr[2], 'mgr': rr[3], 'daol': rr[4], 'prev': rr[5],
                    'first': rr[6][:10], 'last': rr[7][:10], 'move': rr[8], 'memo': rr[9], 'hist': hist})
doc_banks = set(d['bank'] for d in doc)
doc_nb = collections.defaultdict(set)
for b in doc_banks: doc_nb[nz(b)].add(b)
doc_keys = {(d['bank'], d['branch'], d['mgr']): d for d in doc}
doc_bb = set((d['bank'], d['branch']) for d in doc)
doc_hist_bb = set((d['bank'], h) for d in doc for h, _ in d['hist'])
doc_branches_by_bank = collections.defaultdict(set)
for d in doc: doc_branches_by_bank[d['bank']].add(d['branch'])
doc_mgr_rows = collections.defaultdict(list)          # (bank, mgr) -> rows
for d in doc: doc_mgr_rows[(d['bank'], d['mgr'])].append(d)
doc_mgrs_by_bank = collections.defaultdict(set)
for d in doc: doc_mgrs_by_bank[d['bank']].add(d['mgr'])
doc_rows_by_name = collections.defaultdict(list)
for d in doc: doc_rows_by_name[d['mgr']].append(d)
def mgr_hist_branches(bank, mgr):
    out = set()
    for d in doc_mgr_rows.get((bank, mgr), []):
        out.add(d['branch']); out.update(h for h, _ in d['hist'])
    return out

# ── ERP ──
erp = []
for fn in FILES_ERP:
    wb = openpyxl.load_workbook(UP + fn, read_only=True, data_only=True)
    for ws in wb.worksheets:
        rows = ws.iter_rows(values_only=True); next(rows)
        for r in rows:
            if all(c is None for c in r): continue
            erp.append({'bank': s(r[4]), 'branch': s(r[5]), 'mgr': s(r[6]), 'kind': s(r[11]), 'amt': r[16] if isinstance(r[16], (int, float)) else 0,
                        'ch': s(r[21]), 'writer': s(r[22]), 'gubun': s(r[23]), 'cancel': s(r[0]) == 'cancel',
                        'ymd': f"{s(r[1])}-{s(r[2]).zfill(2)}-{s(r[3]).zfill(2)}", 'sheet': ws.title})
print('ERP rows', len(erp), 'DOC rows', len(doc))

# ── 직원 명단 ──
staff = set(BASE_STAFF) | set(d['daol'] for d in doc if d['daol'])
if STAFF_FILE and os.path.exists(STAFF_FILE):
    staff |= set(l.strip() for l in open(STAFF_FILE, encoding='utf-8') if l.strip()); staff_src = '직원명단 파일'
else:
    wc = C(d['writer'] for d in erp if d['writer'])
    staff |= set(w for w, n in wc.items() if n >= 20 and re.fullmatch(r'[가-힣]{2,4}', w)); staff_src = '문서 다올 담당 + ERP 작성자(20행 이상) + 기본 명단(DB 미대조)'

# ═══ 1. 은행명 ═══
bank_rows = C(d['bank'] for d in erp)
bank_combos = collections.defaultdict(set)
for d in erp: bank_combos[d['bank']].add((d['branch'], d['mgr']))
bank_fix = {}; bank_tbl = []
erp_banks_sorted = sorted(bank_rows, key=lambda b: -bank_rows[b])
for b in erp_banks_sorted:
    rec, why, grade = b, '', ''
    if b in doc_banks:
        grade = '일치'; why = '문서와 동일'
    elif not b:
        grade = '은행 없음'; why = '빈 값'
    else:
        n = nz(b); cands = {n, re.sub(r'^(kb|nh)', '', n), 'kb' + n, 'nh' + n}
        hit = [x for c in cands for x in doc_nb.get(c, [])]
        if hit:
            rec = sorted(hit, key=lambda x: -sum(1 for d in doc if d['bank'] == x))[0]; grade = '정규화 일치'; why = f'띄어쓰기·접두·(주) 차이 → 문서 표기 "{rec}"'
        else:
            best = max(((ratio(nz(b), nz(x)), x) for x in doc_banks), default=(0, ''))
            if best[0] >= 0.8:
                rec = best[1]; grade = '유사(문서)'; why = f'문서 "{best[1]}" 유사도 {best[0]:.2f}'
            else:
                best2 = max(((ratio(nz(b), nz(x)), x) for x in erp_banks_sorted if x != b and bank_rows[x] > bank_rows[b]), default=(0, ''))
                if best2[0] >= 0.85:
                    rec = bank_fix.get(best2[1], best2[1]); grade = '유사(ERP 다빈도)'; why = f'ERP "{best2[1]}"({bank_rows[best2[1]]}행) 유사도 {best2[0]:.2f}'
                else:
                    grade = '문서 없음'; why = '문서에 없는 거래처 — 매출처명 확인'
    bank_fix[b] = rec
    bank_tbl.append([b, bank_rows[b], len(bank_combos[b]), grade, rec if rec != b else '', why, ''])
print('은행명', C(r[3] for r in bank_tbl))

# ═══ 2. 지점명 (은행 정정 후) ═══
bb_rows = C(); bb_mgrs = collections.defaultdict(C); bb_orig = collections.defaultdict(set)
for d in erp:
    k = (bank_fix[d['bank']], d['branch']); bb_rows[k] += 1; bb_mgrs[k][d['mgr']] += 1; bb_orig[k].add(d['bank'])
erp_branches_by_bank = collections.defaultdict(set)
for (b, br) in bb_rows: erp_branches_by_bank[b].add(br)
branch_fix = {}; branch_tbl = []
for k in sorted(bb_rows, key=lambda k: (k[0], -bb_rows[k])):
    b, br = k; rec, grade, why = br, '', ''
    in_doc_bank = b in doc_banks
    if k in doc_bb:
        grade = '일치'; why = '문서와 동일'
    elif br and sum(n for m, n in bb_mgrs[k].items() if br in set(h for d in doc_mgr_rows.get((b, m), []) for h, _ in d['hist'])) * 2 >= bb_rows[k]:
        grade = '옛 지점(이력)'; why = '이 지점 담당자 본인의 문서 부서 이동 이력에 있는 지점 — 정상, 고치지 않음'
    elif not in_doc_bank:
        grade = '문서 없음'; why = '은행(거래처) 자체가 문서에 없음'
    elif not br:
        # 빈 지점 → 담당자 기준 문서 지점 추천
        cand = C()
        for m, n in bb_mgrs[k].items():
            for d in doc_mgr_rows.get((b, m), []): cand[d['branch']] += n
        if cand and len(cand) == 1 and list(cand)[0]:
            rec = list(cand)[0]; grade = '지점 없음→담당자 기준'; why = f'담당자 {sum(bb_mgrs[k].values())}행 중 {cand[rec]}행이 문서 "{rec}" 소속'
        elif cand:
            grade = '지점 없음(담당자 분산)'; why = '담당자들이 문서에서 여러 지점: ' + ', '.join(f'{x or "(빈)"} {n}' for x, n in cand.most_common(4))
        else:
            grade = '지점 없음'; why = '담당자도 문서에 없음'
    else:
        same = [x for x in doc_branches_by_bank[b] if x and nz(x) == nz(br)]
        hist_br = C()                                       # 이 지점 담당자들의 문서 이력 지점
        for m, n in bb_mgrs[k].items():
            for d in doc_mgr_rows.get((b, m), []):
                for h, _ in d['hist']: hist_br[h] += n
        besth = max(((ratio(nz(br), nz(x)), x) for x in hist_br if x), default=(0, ''))
        best = max(((ratio(nz(br), nz(x)), x) for x in doc_branches_by_bank[b] if x), default=(0, ''))
        best2 = max(((ratio(nz(br), nz(x)), x) for x in erp_branches_by_bank[b] if x and x != br and bb_rows[(b, x)] > bb_rows[k]), default=(0, ''))
        cand = C()
        for m, n in bb_mgrs[k].items():
            for d in doc_mgr_rows.get((b, m), []): cand[d['branch']] += n
        if same:
            rec = same[0]; grade = '정규화 일치'; why = f'띄어쓰기 차이 → 문서 "{rec}"'
        elif besth[0] >= 0.8:
            rec = besth[1]; grade = '유사(담당자 이력)'; why = f'담당자 본인 이력의 옛 지점 "{besth[1]}" 유사도 {besth[0]:.2f} — 옛 지점 표기로 통일(이동 아님, 오타)'
            if best[0] >= 0.8 and nz(best[1]) != nz(besth[1]): why += f' / 문서 현재 지점 "{best[1]}"와도 유사 — 문서 내 표기 불일치 가능, 문서 쪽 확인'
        elif best[0] >= 0.8:
            rec = best[1]; grade = '유사(문서)'; why = f'문서 "{best[1]}" 유사도 {best[0]:.2f}'
        elif best2[0] >= 0.85:
            rec = branch_fix.get((b, best2[1]), best2[1]); grade = '유사(ERP 다빈도)'; why = f'ERP "{best2[1]}"({bb_rows[(b, best2[1])]}행) 유사도 {best2[0]:.2f}'
        elif cand:
            top, tn = cand.most_common(1)[0]; r0 = ratio(nz(br), nz(top)) if top else 0
            if r0 >= 0.6:
                rec = top; grade = '유사(담당자+문서)'; why = f'담당자 {tn}행이 문서 "{top}" 소속, 유사도 {r0:.2f}'
            else:
                grade = '판정 필요(담당자는 문서 다른 지점)'; why = f'담당자 {tn}행/{bb_rows[k]}행이 문서 "{top or "(빈)"}" 소속이나 표기가 다름 — 이동(이력 누락) 또는 오타'
                rec = top if top and tn * 2 >= bb_rows[k] else br
        else:
            grade = '확인 필요'; why = '문서·ERP 어디에도 유사 지점 없음 — 신규 지점 또는 오타'
    branch_fix[k] = rec
    branch_tbl.append([b, br, bb_rows[k], len(bb_mgrs[k]), ', '.join(sorted(x for x in bb_orig[k] if x != b)), grade, rec if rec != br else '', why, ''])
print('지점명', C(r[5] for r in branch_tbl))

# ═══ 3. 담당자명 (은행·지점 정정 후) ═══
def split_name(m):
    t = m.replace('님', '').split()
    return (t[0], ' '.join(t[1:])) if t else ('', '')
cb_rows = C(); cb = collections.defaultdict(lambda: {'n': 0, 'amt': 0, 'first': '9', 'last': '0', 'ch': C(), 'gubun': C(), 'kind': C(), 'orig': set()})
for d in erp:
    b = bank_fix[d['bank']]; br = branch_fix[(b, d['branch'])]; k = (b, br, d['mgr'])
    c = cb[k]; c['n'] += 1; c['first'] = min(c['first'], d['ymd']); c['last'] = max(c['last'], d['ymd']); c['ch'][d['ch']] += 1
    c['kind'][d['kind']] += 1; c['orig'].add((d['bank'], d['branch']))
    if not d['cancel']: c['amt'] += d['amt']; c['gubun'][d['gubun']] += d['amt']
erp_mgrs_by_bb = collections.defaultdict(C)
for (b, br, m), c in cb.items(): erp_mgrs_by_bb[(b, br)][m] += c['n']
mgr_fix = {}; mgr_tbl = []
for k in sorted(cb, key=lambda k: (k[0], k[1], -cb[k]['n'])):
    b, br, m = k; rec, grade, why = m, '', ''
    in_doc_bank = b in doc_banks
    if k in doc_keys:
        grade = '일치'; why = '문서와 동일'
    elif not m:
        grade = '담당자 없음'; why = '빈 값'
    elif m in doc_mgrs_by_bank.get(b, set()) and br in mgr_hist_branches(b, m):
        grade = '옛 지점의 고객(이력)'; why = '문서 부서 이동 이력상 이 지점에 있던 고객 — 정상'
    elif not m.endswith('님') and (b, br, m + '님') in doc_keys:
        rec = m + '님'; grade = "'님' 누락"; why = '존칭만 보충하면 문서와 일치'
    elif not m.endswith('님') and (b, br, m + ' 님') in doc_keys:
        rec = m + ' 님'; grade = "'님' 누락"; why = '존칭만 보충하면 문서와 일치'
    elif m in doc_mgrs_by_bank.get(b, set()):
        rows = doc_mgr_rows[(b, m)]
        grade = '같은 은행·다른 지점(문서)'; why = '문서 지점: ' + ', '.join(f'{d["branch"] or "(빈)"}' for d in rows) + ' — 이력 미기재 이동 또는 동명이인 (4번 시트)'
    elif not in_doc_bank:
        grade = '문서 없음'; why = '은행(거래처)이 문서에 없음'
    else:
        nm, ti = split_name(m)
        # 같은 지점 문서 담당자 중 이름 같고 직함 다른 경우
        same_name = [d for d in doc if d['bank'] == b and d['branch'] == br and split_name(d['mgr'])[0] == nm and nm]
        if same_name:
            rec = same_name[0]['mgr']; grade = '직함 상이(승진 가능)'; why = f'문서 "{rec}" — 이름 동일, 직함만 다름 (동일인이면 문서 표기로 통일)'
        else:
            same_name_bank = [d for d in doc if d['bank'] == b and split_name(d['mgr'])[0] == nm and nm and len(nm) >= 2]
            best = max(((ratio(m, x), x) for x in doc_mgrs_by_bank[b]), default=(0, ''))
            sp = [x for x in doc_mgrs_by_bank[b] if nz(x) == nz(m)]
            if sp:
                dr = doc_mgr_rows[(b, sp[0])]
                rec = sp[0]; grade = '띄어쓰기 차이(문서)'; why = f'문서 "{sp[0]}"({", ".join(d["branch"] or "(빈)" for d in dr)}) — 띄어쓰기만 다름. 문서 표기가 어색하면 문서 쪽을 고칠 것'
            elif best[0] >= 0.8:
                dr = doc_mgr_rows[(b, best[1])]
                rec = best[1]; grade = '유사(문서)'; why = f'문서 "{best[1]}"({", ".join(d["branch"] or "(빈)" for d in dr)}) 유사도 {best[0]:.2f}'
            elif same_name_bank:
                grade = '동명·직함 상이(다른 지점)'; why = '문서 ' + ', '.join(f'{d["branch"] or "(빈)"} {d["mgr"]}' for d in same_name_bank[:3]) + ' — 이동+승진 또는 동명이인'
                rec = same_name_bank[0]['mgr'] if len(same_name_bank) == 1 else m
            else:
                best2 = max(((ratio(m, x), x) for x in erp_mgrs_by_bb[(b, br)] if x and x != m and erp_mgrs_by_bb[(b, br)][x] > cb[k]['n']), default=(0, ''))
                if best2[0] >= 0.8:
                    rec = mgr_fix.get((b, br, best2[1]), best2[1]); grade = '유사(ERP 다빈도)'; why = f'같은 지점 ERP "{best2[1]}"({erp_mgrs_by_bb[(b, br)][best2[1]]}행) 유사도 {best2[0]:.2f}'
                elif not m.endswith('님'):
                    rec = m + '님' if ' ' in m else m + ' 님'; grade = "문서 없음·'님' 누락"; why = '문서에 없는 고객 — 존칭 보충만 추천'
                else:
                    grade = '문서 없음(신규 고객)'; why = f'문서(2026-08-27 기준) 이후 신규 또는 누락 — 첫 주문 {cb[k]["first"]}'
    mgr_fix[k] = rec
    dk = doc_keys.get((b, br, rec)) or doc_keys.get(k)
    mgr_tbl.append([b, br, m, cb[k]['n'], cb[k]['first'], cb[k]['last'], grade, rec if rec != m else '', why, dk['daol'] if dk else '', ''])
print('담당자', C(r[6] for r in mgr_tbl))

# ═══ 4. 동명이인 · 부서 이동 (정정 적용 후 최종 조합) ═══
fin = collections.defaultdict(lambda: {'n': 0, 'first': '9', 'last': '0', 'orig': set()})
for (b, br, m), c in cb.items():
    mf = mgr_fix[(b, br, m)]; f = fin[(b, br, mf)]
    f['n'] += c['n']; f['first'] = min(f['first'], c['first']); f['last'] = max(f['last'], c['last']); f['orig'].add(m)
by_name = collections.defaultdict(list)
for (b, br, m), f in fin.items():
    if m: by_name[m].append((b, br, f))
move_tbl = []; move_cat = C()
for m in sorted(by_name, key=lambda m: -sum(f['n'] for _, _, f in by_name[m])):
    places = by_name[m]
    if len(places) < 2: continue
    rows = doc_rows_by_name.get(m, [])
    banks = set(b for b, _, _ in places)
    if not rows: cat = '문서에 없음 — 판정 필요'
    elif len(rows) == 1:
        d = rows[0]; h = set(x for x, _ in d['hist']) | {d['branch']}
        if all(b == d['bank'] and br in h for b, br, _ in places): cat = '부서 이동(문서 이력으로 전부 설명)'
        elif all(b == d['bank'] for b, br, _ in places): cat = '같은 은행·이력 밖 지점 있음 — 이동(이력 누락) 또는 지점명 오타'
        else: cat = '은행이 다름 — 동명이인 가능(문서 1행)'
    else:
        if len(set(d['bank'] for d in rows)) > 1: cat = '문서에 같은 이름 여러 은행 — 동명이인으로 취급 중'
        else: cat = '문서에 같은 이름 여러 지점(같은 은행) — 동명이인 또는 미정리'
    move_cat[cat] += 1
    hist_txt = ' / '.join(f'{d["bank"]}|{d["branch"] or "(빈)"} [{d["move"]}] 다올 {d["daol"]}' for d in rows) if rows else ''
    first = True
    for b, br, f in sorted(places, key=lambda p: p[2]['first']):
        d1 = doc_keys.get((b, br, m))
        in_hist = any(b == d['bank'] and (br == d['branch'] or br in set(x for x, _ in d['hist'])) for d in rows)
        if d1: rec = '현재 지점(문서)'
        elif in_hist: rec = '옛 지점(이력) — 지점명 유지'
        else: rec = '판정 필요'
        move_tbl.append([m, cat if first else '', len(places) if first else '', b, br or '(빈)', f['n'], f['first'], f['last'],
                         ', '.join(sorted(x for x in f['orig'] if x != m)), rec, hist_txt if first else '', ''])
        first = False
print('동명이인·이동', dict(move_cat))

# ═══ 5. 구분 정규화 ═══
def norm_gubun(g):
    x = g.strip(); xl = x.lower().replace(' ', '')
    if not xl: return '', ''
    if xl in ('상시', 'tkdtl', '상시시', '성시', 'ㅌ상시', '상', '25상시', '26상시'): return '상시', '상시 변형'
    if xl in ('vip',): return 'VIP', '대소문자'
    if xl in ('샘플', '샘', '샘픔'): return '샘플', '샘플 변형'
    if xl == '선결제': return '선결제', ''
    if xl == '매입': return '매입', ''
    m = re.fullmatch(r'(\d{2})(설|섧|살|tjf)', xl)
    if m and m.group(1) in ('25', '26'): return f'{m.group(1)}설', '설 변형'
    m = re.fullmatch(r'(\d{2})(추석|츠삭|추서|추)(개별)?', xl)
    if m and m.group(1) in ('25', '26'): return f'{m.group(1)}추석', '추석 변형'
    if xl in ('25추설',): return '25추석', '추석 변형(추설)'
    return '', ''
gub_rows = C(); gub_amt = C(); gub_years = collections.defaultdict(C)
for d in erp:
    gub_rows[d['gubun']] += 1; gub_years[d['gubun']][d['ymd'][:4]] += 1
    if not d['cancel']: gub_amt[d['gubun']] += d['amt']
gub_tbl = []
for g in sorted(gub_rows, key=lambda g: -gub_rows[g]):
    rec, why = norm_gubun(g)
    if g and rec == g: grade, rec = '정규값', ''
    elif rec: grade = '정규화'
    elif g in ('명절', '26명절', '추석', '95추석', '15설') or re.fullmatch(r'\d{2}(설|추석)', g):
        grade = '명절 미상(연도·명절 확인)'; why = '행 날짜로 명절 판정 가능: ' + ', '.join(f'{y} {n}' for y, n in gub_years[g].most_common())
    elif not g: grade = '빈 값'; why = ''
    else: grade = '잡값(사람 판정)'; why = '직원명·유형값·숫자 등 열 착오 가능'
    gub_tbl.append([g, gub_rows[g], gub_amt[g], grade, rec, why, ''])
print('구분', C(r[3] for r in gub_tbl))

# ═══ 6. 채널 · 다올 담당 ═══
ch_rows = C(d['ch'] for d in erp)
ch_tbl = []
for v in sorted(ch_rows, key=lambda v: -ch_rows[v]):
    rec, grade, why = '', '', ''
    if v in staff: grade = '직원명 일치'
    elif not v: grade = '빈 값'
    else:
        best = max(((ratio(v, x), x) for x in staff), default=(0, ''))
        if best[0] >= 0.66 and re.fullmatch(r'[가-힣ㄱ-ㅎㅏ-ㅣ]{2,5}', v): rec = best[1]; grade = '오타 추정'; why = f'"{best[1]}" 유사도 {best[0]:.2f}'
        elif re.fullmatch(r'[가-힣]{2,4}', v): grade = '직원 명단에 없는 이름'; why = '퇴사자 또는 명단 미포함 — 직원 명단 확인'
        else: grade = '잡값(채널 아님)'; why = '매출 경로명·날짜·숫자 등'
    ch_tbl.append([v, ch_rows[v], grade, rec, why, ''])
# 조합별 채널≠다올 담당
chd_tbl = []
pat = C()
for (b, br, m), c in cb.items():
    mf = mgr_fix[(b, br, m)]; d = doc_keys.get((b, br, mf))
    if not d: continue
    for ch, n in c['ch'].items():
        if ch != d['daol']: pat[(ch, d['daol'], d['prev'])] += n
for (ch, daol, prev), n in pat.most_common():
    chd_tbl.append([ch, daol, prev, n, '예전 담당 교체' if prev and prev == ch else ('응대자(채널)와 담당 영업이 다름' if ch in staff else '채널 값이 직원명 아님'), ''])
print('채널', C(r[2] for r in ch_tbl), '채널≠다올 패턴', len(chd_tbl))

# ═══ 7. 문서 없는 거래처 ═══
nodoc_tbl = []
agg = collections.defaultdict(lambda: {'n': 0, 'amt': 0, 'mgrs': set(), 'branches': set(), 'ch': C(), 'kind': C(), 'first': '9', 'last': '0', 'gub': C()})
for d in erp:
    b = bank_fix[d['bank']]
    if b in doc_banks or not b: continue
    a = agg[b]; a['n'] += 1; a['mgrs'].add(d['mgr']); a['branches'].add(d['branch']); a['ch'][d['ch']] += 1; a['kind'][d['kind']] += 1
    a['first'] = min(a['first'], d['ymd']); a['last'] = max(a['last'], d['ymd'])
    if not d['cancel']: a['amt'] += d['amt']; a['gub'][norm_gubun(d['gubun'])[0] or d['gubun']] += d['amt']
for b, a in sorted(agg.items(), key=lambda x: -x[1]['n']):
    nodoc_tbl.append([b, a['n'], a['amt'], len(a['branches'] - {''}), len(a['mgrs'] - {''}), a['first'], a['last'],
                      ', '.join(f'{k} {n}' for k, n in a['ch'].most_common(3)), ', '.join(f'{k} {n}' for k, n in a['kind'].most_common()),
                      ', '.join(f'{k} {v:,}' for k, v in a['gub'].most_common(4)), '', ''])

# ═══ 0. 조합 대조표 (원 조합 2,370 → 추천 표기) ═══
master = []
orig_combo = collections.defaultdict(lambda: {'n': 0, 'amt': 0, 'first': '9', 'last': '0', 'ch': C(), 'gub': C(), 'kind': C()})
for d in erp:
    k = (d['bank'], d['branch'], d['mgr']); c = orig_combo[k]; c['n'] += 1; c['first'] = min(c['first'], d['ymd']); c['last'] = max(c['last'], d['ymd'])
    c['ch'][d['ch']] += 1; c['kind'][d['kind']] += 1
    if not d['cancel']: c['amt'] += d['amt']; c['gub'][norm_gubun(d['gubun'])[0] or d['gubun']] += d['amt']
GUB_COLS = ['상시', '25설', '25추석', '26설', '26추석', 'VIP', '선결제', '샘플']
for (b0, br0, m0), c in sorted(orig_combo.items(), key=lambda x: (bank_fix[x[0][0]], branch_fix[(bank_fix[x[0][0]], x[0][1])], -x[1]['n'])):
    b = bank_fix[b0]; br = branch_fix[(b, br0)]; m = mgr_fix[(b, br, m0)]
    d = doc_keys.get((b, br, m))
    changed = [x for x, y, z in (('은행', b0, b), ('지점', br0, br), ('담당자', m0, m)) if y != z]
    if d and not changed: grade = '문서 일치'
    elif d: grade = '정정 후 문서 일치'
    elif b in doc_banks and m in doc_mgrs_by_bank.get(b, set()) and br in mgr_hist_branches(b, m): grade = '옛 지점의 고객(이력) — 정상'
    elif b not in doc_banks: grade = '문서 없는 거래처'
    elif not m: grade = '담당자 없음'
    else: grade = '문서 미일치(판정 필요)'
    master.append([b0, br0, m0, c['n'], c['amt'], c['first'], c['last'], grade, '·'.join(changed),
                   b if b != b0 else '', br if br != br0 else '', m if m != m0 else '',
                   d['daol'] if d else '', d['prev'] if d else '', d['move'] if d else '',
                   ', '.join(f'{k} {n}' for k, n in c['ch'].most_common(3)), ', '.join(f'{k} {n}' for k, n in c['kind'].most_common()),
                   *[c['gub'].get(g, 0) for g in GUB_COLS], sum(v for g, v in c['gub'].items() if g not in GUB_COLS),
                   '', '', '', ''])
print('조합 대조표', C(r[7] for r in master))

# ═══ 판정 이름 평어화 + 설명표 ═══
# (내부 판정 → 화면 표기, 뜻, 검수자가 할 일)
LABELS = {
    # 공통
    '일치': ('문서와 같음', 'ERP 표기가 고객관리문서에 그대로 있다.', '넘어감'),
    '정규화 일치': ('띄어쓰기·접두만 다름', '띄어쓰기, (주), KB/NH 접두만 다르고 나머지는 같다. 예: KB국민은행 → 국민은행', '추천 확인'),
    '유사(문서)': ('문서 표기와 비슷함(오타 추정)', '글자가 거의 같은 표기가 문서에 있어 오타로 본다. 예: 푸본헌대생명 → 푸본현대생명', '추천이 맞는지 확인'),
    '유사(ERP 다빈도)': ('ERP의 더 많이 쓰인 표기와 비슷함(오타 추정)', '문서에는 없지만 ERP 안에서 더 많이 쓰인 비슷한 표기가 있다. 예: 아트만 자산운용(1행) → 아트만자산운용(11행)', '추천이 맞는지 확인'),
    '문서 없음': ('고객관리문서에 없는 거래처', '그 거래처(은행)가 문서에 없어 문서로는 확인할 수 없다. 예: 다올커머스, 요아럽, 병원지부', '검수자가 직접 매출처명 확정(7번 시트)'),
    '확인 필요': ('비슷한 표기를 못 찾음', '문서에도 ERP에도 비슷한 표기가 없다. 신규이거나 오타.', '검수자 판정'),
    # 은행
    '은행 없음': ('빈 값', '은행명이 비어 있다.', '검수자 판정'),
    # 지점
    '옛 지점(이력)': ('이 고객의 옛 지점(이동 전) — 그대로 둠', '그 지점 담당자가 문서의 부서 이동 이력에서 예전에 있던 지점이다. 이동 전 기록이므로 정상.', '넘어감(고치지 않음)'),
    '유사(담당자 이력)': ('고객의 옛 지점 표기와 비슷함(오타 추정)', '담당자 본인의 옛 지점 표기와 글자가 거의 같다. 예: 신성장GA사업부 → 신성장GA영업부. 이동이 아니라 오타로 본다.', '추천이 맞는지 확인'),
    '유사(담당자+문서)': ('담당자가 속한 문서 지점과 비슷함(오타 추정)', '그 담당자가 문서에서 속한 지점과 표기가 비슷하다.', '추천이 맞는지 확인'),
    '판정 필요(담당자는 문서 다른 지점)': ('담당자는 문서에 있으나 지점이 다름 — 이동? 오타?', '담당자는 문서에 있는데 지점이 다르고 글자도 비슷하지 않다. 예: 다솜GA지점 vs 문서 서부GA지점. 이동(이력 누락)인지 오타인지 사람이 정한다.', '검수자 판정'),
    '지점 없음→담당자 기준': ('지점 빈칸 — 담당자 기준으로 채움 추천', 'ERP 지점이 빈칸인데 담당자가 문서에서 한 지점에만 속한다. 그 지점으로 채우라는 추천.', '추천 확인'),
    '지점 없음(담당자 분산)': ('지점 빈칸 — 담당자들이 여러 지점', 'ERP 지점이 빈칸이고 담당자들이 문서에서 여러 지점에 속한다.', '검수자 판정'),
    '지점 없음': ('지점 빈칸 — 담당자도 문서에 없음', 'ERP 지점이 빈칸이고 담당자도 문서에 없다.', '검수자 판정'),
    # 담당자
    '담당자 없음': ('빈 값', '담당자명이 비어 있다.', '검수자 판정'),
    '옛 지점의 고객(이력)': ('이 고객의 옛 지점 기록(이동 전) — 정상', '문서 이력상 이 고객이 예전에 이 지점에 있었다. 정상.', '넘어감'),
    "'님' 누락": ("'님'만 빠짐", '존칭만 보충하면 문서와 같아진다. 예: 김세진님 → 김세진 님', '추천 확인'),
    '띄어쓰기 차이(문서)': ('띄어쓰기만 다름', '띄어쓰기만 다르다. 문서 쪽이 더 어색하면(이현준지점장님) 문서를 고치는 것이 맞을 수 있다.', '어느 쪽 표기로 할지 확인'),
    '직함 상이(승진 가능)': ('이름 같고 직함만 다름(승진 추정)', '같은 지점에 이름은 같고 직함만 다른 고객이 문서에 있다. 예: 박재현 자장님 → 박재현 차장님. 같은 사람이면 문서(현재) 표기로.', '같은 사람인지 확인'),
    '같은 은행·다른 지점(문서)': ('문서에는 같은 은행 다른 지점에 있음', '이 이름이 문서에는 같은 은행의 다른 지점에 있다. 이동인지 동명이인인지는 4번 시트에서 판정.', '4번 시트에서 판정'),
    '동명·직함 상이(다른 지점)': ('이름 같고 직함·지점 다름', '같은 은행 다른 지점에 이름은 같고 직함이 다른 고객이 문서에 있다. 이동+승진 또는 동명이인.', '검수자 판정'),
    "문서 없음·'님' 누락": ("문서에 없는 고객 — '님'만 보충", '문서에 없는 고객이라 존칭 보충만 추천한다.', '추천 확인'),
    '문서 없음(신규 고객)': ('문서에 없는 고객(신규 또는 누락)', '문서(2026-08-27 기준)에 없다. 그 뒤 신규 고객이거나 문서에서 빠진 고객.', '검수자 판정(문서에 추가할지)'),
    # 구분
    '정규값': ('정규값', '정규값 9종 중 하나다.', '넘어감'),
    '정규화': ('정규값으로 바꿈', '오타·변형을 정규값으로 맞춘다. 예: tkdtl → 상시, 26tjf → 26설', '추천 확인'),
    '명절 미상(연도·명절 확인)': ('어느 명절인지 불명', '명절인 것은 알지만 연도나 설/추석이 불명하다. 행 날짜로 판정 가능.', '검수자 판정'),
    '잡값(사람 판정)': ('구분 값이 아님(열 착오 추정)', '직원명·유형값·숫자 등 구분 열에 잘못 들어간 값.', '검수자 판정'),
    '빈 값': ('빈 값', '값이 비어 있다.', '검수자 판정'),
    # 채널
    '직원명 일치': ('직원명과 같음', '직원 명단에 있는 이름이다.', '넘어감'),
    '오타 추정': ('직원명 오타 추정', '직원 명단의 이름과 글자가 비슷하다. 예: 옥과일 → 옥광일', '추천 확인'),
    '직원 명단에 없는 이름': ('직원 명단에 없는 이름', '사람 이름이지만 명단에 없다. 퇴사자 또는 명단 미포함.', '직원 명단 확인'),
    '잡값(채널 아님)': ('채널 값이 아님', '매출 경로명·날짜·숫자 등.', '검수자 판정'),
    # 조합대조표
    '문서 일치': ('문서와 같음', '은행·지점·담당자 모두 문서에 그대로 있다.', '넘어감'),
    '정정 후 문서 일치': ('추천대로 고치면 문서와 같아짐', '1~3번 시트의 추천을 적용하면 문서 조합과 일치한다.', '추천 확인'),
    '옛 지점의 고객(이력) — 정상': ('이 고객의 옛 지점 기록(이동 전) — 정상', '문서 이력상 이동 전 지점의 기록이다.', '넘어감'),
    '문서 없는 거래처': ('고객관리문서에 없는 거래처', '거래처가 문서에 없다.', '7번 시트에서 확정'),
    '문서 미일치(판정 필요)': ('문서와 맞지 않음 — 사람 판정', '추천을 적용해도 문서 조합과 맞지 않는다.', '1~4번 시트에서 판정'),
}
def lab(x): return LABELS.get(x, (x,))[0]
for r in bank_tbl: r[3] = lab(r[3])
for r in branch_tbl: r[5] = lab(r[5])
for r in mgr_tbl: r[6] = lab(r[6])
for r in gub_tbl: r[3] = lab(r[3])
for r in ch_tbl: r[2] = lab(r[2])
for r in master: r[7] = lab(r[7])
legend = [[k, v[0], v[1], v[2]] for k, v in LABELS.items()]

# ═══ 엑셀 쓰기 ═══
wb = openpyxl.Workbook()
HFILL = PatternFill('solid', fgColor='DDE3EA'); IFILL = PatternFill('solid', fgColor='FFF7D6'); HF = Font(bold=True)
def sheet(title, header, rows, widths=None, note=None, input_cols=()):
    ws = wb.create_sheet(title)
    r0 = 1
    if note:
        ws.cell(1, 1, note).font = Font(italic=True, color='555555'); r0 = 3
    for j, h in enumerate(header, 1):
        c = ws.cell(r0, j, h); c.font = HF; c.fill = IFILL if h in input_cols else HFILL; c.alignment = Alignment(wrap_text=True, vertical='center')
    for i, row in enumerate(rows, r0 + 1):
        for j, v in enumerate(row, 1):
            c = ws.cell(i, j, v)
            if header[j - 1] in input_cols: c.fill = IFILL
    ws.freeze_panes = ws.cell(r0 + 1, 1)
    ws.auto_filter.ref = f"A{r0}:{get_column_letter(len(header))}{r0 + len(rows)}"
    for j, w in enumerate(widths or [], 1): ws.column_dimensions[get_column_letter(j)].width = w
    return ws

today = datetime.date.today().isoformat()
ws = wb.active; ws.title = '요약'
summ = [
    ['ERP 1차 검수 보조 (v2)', today],
    ['목적', '매출처(은행+지점)별 고객(담당자) 주문·구분 금액·다올 담당·부서 이동 확인을 위해 은행명·지점명·담당자명 표기를 통일'],
    ['원칙', '시스템은 추천만, 확정은 검수자가 노란 "기입" 열에. 부서 이동이면 옛 지점명은 고치지 않는다(주문 당시 지점). 고객 동일성은 4번 시트에서 판정'],
    ['판정 뜻', '"판정 설명" 시트 참고. 문서 = 고객관리문서(기준), ERP = 판매내역(고칠 대상)'],
    ['검수 순서', '1 은행명 → 2 지점명 → 3 담당자명 → 4 동명이인·부서이동 → 5 구분 → 6 채널·다올 담당. 7은 문서 밖 거래처 별도 기준'],
    ['입력', f'ERP 판매내역 {len(erp):,}행 ({min(d["ymd"] for d in erp)}~{max(d["ymd"] for d in erp)}), 고객관리문서 {len(doc):,}행(2026-08-27 기준)'],
    ['직원 명단 출처', staff_src + f' — {len(staff)}명'],
    [],
    ['시트', '행', '판정 분포'],
    ['0_조합대조표', len(master), ', '.join(f'{k} {n}' for k, n in C(r[7] for r in master).most_common())],
    ['1_은행명', len(bank_tbl), ', '.join(f'{k} {n}' for k, n in C(r[3] for r in bank_tbl).most_common())],
    ['2_지점명', len(branch_tbl), ', '.join(f'{k} {n}' for k, n in C(r[5] for r in branch_tbl).most_common())],
    ['3_담당자명', len(mgr_tbl), ', '.join(f'{k} {n}' for k, n in C(r[6] for r in mgr_tbl).most_common())],
    ['4_동명이인_부서이동', len(move_tbl), ', '.join(f'{k} {n}' for k, n in move_cat.most_common()) + ' (고객 수 기준)'],
    ['5_구분', len(gub_tbl), ', '.join(f'{k} {n}' for k, n in C(r[3] for r in gub_tbl).most_common())],
    ['6_채널값', len(ch_tbl), ', '.join(f'{k} {n}' for k, n in C(r[2] for r in ch_tbl).most_common())],
    ['6_채널≠다올담당', len(chd_tbl), f'문서 일치 조합 내 채널≠다올 담당 {sum(r[3] for r in chd_tbl):,}행'],
    ['7_문서없는거래처', len(nodoc_tbl), f'{sum(r[1] for r in nodoc_tbl):,}행'],
]
for i, row in enumerate(summ, 1):
    for j, v in enumerate(row, 1): ws.cell(i, j, v)
ws.column_dimensions['A'].width = 22; ws.column_dimensions['B'].width = 14; ws.column_dimensions['C'].width = 120
for i in (1, 8): ws.cell(i, 1).font = HF

sheet('판정 설명', ['내부 판정명', '화면 표기', '뜻', '검수자가 할 일'], legend, [30, 40, 90, 28],
      note='각 시트의 "판정" 열 뜻. 요약: "문서와 같음"은 넘어가고, "비슷함·…만 다름"은 추천이 맞는지만 확인하고, "사람 판정·못 찾음·문서에 없음"은 검수자가 직접 정한다.')
sheet('0_조합대조표', ['원 은행명', '원 지점명', '원 담당자', '행수', '금액(취소 제외)', '첫 주문', '마지막 주문', '판정', '정정 항목', '추천 은행명', '추천 지점명', '추천 담당자',
                   '문서 다올 담당', '문서 예전 담당', '문서 부서 이동', '채널 상위', '지점/개별/샘플', *GUB_COLS, '기타 구분', '기입 은행명', '기입 지점명', '기입 담당자', '기입 다올 담당'],
      master, [16, 22, 18, 7, 14, 11, 11, 24, 12, 16, 22, 18, 10, 10, 40, 24, 20] + [11] * 9 + [16, 22, 18, 12],
      note='원 조합(은행|지점|담당자) 2,370건. 1~3번 시트의 추천을 합친 결과. 노란 열은 검수자 기입(비우면 추천 또는 원 표기 유지).',
      input_cols=('기입 은행명', '기입 지점명', '기입 담당자', '기입 다올 담당'))
sheet('1_은행명', ['ERP 은행명', '행수', '조합수', '판정', '추천 은행명', '근거', '기입 은행명'], bank_tbl, [28, 8, 8, 16, 28, 60, 28],
      note='매출처의 첫 축. 문서 표기를 기준으로 통일. "문서 없음"은 7번 시트에서 거래처명을 따로 확정.', input_cols=('기입 은행명',))
sheet('2_지점명', ['은행명(정정 후)', 'ERP 지점명', '행수', '담당자수', '원 은행명(다른 경우)', '판정', '추천 지점명', '근거', '기입 지점명'], branch_tbl, [20, 26, 8, 8, 18, 26, 26, 70, 26],
      note='은행명 정정 후 (은행|지점) 1,391건 기준. "옛 지점(이력)"은 고치지 않는다. "지점 없음→담당자 기준"은 빈 지점을 문서 지점으로 채우는 추천.', input_cols=('기입 지점명',))
sheet('3_담당자명', ['은행명', '지점명', 'ERP 담당자', '행수', '첫 주문', '마지막 주문', '판정', '추천 담당자', '근거', '문서 다올 담당', '기입 담당자'], mgr_tbl, [20, 24, 20, 8, 11, 11, 26, 20, 70, 10, 20],
      note='은행·지점 정정 후 조합 기준. 같은 매출처 안에서 같은 고객이 하나의 이름이 되게 한다. 승진으로 직함이 바뀐 경우는 동일인이면 문서(현재) 표기로 통일.', input_cols=('기입 담당자',))
sheet('4_동명이인_부서이동', ['담당자명', '분류(고객 단위)', '출현 매출처 수', '은행명', '지점명', '행수', '첫 주문', '마지막 주문', '정정 전 표기', '추천', '문서 이력', '기입(동일인/동명이인)'], move_tbl,
      [20, 44, 8, 18, 26, 8, 11, 11, 18, 26, 80, 18],
      note='정정 후에도 같은 담당자명이 둘 이상의 매출처에 나타나는 고객. 문서의 부서 이동 이력과 주문 날짜로 판정. 기입: "동일인(이동)" 또는 "동명이인".', input_cols=('기입(동일인/동명이인)',))
sheet('5_구분', ['구분 값', '행수', '금액(취소 제외)', '판정', '추천 정규값', '근거', '기입 정규값'], gub_tbl, [16, 8, 14, 24, 12, 50, 12],
      note='정규값 9종: 상시 · 25설 · 25추석 · 26설 · 26추석 · VIP · 선결제 · 샘플 · 매입. VIP·선결제 금액 집계의 전제.', input_cols=('기입 정규값',))
sheet('6_채널값', ['채널 값', '행수', '판정', '추천 직원명', '근거', '기입'], ch_tbl, [16, 8, 22, 14, 40, 14],
      note='채널 = 주문을 받은 응대자(다올 직원). 다올 담당(담당 영업)과는 다른 값. 직원 명단은 DB 미대조(요약 시트 참고).', input_cols=('기입',))
sheet('6_채널≠다올담당', ['채널(응대자)', '문서 다올 담당', '문서 예전 담당', '행수', '해석', '기입'], chd_tbl, [14, 14, 14, 8, 36, 14],
      note='문서와 일치하는 조합 안에서 채널 값과 문서 다올 담당이 다른 패턴. 채널을 덮어쓰지 않고 다올 담당을 별도 열로 두는 근거 자료.', input_cols=('기입',))
sheet('7_문서없는거래처', ['거래처명(정정 후)', '행수', '금액(취소 제외)', '지점수', '담당자수', '첫 주문', '마지막 주문', '채널 상위', '지점/개별/샘플', '구분별 금액', '기입 매출처명', '기입 다올 담당'], nodoc_tbl,
      [26, 8, 14, 7, 8, 11, 11, 28, 24, 40, 26, 12],
      note='고객관리문서에 없는 거래처(은행 아님 다수). 문서로 검수가 안 되므로 매출처명과 다올 담당을 여기서 직접 확정.', input_cols=('기입 매출처명', '기입 다올 담당'))

out = OUT + f'ERP_검수보조_v2_{today}.xlsx'
wb.save(out)

# ═══ 단순판: 1~3번 시트만, 열 축소 (SIMPLE=1 환경변수 또는 항상 함께 생성) ═══
wb_full = wb
wb = openpyxl.Workbook(); wb.remove(wb.active)
guide = '판정 읽는 법: "문서와 같음" → 넘어감 / "…와 비슷함", "…만 다름" → 추천이 맞는지만 확인 / "사람 판정", "못 찾음", "문서에 없는 …" → 노란 기입 열에 바른 표기를 직접 적음. 비워 두면 추천(추천이 없으면 원 표기)으로 처리.'
sheet('1_은행명', ['ERP 은행명', '행수', '판정', '추천 은행명', '근거', '기입 은행명'],
      [[r[0], r[1], r[3], r[4], r[5], ''] for r in bank_tbl], [28, 8, 30, 28, 60, 28], note=guide, input_cols=('기입 은행명',))
sheet('2_지점명', ['은행명', 'ERP 지점명', '행수', '판정', '추천 지점명', '근거', '기입 지점명'],
      [[r[0], r[1], r[2], r[5], r[6], r[7], ''] for r in branch_tbl], [20, 26, 8, 34, 26, 70, 26],
      note=guide + ' 은행명은 1번 시트 추천을 적용한 표기.', input_cols=('기입 지점명',))
sheet('3_담당자명', ['은행명', '지점명', 'ERP 담당자', '행수', '판정', '추천 담당자', '근거', '기입 담당자'],
      [[r[0], r[1], r[2], r[3], r[6], r[7], r[8], ''] for r in mgr_tbl], [20, 24, 20, 8, 34, 20, 70, 20],
      note=guide + ' 은행명·지점명은 1·2번 시트 추천을 적용한 표기.', input_cols=('기입 담당자',))
out_simple = OUT + f'ERP_검수_단순판_{today}.xlsx'
wb.save(out_simple)
print('saved', out_simple)

# ═══ 한 장 대조표: 조합(은행|지점|담당자|채널) 단위, 문서와 완전히 같은 조합 제외 ═══
why_bank = {r[0]: (r[3], r[5]) for r in bank_tbl}
why_branch = {(r[0], r[1]): (r[5], r[7]) for r in branch_tbl}
why_mgr = {(r[0], r[1], r[2]): (r[6], r[8]) for r in mgr_tbl}
one = []
for (b0, br0, m0), c in sorted(orig_combo.items(), key=lambda x: (bank_fix[x[0][0]], branch_fix[(bank_fix[x[0][0]], x[0][1])], -x[1]['n'])):
    b = bank_fix[b0]; br = branch_fix[(b, br0)]; m = mgr_fix[(b, br, m0)]
    d = doc_keys.get((b, br, m))
    if d and b == b0 and br == br0 and m == m0: continue          # 문서와 완전히 같음 → 제외
    if d: grade = '추천대로 고치면 문서와 같아짐'
    elif b in doc_banks and m in doc_mgrs_by_bank.get(b, set()) and br in mgr_hist_branches(b, m): grade = '이 고객의 옛 지점 기록(이동 전) — 정상'
    elif b not in doc_banks: grade = '고객관리문서에 없는 거래처'
    elif not m: grade = '담당자 빈 값'
    else: grade = '문서와 맞지 않음 — 사람 판정'
    gb, wb_ = why_bank[b0]; gbr, wbr = why_branch[(b, br0)]; gm, wm = why_mgr[(b, br, m0)]
    ch_txt = ', '.join(f'{k or "(빈)"} {n}' for k, n in c['ch'].most_common())
    ch_ok = '' if not d else ('같음' if set(c['ch']) == {d['daol']} else '다름')
    one.append([b0, br0, m0, ch_txt, c['n'], c['first'], c['last'], grade,
                b if b != b0 else '', br if br != br0 else '', m if m != m0 else '',
                d['daol'] if d else '', ch_ok, d['move'] if d else '',
                f'[{gb}] {wb_}' if b != b0 or gb != '문서와 같음' else '',
                f'[{gbr}] {wbr}' if br != br0 or gbr != '문서와 같음' else '',
                f'[{gm}] {wm}' if m != m0 or gm != '문서와 같음' else '',
                '', '', '', ''])
wb = openpyxl.Workbook(); wb.remove(wb.active)
sheet('대조표', ['ERP 은행명', 'ERP 지점명', 'ERP 담당자(고객)', 'ERP 채널(다올직원) 행수', '행수', '첫 주문', '마지막 주문', '판정',
               '추천 은행명', '추천 지점명', '추천 담당자', '문서 다올 담당', '채널=다올 담당?', '문서 부서 이동',
               '근거(은행명)', '근거(지점명)', '근거(담당자)', '기입 은행명', '기입 지점명', '기입 담당자', '기입 다올 담당'],
      one, [18, 24, 20, 26, 7, 11, 11, 32, 18, 24, 20, 11, 10, 44, 50, 60, 60, 18, 24, 20, 12],
      note=f'ERP 조합(은행|지점|담당자) {len(orig_combo):,}건 중 고객관리문서와 완전히 같은 {len(orig_combo) - len(one):,}건 제외, {len(one):,}건. '
           '판정 읽는 법: "추천대로 고치면 …" → 추천 확인 / "옛 지점 기록" → 그대로 둠 / "문서에 없는 거래처", "맞지 않음" → 기입. '
           '추천 열이 비어 있으면 원 표기 유지. 채널은 응대자(주문 받은 직원)이므로 고치지 않고, 담당 영업은 "기입 다올 담당"에.',
      input_cols=('기입 은행명', '기입 지점명', '기입 담당자', '기입 다올 담당'))
out_one = OUT + f'ERP_검수_대조표_{today}.xlsx'
wb.save(out_one)
print('saved', out_one, len(one), C(r[7] for r in one))
wb = wb_full
json.dump({'bank_fix': {k: v for k, v in bank_fix.items() if k != v}, 'branch_fix': {f'{k[0]}|{k[1]}': v for k, v in branch_fix.items() if k[1] != v},
           'mgr_fix': {f'{k[0]}|{k[1]}|{k[2]}': v for k, v in mgr_fix.items() if k[2] != v}}, open(OUT + 'recommendations.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('saved', out)
