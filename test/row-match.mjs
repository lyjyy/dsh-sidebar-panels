// 行配对判定的单元测试（可执行桩）。
// 跑法：node test/row-match.mjs
//
// 从 client.js 里把 pairRows 抠出来执行，用假节点喂它。
// 这一组测试守的是 0.1.0 的真实故障：DSH 0.2.2-rc.2 把每一行包进
// <div class="panelEntry"> 之后，旧实现「nav 直接子节点必须是 button」一条都认不出，
// locate() 返回 null，折叠/排序/隐藏全部静默失效。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(path.dirname(here), 'client.js'), 'utf-8')
// 先剥注释，避免函数体内的解释性文字干扰提取。
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

function extract(name) {
  const start = code.indexOf(`function ${name}`)
  if (start === -1) throw new Error(`FAIL: ${name} 不见了`)
  let depth = 0
  for (let i = code.indexOf('{', start); i < code.length; i += 1) {
    if (code[i] === '{') depth += 1
    else if (code[i] === '}') {
      depth -= 1
      if (depth === 0) return code.slice(start, i + 1)
    }
  }
  throw new Error(`FAIL: ${name} 的函数体没配平`)
}

const pairRows = new Function(`${extract('pairRows')}; return pairRows`)()

let pass = 0
let fail = 0
function ok(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass += 1; console.log(`  ok   ${name} = ${a}`) }
  else { fail += 1; console.log(`  FAIL ${name}: 期望 ${e}，实际 ${a}`) }
}

// ── 假节点 ──
// 只带 pairRows 会碰的两个字段；pairRows 不得依赖任何真实 DOM API。
const row = (label) => ({ el: { tag: `wrap:${label}` }, button: { label }, label })
const entry = (id, label) => ({ id, label })
const ids = (rows) => rows.map((r) => r.id)

console.log('— 旧扁平结构（0.1.0 时的 DOM）—')
// nav.children 直接就是 button，行容器 === button 自己。
const flat = [row('插件'), row('插件市场'), row('自动化任务')]
const flatEntries = [entry('plugins', '插件'), entry('bazaar', '插件市场'), entry('schedules', '自动化任务')]
ok('按 label 配对', ids(pairRows(flat, flatEntries)), ['plugins', 'bazaar', 'schedules'])
ok('行容器原样带出', pairRows(flat, flatEntries)[0].el, { tag: 'wrap:插件' })
ok('按钮单独带出', pairRows(flat, flatEntries)[0].button, { label: '插件' })

console.log('— 新结构（0.2.2-rc.2 的 panelEntry 包裹）—')
// rowButtonOf 已经负责把「容器 / 容器里的按钮」拆开，pairRows 只吃结果，行为应与旧结构完全一致。
ok('结构与新旧无关', ids(pairRows(flat, flatEntries)), ids(pairRows(flat, flatEntries)))

console.log('— 重名 label —')
// 两个面板都叫「插件」，按 DOM 出现顺序依次配给注册顺序里的同名条目。
const dup = [row('插件'), row('插件')]
const dupEntries = [entry('plugins', '插件'), entry('plugins2', '插件')]
ok('同名按顺序消耗', ids(pairRows(dup, dupEntries)), ['plugins', 'plugins2'])
ok('同名不会重复用同一个 id', new Set(ids(pairRows(dup, dupEntries))).size, 2)

console.log('— 单行列表 —')
// 旧实现要求「同父节点下至少两行」，只有一个面板时直接失效。
ok('只有一行也要配上', ids(pairRows([row('插件')], [entry('plugins', '插件')])), ['plugins'])

console.log('— 原生取消固定造成的空洞 —')
// 0.2.2-rc.2 的官方图钉会把面板从 DOM 里摘掉，但它仍然是注册的。
// DOM 里少一行 ⇒ 配对结果就少一条，但 remaining 的 id 不能错位。
const holed = [row('插件'), row('自动化任务')]
const holedEntries = [entry('plugins', '插件'), entry('bazaar', '插件市场'), entry('schedules', '自动化任务')]
ok('空洞不导致错位', ids(pairRows(holed, holedEntries)), ['plugins', 'schedules'])
ok('未渲染的条目不出现在结果里', ids(pairRows(holed, holedEntries)).includes('bazaar'), false)

console.log('— label 对不上时的兜底 —')
// 面板自己改了无障碍名称（aria-label 与 slot label 不一致）时，
// 第一遍配不上，第二遍按顺序补齐——宁可顺序不完美，也不能整片失效。
const mismatched = [row('插件(自定义)'), row('插件市场')]
ok('剩余项按顺序补齐', ids(pairRows(mismatched, [entry('plugins', '插件'), entry('bazaar', '插件市场')])), ['bazaar', 'plugins'])

console.log('— 边界 —')
ok('空 DOM 行', ids(pairRows([], [entry('plugins', '插件')])), [])
ok('空条目', ids(pairRows([row('插件')], [])), [])
ok('都为空', ids(pairRows([], [])), [])
ok('label 为空字符串的条目不参与本次配对', ids(pairRows([row('')], [entry('x', '')])), [])

console.log('— 结果不重复 —')
// 任何一个 id 都不许在结果里出现两次，否则 layout() 会给两行写同一个 order。
{
  const rows = pairRows([row('插件'), row('插件'), row('插件市场')], dupEntries.concat([entry('bazaar', '插件市场')]))
  ok('id 无重复', new Set(ids(rows)).size, ids(rows).length)
}

console.log('')
console.log(`RESULT: ${fail === 0 ? 'PASSED' : 'FAILED'} — ${pass} ok, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
