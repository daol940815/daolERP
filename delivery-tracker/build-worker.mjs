// 배포용 워커 생성: worker.js + index.html + PWA 아이콘 → dist/worker.js
//   node delivery-tracker/build-worker.mjs
// Workers 대시보드에는 dist/worker.js 를 통째로 붙여넣어 배포한다 (키는 Variables/Secrets 에 있으므로 그대로 유지됨).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(dir, 'worker.js'), 'utf8');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const icon = size => fs.readFileSync(path.join(dir, 'pwa', `icon-${size}.png`)).toString('base64');

const marker = 'const APP_HTML = null; // BUILD';
if (!src.includes(marker)) throw new Error('worker.js 에 APP_HTML 자리표시가 없습니다');
const build = (html.match(/const APP_BUILD = '([^']+)'/) || [])[1] || '';
let out = src.replace(marker, `const APP_HTML = ${JSON.stringify(html)}; // BUILD ${build}`);
out = out.replace("const APP_ICON_192 = ''; // BUILD", `const APP_ICON_192 = '${icon(192)}'; // BUILD`);
out = out.replace("const APP_ICON_512 = ''; // BUILD", `const APP_ICON_512 = '${icon(512)}'; // BUILD`);

fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
const dest = path.join(dir, 'dist', 'worker.js');
fs.writeFileSync(dest, out);
console.log(`dist/worker.js 생성 — 화면 ${build}, ${(out.length / 1024).toFixed(0)}KB`);
