const SHEET_NAME = '송장조회_daol';

function doPost(e) {
  // 동시 요청 직렬화 — 병렬 조회(3건씩) 저장 시 행 중복·덮어쓰기 방지
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const payload = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAME);
    const action = payload.action;

    if (action === 'save') {
      // 시트에 없는 새 컬럼(매입처·출고일 등)은 헤더에 자동 추가
      let headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      headers = ensureColumns_(sh, headers, payload);

      const data = sh.getDataRange().getValues();
      const numCol     = headers.indexOf('운송장번호');
      const localIdCol = headers.indexOf('localId');
      const prodCol    = headers.indexOf('상품명');
      const rows = data.slice(1);

      // 매칭 1순위: localId (무번호·합포장 건의 고유 식별자)
      let rowIdx = -1;
      if (payload['localId'] && localIdCol >= 0) {
        rowIdx = rows.findIndex(r => String(r[localIdCol]) === String(payload['localId']));
      }
      // 매칭 2순위: 송장번호 + 상품명 — 합포장(같은 송장번호, 다른 상품) 행을 서로 덮어쓰지 않도록 구분.
      // localId가 달라도 송장번호+상품명이 같으면 같은 행으로 취급해 기기 간 중복 생성을 방지
      if (rowIdx < 0 && payload['운송장번호']) {
        rowIdx = rows.findIndex(r =>
          String(r[numCol]) === String(payload['운송장번호']) &&
          (prodCol < 0 || !payload['상품명'] || String(r[prodCol]).trim() === String(payload['상품명']).trim()));
      }

      // 갱신 시 payload에 없는 컬럼은 기존 값 유지 (수동 추가 컬럼 보호)
      const oldRow = rowIdx >= 0 ? rows[rowIdx] : null;
      const newRow = headers.map((h, i) =>
        payload[h] !== undefined ? payload[h] : (oldRow ? oldRow[i] : ''));

      if (rowIdx >= 0) {
        sh.getRange(rowIdx + 2, 1, 1, newRow.length).setValues([newRow]);
      } else {
        sh.appendRow(newRow);
      }
      return json_({ ok: true });
    }

    if (action === 'load') {
      const data = sh.getDataRange().getValues();
      const headers = data[0];
      const numCol     = headers.indexOf('운송장번호');
      const localIdCol = headers.indexOf('localId');
      const rows = data.slice(1)
        .filter(r => r[numCol] || (localIdCol >= 0 && r[localIdCol]))
        .map(r => {
          const obj = {};
          headers.forEach((h, i) => obj[h] = r[i]);
          return obj;
        });
      return json_({ ok: true, rows });
    }

    if (action === 'delete') {
      const data = sh.getDataRange().getValues();
      const headers = data[0];
      const numCol     = headers.indexOf('운송장번호');
      const localIdCol = headers.indexOf('localId');
      const prodCol    = headers.indexOf('상품명');
      // localId가 오면 localId로만, 없으면 송장번호(+상품명)로 매칭.
      // 매칭되는 모든 행을 삭제해 누적된 유령 중복 행까지 정리
      for (let i = data.length - 1; i >= 1; i--) {
        const byLocalId = payload['localId'] && localIdCol >= 0 &&
          String(data[i][localIdCol]) === String(payload['localId']);
        const byNum = !payload['localId'] && payload['운송장번호'] &&
          String(data[i][numCol]) === String(payload['운송장번호']) &&
          (prodCol < 0 || !payload['상품명'] || String(data[i][prodCol]).trim() === String(payload['상품명']).trim());
        if (byLocalId || byNum) sh.deleteRow(i + 1);
      }
      return json_({ ok: true });
    }

    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: err.message });
  } finally {
    lock.releaseLock();
  }
}

// 시트 헤더에 없는 payload 키를 새 컬럼으로 추가하고 확장된 헤더를 반환
function ensureColumns_(sh, headers, payload) {
  const missing = Object.keys(payload)
    .filter(k => k !== 'action' && headers.indexOf(k) < 0);
  if (missing.length) {
    sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    return headers.concat(missing);
  }
  return headers;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
