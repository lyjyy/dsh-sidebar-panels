// 拖动落点判定的单元测试（可执行桩）。
// 跑法：node test/drop-index.mjs
//
// 从 client.js 里把 computeDropIndex 抠出来执行，用假矩形喂它。
// 这样不必真的拖鼠标，也能守住「拖动会不会抖、会不会跳位」。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(path.dirname(here), 'client.js'), 'utf-8')
// 先剥注释，避免函数体内的解释性文字干扰提取。
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const start = code.indexOf('function computeDropIndex')
if (start === -1) {
  console.error('FAIL: computeDropIndex 不见了')
  process.exit(1)
}
// 花括号配平取出整个函数体
let depth = 0
let end = -1
for (let i = code.indexOf('{', start); i < code.length; i += 1) {
  if (code[i] === '{') depth += 1
  else if (code[i] === '}') {
    depth -= 1
    if (depth === 0) { end = i + 1; break }
  }
}
const fnSource = code.slice(start, end)
const computeDropIndex = new Function(`${fnSource}; return computeDropIndex`)()

let pass = 0
let fail = 0
function ok(name, actual, expected) {
  if (actual === expected) { pass += 1; console.log(`  ok   ${name} = ${actual}`) }
  else { fail += 1; console.log(`  FAIL ${name}: 期望 ${expected}，实际 ${actual}`) }
}

// 6 行，每行 32px 高，从 y=100 开始
const ROW_H = 32
const TOP = 100
const rects = [0, 1, 2, 3, 4, 5].map((i) => ({ top: TOP + i * ROW_H, height: ROW_H }))
const mid = (i) => TOP + i * ROW_H + ROW_H / 2

console.log('— 拖到最顶 / 最底 —')
ok('指针在首行上半部之前', computeDropIndex(rects, TOP - 10, 2), 0)
ok('指针高于首行中线', computeDropIndex(rects, mid(0) - 1, 2), 0)
ok('指针低于末行中线', computeDropIndex(rects, mid(5) + 1, 0), 5)
ok('指针远低于列表', computeDropIndex(rects, TOP + 1000, 0), 5)

console.log('— 原地不动 —')
// 把第 2 行拖到它自己的位置：它上下各 2 行，指针停在自己中线上，应回到 2
ok('停留在自身中线', computeDropIndex(rects, mid(2), 2), 2)
// 拖第 0 行到第 1 行位置（指针在第 1 行中线略上）
ok('首行下移一位', computeDropIndex(rects, mid(1) - 1, 0), 1)

console.log('— 顺序稳定性（防抖） —')
// 同一指针位置、同一 fromIndex 连续调用必须得到同一结果，
// 否则拖动过程会来回换位（旧实现被拖行本身参与判定，正是这个毛病）。
let stable = true
for (const from of [0, 2, 4]) {
  for (const y of [TOP + 5, mid(1), mid(3), TOP + 200]) {
    const a = computeDropIndex(rects, y, from)
    const b = computeDropIndex(rects, y, from)
    const c = computeDropIndex(rects, y, from)
    if (a !== b || b !== c) { stable = false; console.log(`    抖动: from=${from} y=${y} -> ${a},${b},${c}`) }
  }
}
ok('同一输入恒得同一结果', stable, true)

console.log('— 边界 —')
ok('单行列表', computeDropIndex([{ top: TOP, height: ROW_H }], TOP + 5, 0), 0)
ok('空列表回 0', computeDropIndex([], TOP, 0), 0)
ok('结果不越界（上）', computeDropIndex(rects, TOP - 500, 3), 0)
ok('结果不越界（下）', computeDropIndex(rects, TOP + 5000, 3), 5)

console.log('— 不能把被拖行自己算进去 —')
// 若把自己算进去，fromIndex 之后的行会被少算一次，
// 表现是「往下拖时总差一格」。这里挑一个会暴露它的用例：
// 6 行里拖第 0 行到最底：排除自己后剩 5 行，全部中线都在指针上方 -> above=5 -> 5
ok('首行拖到最底', computeDropIndex(rects, TOP + 5000, 0), 5)
// 拖第 5 行到最顶 -> 0
ok('末行拖到最顶', computeDropIndex(rects, TOP - 500, 5), 0)
// 拖第 0 行，指针越过第 3 行中线：剩余 5 行中第 1、2、3 行中线在上方 -> above=3，
// 指针在源行下方 -> 补回 1 -> 4。语义：排到原第 4 行（索引 4）之前。
// 断言要去掉超出范围的值：索引 5 是最大合法值，这里 4 正确。
ok('首行拖过第三行中线', computeDropIndex(rects, mid(3) + 1, 0), 4)
// 指针只在第 2 行中线下方一点点：剩余中线在上方的只有第 1、2 行 -> above=2，
// 指针仍在源行（第 0 行）下方 -> 补回 1 -> 3？不对：此时第 3 行中线还没越过。
// 用 mid(2)+1（仍在第 3 行中线上方）：above=2（第 1、2 行），补回 1 -> 3。
// 这里改用 mid(1)+1：只有第 1 行中线在上方 -> above=1，补回 1 -> 2。
ok('首行拖过第一行中线', computeDropIndex(rects, mid(1) + 1, 0), 2)

console.log('')
console.log(`RESULT: ${fail === 0 ? 'PASSED' : 'FAILED'} — ${pass} ok, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
