/*
 * 人样后台多页面原型共享交互。
 * 所有交互仅用于展示信息架构、状态与流程，不调用真实接口，也不扩展现有后端能力。
 */

'use strict';

const NAV_GROUPS = [
  {
    label: '工作台',
    items: [
      { id: 'dashboard', label: '今日工作', file: 'dashboard.html', icon: 'home' },
      { id: 'new-task', label: '新建任务', file: 'new-task.html', icon: 'plus' },
      { id: 'task-history', label: '任务记录', file: 'task-history.html', icon: 'history', count: '示例 2' }
    ]
  },
  {
    label: '人物空间',
    items: [
      { id: 'personas', label: '人物', file: 'personas.html', icon: 'person', count: '示例 3' },
      { id: 'worlds', label: '世界', file: 'worlds.html', icon: 'world' },
      { id: 'sources', label: '资料库', file: 'sources.html', icon: 'archive', count: '示例 1' }
    ]
  },
  {
    label: '学习与复盘',
    items: [
      { id: 'learning-center', label: '学习中心', file: 'learning-center.html', icon: 'review', count: '示例 6' },
      { id: 'evaluation-detail', label: '评测', file: 'evaluation-detail.html', icon: 'compare' }
    ]
  },
  {
    label: '系统',
    items: [
      { id: 'templates', label: '内容模板', file: 'templates.html', icon: 'template' },
      { id: 'generation-settings', label: '生成设置', file: 'generation-settings.html', icon: 'sliders' },
      { id: 'system-center', label: '系统中心', file: 'system-center.html', icon: 'settings', count: '示例 1' }
    ]
  }
];

const DETAIL_PARENT = {
  'task-detail': 'task-history',
  'persona-create': 'personas',
  'persona-workspace': 'personas',
  'world-detail': 'worlds',
  'source-detail': 'sources'
};

/*
 * 主题只改变共享语义颜色，不改变成功、警告、失败和目标态能力的业务含义。
 * “雾白”为默认简洁主题，其余主题用于评审不同产品气质。
 */
const THEMES = [
  { id: 'mist', label: '雾白' },
  { id: 'sand', label: '暖砂' },
  { id: 'ocean', label: '海盐' },
  { id: 'sage', label: '松岚' }
];

const ICON_PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-7h6v7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v6h6M12 7v5l3 2"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  world: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  archive: '<path d="M4 5h16v4H4zM5 9v11h14V9M9 13h6"/>',
  review: '<path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5"/>',
  compare: '<path d="M8 3 4 7l4 4M4 7h12M16 13l4 4-4 4M20 17H8"/>',
  template: '<path d="M4 4h16v16H4zM4 9h16M10 9v11"/>',
  sliders: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="7" cy="18" r="2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  collapse: '<path d="m14 6-6 6 6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  activity: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  context: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/>',
  alert: '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  arrow: '<path d="M5 12h14M14 7l5 5-5 5"/>',
  more: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>'
};

/**
 * 生成统一线性 SVG 图标。
 * @param {string} name 图标名称，对应 ICON_PATHS 中的键。
 * @param {string} [className='icon'] 输出 SVG 使用的类名。
 * @returns {string} 可直接插入页面的 SVG 字符串；未知图标返回信息图标。
 */
function iconSvg(name, className) {
  const resolvedClass = className || 'icon';
  const path = ICON_PATHS[name] || ICON_PATHS.info;
  return '<svg class="' + resolvedClass + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
}

/**
 * 生成正式的人样人形字标。
 * @param {string} [className='brand-symbol'] 输出 SVG 使用的类名。
 * @returns {string} 可直接插入品牌区域的装饰性 SVG 字符串。
 * 特殊业务逻辑：头部与右笔画使用主题品牌色，左笔画跟随当前表面前景色；图形本身不重复朗读可见品牌名称。
 */
function brandSymbolSvg(className) {
  const resolvedClass = className || 'brand-symbol';
  return '<svg class="' + resolvedClass + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<circle class="brand-symbol-accent" cx="12" cy="4.6" r="2.6" fill="currentColor"/>' +
    '<path d="M10.3 10 3.7 20.4" fill="none" stroke="currentColor" stroke-width="4.4" stroke-linecap="round"/>' +
    '<path class="brand-symbol-accent" d="M13.7 10 20.3 20.4" fill="none" stroke="currentColor" stroke-width="4.4" stroke-linecap="round"/>' +
    '</svg>';
}

/**
 * 安全读取 localStorage，避免文件预览或隐私模式阻断页面初始化。
 * @param {string} key 存储键。
 * @returns {string|null} 已保存的字符串；读取失败或不存在时返回 null。
 */
function storageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

/**
 * 安全写入 localStorage。
 * @param {string} key 存储键。
 * @param {string} value 待保存的字符串。
 * @returns {void}
 */
function storageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    /* 原型仍可在禁用存储的环境中继续使用。 */
  }
}

/**
 * 校验主题标识，避免无效持久化值导致页面缺少主题令牌。
 * @param {string|null} themeId 待校验的主题标识。
 * @returns {string} 有效主题标识；无效值回退为默认“雾白”。
 */
function resolveThemeId(themeId) {
  for (let index = 0; index < THEMES.length; index += 1) {
    if (THEMES[index].id === themeId) return themeId;
  }
  return THEMES[0].id;
}

/**
 * 生成统一主题选择控件。
 * @param {string} controlId 控件实例标识，用于生成唯一的 select id。
 * @returns {string} 可插入顶部栏或独立页面的主题选择 HTML。
 */
function renderThemeControl(controlId) {
  let options = '';
  for (let index = 0; index < THEMES.length; index += 1) {
    options += '<option value="' + THEMES[index].id + '">' + THEMES[index].label + '</option>';
  }
  return '<label class="theme-control" for="theme-select-' + controlId + '">' +
    '<span class="theme-swatch" aria-hidden="true"></span>' +
    '<span class="visually-hidden">界面主题</span>' +
    '<select class="theme-select" id="theme-select-' + controlId + '" data-theme-select>' + options + '</select>' +
    '</label>';
}

/**
 * 应用主题并同步当前页面内的所有主题选择控件。
 * @param {string|null} themeId 目标主题标识。
 * @param {boolean} persist 是否保存到 localStorage。
 * @returns {void}
 */
function applyTheme(themeId, persist) {
  const resolvedTheme = resolveThemeId(themeId);
  document.documentElement.dataset.theme = resolvedTheme;
  const controls = document.querySelectorAll('[data-theme-select]');
  for (let index = 0; index < controls.length; index += 1) {
    controls[index].value = resolvedTheme;
  }
  if (persist) storageSet('renyang-theme', resolvedTheme);
}

/**
 * 在没有共享顶部栏的总览与认证页面注入独立主题选择器。
 * @returns {void}
 * 特殊业务逻辑：只添加视觉偏好控件，不注入登录后导航或命令面板。
 */
function initStandaloneThemeControl() {
  if (document.querySelector('[data-topbar]') || document.querySelector('[data-standalone-theme-control]')) return;
  document.body.insertAdjacentHTML(
    'beforeend',
    '<div class="standalone-theme-control" data-standalone-theme-control>' + renderThemeControl('standalone') + '</div>'
  );
}

/**
 * 响应用户的主题选择并持久化偏好。
 * @param {Event} event 主题 select 的 change 事件。
 * @returns {void}
 */
function handleThemeChange(event) {
  applyTheme(event.currentTarget.value, true);
}

/**
 * 恢复主题偏好并绑定当前页面的主题选择器。
 * @returns {void}
 */
function initThemeControls() {
  applyTheme(storageGet('renyang-theme'), false);
  const controls = document.querySelectorAll('[data-theme-select]');
  for (let index = 0; index < controls.length; index += 1) {
    controls[index].addEventListener('change', handleThemeChange);
  }
}

/**
 * 根据详情页映射确定侧栏需要高亮的父级页面。
 * @param {string} pageId 当前 HTML 页面标识。
 * @returns {string} 侧栏对应的页面标识。
 */
function resolveActiveNav(pageId) {
  return DETAIL_PARENT[pageId] || pageId;
}

/**
 * 创建一个侧栏导航链接。
 * @param {Object} item 导航项目对象。
 * @param {string} activeId 当前高亮的导航标识。
 * @returns {string} 导航链接 HTML。
 */
function renderNavItem(item, activeId) {
  const current = item.id === activeId ? ' aria-current="page"' : '';
  const count = item.count ? '<span class="nav-count" aria-label="待处理数量，' + item.count + '">' + item.count + '</span>' : '';
  return '<a class="nav-item" href="' + item.file + '" aria-label="' + item.label + '"' + current + '>' +
    iconSvg(item.icon) +
    '<span class="nav-copy">' + item.label + '</span>' +
    count +
    '</a>';
}

/**
 * 创建完整侧栏结构。
 * @param {string} pageId 当前页面标识。
 * @returns {string} 侧栏 HTML。
 */
function renderSidebar(pageId) {
  const activeId = resolveActiveNav(pageId);
  let groups = '';
  for (let groupIndex = 0; groupIndex < NAV_GROUPS.length; groupIndex += 1) {
    const group = NAV_GROUPS[groupIndex];
    let items = '';
    for (let itemIndex = 0; itemIndex < group.items.length; itemIndex += 1) {
      items += renderNavItem(group.items[itemIndex], activeId);
    }
    groups += '<section class="nav-group" data-od-id="shell-nav-group-' + groupIndex + '" aria-labelledby="nav-group-' + groupIndex + '">' +
      '<h2 class="nav-group-title" id="nav-group-' + groupIndex + '">' + group.label + '</h2>' +
      items +
      '</section>';
  }

  return '<div class="sidebar-brand">' +
    '<span class="brand-mark">' + brandSymbolSvg() + '</span>' +
    '<span class="brand-copy"><span class="brand-name">人样</span><span class="brand-sub">Agents, with a human touch.</span></span>' +
    '</div>' +
    '<nav class="sidebar-nav" aria-label="主导航">' + groups + '</nav>' +
    '<div class="sidebar-footer">' +
    '<a class="sidebar-status" href="system-center.html" aria-label="查看系统状态，当前资料同步存在一项失败">' +
    '<span class="signal-dot is-warning" aria-hidden="true"></span>' +
    '<span class="sidebar-status-copy"><strong>系统可用</strong><span>资料同步 1 项待重试</span></span>' +
    '</a>' +
    '</div>';
}

/**
 * 创建顶部上下文工具栏。
 * @returns {string} 顶部工具栏 HTML。
 */
function renderTopbar() {
  return '<div class="topbar-start">' +
    '<button class="icon-button mobile-menu-button" type="button" data-mobile-menu aria-label="打开主导航">' + iconSvg('menu') + '</button>' +
    '<button class="icon-button sidebar-toggle" type="button" data-sidebar-toggle aria-label="折叠或展开主导航">' + iconSvg('collapse') + '</button>' +
    '<button class="command-button" type="button" data-open-command aria-label="打开全局命令面板">' +
    '<span class="command-label">' + iconSvg('search') + '<span>搜索页面或输入命令</span></span>' +
    '<span class="shortcut">Ctrl K</span>' +
    '</button>' +
    '</div>' +
    '<div class="topbar-end">' +
    '<a class="context-button" href="persona-workspace.html">' + iconSvg('context') + '<span>当前人物：顾岚</span></a>' +
    renderThemeControl('topbar') +
    '</div>';
}

/**
 * 将共享应用壳注入当前页面占位区域。
 * @returns {void}
 */
function initShell() {
  const sidebar = document.querySelector('[data-sidebar]');
  const topbar = document.querySelector('[data-topbar]');
  const pageId = document.body.dataset.page || 'dashboard';
  if (sidebar) {
    sidebar.innerHTML = renderSidebar(pageId);
  }
  if (topbar) {
    topbar.innerHTML = renderTopbar();
  }
  if (storageGet('renyang-sidebar-collapsed') === 'true') {
    document.body.classList.add('sidebar-collapsed');
  }
}

/**
 * 创建全局命令面板中的页面列表。
 * @returns {string} 命令项目 HTML。
 */
function renderCommandItems() {
  let output = '';
  for (let groupIndex = 0; groupIndex < NAV_GROUPS.length; groupIndex += 1) {
    const group = NAV_GROUPS[groupIndex];
    for (let itemIndex = 0; itemIndex < group.items.length; itemIndex += 1) {
      const item = group.items[itemIndex];
      output += '<button class="command-item" type="button" data-command-href="' + item.file + '" data-command-text="' + group.label + ' ' + item.label + '">' +
        iconSvg(item.icon) +
        '<span><strong>' + item.label + '</strong><small>' + group.label + '</small></span>' +
        '<span class="meta">打开</span>' +
        '</button>';
    }
  }
  output += '<button class="command-item" type="button" data-command-href="persona-create.html" data-command-text="建立人物 创建人物">' +
    iconSvg('plus') + '<span><strong>建立人物</strong><small>人物空间</small></span><span class="meta">打开</span></button>';
  return output;
}

/**
 * 注入命令面板、抽屉遮罩和状态播报区域。
 * @returns {void}
 */
function initGlobalOverlays() {
  if (document.querySelector('[data-toast-region]')) return;

  let overlays = '<div class="toast-region" aria-live="polite" aria-atomic="true" data-toast-region></div>';
  if (document.querySelector('[data-sidebar]')) {
    overlays = '<button class="drawer-backdrop" type="button" data-drawer-backdrop aria-label="关闭主导航"></button>' +
      '<dialog class="dialog command-dialog" data-command-dialog aria-labelledby="command-title">' +
      '<div class="command-search">' +
      '<label class="field" for="command-input"><span class="field-label" id="command-title">搜索页面或输入命令</span>' +
      '<input class="input" id="command-input" type="search" placeholder="例如：人物、任务记录、系统中心" autocomplete="off" data-command-input></label>' +
      '</div>' +
      '<div class="command-list" data-command-list>' + renderCommandItems() + '</div>' +
      '</dialog>' + overlays;
  }
  document.body.insertAdjacentHTML('beforeend', overlays);
}

/**
 * 切换桌面侧栏的折叠状态并保存选择。
 * @returns {void}
 */
function handleSidebarToggle() {
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  storageSet('renyang-sidebar-collapsed', String(collapsed));
}

/**
 * 打开移动端导航抽屉。
 * @returns {void}
 */
function openMobileDrawer() {
  document.body.classList.add('drawer-open');
  const firstLink = document.querySelector('.sidebar .nav-item');
  if (firstLink) {
    firstLink.focus();
  }
}

/**
 * 关闭移动端导航抽屉。
 * @returns {void}
 */
function closeMobileDrawer() {
  document.body.classList.remove('drawer-open');
}

/**
 * 打开全局命令面板并聚焦搜索框。
 * @returns {void}
 */
function openCommandDialog() {
  const dialog = document.querySelector('[data-command-dialog]');
  if (dialog && typeof dialog.showModal === 'function') {
    dialog.showModal();
    const input = dialog.querySelector('[data-command-input]');
    if (input) {
      input.value = '';
      filterCommandItems(input);
      input.focus();
    }
  }
}

/**
 * 关闭全局命令面板。
 * @returns {void}
 */
function closeCommandDialog() {
  const dialog = document.querySelector('[data-command-dialog]');
  if (dialog && dialog.open) {
    dialog.close();
  }
}

/**
 * 根据输入内容筛选命令项目。
 * @param {HTMLInputElement} input 命令搜索输入框。
 * @returns {void}
 */
function filterCommandItems(input) {
  const query = input.value.trim().toLocaleLowerCase('zh-CN');
  const items = document.querySelectorAll('[data-command-text]');
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const text = (item.dataset.commandText || '').toLocaleLowerCase('zh-CN');
    item.hidden = query !== '' && !text.includes(query);
  }
}

/**
 * 处理命令面板输入事件。
 * @param {Event} event 输入事件。
 * @returns {void}
 */
function handleCommandInput(event) {
  filterCommandItems(event.currentTarget);
}

/**
 * 处理命令项目点击并跳转到对应原型页面。
 * @param {Event} event 点击事件。
 * @returns {void}
 */
function handleCommandNavigation(event) {
  const target = event.currentTarget;
  const href = target.dataset.commandHref;
  if (href) {
    window.location.href = href;
  }
}

/**
 * 处理全局键盘快捷键和抽屉关闭行为。
 * @param {KeyboardEvent} event 键盘事件。
 * @returns {void}
 */
function handleGlobalKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase('en-US') === 'k') {
    event.preventDefault();
    openCommandDialog();
    return;
  }
  if (event.key === 'Escape') {
    closeMobileDrawer();
    closeCommandDialog();
  }
}

/**
 * 初始化全局导航、抽屉和命令面板事件。
 * @returns {void}
 */
function initGlobalNavigation() {
  const sidebarToggle = document.querySelector('[data-sidebar-toggle]');
  const mobileMenu = document.querySelector('[data-mobile-menu]');
  const drawerBackdrop = document.querySelector('[data-drawer-backdrop]');
  const commandOpeners = document.querySelectorAll('[data-open-command]');
  const commandInput = document.querySelector('[data-command-input]');
  const commandItems = document.querySelectorAll('[data-command-href]');

  if (sidebarToggle) sidebarToggle.addEventListener('click', handleSidebarToggle);
  if (mobileMenu) mobileMenu.addEventListener('click', openMobileDrawer);
  if (drawerBackdrop) drawerBackdrop.addEventListener('click', closeMobileDrawer);
  for (let index = 0; index < commandOpeners.length; index += 1) {
    commandOpeners[index].addEventListener('click', openCommandDialog);
  }
  if (commandInput) commandInput.addEventListener('input', handleCommandInput);
  for (let index = 0; index < commandItems.length; index += 1) {
    commandItems[index].addEventListener('click', handleCommandNavigation);
  }
  document.addEventListener('keydown', handleGlobalKeydown);
}

/**
 * 激活指定标签，并同步 ARIA、内容面板和本地持久化状态。
 * @param {HTMLElement} tabs 标签组根元素。
 * @param {string} tabId 需要激活的标签标识。
 * @param {boolean} persist 是否保存到 localStorage。
 * @returns {void}
 */
function activateTab(tabs, tabId, persist) {
  const buttons = tabs.querySelectorAll('[data-tab]');
  const panels = tabs.querySelectorAll('[data-tab-panel]');
  let matched = false;

  for (let index = 0; index < buttons.length; index += 1) {
    const selected = buttons[index].dataset.tab === tabId;
    buttons[index].setAttribute('aria-selected', String(selected));
    buttons[index].tabIndex = selected ? 0 : -1;
    if (selected) matched = true;
  }
  for (let index = 0; index < panels.length; index += 1) {
    panels[index].hidden = panels[index].dataset.tabPanel !== tabId;
  }
  if (!matched && buttons.length > 0) {
    activateTab(tabs, buttons[0].dataset.tab, persist);
    return;
  }
  if (matched && persist) {
    const storageKey = 'renyang-tab-' + window.location.pathname + '-' + (tabs.id || 'main');
    storageSet(storageKey, tabId);
  }
}

/**
 * 响应标签点击。
 * @param {Event} event 标签按钮点击事件。
 * @returns {void}
 */
function handleTabClick(event) {
  const button = event.currentTarget;
  const tabs = button.closest('[data-tabs]');
  if (tabs) activateTab(tabs, button.dataset.tab, true);
}

/**
 * 响应标签键盘左右方向导航。
 * @param {KeyboardEvent} event 标签按钮键盘事件。
 * @returns {void}
 */
function handleTabKeydown(event) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const button = event.currentTarget;
  const tabs = button.closest('[data-tabs]');
  if (!tabs) return;
  const buttons = tabs.querySelectorAll('[data-tab]');
  let currentIndex = 0;
  for (let index = 0; index < buttons.length; index += 1) {
    if (buttons[index] === button) currentIndex = index;
  }
  const delta = event.key === 'ArrowRight' ? 1 : -1;
  const nextIndex = (currentIndex + delta + buttons.length) % buttons.length;
  event.preventDefault();
  activateTab(tabs, buttons[nextIndex].dataset.tab, true);
  buttons[nextIndex].focus();
}

/**
 * 初始化页面内所有标签组，并恢复最近一次选择。
 * @returns {void}
 */
function initTabs() {
  const tabGroups = document.querySelectorAll('[data-tabs]');
  for (let groupIndex = 0; groupIndex < tabGroups.length; groupIndex += 1) {
    const tabs = tabGroups[groupIndex];
    const buttons = tabs.querySelectorAll('[data-tab]');
    if (buttons.length === 0) continue;
    const storageKey = 'renyang-tab-' + window.location.pathname + '-' + (tabs.id || 'main');
    const saved = storageGet(storageKey);
    const initial = saved || tabs.dataset.defaultTab || buttons[0].dataset.tab;
    activateTab(tabs, initial, false);
    for (let buttonIndex = 0; buttonIndex < buttons.length; buttonIndex += 1) {
      buttons[buttonIndex].addEventListener('click', handleTabClick);
      buttons[buttonIndex].addEventListener('keydown', handleTabKeydown);
    }
  }
}

/**
 * 显示页内锚点所属的标签面板，并把焦点移到目标内容。
 * @param {string} hash 包含井号的页内锚点，例如 `#world-panel-personas`。
 * @returns {boolean} 找到目标且成功显示时返回 true，否则返回 false。
 * 特殊业务逻辑：只切换当前页面已有标签，不创建路由、不修改业务数据。
 */
function revealTabAnchor(hash) {
  if (!hash || hash === '#') return false;
  let targetId = '';
  try {
    targetId = decodeURIComponent(hash.slice(1));
  } catch (error) {
    targetId = hash.slice(1);
  }
  const target = document.getElementById(targetId);
  const panel = target ? target.closest('[data-tab-panel]') : null;
  const tabs = panel ? panel.closest('[data-tabs]') : null;
  if (!target || !panel || !tabs) return false;
  activateTab(tabs, panel.dataset.tabPanel, true);
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus();
  return true;
}

/**
 * 在浏览器执行默认锚点跳转前，先显示目标所在的隐藏标签面板。
 * @param {MouseEvent} event 页内锚点链接的点击事件。
 * @returns {void} 不返回值，仅同步当前标签与焦点。
 */
function handleTabAnchorClick(event) {
  const anchor = event.currentTarget;
  revealTabAnchor(anchor.hash);
}

/**
 * 响应地址栏锚点变化，确保直接访问或前进后退时显示正确标签。
 * @returns {void} 不返回值，仅根据当前地址锚点更新标签。
 */
function handleTabAnchorHashChange() {
  revealTabAnchor(window.location.hash);
}

/**
 * 初始化所有指向标签内容的页内锚点。
 * @returns {void} 不返回值，完成锚点点击和地址变化监听。
 */
function initTabAnchors() {
  const anchors = document.querySelectorAll('a[href^="#"]');
  for (let index = 0; index < anchors.length; index += 1) {
    anchors[index].addEventListener('click', handleTabAnchorClick);
  }
  window.addEventListener('hashchange', handleTabAnchorHashChange);
  revealTabAnchor(window.location.hash);
}

/**
 * 检查当前向导步骤中的必填字段，并就地标记错误。
 * @param {HTMLElement} panel 当前步骤内容面板。
 * @returns {boolean} 所有必填字段有效时返回 true。
 */
function validateWizardPanel(panel) {
  const requiredFields = panel.querySelectorAll('[required]');
  let valid = true;
  let firstInvalid = null;
  for (let index = 0; index < requiredFields.length; index += 1) {
    const field = requiredFields[index];
    const fieldValid = field.checkValidity();
    field.setAttribute('aria-invalid', String(!fieldValid));
    if (!fieldValid && !firstInvalid) firstInvalid = field;
    valid = valid && fieldValid;
  }
  if (firstInvalid) {
    firstInvalid.focus();
    showToast('请完成当前步骤', '已将焦点移到第一个需要补充的字段。');
  }
  return valid;
}

/**
 * 更新向导步骤、内容面板和操作按钮状态。
 * @param {HTMLElement} wizard 向导根元素。
 * @param {number} stepIndex 从零开始的目标步骤。
 * @returns {void}
 */
function updateWizard(wizard, stepIndex) {
  const steps = wizard.querySelectorAll('[data-step]');
  const panels = wizard.querySelectorAll('[data-step-panel]');
  const boundedIndex = Math.max(0, Math.min(stepIndex, panels.length - 1));
  wizard.dataset.currentStep = String(boundedIndex);

  for (let index = 0; index < steps.length; index += 1) {
    steps[index].classList.toggle('is-current', index === boundedIndex);
    steps[index].classList.toggle('is-complete', index < boundedIndex);
    steps[index].setAttribute('aria-current', index === boundedIndex ? 'step' : 'false');
  }
  for (let index = 0; index < panels.length; index += 1) {
    panels[index].hidden = index !== boundedIndex;
  }

  const back = wizard.querySelector('[data-wizard-back]');
  const next = wizard.querySelector('[data-wizard-next]');
  const submit = wizard.querySelector('[data-wizard-submit]');
  if (back) back.disabled = boundedIndex === 0;
  if (next) next.hidden = boundedIndex === panels.length - 1;
  if (submit) submit.hidden = boundedIndex !== panels.length - 1;
  storageSet('renyang-wizard-' + window.location.pathname + '-' + (wizard.id || 'main'), String(boundedIndex));
}

/**
 * 推进向导到下一步。
 * @param {Event} event 下一步按钮点击事件。
 * @returns {void}
 */
function handleWizardNext(event) {
  const wizard = event.currentTarget.closest('[data-wizard]');
  if (!wizard) return;
  const current = Number(wizard.dataset.currentStep || '0');
  const panels = wizard.querySelectorAll('[data-step-panel]');
  if (panels[current] && validateWizardPanel(panels[current])) {
    updateWizard(wizard, current + 1);
  }
}

/**
 * 返回向导上一步。
 * @param {Event} event 上一步按钮点击事件。
 * @returns {void}
 */
function handleWizardBack(event) {
  const wizard = event.currentTarget.closest('[data-wizard]');
  if (!wizard) return;
  const current = Number(wizard.dataset.currentStep || '0');
  updateWizard(wizard, current - 1);
}

/**
 * 完成原型向导，显示结果并按页面配置跳转。
 * @param {Event} event 提交按钮点击事件。
 * @returns {void}
 */
function handleWizardSubmit(event) {
  const wizard = event.currentTarget.closest('[data-wizard]');
  if (!wizard) return;
  const current = Number(wizard.dataset.currentStep || '0');
  const panels = wizard.querySelectorAll('[data-step-panel]');
  if (panels[current] && !validateWizardPanel(panels[current])) return;
  const title = wizard.dataset.successTitle || '已完成当前流程';
  const message = wizard.dataset.successMessage || '原型已记录本次操作。';
  showToast(title, message);
  const href = wizard.dataset.submitHref;
  if (href) {
    window.setTimeout(function navigateAfterWizardSubmit() {
      window.location.href = href;
    }, 520);
  }
}

/**
 * 计算向导可安全恢复的步骤，避免在表单值未持久化时跳过必填阶段。
 * @param {HTMLElement} wizard 向导根元素。
 * @param {number} savedStep 本地存储中记录的步骤索引。
 * @returns {number} 可以显示的步骤索引；发现未完成阶段时返回最早未完成位置。
 */
function resolveWizardRestoreStep(wizard, savedStep) {
  const panels = wizard.querySelectorAll('[data-step-panel]');
  const boundedStep = Math.max(0, Math.min(savedStep, panels.length - 1));
  for (let panelIndex = 0; panelIndex < boundedStep; panelIndex += 1) {
    const requiredFields = panels[panelIndex].querySelectorAll('[required]');
    for (let fieldIndex = 0; fieldIndex < requiredFields.length; fieldIndex += 1) {
      if (!requiredFields[fieldIndex].checkValidity()) return panelIndex;
    }
  }
  return boundedStep;
}

/**
 * 初始化所有分步向导并恢复步骤位置。
 * @returns {void}
 */
function initWizards() {
  const wizards = document.querySelectorAll('[data-wizard]');
  for (let index = 0; index < wizards.length; index += 1) {
    const wizard = wizards[index];
    const saved = Number(storageGet('renyang-wizard-' + window.location.pathname + '-' + (wizard.id || 'main')) || '0');
    updateWizard(wizard, resolveWizardRestoreStep(wizard, saved));
    const next = wizard.querySelector('[data-wizard-next]');
    const back = wizard.querySelector('[data-wizard-back]');
    const submit = wizard.querySelector('[data-wizard-submit]');
    if (next) next.addEventListener('click', handleWizardNext);
    if (back) back.addEventListener('click', handleWizardBack);
    if (submit) submit.addEventListener('click', handleWizardSubmit);
  }
}

/**
 * 根据输入值筛选指定列表或表格行。
 * @param {Event} event 搜索输入事件。
 * @returns {void}
 */
function handlePageSearch(event) {
  const input = event.currentTarget;
  const targetId = input.dataset.searchTarget;
  const target = targetId ? document.getElementById(targetId) : null;
  if (!target) return;
  const query = input.value.trim().toLocaleLowerCase('zh-CN');
  const rows = target.querySelectorAll('[data-search-text]');
  let visibleCount = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const text = (rows[index].dataset.searchText || '').toLocaleLowerCase('zh-CN');
    const visible = query === '' || text.includes(query);
    rows[index].hidden = !visible;
    if (visible) visibleCount += 1;
  }
  const empty = target.querySelector('[data-filter-empty]');
  if (empty) empty.hidden = visibleCount !== 0;
}

/**
 * 初始化页面级搜索过滤器。
 * @returns {void}
 */
function initSearch() {
  const inputs = document.querySelectorAll('[data-search-target]');
  for (let index = 0; index < inputs.length; index += 1) {
    inputs[index].addEventListener('input', handlePageSearch);
  }
}

/**
 * 打开按钮指定的原生 dialog。
 * @param {Event} event 触发按钮点击事件。
 * @returns {void}
 */
function handleDialogOpen(event) {
  const id = event.currentTarget.dataset.openDialog;
  const dialog = id ? document.getElementById(id) : null;
  if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
}

/**
 * 关闭按钮所在的原生 dialog。
 * @param {Event} event 关闭按钮点击事件。
 * @returns {void}
 */
function handleDialogClose(event) {
  const dialog = event.currentTarget.closest('dialog');
  if (dialog) dialog.close();
}

/**
 * 点击遮罩区域时关闭原生 dialog，点击内容区保持打开。
 * @param {MouseEvent} event dialog 点击事件。
 * @returns {void}
 */
function handleDialogBackdrop(event) {
  const dialog = event.currentTarget;
  if (event.target === dialog) dialog.close();
}

/**
 * 将 Tab 焦点限制在当前打开的原生 dialog 内。
 * @param {KeyboardEvent} event dialog 的键盘事件。
 * @returns {void}
 * 特殊业务逻辑：修正部分文件预览环境在末尾控件后短暂把焦点移到 body 的行为。
 */
function handleDialogKeydown(event) {
  if (event.key !== 'Tab') return;
  const dialog = event.currentTarget;
  const candidates = dialog.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  const focusable = [];
  for (let index = 0; index < candidates.length; index += 1) {
    if (candidates[index].getClientRects().length > 0) focusable.push(candidates[index]);
  }
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === document.body)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || active === document.body)) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * 初始化页面中的确认框、抽屉式对话框和关闭操作。
 * @returns {void}
 */
function initDialogs() {
  const openers = document.querySelectorAll('[data-open-dialog]');
  const closers = document.querySelectorAll('[data-close-dialog]');
  const dialogs = document.querySelectorAll('dialog');
  for (let index = 0; index < openers.length; index += 1) openers[index].addEventListener('click', handleDialogOpen);
  for (let index = 0; index < closers.length; index += 1) closers[index].addEventListener('click', handleDialogClose);
  for (let index = 0; index < dialogs.length; index += 1) {
    dialogs[index].addEventListener('click', handleDialogBackdrop);
    dialogs[index].addEventListener('keydown', handleDialogKeydown);
  }
}

/**
 * 按确认复选框当前状态同步对应关键操作按钮。
 * @param {HTMLInputElement} checkbox 用于人工确认影响范围的复选框。
 * @returns {void} 不返回值，直接同步目标按钮的禁用状态。
 */
function syncAcknowledgement(checkbox) {
  const target = document.getElementById(checkbox.dataset.enableTarget || '');
  if (target) target.disabled = !checkbox.checked;
}

/**
 * 根据确认复选框状态启用或禁用对应的关键操作。
 * @param {Event} event 确认复选框的变更事件。
 * @returns {void} 不返回值，直接同步目标按钮的禁用状态。
 */
function handleAcknowledgementChange(event) {
  syncAcknowledgement(event.currentTarget);
}

/**
 * 初始化需要人工勾选后才能执行的关键确认操作。
 * @returns {void} 不返回值，绑定复选框并同步初始按钮状态。
 */
function initAcknowledgements() {
  const checkboxes = document.querySelectorAll('[data-enable-target]');
  for (let index = 0; index < checkboxes.length; index += 1) {
    checkboxes[index].addEventListener('change', handleAcknowledgementChange);
    syncAcknowledgement(checkboxes[index]);
  }
}

/**
 * 在全局状态播报区域显示短时反馈。
 * @param {string} title 状态标题。
 * @param {string} message 状态补充说明。
 * @returns {void}
 */
function showToast(title, message) {
  const region = document.querySelector('[data-toast-region]');
  if (!region) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = '<strong>' + title + '</strong><span>' + message + '</span>';
  region.appendChild(toast);
  window.setTimeout(function removeToast() {
    toast.remove();
  }, 3600);
}

/**
 * 处理带 data-toast 属性的演示动作。
 * @param {Event} event 点击事件。
 * @returns {void}
 */
function handleToastAction(event) {
  const button = event.currentTarget;
  showToast(button.dataset.toastTitle || '操作已完成', button.dataset.toastMessage || '原型已更新当前状态。');
}

/**
 * 切换按钮指定区域的隐藏状态。
 * @param {Event} event 点击事件。
 * @returns {void}
 */
function handleToggleTarget(event) {
  const button = event.currentTarget;
  const target = document.getElementById(button.dataset.toggleTarget || '');
  if (!target) return;
  const willShow = target.hidden;
  target.hidden = !willShow;
  button.setAttribute('aria-expanded', String(willShow));
}

/**
 * 演示远端资料同步重试，依次更新状态文本和按钮可用性。
 * @param {Event} event 重试按钮点击事件。
 * @returns {void}
 */
function handleRetrySync(event) {
  const button = event.currentTarget;
  const statusSelector = button.dataset.statusTarget;
  const status = statusSelector ? document.querySelector(statusSelector) : null;
  button.disabled = true;
  if (status) status.textContent = '已排队，等待同步';
  showToast('已加入同步队列', '本地资料保持可用，远端索引将在后台重试。');
  window.setTimeout(function completeSyncRetry() {
    if (status) status.textContent = '同步成功';
    button.disabled = false;
    button.textContent = '再次检测';
  }, 1300);
}

/**
 * 演示表单提交，阻止真实网络请求并展示成功说明。
 * @param {SubmitEvent} event 表单提交事件。
 * @returns {void}
 */
function handleDemoFormSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  const title = form.dataset.successTitle || '已保存';
  const message = form.dataset.successMessage || '原型已记录本次更改。';
  const dialog = form.closest('dialog');
  if (dialog) dialog.close();
  showToast(title, message);
  const href = form.dataset.successHref;
  if (href) {
    window.setTimeout(function navigateAfterFormSubmit() {
      window.location.href = href;
    }, 520);
  }
}

/**
 * 初始化通用演示动作，包括 Toast、折叠、同步重试和表单提交。
 * @returns {void}
 */
function initDemoActions() {
  const toastActions = document.querySelectorAll('[data-toast-title]');
  const toggleActions = document.querySelectorAll('[data-toggle-target]');
  const retryActions = document.querySelectorAll('[data-retry-sync]');
  const forms = document.querySelectorAll('[data-demo-submit]');
  for (let index = 0; index < toastActions.length; index += 1) toastActions[index].addEventListener('click', handleToastAction);
  for (let index = 0; index < toggleActions.length; index += 1) toggleActions[index].addEventListener('click', handleToggleTarget);
  for (let index = 0; index < retryActions.length; index += 1) retryActions[index].addEventListener('click', handleRetrySync);
  for (let index = 0; index < forms.length; index += 1) forms[index].addEventListener('submit', handleDemoFormSubmit);
}

/**
 * 启动共享应用壳和所有可复用交互。
 * @returns {void}
 */
function bootstrapPrototype() {
  initShell();
  initStandaloneThemeControl();
  initThemeControls();
  initGlobalOverlays();
  initGlobalNavigation();
  initTabs();
  initTabAnchors();
  initWizards();
  initSearch();
  initDialogs();
  initAcknowledgements();
  initDemoActions();
}

document.addEventListener('DOMContentLoaded', bootstrapPrototype);
