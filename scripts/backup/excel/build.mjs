// run.ts 를 앱 코드와 함께 한 파일로 묶는다. 앱 코드는 고치지 않고 두 곳만 바꿔 끼운다:
//   '@/lib/user-role' → stubs/user-role.ts (로그인 대신 백업 계정)
//   'next/headers'    → stubs/next-headers.ts (요청 밖이라 쿠키 없음)
// 결과: my-accounting-app/node_modules/.cache/backup-excel/run.cjs (앱 패키지를 그대로 쓰도록 앱 안에 둔다)
// 사용: node build.mjs
import { build } from 'esbuild'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const app = path.resolve(here, '../../../my-accounting-app')
const outfile = path.join(app, 'node_modules/.cache/backup-excel/run.cjs')
const realUserRole = path.join(app, 'lib/user-role.ts')

function resolveAppFile(p) {
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const f = p + ext
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return f
  }
  return null
}

const swap = {
  name: 'backup-swap',
  setup(b) {
    b.onResolve({ filter: /^@\/lib\/user-role$/ }, () => ({ path: path.join(here, 'stubs/user-role.ts') }))
    b.onResolve({ filter: /^__REAL_USER_ROLE__$/ }, () => ({ path: realUserRole }))
    b.onResolve({ filter: /^next\/headers(\.js)?$/ }, () => ({ path: path.join(here, 'stubs/next-headers.ts') }))
    b.onResolve({ filter: /^@\// }, (args) => {
      const f = resolveAppFile(path.join(app, args.path.slice(2)))
      return f ? { path: f } : { errors: [{ text: `앱 파일을 찾을 수 없음: ${args.path}` }] }
    })
  },
}

await build({
  entryPoints: [path.join(here, 'run.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  packages: 'external', // xlsx · supabase · next 는 앱 node_modules 것을 그대로
  plugins: [swap],
  logLevel: 'warning',
})
console.log(`묶기 완료: ${path.relative(process.cwd(), outfile)}`)
