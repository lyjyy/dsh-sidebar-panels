// dsh-sidebar-panels — Client half.
//
// 目标：左侧「全局面板」列表可折叠、可排序、可隐藏。
//
// 三条硬约束（决定了实现方式）：
//   1. 经典 script 注入，不能有顶层 import/export，导出走 factory 的 module.exports。
//   2. DSH 的侧栏列表由官方 ui-sidebar 用 React 渲染；**不能重排它的 DOM 节点**，
//      React 的 keyed 列表下次 reconcile 会把顺序改回去。
//      排序改用 CSS `order`（视觉位置），DOM 顺序保持原样；删除改用 `display:none`。
//   3. 状态变更必须持久化（localStorage），否则重启就丢。
//
// 发现方式不依赖 CSS module 的哈希类名（`wtg9ga_panelList` 会随构建变）：
// 用 slots 服务读出每个面板的 id/label，再按 aria-label 在 DOM 里认出各行，
// 取它们共同的父节点当列表容器。
window.__ModuleLoader__.load({
  id: 'dsh-sidebar-panels',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require('react');
    const NS = 'sidebar-panels';
    const STORE_KEY = 'dsh-sidebar-panels:v1';
    const STYLE_ID = 'dsh-sidebar-panels-styles';
    const EXPANDER_ATTR = 'data-spl-expander';
    const ORDER_MORE = 9001;
    // 折叠态保留顺序最前面的几个条目（跳过隐藏项）。
    const COLLAPSED_KEEP = 3;
    // 我们那一行的视觉位置：**始终排在「更多」之后**，折叠与展开都不变。
    // 「更多」的包装元素没有 order（=0），列表行是 1..n，所以取一个稳定的大值即可。
    // 早期折叠态用 -1 把它顶到最前，会让展开行跑到列表顶部；
    // 收起后的展开行应始终在最下面一列，故改用一个稳定的大值。
    const ORDER_EXPANDER = 9002;

    // ── 共享状态 ──
    // 侧栏装饰（纯 DOM）和浮层（React）都读这一份。
    const state = {
      collapsed: false,
      order: [],
      hidden: [],
      overlay: null,
    };
    const listeners = new Set();
    let applyLayout = () => {};

    function snapshot() {
      return {
        collapsed: state.collapsed,
        order: state.order.slice(),
        hidden: state.hidden.slice(),
        overlay: state.overlay,
      };
    }

    function emit() {
      for (const fn of [...listeners]) fn();
    }

    function subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    }

    function storage() {
      try {
        if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
      } catch {
        /* storage may be disabled */
      }
      return null;
    }

    function loadSaved() {
      const ls = storage();
      if (ls === null) return;
      try {
        const raw = ls.getItem(STORE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object') return;
        state.collapsed = parsed.collapsed === true;
        state.order = Array.isArray(parsed.order) ? parsed.order.filter((x) => typeof x === 'string') : [];
        state.hidden = Array.isArray(parsed.hidden) ? parsed.hidden.filter((x) => typeof x === 'string') : [];
      } catch {
        /* a corrupt value must never block the feature */
      }
    }

    function save() {
      const ls = storage();
      if (ls === null) return;
      try {
        ls.setItem(STORE_KEY, JSON.stringify({
          collapsed: state.collapsed,
          order: state.order,
          hidden: state.hidden,
        }));
      } catch {
        /* quota or disabled storage: keep the in-memory state */
      }
    }

    /** Re-apply the layout without emitting (used from the DOM sync loop). */
    function commit(patch) {
      Object.assign(state, patch);
      save();
      applyLayout();
      emit();
    }

    // ── 面板清单（来自 slots 服务，不是 DOM 猜的） ──
    let slotsRef = null;

    function resolveLabel(label) {
      if (typeof label === 'function') {
        try { return String(label()); } catch { return ''; }
      }
      return typeof label === 'string' ? label : '';
    }

    function panelEntries() {
      const slots = slotsRef;
      if (!slots || typeof slots.entriesOfSlot !== 'function') return [];
      let rows;
      try { rows = slots.entriesOfSlot('sidebar.panellist'); } catch { return []; }
      if (!Array.isArray(rows)) return [];
      const list = [];
      for (const row of rows) {
        const options = row && row.options ? row.options : null;
        if (!options || options.id === undefined || options.id === null) continue;
        const label = resolveLabel(options.label);
        list.push({
          id: String(options.id),
          label,
          order: Number.isFinite(Number(options.order)) ? Number(options.order) : 0,
        });
      }
      // 官方侧栏用同一个比较器（order 升序，稳定排序）。
      list.sort((a, b) => a.order - b.order);
      return list;
    }

    /**
     * 在 DOM 里认出官方列表：行是带 `aria-label` 的按钮，同一父节点下成组出现。
     * 只认「同父节点下至少两行」的组，避免把别处的同名按钮算进来。
     */
    function locate() {
      if (typeof document === 'undefined') return null;
      const entries = panelEntries();
      if (entries.length === 0) return null;

      const byLabel = new Map();
      for (const entry of entries) {
        if (entry.label === '') continue;
        const bucket = byLabel.get(entry.label);
        if (bucket === undefined) byLabel.set(entry.label, [entry.id]);
        else bucket.push(entry.id);
      }

      const groups = new Map();
      const buttons = document.querySelectorAll('button[aria-label]');
      for (const el of buttons) {
        const label = el.getAttribute('aria-label');
        const bucket = byLabel.get(label);
        if (bucket === undefined) continue;
        const parent = el.parentElement;
        if (parent === null) continue;
        const group = groups.get(parent);
        if (group === undefined) groups.set(parent, [{ el, label }]);
        else group.push({ el, label });
      }

      let best = null;
      for (const [parent, group] of groups) {
        if (group.length < 2) continue;
        if (best === null || group.length > best.group.length) best = { parent, group };
      }
      if (best === null) return null;

      const nav = best.parent;
      // 只取直接子节点里的按钮 = 列表行（More 那行在包装元素里，不算）。
      const domButtons = [];
      for (const child of nav.children) {
        if (typeof child.matches === 'function' && child.matches('button[aria-label]')) {
          domButtons.push(child);
        }
      }
      const rows = [];
      const consumed = new Map();
      for (const el of domButtons) {
        const label = el.getAttribute('aria-label');
        const bucket = byLabel.get(label) || [];
        const used = consumed.get(label) || 0;
        consumed.set(label, used + 1);
        // 同名的多个面板按出现顺序依次配对；配不上就跳过（不去猜）。
        const id = bucket[used];
        if (id === undefined) continue;
        rows.push({ id, label, el });
      }
      if (rows.length === 0) return null;
      return { nav, rows };
    }

    /** More 那一行的包装元素：里面有 aria-haspopup=menu 的按钮。 */
    function moreChild(nav) {
      for (const child of nav.children) {
        if (typeof child.querySelector !== 'function') continue;
        if (child.querySelector('[aria-haspopup="menu"]') !== null) return child;
      }
      return null;
    }

    /** 我们自己的展开/提示行：DOM 追加到列表末尾，靠 CSS order 定位置。 */
    function ensureExpander(nav) {
      let el = nav.querySelector('[' + EXPANDER_ATTR + ']');
      if (el !== null) return el;
      el = document.createElement('div');
      el.setAttribute(EXPANDER_ATTR, '1');
      el.className = 'spl-expander';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'spl-expander-btn';
      button.setAttribute('aria-label', 'sidebar panels expander');
      el.appendChild(button);
      const gear = document.createElement('button');
      gear.type = 'button';
      gear.className = 'spl-expander-gear';
      gear.setAttribute('aria-label', 'sidebar panels manager');
      gear.textContent = '⋯';
      el.appendChild(gear);
      el.__splButton = button;
      el.__splGear = gear;
      nav.appendChild(el);
      return el;
    }

    function paintExpander(nav, entries, hiddenCount, translate) {
      const el = ensureExpander(nav, entries, hiddenCount);
      const button = el.__splButton;
      const gear = el.__splGear;
      const total = entries.length;
      const collapsed = state.collapsed;
      // 常驻可见：折叠 / 隐藏都从这一行进入。默认展开态它就是「收起列表」入口。
      // 位置固定排在「更多」之后，不随折叠状态上下跳。
      el.style.display = '';
      el.style.order = String(ORDER_EXPANDER);
      const label = collapsed
        ? translate('expanderCollapsed', { n: total })
        : translate('expanderExpanded') + (hiddenCount > 0 ? ' · ' + translate('expanderHidden', { n: hiddenCount }) : '');
      if (button.__splLabel !== label) {
        button.__splLabel = label;
        button.textContent = label;
      }
      button.setAttribute('title', collapsed ? translate('expandTip') : translate('manageTip'));
      // 齿轮常驻：折叠态也要能进管理面板（否则只能靠右键面板行，不直观）。
      if (gear !== null && gear !== undefined) {
        gear.style.display = '';
      }
      return el;
    }

    // ── 排版应用 ──
    function mergeOrder(ids) {
      const known = [];
      for (const id of state.order) {
        if (ids.indexOf(id) !== -1 && known.indexOf(id) === -1) known.push(id);
      }
      for (const id of ids) {
        if (known.indexOf(id) === -1) known.push(id);
      }
      return known;
    }

    /**
     * 把保存的折叠/顺序/隐藏状态刷到官方列表上。
     * 只写 style，不移动节点 —— React 的 keyed 列表下次 reconcile 不会打架。
     */
    function layout(translate) {
      const found = locate();
      if (found === null) return null;
      const { nav, rows } = found;
      const entries = panelEntries();
      const ids = rows.map((row) => row.id);
      const merged = mergeOrder(ids);
      if (merged.join('|') !== state.order.join('|')) {
        state.order = merged;
        save();
      }
      // 折叠态保留**用户排序结果里最前面的 COLLAPSED_KEEP 个**（跳过被隐藏的）。
      // 关键：判据必须走 merged（用户排序），不能按 DOM 顺序数——
      // 官方 DOM 的物理顺序是注册顺序，用户排过序之后两者不同，
      // 早期版本按 rows 循环计数，于是留下的是「注册顺序的前三个」，看着像没理会排序。
      const keptIds = [];
      if (state.collapsed) {
        for (const id of merged) {
          if (keptIds.length >= COLLAPSED_KEEP) break;
          if (state.hidden.indexOf(id) !== -1) continue;
          keptIds.push(id);
        }
      }

      for (const row of rows) {
        const index = merged.indexOf(row.id);
        const hidden = state.hidden.indexOf(row.id) !== -1;
        const collapseOut = state.collapsed && keptIds.indexOf(row.id) === -1;
        if (hidden || collapseOut) {
          row.el.style.display = 'none';
          continue;
        }
        row.el.style.order = String(index + 1);
        row.el.style.display = '';
      }

      const more = moreChild(nav);
      if (more !== null) {
        more.style.order = String(ORDER_MORE);
        more.style.display = '';
      }

      const hiddenCount = state.hidden.length;
      const expander = paintExpander(nav, entries, hiddenCount, translate);
      if (expander !== null && expander.__splButton) {
        const button = expander.__splButton;
        button.onclick = (event) => {
          event.stopPropagation();
          commit({ collapsed: !state.collapsed });
        };
        const gear = expander.__splGear;
        if (gear !== null && gear !== undefined) {
          gear.onclick = (event) => {
            event.stopPropagation();
            openManager(event.currentTarget);
          };
        }
      }
      return found;
    }

    // ── 浮层控制 ──
    function openOverlay(overlay) {
      state.overlay = overlay;
      emit();
      applyLayout();
    }

    function closeOverlay() {
      if (state.overlay === null) return;
      state.overlay = null;
      emit();
    }

    function anchorPoint(target) {
      if (target && typeof target.getBoundingClientRect === 'function') {
        const rect = target.getBoundingClientRect();
        return { x: rect.right + 8, y: rect.bottom - 8 };
      }
      return { x: 48, y: 240 };
    }

    function openManager(target) {
      openOverlay({ mode: 'manager', x: anchorPoint(target).x, y: anchorPoint(target).y });
    }

    function openRowMenu(id, x, y) {
      openOverlay({ mode: 'menu', id, x, y });
    }

    // ── 排序操作 ──
    function moveId(id, delta) {
      const found = locate();
      const ids = found === null ? state.order.slice() : mergeOrder(found.rows.map((row) => row.id));
      const from = ids.indexOf(id);
      if (from === -1) return;
      const to = from + delta;
      if (to < 0 || to >= ids.length) return;
      ids.splice(from, 1);
      ids.splice(to, 0, id);
      commit({ order: ids });
    }

    function moveIdTo(id, index) {
      const found = locate();
      const ids = found === null ? state.order.slice() : mergeOrder(found.rows.map((row) => row.id));
      const from = ids.indexOf(id);
      if (from === -1) return;
      const to = Math.max(0, Math.min(ids.length - 1, index));
      if (to === from) return;
      ids.splice(from, 1);
      ids.splice(to, 0, id);
      commit({ order: ids });
    }

    function toggleHidden(id) {
      const hidden = state.hidden.slice();
      const at = hidden.indexOf(id);
      if (at === -1) hidden.push(id);
      else hidden.splice(at, 1);
      commit({ hidden });
    }

    function resetAll() {
      commit({ collapsed: false, order: [], hidden: [] });
    }

    // ── React 组件 ──
    function useStore() {
      const [snap, setSnap] = React.useState(snapshot());
      React.useEffect(() => subscribe(() => setSnap(snapshot())), []);
      return snap;
    }

    function clampToViewport(point, size) {
      const width = typeof window !== 'undefined' ? window.innerWidth : 1280;
      const height = typeof window !== 'undefined' ? window.innerHeight : 800;
      return {
        left: Math.max(8, Math.min(point.x, width - size.w - 8)),
        top: Math.max(8, Math.min(point.y, height - size.h - 8)),
      };
    }

    function Overlay({ t }) {
      const snap = useStore();
      const overlay = snap.overlay;
      if (overlay === null) return null;
      const size = overlay.mode === 'manager' ? { w: 292, h: 372 } : { w: 208, h: 196 };
      const spot = clampToViewport(overlay, size);
      const card = overlay.mode === 'manager'
        ? React.createElement(ManagerCard, { t, snap })
        : React.createElement(RowMenuCard, { t, snap, id: overlay.id });
      return React.createElement('div', {
        className: 'spl-backdrop',
        onPointerDown: (event) => { event.stopPropagation(); closeOverlay(); },
        onContextMenu: (event) => { event.preventDefault(); closeOverlay(); },
      }, React.createElement('div', {
        className: 'spl-card',
        style: { left: spot.left + 'px', top: spot.top + 'px' },
        onPointerDown: (event) => event.stopPropagation(),
      }, card));
    }

    function RowMenuCard({ t, id }) {
      const entries = panelEntries();
      const entry = entries.find((item) => item.id === id) || { id, label: id };
      const found = locate();
      const ids = found === null ? state.order.slice() : mergeOrder(found.rows.map((row) => row.id));
      const at = ids.indexOf(id);
      const isHidden = state.hidden.indexOf(id) !== -1;
      const item = (label, glyph, onClick, disabled) => React.createElement('button', {
        type: 'button',
        className: 'spl-menu-item',
        disabled: disabled === true,
        onClick,
      }, React.createElement('span', { className: 'spl-menu-glyph' }, glyph),
        React.createElement('span', { className: 'spl-menu-text' }, label));
      return React.createElement('div', { className: 'spl-section' },
        React.createElement('div', { className: 'spl-card-title', title: entry.label }, entry.label),
        item(t('moveUp'), '↑', () => moveId(id, -1), at <= 0),
        item(t('moveDown'), '↓', () => moveId(id, 1), at === -1 || at >= ids.length - 1),
        item(isHidden ? t('show') : t('hide'), isHidden ? '◻' : '◼', () => toggleHidden(id)),
        item(t('manage'), '⋯', () => openOverlay({ mode: 'manager', x: 300, y: 240 })));
    }

    /**
     * 计算拖动落点索引（纯函数，可单测）。
     *
     * 语义：**先把自己从列表里拿掉**，再数「中线在指针上方的行」= 插入位置。
     * 因为基准是「移除自己之后」的坐标轴，指针落到源行中线以下时，
     * 被移除的那一格原本占一个名额，要补回来。
     *
     * 注意：这一版与原「直接找指针越过的第一行」在数学上等价（已用判别性验证确认：
     * 把实现换回旧写法，drop-index 测试不会红）。改写成纯函数的目的不是修 bug，
     * 而是让这段判定**可以脱离真实拖拽被单测覆盖**——手感本身仍需要人验。
     *
     * @param {Array<{top:number,height:number}>} rects 各行按当前视觉顺序的矩形。
     * @param {number} pointerY 指针的视口 y。
     * @param {number} fromIndex 被拖行在 rects 里的下标。
     * @returns {number} 目标插入索引，范围 [0, rects.length - 1]。
     */
    function computeDropIndex(rects, pointerY, fromIndex) {
      const last = rects.length - 1;
      if (last < 0) return 0;
      let above = 0;
      for (let i = 0; i < rects.length; i += 1) {
        if (i === fromIndex) continue;
        const rect = rects[i];
        if (!rect) continue;
        if (rect.top + rect.height / 2 < pointerY) above += 1;
      }
      // 指针落到源行中线以下时，被移除的那格要补回来（否则往下拖总差一格）；
      // 指针在源行中线以上，被移除的格本来就在插入点之后，不用补。
      const self = rects[fromIndex];
      if (self && pointerY > self.top + self.height / 2) above += 1;
      return Math.max(0, Math.min(above, last));
    }

    function ManagerCard({ t, snap }) {
      const entries = panelEntries();
      const merged = mergeOrder(entries.map((entry) => entry.id));
      const listRef = React.useRef(null);
      const dragRef = React.useRef(null);

      function rowElements() {
        const host = listRef.current;
        if (host === null || typeof host.querySelectorAll !== 'function') return [];
        const out = [];
        for (const el of host.querySelectorAll('[data-spl-row]')) out.push(el);
        return out;
      }

      function onHandleDown(event, id) {
        // 只在按钮上按下时不启动拖动：这一行其余部分都是拖动区域。
        const target = event.target;
        if (target && typeof target.closest === 'function' && target.closest('button') !== null) return;
        event.preventDefault();
        event.stopPropagation();
        dragRef.current = { id };
        // 拖动期间标记到 body 上，让整张卡片都显示抓取光标，指针跑出卡片也不断。
        if (typeof document !== 'undefined') document.body.classList.add('spl-dragging');
        const move = (moveEvent) => {
          if (dragRef.current === null) return;
          const rows = rowElements();
          if (rows.length === 0) return;
          const rects = [];
          let fromIndex = -1;
          for (let i = 0; i < rows.length; i += 1) {
            const rect = rows[i].getBoundingClientRect();
            rects.push({ top: rect.top, height: rect.height });
            if (rows[i].getAttribute('data-spl-row') === id) fromIndex = i;
          }
          if (fromIndex === -1) return;
          moveIdTo(id, computeDropIndex(rects, moveEvent.clientY, fromIndex));
        };
        const up = () => {
          dragRef.current = null;
          if (typeof document !== 'undefined') document.body.classList.remove('spl-dragging');
          if (typeof window !== 'undefined') {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
          }
        };
        if (typeof window !== 'undefined') {
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
          window.addEventListener('pointercancel', up);
        }
      }

      const rows = merged.map((id, index) => {
        const entry = entries.find((item) => item.id === id) || { id, label: id };
        const hidden = snap.hidden.indexOf(id) !== -1;
        return React.createElement('div', {
          key: id,
          className: 'spl-row' + (hidden ? ' spl-row-hidden' : ''),
          'data-spl-row': id,
          title: t('dragTip'),
          onPointerDown: (event) => onHandleDown(event, id),
        },
          React.createElement('span', {
            className: 'spl-grip',
            'aria-hidden': 'true',
          }, '⋮⋮'),
          React.createElement('span', { className: 'spl-row-label', title: entry.label }, entry.label),
          React.createElement('button', {
            type: 'button', className: 'spl-row-btn', disabled: index === 0,
            title: t('moveUp'), onClick: () => moveId(id, -1),
          }, '↑'),
          React.createElement('button', {
            type: 'button', className: 'spl-row-btn', disabled: index === merged.length - 1,
            title: t('moveDown'), onClick: () => moveId(id, 1),
          }, '↓'),
          React.createElement('button', {
            type: 'button',
            className: 'spl-row-btn spl-row-toggle',
            title: hidden ? t('show') : t('hide'),
            onClick: () => toggleHidden(id),
          }, hidden ? '◻' : '◼'),
        );
      });

      return React.createElement('div', { className: 'spl-section' },
        React.createElement('div', { className: 'spl-card-title' }, t('managerTitle')),
        React.createElement('div', { className: 'spl-hint' }, t('managerHint')),
        React.createElement('div', { className: 'spl-list', ref: listRef }, rows),
        React.createElement('div', { className: 'spl-actions' },
          React.createElement('button', {
            type: 'button', className: 'spl-pill',
            onClick: resetAll,
          }, t('reset')),
          React.createElement('button', {
            type: 'button', className: 'spl-pill spl-pill-primary',
            onClick: closeOverlay,
          }, t('done')),
        ));
    }

    /**
     * 「更多」菜单里的一行：打开管理页。
     * 折叠切换不在这里——侧栏列表末尾的入口行已经管着它（用户要求去掉重复入口）。
     */
    function MoreMenuRows({ t, onDismiss }) {
      const row = (label, glyph, onClick) => React.createElement('button', {
        type: 'button',
        className: 'spl-menu-item',
        onClick: () => {
          if (typeof onDismiss === 'function') onDismiss();
          onClick();
        },
      }, React.createElement('span', { className: 'spl-menu-glyph' }, glyph),
        React.createElement('span', { className: 'spl-menu-text' }, label));
      return React.createElement(React.Fragment, null,
        row(t('manage'), '⋯', () => openOverlay({ mode: 'manager', x: 300, y: 240 })));
    }

    // ── 样式 ──
    function installStyles() {
      if (typeof document === 'undefined') return;
      if (document.getElementById(STYLE_ID) !== null) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
    /* 我们插进侧栏列表的那一行（展开 / 已隐藏计数） */
    .spl-expander { display: flex; align-items: center; gap: 2px; margin-top: 2px; }
    .spl-expander-btn {
      flex: 1; min-width: 0;
      display: flex; align-items: center; gap: 8px;
      min-height: 32px; padding: 6px 8px;
      border: none; background: transparent; cursor: pointer; text-align: left;
      border-radius: var(--dsw-radius-md, 6px);
      color: var(--dsw-alias-label-secondary, #888); font-size: 12.5px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      -webkit-app-region: no-drag;
    }
    .spl-expander-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.16)); }
    .spl-expander-gear {
      flex: none; width: 24px; height: 24px; padding: 0; margin-right: 2px;
      border: none; background: transparent; cursor: pointer; border-radius: 4px;
      color: var(--dsw-alias-label-secondary, #888); font-size: 13px; line-height: 1;
      -webkit-app-region: no-drag;
    }
    .spl-expander-gear:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.16)); color: var(--dsw-alias-label-primary, #eee); }

    /* 浮层：整屏透明背板 + 卡片 */
    .spl-backdrop {
      position: fixed; inset: 0; z-index: 900; background: transparent;
      pointer-events: auto; -webkit-app-region: no-drag;
    }
    .spl-card {
      position: fixed; min-width: 180px; max-width: 300px;
      background: var(--dsw-alias-bg-layer-1, #2a2a2a);
      border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35));
      border-radius: 10px; padding: 6px;
      box-shadow: 0 10px 28px rgba(0,0,0,0.32);
      color: var(--dsw-alias-label-primary, #eee);
      -webkit-app-region: no-drag;
    }
    .spl-section { display: flex; flex-direction: column; gap: 4px; }
    .spl-card-title {
      font-size: 12.5px; font-weight: 600; padding: 4px 8px 2px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      max-width: 260px;
    }
    .spl-hint { font-size: 11px; opacity: 0.55; padding: 0 8px 4px; line-height: 1.4; }
    .spl-menu-item {
      display: flex; align-items: center; gap: 8px; width: 100%;
      border: none; background: transparent; cursor: pointer; text-align: left;
      color: var(--dsw-alias-label-primary, #eee); font-size: 12.5px;
      padding: 7px 8px; border-radius: 6px;
      -webkit-app-region: no-drag;
    }
    .spl-menu-item:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.16)); }
    .spl-menu-item:disabled { opacity: 0.35; cursor: default; }
    .spl-menu-glyph { flex: none; width: 14px; text-align: center; opacity: 0.7; }
    .spl-menu-text { white-space: nowrap; }

    .spl-list {
      max-height: 216px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px;
      padding: 2px 0;
    }
    .spl-row {
      display: flex; align-items: center; gap: 6px;
      /* 整行都是拖动区域：命中面积等于行高，不用去戳那个小把手。 */
      padding: 6px 6px; border-radius: 6px;
      cursor: grab; user-select: none; touch-action: none;
    }
    .spl-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.12)); }
    .spl-row-hidden .spl-row-label { opacity: 0.4; text-decoration: line-through; }
    .spl-grip {
      flex: none; opacity: 0.45; font-size: 10px; letter-spacing: -2px;
      padding: 0 2px; pointer-events: none;
    }
    body.spl-dragging, body.spl-dragging * { cursor: grabbing !important; }
    .spl-row-label {
      flex: 1; min-width: 0; font-size: 12.5px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .spl-row-btn {
      flex: none; border: none; background: transparent; cursor: pointer;
      width: 20px; height: 20px; border-radius: 4px; padding: 0;
      color: var(--dsw-alias-label-secondary, #999); font-size: 12px; line-height: 1;
      -webkit-app-region: no-drag;
    }
    .spl-row-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.2)); color: var(--dsw-alias-label-primary, #eee); }
    .spl-row-btn:disabled { opacity: 0.25; cursor: default; }
    .spl-actions { display: flex; gap: 6px; padding: 6px 4px 2px; }
    .spl-pill {
      flex: 1; border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35));
      background: transparent; color: var(--dsw-alias-label-primary, #eee);
      cursor: pointer; border-radius: 6px; padding: 5px 8px; font-size: 12px;
      white-space: nowrap; -webkit-app-region: no-drag;
    }
    .spl-pill:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.16)); }
    .spl-pill-primary {
      background: var(--dsw-alias-state-business-primary, #4f7cff); border-color: transparent; color: #fff;
    }
    .spl-pill-primary:hover { filter: brightness(1.08); }
  `;
      document.head.appendChild(style);
    }

    // ── apply ──
    function apply(ctx) {
      const get = (name) => {
        if (typeof ctx.get === 'function') { try { return ctx.get(name); } catch { return undefined; } }
        return ctx[name];
      };
      const h = React.createElement;

      // 字典
      const dict = {
        zh: {
          managerTitle: '侧边栏面板列表',
          managerHint: '拖动 ⋮⋮ 排序；◼ 隐藏该入口；设置随重启保留',
          expandTip: '展开面板列表',
          manageTip: '打开面板列表管理',
          expanderCollapsed: '▸ 展开面板列表（共 {n} 项）',
          expanderExpanded: '▾ 收起面板列表',
          expanderHidden: '已隐藏 {n} 项',
          hide: '隐藏此入口',
          show: '恢复到列表',
          moveUp: '上移',
          moveDown: '下移',
          dragTip: '拖动排序',
          manage: '管理面板列表…',
          reset: '恢复默认',
          done: '完成',
        },
        en: {
          managerTitle: 'Sidebar panel list',
          managerHint: 'Drag ⋮⋮ to reorder; ◼ hides an entry; settings persist across restarts',
          expandTip: 'Expand the panel list',
          manageTip: 'Open the panel list manager',
          expanderCollapsed: '▸ Expand panel list ({n} items)',
          expanderExpanded: '▾ Collapse panel list',
          expanderHidden: '{n} hidden',
          hide: 'Hide this entry',
          show: 'Restore to list',
          moveUp: 'Move up',
          moveDown: 'Move down',
          dragTip: 'Drag to reorder',
          manage: 'Manage panel list…',
          reset: 'Reset to default',
          done: 'Done',
        },
      };

      const locale = get('locale');
      if (locale && typeof locale.register === 'function') {
        ctx.effect(() => locale.register(NS, dict), 'sidebar-panels: dictionaries');
      }
      const translate = locale && typeof locale.bind === 'function'
        ? (() => {
            try {
              const bound = locale.bind(NS);
              return typeof bound === 'function' ? bound : null;
            } catch { return null; }
          })()
        : null;

      const t = (key, params) => {
        if (translate !== null) {
          try { return translate(key, params); } catch { /* fall through */ }
        }
        const active = locale && typeof locale.getLocale === 'function'
          ? locale.getLocale().active : 'zh';
        const table = dict[active === 'en' ? 'en' : 'zh'];
        const raw = table[key] !== undefined ? table[key] : dict.zh[key] || key;
        if (params === undefined) return raw;
        return raw.replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])));
      };

      slotsRef = get('slots');
      if (!slotsRef || typeof slotsRef.inject !== 'function' || typeof slotsRef.register !== 'function') {
        console.error('sidebar-panels: slots service unavailable; nothing was mounted');
        return;
      }

      installStyles();
      loadSaved();
      applyLayout = () => { layout(t); };
      applyLayout();

      // 官方列表会被 React 重建：盯住侧栏根节点，变化时重新刷一遍排版。
      ctx.effect(() => {
        if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
          return () => {};
        }
        let timer = null;
        let observer = null;
        let watched = null;
        const schedule = () => {
          if (timer !== null) return;
          timer = setTimeout(() => { timer = null; applyLayout(); }, 60);
        };
        const ensureObserver = () => {
          const found = locate();
          const target = found === null ? null : found.nav.parentElement;
          if (target === null || target === watched) return;
          if (observer !== null) observer.disconnect();
          watched = target;
          observer = new MutationObserver(schedule);
          observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'aria-current', 'class'] });
        };
        ensureObserver();
        const tick = setInterval(() => { ensureObserver(); applyLayout(); }, 900);
        return () => {
          clearInterval(tick);
          if (timer !== null) clearTimeout(timer);
          if (observer !== null) observer.disconnect();
        };
      }, 'sidebar-panels: layout sync');

      // 行上右键：置顶/隐藏等操作菜单。
      ctx.effect(() => {
        if (typeof document === 'undefined') return () => {};
        const onContext = (event) => {
          const found = locate();
          if (found === null) return;
          const target = event.target;
          if (!target || typeof target.closest !== 'function') return;
          const button = target.closest('button[aria-label]');
          if (button === null) return;
          const row = found.rows.find((candidate) => candidate.el === button || candidate.el.contains(button));
          if (row === undefined) return;
          event.preventDefault();
          event.stopPropagation();
          openRowMenu(row.id, event.clientX, event.clientY);
        };
        document.addEventListener('contextmenu', onContext, true);
        return () => document.removeEventListener('contextmenu', onContext, true);
      }, 'sidebar-panels: context menu');

      // 浮层：一个常驻组件，打开时才画卡片。
      slotsRef.inject('shell.overlay', () => slotsRef.register(
        { name: 'shell.overlay', id: 'sidebar-panels-overlay', order: 62 },
        () => h(Overlay, { t }),
      ));

      // 「更多」菜单两行：折叠切换 + 管理。
      slotsRef.inject('sidebar.panellist.actions', () => slotsRef.register(
        { name: 'sidebar.panellist.actions', id: 'sidebar-panels', order: 10, locale: NS },
        (props) => h(MoreMenuRows, { t, onDismiss: props && props.onDismiss }),
      ));

      // 外部点击 / Esc 关闭浮层。
      ctx.effect(() => {
        if (typeof document === 'undefined') return () => {};
        const onKey = (event) => {
          if (event.key === 'Escape') closeOverlay();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, 'sidebar-panels: escape');

      exports.__internal = {
        state,
        applyLayout: () => layout(t),
        locate,
        panelEntries,
        moveId,
        moveIdTo,
        toggleHidden,
        commit,
        openRowMenu,
        openManager,
        closeOverlay,
        t,
      };
    }

    exports.apply = apply;
    exports.inject = ['slots', 'locale'];
    return module.exports;
  },
});
