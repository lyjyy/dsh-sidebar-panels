# 侧边栏面板列表 · dsh-sidebar-panels

[![license](https://img.shields.io/github/license/lyjyy/dsh-sidebar-panels?style=flat-square)](LICENSE)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 左侧栏那一列「全局面板」（插件 / 插件市场 / 自动化任务 / … / 更多）加上**折叠、排序、隐藏**三项能力。设置存在 localStorage，重启后保留。

## 安装

```bash
dsh plugin add github:lyjyy/dsh-sidebar-panels
```

装完重启 DSH。

## 功能

- **折叠**：列表收起成一行「▸ 展开面板列表（共 N 项）」，**保留顺序最前面的 3 项**（跳过被隐藏的），其余收起。
- **排序**：管理面板里**整行都是拖动区**（不用瞄准那个小把手），也可以用 `↑` `↓` 按钮调整顺序。行内按钮上按下不会触发拖动。
- **隐藏**：`◼` 隐藏某个入口。隐藏后底部那行会提示「已隐藏 N 项」，点齿轮能进管理面板恢复。
- **管理入口**：列表末尾一行 `▾ 收起面板列表`，右侧 `⋯` 打开管理面板。也可以右键任意面板行，就地看到该行的上移 / 下移 / 隐藏。
- **恢复默认**：管理面板里的「恢复默认」清空顺序与隐藏记录，回到出厂状态。
- **收起开关只有一处**：折叠只在列表末尾那一行。管理面板和「更多」菜单里都没有重复的收起按钮。

## 交互约定

- **不重排 DOM，只用 CSS `order`**：官方侧栏是 React 的 keyed 列表，直接移动节点会被下一次 reconcile 挪回去。排序改 `style.order`，隐藏改 `style.display`。
- **不认 CSS module 哈希类名**（`wtg9ga_panelList` 会随构建变）。列表行靠 `aria-label` 与 slots 服务拿到的面板 id / label 配对识别，取这些行的共同父节点当列表容器。
- **不打断侧栏自己的状态**：折叠只是视觉隐藏，主面板、当前选中态、官方「更多」菜单的行为都不变。
- **右键菜单**：在面板行上右键打开该行的操作菜单（上移 / 下移 / 隐藏 / 管理）。
- **Esc 或点空白**关闭浮层。
- **整行可拖**：拖动命中区等于整个行高，拖动中整块区域显示抓取光标。

## 存储

键名 `dsh-sidebar-panels:v1`，值形如：

```json
{ "collapsed": false, "order": ["plugins", "bazaar", "..."], "hidden": [] }
```

`order` 里不认识的新 id 会被忽略，新注册的面板自动排到末尾——插件增删不会把顺序打乱。

## 已知限制

- 依赖官方侧栏的行结构（`aria-label` + 直接子按钮）。DSH 改版后这里可能要跟着修。
- 排序只作用于**左侧栏的全局面板列表**；「工作区 / 会话」列表不在此插件范围。
- 隐藏是「从列表里消失」，不是卸载插件：对应的主面板仍可用 URL / 快捷键等方式进入。
- 「收起为 56px 轨道」的侧栏形态下未做专门适配。

## 开发

```bash
node test/selfcheck.mjs   # 43 项结构自检
node test/drop-index.mjs  # 15 项拖动落点纯函数单测
```

自检里的断言能用注释剥离、能真正变红——改错实现就会 FAIL。插件是纯浏览器端改造（`index.js` 的 host 半边是空壳），**改完不用重启 DSH**。

## 版本

当前 **0.1.0**。历史版本见 [Releases](https://github.com/lyjyy/dsh-sidebar-panels/releases)。

## 许可证

[MIT](LICENSE)

---

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
