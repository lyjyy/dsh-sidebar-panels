// 结构自检：守住这个插件的几条硬约束。
// 跑法：node test/selfcheck.mjs
// 这些断言都是能真正变红的那种——改错实现就会 FAIL。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.dirname(here)
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8')

let pass = 0
let fail = 0
function ok(name, cond) {
  if (cond) { pass += 1; console.log(`  ok   ${name}`) }
  else { fail += 1; console.log(`  FAIL ${name}`) }
}

const client = read('client.js')
// 先剥掉注释再断言：注释里会提到那几个哈希类名作为反例说明，
// 直接匹配会把解释性文字误报成「硬编码」（sticky-notes 的坑 5 就是这么来的）。
const code = client
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')
const pkg = JSON.parse(read('package.json'))
const zh = JSON.parse(read('locale/zh.json'))
const en = JSON.parse(read('locale/en.json'))

console.log('— 经典 script 契约 —')
// DSH 用普通 script 注入 client 半，顶层 export 会让 web boot 中止。
ok('client.js 无顶层 export', !/^(export\s)/m.test(client) && !/\nexport\s+(default|const|function|class)/.test(client))
ok('client.js factory 的 id 是完整包名', client.includes(`id: 'dsh-sidebar-panels'`))
ok('client.js 可被 classic-script 解析', (() => {
  try { new Function('window', 'document', 'console', client); return true } catch { return false }
})())

console.log('— 不碰 DOM 顺序 —')
// React keyed 列表 reconcile 会把移动过的节点挪回去，所以只能改 style。
ok('只写 style.order，不调用 insertBefore', !client.includes('insertBefore') && !client.includes('appendChild(row') && !client.includes('replaceChild'))
ok('用 style.order 排序', client.includes('style.order'))
ok('用 style.display 隐藏', /style\.display = 'none'/.test(client))

console.log('— 不依赖 CSS module 哈希 —')
// 侧栏类名（wtg9ga_panelList 之类）会随构建变，认死它等于下次 DSH 升级就崩。
ok('未硬编码官方侧栏哈希类名', !/wtg9ga_|_module_css_default/.test(code))
ok('靠 aria-label 认行', client.includes("button[aria-label]"))
ok('靠 slots 服务取面板清单', client.includes('entriesOfSlot') && client.includes('sidebar.panellist'))

console.log('— 槽位注册 —')
ok('注册 shell.overlay 浮层', /slotsRef\.inject\('shell\.overlay'/.test(client))
ok('注册 sidebar.panellist.actions', /slotsRef\.inject\('sidebar\.panellist\.actions'/.test(client))
ok('服务用 ctx.get 而不是属性访问', client.includes("ctx.get(name)") && !client.includes('ctx.slots'))
ok('导出 inject 声明', /exports\.inject = \['slots', 'locale'\]/.test(client))

console.log('— 持久化 —')
ok('读写 localStorage', client.includes('setItem') && client.includes('getItem'))
ok('存储键固定', client.includes("dsh-sidebar-panels:v1"))
ok('损坏值不致命', /catch\s*\{/.test(client) && client.includes('a corrupt value must never block the feature'))

console.log('— DSH 0.2.2-rc.2 行结构兼容 —')
// 0.1.0 的真实故障：官方把每一行包进 <div class="panelEntry">，nav 的直接子节点
// 不再有 button，locate() 静默返回 null，折叠/排序/隐藏全部失效。
// 这几条断言盯着「认行」的写法，改回旧写法任何一条都会红。
const locateBody = (() => {
  const start = code.indexOf('function locate')
  if (start === -1) return ''
  let depth = 0
  for (let i = code.indexOf('{', start); i < code.length; i += 1) {
    if (code[i] === '{') depth += 1
    else if (code[i] === '}') {
      depth -= 1
      if (depth === 0) return code.slice(start, i + 1)
    }
  }
  return ''
})()
ok('找到 locate 函数体', locateBody.length > 0)
// 判别1：行容器与按钮必须分开存（.el 是容器、.button 是按钮）。
ok('有 rowButtonOf 拆容器与按钮',
  /function rowButtonOf/.test(code)
  && /return \{ el: child, button: candidate \}/.test(code)
  && /return \{ el: child, button: child \}/.test(code))
// 判别1b：「更多」按钮带 aria-haspopup=menu，不是面板行；不排除它会冒充
// 被官方图钉取消固定（从 DOM 消失）的那个面板，把整行 id 对错。
ok('rowButtonOf 排除 aria-haspopup 菜单启动器', /isMenuTrigger/.test(code) && /aria-haspopup/.test(code))
// 判别2：nav 锚点不许再依赖「直接子节点就是 button」。
ok("findNav 用 closest('nav') 锚点", /closest\('nav'\)/.test(code))
ok('findNav 认 More 按钮当锚点', /querySelector\('nav button\[aria-haspopup="menu"\]'\)/.test(code))
// 判别3：locate 不得自己遍历 nav.children 去 matches('button[aria-label]') 当唯一来源。
ok('locate 走 rowButtonOf 而不是自己判 button',
  locateBody.includes('rowButtonOf(child)') && !/child\.matches\('button\[aria-label\]'\)/.test(locateBody))
// 判别4：样式必须写在行容器上，否则藏不掉 rc.2 新加的 panelUnpin。
ok('style 写在 row.el（行容器）上', /row\.el\.style\.order/.test(code) && /row\.el\.style\.display/.test(code))
ok('没有把 style 写到 row.button 上', !/row\.button\.style/.test(code))
// 判别5：右键严格按行自己的按钮匹配，别被 panelUnpin 抢走。
ok('右键按 candidate.button 严格匹配', /candidate\.button === button/.test(code))
// 判别6：定位失败要出声，不许再静默。
ok('定位失败有一次性 warn', /function warnLocateFailure/.test(code) && /could not locate the sidebar panel list/.test(code))
ok('warn 只报一次', /if \(locateWarned\) return;/.test(code))

console.log('— 顺序 id 宇宙 —')
// rc.2 官方自带「取消固定」：面板会从渲染列表消失但仍然是注册的。
// 旧实现只保留 DOM 里存在的 id ⇒ 点一下小图钉就把用户排好的位次永久抹掉。
ok('有 registeredIds 取自 slots', /function registeredIds\(\)[\s\S]{0,90}panelEntries\(\)\.map/.test(code))
ok('mergeOrder 只保留 ids 里有的（剪掉注销项）', /for \(const id of state\.order\) \{\s*if \(ids\.indexOf\(id\) !== -1/.test(code))
ok('layout 用注册 id 计算顺序', /mergeOrder\(entries\.map\(\(entry\) => entry\.id\)\)/.test(code))
ok('moveId 用 registeredIds', /const ids = mergeOrder\(registeredIds\(\)\)/.test(code))
ok('moveIdTo 用 registeredIds', (code.match(/mergeOrder\(registeredIds\(\)\)/g) || []).length >= 2)
ok('不再拿 DOM 行当 id 来源', !/mergeOrder\(found\.rows\.map/.test(code))

console.log('— 轨道态可达性 —')
// 56px 轨道下官方 CSS 把整个 panelList 隐藏；我们那行不能再自隐藏，
// 否则「已折叠」在 UI 里没有任何入口能改回来。
ok('layout 判定了 rail 态', /const rail = nav\.clientWidth > 0 && nav\.clientWidth < 80/.test(code))
ok('rail 态下不做折叠隐藏', /const collapseOut = !rail && state\.collapsed/.test(code))
// 判据不许用 CSS module 哈希类名。
ok('rail 判据不是哈希类名', !/wtg9ga_/.test(code))

console.log('— 展平器常驻 —')
// 早期版本把入口行只在「折叠或隐藏后」显示，等于默认状态下根本没有入口，
// 用户看到的功能就像不存在。这里做**结构断言**：抽出 paintExpander 函数体，
// 里面任何对 display 的赋值都不许依赖 collapsed / hiddenCount —— 否则又变回条件显示。
// （写成字面串匹配会被换一种写法规避；判别性验证已证明过一次，故改结构判断。）
const paintBody = (() => {
  const start = code.indexOf('function paintExpander')
  if (start === -1) return ''
  const open = code.indexOf('{', start)
  let depth = 0
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1
    else if (code[i] === '}') {
      depth -= 1
      if (depth === 0) return code.slice(start, i + 1)
    }
  }
  return ''
})()
const displayLines = paintBody.split('\n').filter((line) => line.includes('.style.display'))
ok('找到 paintExpander 函数体', paintBody.length > 0)
ok('有无条件显示入口行', displayLines.some((line) => /=\s*''\s*;/.test(line) && !/(collapsed|hiddenCount)/.test(line)))
ok('入口行没有被按状态隐藏回去', !displayLines.some((line) => /(collapsed|hiddenCount)/.test(line)))
ok('齿轮显式恢复可见（不是折叠态隐藏）', /gear[\s\S]{0,40}\.style\.display = ''/.test(paintBody))

console.log('— 折叠保留前三条 —')
// 用户要求：收起时保留顺序最前面 3 项，而不是「只留当前选中的那一个」。
ok('有 COLLAPSED_KEEP 常量', /const COLLAPSED_KEEP = 3;/.test(code))
ok('折叠按序号保留，不按 aria-current', !/activeId/.test(code))
// 用户第二次反馈：收起后留下的三条必须是「按我排序后的前三」，不是注册顺序的前三。
// 结构断言：保留集合必须从 merged（用户排序）里取，不能靠遍历 DOM 行计数。
ok('保留集合从 merged 里取', /for \(const id of merged\)[\s\S]{0,160}keptIds\.push\(id\)/.test(code))
ok('保留集合满 COLLAPSED_KEEP 就停', /keptIds\.length >= COLLAPSED_KEEP[\s\S]{0,20}break/.test(code))
ok('保留逻辑跳过隐藏项', /if \(state\.hidden\.indexOf\(id\) !== -1\) continue;[\s\S]{0,60}keptIds\.push/.test(code))
ok('未在保留集合里的条目被收起', /state\.collapsed && keptIds\.indexOf\(row\.id\) === -1/.test(code))
// 反向：不许再出现「遍历 rows 按出现顺序累加 kept」的旧写法。
ok('没有按 DOM 顺序累加计数', !/kept \+= 1/.test(code))

console.log('— 整行可拖 —')
// 用户反馈：把手太小容易拖不到。改成整行都是拖动区，只在按钮上排除。
// 结构断言：抓出 createElement('div', {...}) 的行对象字面量，
// onPointerDown 必须落在**那个对象里**（= 挂在行上），不能只落在把手 span 上。
const rowObject = (() => {
  const at = code.indexOf("className: 'spl-row'")
  if (at === -1) return ''
  // 往前取到 createElement 起点，往后取到该对象的收尾 `},`
  const start = code.lastIndexOf('createElement', at)
  const open = code.indexOf('{', at)
  let depth = 0
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1
    else if (code[i] === '}') {
      depth -= 1
      if (depth === 0) return code.slice(start, i + 1)
    }
  }
  return ''
})()
ok('抓到行对象字面量', rowObject.length > 0)
ok('拖动处理器挂在行对象里', /onPointerDown: \(event\) => onHandleDown\(event, id\)/.test(rowObject))
ok('把手本身不再单独绑拖动', (() => {
  const grip = code.slice(code.indexOf("className: 'spl-grip'") - 40, code.indexOf("className: 'spl-grip'") + 90)
  return !/onPointerDown/.test(grip)
})())
ok('按钮上不启动拖动', /closest\('button'\) !== null\) return;/.test(code))
ok('行有 grab 光标', /\.spl-row\s*\{[^}]*cursor: grab/.test(code))
ok('拖动中整卡显示 grabbing', /body\.spl-dragging/.test(code))

console.log('— 收起开关只留一处 —')
// 用户明确要求：面板行内不要重复的收起按钮，折叠已在侧栏列表入口实现。
ok('管理面板底部没有折叠按钮', !/spl-pill[^\n]*\n?[^;]{0,120}commit\(\{ collapsed/.test(code))
ok('More 菜单不再有折叠行', (() => {
  const at = code.indexOf('function MoreMenuRows')
  if (at === -1) return false
  const body = code.slice(at, at + 900)
  return !/collapsed: !snap\.collapsed/.test(body)
})())
{
  const hits = code.match(/commit\(\{ collapsed: !state\.collapsed \}\)/g) || []
  ok('折叠开关只剩入口行一处', hits.length === 1)
}

console.log('— 入口行始终在最下面 —')
// 用户要求：收起后的「展开面板列表」应排在列表末尾（「更多」之后），不能跑到最上面。
// 断言：入口行的 order 必须是常量，不许依赖 collapsed。
ok('入口行 order 不随折叠状态变化', !/el\.style\.order = collapsed/.test(code))
ok('入口行用固定常量排位', /el\.style\.order = String\(ORDER_EXPANDER\)/.test(code))
{
  const m = code.match(/const ORDER_EXPANDER = (\d+);/)
  ok('入口行 order 大于「更多」的 9001', m !== null && Number(m[1]) > 9001)
}

console.log('— 显示元数据 —')
ok('package.json 有 client 段', pkg.dsh?.client?.platform === 'web')
ok('locale 中英都有 meta.title', zh.meta?.title && en.meta?.title)
ok('icon 可读且是 SVG', read('icon.svg').includes('<svg'))
ok('README 被 files 收录', pkg.files.includes('README.md'))

console.log('')
console.log(`RESULT: ${fail === 0 ? 'PASSED' : 'FAILED'} — ${pass} ok, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
