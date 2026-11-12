// locate() 的集成测试：喂一份**照着 DSH 0.2.2-rc.2 真实结构捏出来的假 DOM**。
// 跑法：node test/locate-rc2.mjs
//
// row-match.mjs 测的是配对纯函数；这里测的是「从 document 一路认到行」的全链路，
// 也就是 0.1.0 真正断掉的那一环。假节点的形状取自本机 0.2.2-rc.2 运行时的快照：
//
//   nav.wtg9ga_panelList[aria-label=全局面板]
//     div.wtg9ga_panelEntry.wtg9ga_panelEntryWide   ← rc.2 新加的包裹层
//       button.wtg9ga_panelRow[aria-label=插件]
//       button.wtg9ga_panelUnpin[aria-label=从侧边栏取消固定插件]   ← 宽态才有
//     div.wtg9ga_panelEntry...
//     span.wtg9ga_moreAnchor                         ← 直接子节点，不是 button
//       button.wtg9ga_panelRow[aria-label=更多][aria-haspopup=menu]
//     div[data-spl-expander]                         ← 我们自己的行
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(path.dirname(here), 'client.js'), 'utf-8')
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

let pass = 0
let fail = 0
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log(`  ok   ${name}`) }
  else { fail += 1; console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`) }
}

// ── 极简假 DOM ──
// 只实现 locate/findNav/rowButtonOf 用到的成员：matches、querySelector、querySelectorAll、
// children、getAttribute、parentElement、closest、clientWidth。
class El {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag
    this.attrs = attrs
    this.children = children
    this.parentElement = null
    this.clientWidth = 0
    for (const child of children) child.parentElement = this
  }
  getAttribute(name) { return this.attrs[name] === undefined ? null : this.attrs[name] }
  get classList() { return String(this.attrs.class || '').split(/\s+/).filter(Boolean) }
  matches(selector) { return matchesOne(this, selector) }
  querySelector(selector) {
    for (const child of this.children) {
      if (matchesOne(child, selector)) return child
      const deep = child.querySelector(selector)
      if (deep !== null) return deep
    }
    return null
  }
  querySelectorAll(selector) {
    const out = []
    const walk = (node) => {
      for (const child of node.children) {
        if (matchesOne(child, selector)) out.push(child)
        walk(child)
      }
    }
    walk(this)
    return out
  }
  closest(selector) {
    let node = this
    while (node !== null) {
      if (matchesOne(node, selector)) return node
      node = node.parentElement
    }
    return null
  }
}

/** 支持 `tag`、`tag[attr]`、`tag[attr="v"]`、`.class`、`[attr]`、`[attr="v"]`，以及空格分隔的后代组合。 */
function splitSelector(selector) {
  return selector.trim().split(/\s+/)
}
function matchesOne(el, selector) {
  const parts = splitSelector(selector)
  // 最后一个复合选择器必须落在 el 上，前面的逐个向上找祖先。
  if (!matchesPart(el, parts[parts.length - 1])) return false
  let index = parts.length - 2
  let node = el.parentElement
  while (index >= 0) {
    if (node === null) return false
    if (matchesPart(node, parts[index])) index -= 1
    node = node.parentElement
  }
  return true
}
function matchesPart(el, part) {
  const re = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+|\[[^\]]+\])*)$/
  const m = re.exec(part)
  if (m === null) throw new Error(`假 DOM 不认识选择器片段: ${part}`)
  if (m[1] !== undefined && el.tag !== m[1]) return false
  const rest = m[2] || ''
  const tokenRe = /([.#])([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g
  let t
  while ((t = tokenRe.exec(rest)) !== null) {
    if (t[1] === '.') {
      if (!el.classList.includes(t[2])) return false
    } else if (t[1] === '#') {
      if (el.attrs.id !== t[2]) return false
    } else {
      const value = el.getAttribute(t[3])
      if (value === null) return false
      if (t[4] !== undefined && value !== t[4]) return false
    }
  }
  return true
}

// ── 照 rc.2 快照捏一份结构 ──
function buildSidebar(panelLabels, { rail = false, withUnpin = true } = {}) {
  const entries = []
  for (const label of panelLabels) {
    const rowChildren = [
      new El('button', { class: 'wtg9ga_panelRow', 'aria-label': label, type: 'button' }),
    ]
    if (withUnpin) {
      rowChildren.push(new El('button', { class: 'wtg9ga_panelUnpin', 'aria-label': `从侧边栏取消固定${label}`, type: 'button' }))
    }
    entries.push(new El('div', { class: 'wtg9ga_panelEntry wtg9ga_panelEntryWide' }, rowChildren))
  }
  const more = new El('span', { class: 'wtg9ga_moreAnchor' }, [
    new El('button', { class: 'wtg9ga_panelRow', 'aria-label': '更多', 'aria-haspopup': 'menu', type: 'button' }),
  ])
  const expander = new El('div', { 'data-spl-expander': '1', class: 'spl-expander' }, [
    new El('button', { class: 'spl-expander-btn', 'aria-label': 'sidebar panels expander', type: 'button' }),
    new El('button', { class: 'spl-expander-gear', 'aria-label': 'sidebar panels manager', type: 'button' }),
  ])
  const nav = new El('nav', { class: 'wtg9ga_panelList', 'aria-label': '全局面板', role: 'navigation' },
    [...entries, more, expander])
  nav.clientWidth = rail ? 56 : 264
  const root = new El('div', { class: 'wtg9ga_root' }, [nav])
  return root
}

// slot 侧的注册清单（id 与 label）——顺序即官方 order 顺序。
const REGISTERED = [
  { id: 'plugins', label: '插件' },
  { id: 'bazaar', label: '插件市场' },
  { id: 'media-desk', label: '自媒体工作台' },
  { id: 'guizang', label: '歸藏设计' },
  { id: 'schedules', label: '自动化任务' },
  { id: 'xdpool', label: 'XD Pool' },
  { id: 'context', label: '上下文洞察' },
  { id: 'jethub', label: 'Jet Hub' },
  { id: 'sticky', label: '便签墙' },
]

function makeScope({ labels = REGISTERED.map((e) => e.label), entries = REGISTERED, rail = false, withUnpin = true } = {}) {
  const root = buildSidebar(labels, { rail, withUnpin })
  const doc = {
    querySelector: (selector) => root.querySelector(selector),
    querySelectorAll: (selector) => root.querySelectorAll(selector),
  }
  const warned = []
  const logger = { warn: (...args) => warned.push(args) }
  const fnSource = [
    extract('pairRows'), extract('findNav'), extract('navHasRows'), extract('fallbackNav'),
    extract('rowButtonOf'), extract('locate'), extract('warnLocateFailure'),
  ].join('\n\n')
  const factory = new Function(
    'document', 'panelEntries', 'EXPANDER_ATTR', 'console',
    `${fnSource}
     let locateWarned = false;
     return { locate, findNav, rowButtonOf };`,
  )
  const scope = factory(doc, () => entries.slice(), 'data-spl-expander', logger)
  return { scope, warned, root }
}

console.log('— rc.2 结构（panelEntry 包裹）—')
{
  const { scope, warned, root } = makeScope()
  const found = scope.locate()
  ok('locate 不再返回 null', found !== null)
  if (found !== null) {
    ok('找到 nav', found.nav.getAttribute('aria-label') === '全局面板')
    ok('认出全部 9 行', found.rows.length === 9, `实际 ${found.rows.length}`)
    ok('id 按注册顺序', found.rows.map((r) => r.id).join(',') === REGISTERED.map((e) => e.id).join(','))
    // 行容器必须是 panelEntry，不是里面的按钮 —— 否则藏不掉 panelUnpin。
    ok('el 是行容器 panelEntry', found.rows.every((r) => r.el.classList.includes('wtg9ga_panelEntry')))
    ok('button 是真正的行按钮', found.rows.every((r) => r.button.classList.includes('wtg9ga_panelRow')))
    ok('没有把 unpin 图钉当行', found.rows.every((r) => r.button.getAttribute('aria-label').startsWith('从侧边栏') === false))
  } else {
    ok('找到 nav', false, 'locate 返回 null')
  }
  ok('正常情况不报警', warned.length === 0)
  ok('expander 行不被当成面板行',
    scope.locate() === null ? false : scope.locate().rows.every((r) => r.el.getAttribute('data-spl-expander') === null))
}

console.log('— 旧扁平结构仍然可用（不回归）—')
{
  // 直接把 button 当 nav 的子节点：模拟 0.1.0 时代 / 未来若改回扁平结构。
  const entries2 = REGISTERED.slice(0, 3)
  const nav = new El('nav', { class: 'wtg9ga_panelList' }, [
    ...entries2.map((e) => new El('button', { class: 'wtg9ga_panelRow', 'aria-label': e.label, type: 'button' })),
    new El('span', { class: 'moreAnchor' }, [
      new El('button', { 'aria-label': '更多', 'aria-haspopup': 'menu', type: 'button' }),
    ]),
  ])
  nav.clientWidth = 264
  const root = new El('div', {}, [nav])
  const doc = {
    querySelector: (s) => root.querySelector(s),
    querySelectorAll: (s) => root.querySelectorAll(s),
  }
  const fnSource = [extract('pairRows'), extract('findNav'), extract('navHasRows'), extract('fallbackNav'),
    extract('rowButtonOf'), extract('locate'), extract('warnLocateFailure')].join('\n\n')
  const scope = new Function('document', 'panelEntries', 'EXPANDER_ATTR', 'console',
    `${fnSource}
     let locateWarned = false;
     return { locate };`)(doc, () => entries2.slice(), 'data-spl-expander', { warn: () => {} })
  const found = scope.locate()
  ok('扁平结构也能认出 3 行', found !== null && found.rows.length === 3)
  ok('扁平结构下 el 就是 button',
    found !== null && found.rows.every((r) => r.el === r.button))
}

console.log('— 原生取消固定造成的空洞 —')
{
  // 插件市场被官方图钉摘掉了，DOM 只剩 8 行，但注册清单仍是 9 条。
  const labels = REGISTERED.map((e) => e.label).filter((l) => l !== '插件市场')
  const { scope } = makeScope({ labels })
  const found = scope.locate()
  ok('8 行能配上', found !== null && found.rows.length === 8)
  ok('空洞不导致 id 错位',
    found !== null && found.rows.map((r) => r.id).join(',') === 'plugins,media-desk,guizang,schedules,xdpool,context,jethub,sticky')
}

console.log('— 只有 1 个面板 —')
{
  const { scope } = makeScope({ labels: ['插件'], entries: [REGISTERED[0]] })
  const found = scope.locate()
  ok('单行也认得出来', found !== null && found.rows.length === 1 && found.rows[0].id === 'plugins')
}

console.log('— 认不出来时要出声 —')
{
  // 结构完全不认识：没有任何 More 按钮，也没有能配上的 label。
  const nav = new El('nav', { class: 'wtg9ga_panelList' }, [
    new El('div', {}, [new El('button', { 'aria-label': '完全不相干', type: 'button' })]),
  ])
  nav.clientWidth = 264
  const root = new El('div', {}, [nav])
  const doc = {
    querySelector: (s) => root.querySelector(s),
    querySelectorAll: (s) => root.querySelectorAll(s),
  }
  const warned = []
  const fnSource = [extract('pairRows'), extract('findNav'), extract('navHasRows'), extract('fallbackNav'),
    extract('rowButtonOf'), extract('locate'), extract('warnLocateFailure')].join('\n\n')
  const scope = new Function('document', 'panelEntries', 'EXPANDER_ATTR', 'console',
    `${fnSource}
     let locateWarned = false;
     return { locate };`)(doc, () => REGISTERED.slice(), 'data-spl-expander', { warn: (...a) => warned.push(a) })
  ok('认不出时返回 null', scope.locate() === null)
  ok('认不出时打了一条 warn', warned.length === 1, `实际 ${warned.length}`)
  ok('warn 带诊断字段', warned.length === 1 && typeof warned[0][1] === 'object' && warned[0][1].reason !== undefined)
  scope.locate(); scope.locate()
  ok('warn 不会刷屏（只报一次）', warned.length === 1, `实际 ${warned.length}`)
}

console.log('')
console.log(`RESULT: ${fail === 0 ? 'PASSED' : 'FAILED'} — ${pass} ok, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
