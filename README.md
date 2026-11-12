# 侧边栏面板列表 · dsh-sidebar-panels

[![license](https://img.shields.io/github/license/lyjyy/dsh-sidebar-panels?style=flat-square)](LICENSE)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 左侧栏那一列「全局面板」（插件 / 插件市场 / 自动化任务 / … / 更多）加上**折叠、排序、隐藏**三项能力。设置存在 localStorage，重启后保留。

## 安装

```bash
dsh plugin add github:lyjyy/dsh-sidebar-panels
```

装完重启 DSH。

> **版本要求**：0.2.0 起要求 DSH `>=0.2.2-rc.2`（`package.json` 的 `engines.dsh`）。若你还在更早的 DSH 上，请装 0.1.0。

## 功能

- **折叠**：列表收起成一行「▸ 展开面板列表（共 N 项）」，**保留顺序最前面的 3 项**（跳过被隐藏的），其余收起。
- **排序**：管理面板里**整行都是拖动区**（不用瞄准那个小把手），也可以用 `↑` `↓` 按钮调整顺序。行内按钮上按下不会触发拖动。
- **隐藏**：`◼` 隐藏某个入口。隐藏后底部那行会提示「已隐藏 N 项」，点齿轮能进管理面板恢复。
- **管理入口**：列表末尾一行 `▾ 收起面板列表`，右侧 `⋯` 打开管理面板。也可以右键任意面板行，就地看到该行的上移 / 下移 / 隐藏。
- **恢复默认**：管理面板里的「恢复默认」清空顺序与隐藏记录，回到出厂状态。
- **收起开关只有一处**：折叠只在列表末尾那一行。管理面板和「更多」菜单里都没有重复的收起按钮。

## 交互约定

- **不重排 DOM，只用 CSS `order`**：官方侧栏是 React 的 keyed 列表，直接移动节点会被下一次 reconcile 挪回去。排序改 `style.order`，隐藏改 `style.display`。
- **不认 CSS module 哈希类名**（`wtg9ga_panelList` 会随构建变）。列表行靠 `aria-label` 与 slots 服务拿到的面板 id / label 配对识别。
- **列表锚点是「更多」按钮**，不是面板行本身：官方在本插件注册 `sidebar.panellist.actions` 时必然渲染那个 `aria-haspopup="menu"` 的按钮，取它 `closest('nav')` 比认行结构稳。行结构变过好几次（见下），这个锚点没变过。
- **行容器与行按钮分开记**：0.2.2-rc.2 起每行是 `<div class="panelEntry">` 包着 `<button aria-label>`；`order` / `display` 必须写在容器上，否则藏不掉容器里的官方「取消固定」小图钉。
- **「更多」不是面板行**：它带 `aria-haspopup="menu"`，识别时显式排除。漏排会让它冒充某个「已注册但被官方图钉从 DOM 里摘掉」的面板，把整行 id 对错。
- **不打断侧栏自己的状态**：折叠只是视觉隐藏，主面板、当前选中态、官方「更多」菜单的行为都不变。
- **右键菜单**：在面板行上右键打开该行的操作菜单（上移 / 下移 / 隐藏 / 管理）。
- **Esc 或点空白**关闭浮层。
- **整行可拖**：拖动命中区等于整个行高，拖动中整块区域显示抓取光标。

## 存储

键名 `dsh-sidebar-panels:v1`，值形如：

```json
{ "collapsed": false, "order": ["plugins", "bazaar", "..."], "hidden": [] }
```

`order` 的 id 宇宙是**全部已注册的面板**（来自 slots 服务），不是「DOM 里当前渲染出来的行」——两者不等。0.2.2-rc.2 的官方图钉会把面板从渲染列表里摘掉但仍然是注册的，只有「真的注销了」的 id 才会从 `order` 里剪掉，这样点一下小图钉不会把用户排好的位次永久抹掉。

## 与官方「取消固定」的关系

0.2.2-rc.2 起官方自带一套面板固定/取消固定：宽态行悬停出现小图钉，「更多」菜单里可重新固定。两套机制不冲突，分工如下：

| | 本插件的「隐藏」 | 官方的「取消固定」 |
|---|---|---|
| 持久化 | localStorage，跨重启保留 | 内存态，插件重载即重置 |
| 入口 | 管理面板 / 右键菜单 | 行上小图钉 / 更多菜单 |
| 顺序 | 尊重本插件的排序 | 被取消固定的面板保留位次 |

## 已知限制

- 依赖官方侧栏的**两步锚点**：`nav` 里有带 `aria-haspopup="menu"` 的按钮（更多），行按钮的 `aria-label` 与 slot label 对得上。DSH 再改版可能要跟着修——但认不出时现在会在控制台打一条 `sidebar-panels: could not locate the sidebar panel list` 的 warn，不会再静默失效。
- 排序只作用于**左侧栏的全局面板列表**；「工作区 / 会话」列表不在此插件范围。
- 隐藏是「从列表里消失」，不是卸载插件：对应的主面板仍可用 URL / 快捷键等方式进入。
- 「收起为 56px 轨道」的侧栏形态下未做专门适配（轨道形态官方本来就把整个面板列表隐藏；此时本插件不做额外折叠，保证展开回宽态时入口还在）。

## 开发

```bash
node test/selfcheck.mjs   # 63 项结构自检
node test/drop-index.mjs  # 15 项拖动落点纯函数单测
node test/row-match.mjs   # 15 项「DOM 行 ↔ slot 面板」配对单测
node test/locate-rc2.mjs  # 18 项 locate() 全链路单测（照着 0.2.2-rc.2 真实 DOM 捏的假 DOM）
```

> 仓库里只放插件本身。内部交接、迁移说明这类含本机路径的过程文档一律不进本仓库（放 E 盘私有归档区），别依赖 `.gitignore` 兜底。

自检里的断言能用注释剥离、能真正变红——改错实现就会 FAIL。`locate-rc2.mjs` 尤其值得留意：它用一份照着实测快照捏出来的假 DOM 跑 `locate()`，这一版就是靠它抓出了「更多」按钮冒充面板行的问题。插件是纯浏览器端改造（`index.js` 的 host 半边是空壳），**改完不用重启 DSH**，刷新页面即可。

## 版本

当前 **0.2.1**。历史版本见 [Releases](https://github.com/lyjyy/dsh-sidebar-panels/releases)。

- **0.2.1**：仓库清理版，无运行时变更。删掉误提交进公开仓库的内部迁移说明（含本机路径），收敛 `client.js` 的导出面，`.gitignore` 补上同类文档规则。
- **0.2.0**：适配 DSH 0.2.2-rc.2 的侧边栏行结构（`div.panelEntry` 包裹）。此前 0.1.0 在新版上静默失效：`locate()` 认不出任何行，折叠/排序/隐藏全都不生效。同时修掉「官方取消固定会把用户排序位次抹掉」的回归，并为 56px 轨道形态加了可达性守卫。
- **0.1.0**：首个版本。

## 许可证

[MIT](LICENSE)

---

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
