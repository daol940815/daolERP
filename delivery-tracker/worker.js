// ═══════════════════════════════════════════════════════════════
// 운송장 조회 프로그램 — Cloudflare Workers 전체 코드
//
// [기존 기능]
//   /                : 송장 조회 프록시 (deliveryapi + 롯데백화점 직접 조회)
//   /couriers        : 지원 택배사 목록
//   /webhook         : deliveryapi 웹훅 수신
//   /create-endpoint : 웹훅 엔드포인트 등록
//   /register        : 웹훅 구독 등록
//
// [신규 — Supabase DB 게이트웨이]
//   /db/load    : 전체 행 불러오기 (GET)
//   /db/save    : 행 저장/갱신 — upsert (POST, 배열)
//   /db/delete  : 행 삭제 (POST, { local_ids: [...] })
//   /db/migrate : Google Sheets → Supabase 데이터 이전 (GET, 재실행 안전)
//
// ★ 적용 방법
//   1) 아래 PLACEHOLDER 4개를 기존 코드의 실제 값으로 교체
//   2) Workers 대시보드 → Settings → Variables and Secrets 에
//      SUPABASE_URL  = https://xxxx.supabase.co   (Type: Text)
//      SUPABASE_KEY  = sb_secret_...              (Type: Secret ← 반드시 Secret)
//      을 추가 (코드에 직접 쓰지 말 것)
//   3) 저장 후 배포(Deploy)
// ═══════════════════════════════════════════════════════════════

const API_KEY        = 'PLACEHOLDER_API_KEY';         // pk_live_... (기존 코드에서 복사)
const SECRET_KEY     = 'PLACEHOLDER_SECRET_KEY';      // sk_client_... (기존 코드에서 복사)
const SHEETS_URL     = 'PLACEHOLDER_SHEETS_URL';      // https://script.google.com/macros/s/.../exec
const WEBHOOK_SECRET = 'PLACEHOLDER_WEBHOOK_SECRET';  // whsec_... (기존 코드에서 복사)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request, env) {

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // ── Supabase DB 게이트웨이 ──
    if (url.pathname.startsWith('/db/')) {
      try {
        return await handleDb(url, request, env);
      } catch (e) {
        return jsonRes({ ok: false, error: e.message }, 500);
      }
    }

    // ── 매입처 메일 발송 (네이버 SMTP) ──
    if (url.pathname.startsWith('/mail/')) {
      try {
        return await handleMail(url, request, env);
      } catch (e) {
        return jsonRes({ ok: false, error: e.message }, 500);
      }
    }

    // ── 1. 송장 조회 API 프록시 (롯데백화점은 Workers가 직접 조회, 나머지는 deliveryapi) ──
    if (url.pathname === '/' || url.pathname === '') {
      const bodyText = await request.text();
      let payload = null;
      try { payload = JSON.parse(bodyText); } catch (e) {}
      const items = payload?.items || [];
      const hasLottedept = items.some(it => it.courierCode === 'lottedept');

      // 롯데백화점 건이 없으면 기존과 동일하게 통째로 전달
      if (!hasLottedept) {
        const res = await fetch('https://api.deliveryapi.co.kr/v1/tracking/trace', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${API_KEY}:${SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
          body: bodyText,
        });
        const data = await res.text();
        return new Response(data, {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
        });
      }

      // 섞여 있으면 분리 처리 후 원래 순서대로 합침
      const results = new Array(items.length);
      const otherIdx = [];
      const otherItems = [];
      items.forEach((it, i) => {
        if (it.courierCode === 'lottedept') return;
        otherIdx.push(i);
        otherItems.push(it);
      });

      // 일반 택배사 → deliveryapi 일괄 조회
      if (otherItems.length) {
        try {
          const res = await fetch('https://api.deliveryapi.co.kr/v1/tracking/trace', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${API_KEY}:${SECRET_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ items: otherItems }),
          });
          const j = await res.json();
          const rs = j?.data?.results || [];
          otherIdx.forEach((oi, k) => {
            results[oi] = rs[k] || { success: false, error: { message: '응답 없음' } };
          });
        } catch (e) {
          otherIdx.forEach(oi => {
            results[oi] = { success: false, error: { message: '조회 실패: ' + e.message } };
          });
        }
      }

      // 롯데백화점 → bs.dpt.co.kr 직접 조회 (병렬)
      await Promise.all(items.map(async (it, i) => {
        if (it.courierCode !== 'lottedept') return;
        try {
          const r = await fetch(
            `https://bs.dpt.co.kr/api/cust/delivery-info/list?serialKey=${encodeURIComponent(it.trackingNumber)}&rcverNm=`,
            { headers: { 'Accept': 'application/json' } }
          );
          const j = await r.json();
          results[i] = lottedeptToResult(j);
        } catch (e) {
          results[i] = { success: false, error: { message: '롯데백화점 조회 실패: ' + e.message } };
        }
      }));

      return new Response(JSON.stringify({ data: { results } }), {
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    // ── 지원 택배사 목록 프록시 ──
    if (url.pathname === '/couriers' && request.method === 'GET') {
      const res = await fetch('https://api.deliveryapi.co.kr/v1/tracking/couriers', {
        headers: { 'Authorization': `Bearer ${API_KEY}:${SECRET_KEY}` },
      });
      const data = await res.text();
      return new Response(data, {
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    // ── 2. 웹훅 수신 (deliveryapi → Workers) ──
    if (url.pathname === '/webhook' && request.method === 'POST') {
      const rawBody = await request.text();
      const timestamp = request.headers.get('x-webhook-timestamp');
      const signature = request.headers.get('x-webhook-signature');

      // 서명 검증 (webhookSecret 설정된 경우만)
      if (WEBHOOK_SECRET) {
        const diff = Math.abs(Date.now() / 1000 - Number(timestamp));
        if (diff > 300) {
          return new Response('Timestamp expired', { status: 401 });
        }
        // HMAC-SHA256 검증
        const encoder = new TextEncoder();
        const keyData = encoder.encode(WEBHOOK_SECRET);
        const msgData = encoder.encode(`${timestamp}.${rawBody}`);
        const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const signBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
        const expected = 'sha256=' + Array.from(new Uint8Array(signBuffer)).map(b => b.toString(16).padStart(2,'0')).join('');
        if (signature !== expected) {
          return new Response('Invalid signature', { status: 401 });
        }
      }

      const payload = JSON.parse(rawBody);

      // 변경된 항목만 Google Sheets 업데이트
      const items = payload.items || [];
      for (const item of items) {
        if (!item.hasChanged && payload.event !== 'tracking.completed') continue;

        const tracking = item.trackingData;
        const statusMap = {
          'DELIVERED': '배송완료', 'OUT_FOR_DELIVERY': '배송중 (배달출발)',
          'IN_TRANSIT': '배송중 (이동중)', 'PICKED_UP': '집화완료',
          'PENDING': '접수대기', 'FAILED': '배송실패',
        };

        const progresses = tracking?.progresses || [];
        const lastStep = progresses[0];

        await fetch(SHEETS_URL, {
          method: 'POST',
          body: JSON.stringify({
            action: 'save',
            carrierName: tracking?.courierName || item.courierCode,
            num: item.trackingNumber,
            name: '',
            status: statusMap[tracking?.deliveryStatus] || item.currentStatus || '알수없음',
            lastEvent: lastStep?.description || '-',
            lastTime: lastStep?.dateTime || '-',
            addedAt: new Date().toLocaleString('ko-KR'),
            updatedAt: new Date().toLocaleString('ko-KR'),
          }),
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ── 3. 엔드포인트 등록 ──
    if (url.pathname === '/create-endpoint' && request.method === 'POST') {
      const body = await request.text();
      const res = await fetch('https://api.deliveryapi.co.kr/v1/webhooks/endpoints', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}:${SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body,
      });
      const data = await res.text();
      return new Response(data, {
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    // ── 4. 구독 등록 ──
    if (url.pathname === '/register' && request.method === 'POST') {
      const body = await request.text();
      const res = await fetch('https://api.deliveryapi.co.kr/v1/webhooks/register', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}:${SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body,
      });
      const data = await res.text();
      return new Response(data, {
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    return new Response('Not found', { status: 404 });
  }
};

// ═══ Supabase DB 게이트웨이 ═══

const DB_TABLE = 'delivery_items';
const DB_COLUMNS = [
  'local_id','carrier','num','order_date','bank_name','branch_name','manager',
  'product_code','product_name','ship_type','staff','supplier','qty','shipper',
  'company_name','address','phone','memo','status','steps','shipped_at',
  'added_at','updated_at',
];

function jsonRes(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// SUPABASE_URL 끝의 / 나 /rest/v1 이 붙어 있어도 동작하도록 정규화
function sbBase(env) {
  return String(env.SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
}

function sbHeaders(env, extra) {
  return {
    'apikey': env.SUPABASE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...(extra || {}),
  };
}

// 행 객체에서 테이블 컬럼만 추려냄 (모르는 키가 섞여 있어도 저장 실패하지 않도록)
function pickColumns(row) {
  const out = {};
  DB_COLUMNS.forEach(c => {
    if (row[c] !== undefined && row[c] !== null) out[c] = row[c];
  });
  if (!Array.isArray(out.steps)) delete out.steps;
  return out;
}

// upsert: local_id 충돌 시 갱신 (재실행·재저장 안전)
async function sbUpsert(env, rows) {
  const base = sbBase(env);
  let saved = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const res = await fetch(`${base}/rest/v1/${DB_TABLE}?on_conflict=local_id`, {
      method: 'POST',
      headers: sbHeaders(env, { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Supabase 저장 실패 (${res.status}): ${t.slice(0, 300)}`);
    }
    saved += chunk.length;
  }
  return saved;
}

// 전체 행 로드 (1000건씩 페이지 순회 — PostgREST 기본 응답 제한 대응)
async function sbLoadAll(env) {
  const base = sbBase(env);
  const all = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(
      `${base}/rest/v1/${DB_TABLE}?select=*&order=created_at.asc,local_id.asc`,
      { headers: sbHeaders(env, { 'Range-Unit': 'items', 'Range': `${offset}-${offset + PAGE - 1}` }) }
    );
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Supabase 조회 실패 (${res.status}): ${t.slice(0, 300)}`);
    }
    const rows = await res.json();
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

async function handleDb(url, request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
    return jsonRes({
      ok: false,
      error: 'Workers 환경변수 SUPABASE_URL / SUPABASE_KEY 가 설정되지 않았습니다. ' +
             'Settings → Variables and Secrets 에 추가한 뒤 다시 배포하세요.',
    }, 500);
  }

  // ── 전체 불러오기 ──
  if (url.pathname === '/db/load' && request.method === 'GET') {
    const rows = await sbLoadAll(env);
    return jsonRes({ ok: true, count: rows.length, rows });
  }

  // ── 저장/갱신 (배열 upsert) ──
  if (url.pathname === '/db/save' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (e) {
      return jsonRes({ ok: false, error: 'JSON 파싱 실패' }, 400);
    }
    const rows = (Array.isArray(body) ? body : [body])
      .map(pickColumns)
      .filter(r => r.local_id);
    if (!rows.length) return jsonRes({ ok: false, error: 'local_id가 있는 행이 없습니다' }, 400);
    const saved = await sbUpsert(env, rows);
    return jsonRes({ ok: true, saved });
  }

  // ── 삭제 ──
  if (url.pathname === '/db/delete' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (e) {
      return jsonRes({ ok: false, error: 'JSON 파싱 실패' }, 400);
    }
    const ids = (body.local_ids || []).map(String).filter(Boolean);
    if (!ids.length) return jsonRes({ ok: false, error: 'local_ids가 비어 있습니다' }, 400);
    const base = sbBase(env);
    let removed = 0;
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const list = chunk.map(id => `"${id.replace(/"/g, '')}"`).join(',');
      const res = await fetch(
        `${base}/rest/v1/${DB_TABLE}?local_id=in.(${encodeURIComponent(list)})`,
        { method: 'DELETE', headers: sbHeaders(env, { 'Prefer': 'return=representation' }) }
      );
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Supabase 삭제 실패 (${res.status}): ${t.slice(0, 300)}`);
      }
      const del = await res.json();
      removed += del.length;
    }
    return jsonRes({ ok: true, removed });
  }

  // ── 매입처 주소록 (이름 기준 upsert) ──
  if (url.pathname === '/db/suppliers') {
    const base = sbBase(env);
    if (request.method === 'GET') {
      const res = await fetch(`${base}/rest/v1/delivery_suppliers?select=*&order=name.asc`, { headers: sbHeaders(env) });
      if (!res.ok) throw new Error(`주소록 조회 실패 (${res.status}): ${(await res.text()).slice(0, 200)}`);
      return jsonRes({ ok: true, rows: await res.json() });
    }
    if (request.method === 'POST') {
      const body = await request.json();
      const rows = (Array.isArray(body) ? body : [body])
        .map(r => ({
          name: String(r.name || '').trim(),
          email: String(r.email || '').trim(),
          cc: String(r.cc || '').trim(),
          manager: String(r.manager || '').trim(),
          updated_at: new Date().toISOString(),
        }))
        .filter(r => r.name);
      if (!rows.length) return jsonRes({ ok: false, error: '저장할 매입처가 없습니다' }, 400);
      const res = await fetch(`${base}/rest/v1/delivery_suppliers?on_conflict=name`, {
        method: 'POST',
        headers: sbHeaders(env, { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(rows),
      });
      if (!res.ok) throw new Error(`주소록 저장 실패 (${res.status}): ${(await res.text()).slice(0, 200)}`);
      return jsonRes({ ok: true, saved: rows.length });
    }
  }

  // ── 메일 프리셋 ──
  if (url.pathname === '/db/presets') {
    const base = sbBase(env);
    if (request.method === 'GET') {
      const res = await fetch(`${base}/rest/v1/delivery_mail_presets?select=*&order=updated_at.desc`, { headers: sbHeaders(env) });
      if (!res.ok) throw new Error(`프리셋 조회 실패 (${res.status}): ${(await res.text()).slice(0, 200)}`);
      return jsonRes({ ok: true, rows: await res.json() });
    }
    if (request.method === 'POST') {
      const body = await request.json();
      const rows = (Array.isArray(body) ? body : [body])
        .map(r => ({
          id: String(r.id || '').trim(),
          name: String(r.name || '').trim(),
          subject: String(r.subject || ''),
          body: String(r.body || ''),
          updated_at: new Date().toISOString(),
        }))
        .filter(r => r.id);
      if (!rows.length) return jsonRes({ ok: false, error: '저장할 프리셋이 없습니다' }, 400);
      const res = await fetch(`${base}/rest/v1/delivery_mail_presets?on_conflict=id`, {
        method: 'POST',
        headers: sbHeaders(env, { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(rows),
      });
      if (!res.ok) throw new Error(`프리셋 저장 실패 (${res.status}): ${(await res.text()).slice(0, 200)}`);
      return jsonRes({ ok: true, saved: rows.length });
    }
  }

  // ── 변형 접수양식 열 매핑 학습 (헤더 시그니처 기준 upsert) ──
  if (url.pathname === '/db/colmaps') {
    const base = sbBase(env);
    if (request.method === 'GET') {
      const res = await fetch(`${base}/rest/v1/delivery_col_maps?select=*&order=updated_at.desc`, { headers: sbHeaders(env) });
      if (!res.ok) throw new Error(`매핑 조회 실패 (${res.status}): ${(await res.text()).slice(0, 200)}`);
      return jsonRes({ ok: true, rows: await res.json() });
    }
    if (request.method === 'POST') {
      const body = await request.json();
      const rows = (Array.isArray(body) ? body : [body])
        .map(r => ({
          id: String(r.id || '').trim(),
          mapping: (r.mapping && typeof r.mapping === 'object') ? r.mapping : {},
          sample: String(r.sample || '').slice(0, 500),
          updated_at: new Date().toISOString(),
        }))
        .filter(r => r.id);
      if (!rows.length) return jsonRes({ ok: false, error: '저장할 매핑이 없습니다' }, 400);
      const res = await fetch(`${base}/rest/v1/delivery_col_maps?on_conflict=id`, {
        method: 'POST',
        headers: sbHeaders(env, { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(rows),
      });
      if (!res.ok) throw new Error(`매핑 저장 실패 (${res.status}): ${(await res.text()).slice(0, 200)}`);
      return jsonRes({ ok: true, saved: rows.length });
    }
  }

  if (url.pathname === '/db/presets-delete' && request.method === 'POST') {
    const base = sbBase(env);
    const body = await request.json();
    const ids = (body.ids || []).map(String).filter(Boolean);
    if (!ids.length) return jsonRes({ ok: false, error: 'ids가 비어 있습니다' }, 400);
    const list = ids.map(id => `"${id.replace(/"/g, '')}"`).join(',');
    const res = await fetch(`${base}/rest/v1/delivery_mail_presets?id=in.(${encodeURIComponent(list)})`, {
      method: 'DELETE', headers: sbHeaders(env),
    });
    if (!res.ok) throw new Error(`프리셋 삭제 실패 (${res.status})`);
    return jsonRes({ ok: true });
  }

  // ── Google Sheets → Supabase 데이터 이전 (브라우저에서 GET으로 실행, 재실행 안전) ──
  if (url.pathname === '/db/migrate') {
    const gasRes = await fetch(SHEETS_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'load' }),
    });
    const gas = await gasRes.json();
    if (!gas.ok) return jsonRes({ ok: false, error: 'Sheets 불러오기 실패: ' + (gas.error || '') }, 500);

    const sheetRows = gas.rows || [];
    const mapped = sheetRows.map(sheetRowToDb).filter(r => r.local_id);
    const saved = await sbUpsert(env, mapped);
    const after = await sbLoadAll(env);
    return jsonRes({
      ok: true,
      sheet_rows: sheetRows.length,
      migrated: saved,
      supabase_total: after.length,
      note: '재실행해도 안전합니다 (같은 행은 갱신됨)',
    });
  }

  return jsonRes({ ok: false, error: '알 수 없는 /db 경로' }, 404);
}

// 시트의 한글 컬럼 행 → delivery_items 컬럼으로 변환
const CARRIER_NAME_TO_CODE = {
  'CJ대한통운': 'cj', '롯데택배': 'lotte', '한진택배': 'hanjin',
  '우체국택배': 'epost', '로젠택배': 'logen', '롯데백화점': 'lottedept',
};

// 구글 시트가 '269-04-02' 같은 텍스트(품번 등)를 날짜로 오인 변환한 값 복원.
// GAS가 JSON으로 내보내면 '0269-04-01T15:32:08.000Z' 형태(과거 한국 표준시 오프셋)가 되므로
// Asia/Seoul 기준 날짜로 되돌리고 연도 앞의 0을 제거해 원래 텍스트로 복구한다.
function fixGasDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) return v;
  const d = new Date(v);
  if (isNaN(d)) return v;
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  return ymd.replace(/^0+(?=\d)/, '');
}

function sheetRowToDb(r) {
  const s = k => String(r[k] === undefined || r[k] === null ? '' : r[k]).trim();
  const rawCarrier = s('택배사');
  const lastEvent = s('최근이벤트');
  const num = s('운송장번호');
  const productName = s('상품명');
  // localId가 없는 구버전 행: 내용 기반 고정 ID 생성 → 이전을 재실행해도 중복 생성되지 않음
  const localId = s('localId') ||
    'lidmig_' + hash36(`${num}|${productName}|${s('주문일')}|${s('은행명') || s('주문처')}|${s('지점명')}|${s('품번')}|${s('수취인')}|${s('수하인')}`);
  return {
    local_id:     localId,
    carrier:      CARRIER_NAME_TO_CODE[rawCarrier] || rawCarrier || 'lotte',
    num:          num,
    order_date:   fixGasDate(s('주문일')),  // 시트가 날짜로 변환한 값 → YYYY-MM-DD 복원
    bank_name:    s('은행명') || s('주문처'),
    branch_name:  s('지점명'),
    manager:      s('고객명') || s('담당자'),
    product_code: fixGasDate(s('품번')),    // '269-04-02' 같은 품번이 날짜로 변환된 경우 복원
    product_name: productName,
    ship_type:    s('배송타입'),
    staff:        s('다올직원') || s('직원') || s('채널'),
    supplier:     s('매입처'),
    qty:          s('수량'),
    shipper:      s('수하인'),
    company_name: s('수취인'),
    address:      s('고객주소') || s('배송주소'),
    phone:        s('전화번호'),
    memo:         s('메모'),
    status:       s('상태'),
    steps:        (lastEvent && lastEvent !== '-')
                    ? [{ text: lastEvent, time: s('최근시간'), done: true, current: false }]
                    : [],
    shipped_at:   s('출고일'),
    added_at:     s('등록일시'),
    updated_at:   s('수정일시'),
  };
}

// 간단한 문자열 해시 (djb2 변형) → base36
function hash36(str) {
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = (h1 * 33) ^ c; h2 = (h2 * 31) ^ c;
    h1 = h1 >>> 0; h2 = h2 >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

// ═══ 매입처 메일 발송 — 네이버 SMTP (cloudflare:sockets) ═══
//
// Workers 환경변수 (Settings → Variables and Secrets):
//   SMTP_USER      = 네이버 아이디 또는 전체 메일주소   (Type: Text)
//   SMTP_PASS      = 애플리케이션 비밀번호(2단계 인증 시) 또는 비밀번호 (Type: Secret)
//   SMTP_FROM_NAME = 발신자 표시명 (선택, 기본 '다올커머스')
//   SMTP_HOST/PORT = 선택 (기본 smtp.naver.com / 465 — 네이버웍스는 smtp.worksmobile.com)
// 네이버 메일 → 환경설정 → POP3/IMAP 설정 → 'POP3/SMTP 사용함'이 켜져 있어야 합니다.

async function handleMail(url, request, env) {
  // 발송 이력
  if (url.pathname === '/mail/log' && request.method === 'GET') {
    if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return jsonRes({ ok: true, rows: [] });
    const res = await fetch(`${sbBase(env)}/rest/v1/delivery_mail_log?select=*&order=sent_at.desc&limit=300`,
      { headers: sbHeaders(env) });
    if (!res.ok) throw new Error(`이력 조회 실패 (${res.status})`);
    return jsonRes({ ok: true, rows: await res.json() });
  }

  // 발송
  if (url.pathname === '/mail/send' && request.method === 'POST') {
    if (!env.SMTP_USER || !env.SMTP_PASS) {
      return jsonRes({
        ok: false,
        error: 'Workers 환경변수 SMTP_USER / SMTP_PASS 가 설정되지 않았습니다. ' +
               'Settings → Variables and Secrets 에 추가한 뒤 다시 배포하세요.',
      }, 500);
    }
    let p;
    try { p = await request.json(); } catch (e) { return jsonRes({ ok: false, error: 'JSON 파싱 실패' }, 400); }
    if (!String(p.to || '').trim()) return jsonRes({ ok: false, error: '받는 사람이 없습니다' }, 400);
    if (!String(p.subject || '').trim()) return jsonRes({ ok: false, error: '제목이 없습니다' }, 400);

    await sendSmtpMail(env, p);

    // 발송 이력 기록 (실패해도 발송 성공에는 영향 없음)
    if (env.SUPABASE_URL && env.SUPABASE_KEY) {
      try {
        await fetch(`${sbBase(env)}/rest/v1/delivery_mail_log`, {
          method: 'POST',
          headers: sbHeaders(env, { 'Prefer': 'return=minimal' }),
          body: JSON.stringify([{
            supplier: String(p.supplier || ''),
            to_email: String(p.to || ''),
            subject: String(p.subject || ''),
            item_count: Number(p.itemCount || 0),
          }]),
        });
      } catch (e) {}
    }
    return jsonRes({ ok: true });
  }

  return jsonRes({ ok: false, error: '알 수 없는 /mail 경로' }, 404);
}

// UTF-8 문자열 → base64
function b64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function wrap76(b64) { return b64.replace(/(.{76})/g, '$1\r\n'); }
// 한글 등 비ASCII 헤더값 인코딩 (RFC 2047)
function encWord(str) { return /^[\x20-\x7e]*$/.test(str) ? str : `=?UTF-8?B?${b64Utf8(str)}?=`; }
function splitAddrs(s) { return String(s || '').split(/[,;]+/).map(x => x.trim()).filter(Boolean); }

async function sendSmtpMail(env, msg) {
  const host = env.SMTP_HOST || 'smtp.naver.com';
  const port = Number(env.SMTP_PORT || 465);
  const user = env.SMTP_USER;
  const from = user.includes('@') ? user : `${user}@naver.com`;
  const fromName = env.SMTP_FROM_NAME || '다올커머스';
  const toList = splitAddrs(msg.to);
  const ccList = splitAddrs(msg.cc);
  const rcpts = [...toList, ...ccList];
  if (!rcpts.length) throw new Error('받는 사람이 없습니다');

  // MIME 본문 (텍스트 + 엑셀 첨부)
  const boundary = 'daol' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const lines = [
    `From: ${encWord(fromName)} <${from}>`,
    `To: ${toList.join(', ')}`,
    ...(ccList.length ? [`Cc: ${ccList.join(', ')}`] : []),
    `Subject: ${encWord(String(msg.subject || ''))}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64Utf8(String(msg.body || ''))),
  ];
  for (const att of (msg.attachments || [])) {
    if (!att || !att.base64) continue;
    const fn = encWord(String(att.filename || 'attachment.xlsx'));
    lines.push(
      `--${boundary}`,
      `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name="${fn}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${fn}"`,
      '',
      wrap76(String(att.base64).replace(/[\r\n]/g, '')),
    );
  }
  lines.push(`--${boundary}--`, '');
  // DATA 구간 dot-stuffing: 줄 첫머리의 '.'은 '..'으로
  const data = lines.join('\r\n').replace(/(^|\r\n)\./g, '$1..');

  const connectFn = globalThis.__smtpConnect || (await import('cloudflare:sockets')).connect;
  const sock = connectFn({ hostname: host, port }, { secureTransport: 'on', allowHalfOpen: false });
  const writer = sock.writable.getWriter();
  const reader = sock.readable.getReader();
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = '';

  // 응답의 마지막 줄("NNN 텍스트")이 올 때까지 수신 — "250-..." 멀티라인 응답 대응
  async function expect(codes) {
    for (;;) {
      const ls = buf.split('\r\n');
      for (let i = 0; i < ls.length; i++) {
        const m = ls[i].match(/^(\d{3}) /);
        if (m) {
          const line = ls[i];
          buf = ls.slice(i + 1).join('\r\n');
          if (!codes.includes(Number(m[1]))) throw new Error(`SMTP 오류: ${line.slice(0, 200)}`);
          return line;
        }
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('SMTP 연결이 끊어졌습니다');
      buf += dec.decode(value, { stream: true });
    }
  }
  const send = cmd => writer.write(enc.encode(cmd + '\r\n'));

  try {
    await expect([220]);
    await send('EHLO daol'); await expect([250]);
    await send('AUTH LOGIN'); await expect([334]);
    await send(btoa(user)); await expect([334]);
    await send(btoa(env.SMTP_PASS)); await expect([235]);
    await send(`MAIL FROM:<${from}>`); await expect([250]);
    for (const r of rcpts) { await send(`RCPT TO:<${r}>`); await expect([250, 251]); }
    await send('DATA'); await expect([354]);
    await writer.write(enc.encode(data));
    await send('.'); await expect([250]);
    try { await send('QUIT'); } catch (e) {}
  } finally {
    try { writer.releaseLock(); } catch (e) {}
    try { reader.releaseLock(); } catch (e) {}
    try { sock.close(); } catch (e) {}
  }
}

// 롯데백화점(bs.dpt.co.kr) 응답을 프로그램이 쓰는 형식으로 변환
function lottedeptToResult(json) {
  const rows = (json && json.isSuccess && Array.isArray(json.resultList)) ? json.resultList : [];
  if (!rows.length) {
    return { success: false, error: { code: 'NOT_FOUND', message: '배송 정보 없음' } };
  }
  const sorted = [...rows].sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const last = sorted[sorted.length - 1];
  const isDone = String(last.rsltCd || '').includes('완료');
  // 프로그램은 progresses[0]을 최신 이벤트로 보므로 역순 정렬
  const progresses = sorted.slice().reverse().map(r => ({
    description: `${r.rsltCd || '처리'}${r.prdcNm ? ' — ' + r.prdcNm : ''}${r.rcverNm ? ' (받는이 ' + r.rcverNm + ')' : ''}`,
    dateTime: r.rsltPrcsDtm || r.delvDt || '',
    location: '',
    statusCode: String(r.rsltCd || '').includes('완료') ? 'DELIVERED' : 'IN_TRANSIT',
  }));
  return {
    success: true,
    data: {
      deliveryStatus: isDone ? 'DELIVERED' : 'IN_TRANSIT',
      deliveryStatusText: last.rsltCd || '',
      courierName: '롯데백화점',
      progresses,
    },
  };
}
