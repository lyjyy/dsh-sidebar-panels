// dsh-sidebar-panels — Host half.
//
// 这个插件只做浏览器端的界面改造（折叠 / 排序 / 隐藏左侧「全局面板」列表），
// 没有任何 HTTP 路由、存储或 Host 服务，因此 Host 半边是空壳：
// bundle 补丁需要一行可加载的插件条目，顺便让插件在「插件」页有一张带标题的卡片。
export const name = 'dsh-sidebar-panels'

export function apply() {
  /* no host-side behaviour */
}
