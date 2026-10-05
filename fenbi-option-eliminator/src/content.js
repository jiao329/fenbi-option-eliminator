/*!
 * 粉笔刷题 · 长按排除选项  (Fenbi Option Eliminator)
 * ---------------------------------------------------------------
 * 在粉笔网页版刷题时长按选项 -> 选项变淡（排除），再次长按 -> 恢复。
 * 还原粉笔 App 端"长按排除选项"的体验。
 *
 * 识别到的真实 DOM（取自粉笔线上前端 bundle，fb-ng-choice-option 组件）：
 *   <div class="fb-question-options">
 *     ...
 *     <ul class="options font-color-gray-mid">
 *       <li class="theme-ques-option" (click)="...">
 *         <label class="fb-label">
 *           <input class="fb-radio" type="radio">
 *           <span class="fb-radioInput radio-single">A</span>
 *         </label>
 *         <div class="options-material">选项正文</div>
 *       </li>
 *     </ul>
 *   </div>
 * 因此主选择器为 li.theme-ques-option，另有若干兜底选择器与自定义选择器。
 *
 * 本文件同时暴露 window.__fbOptionEliminator 供自动化测试使用（无副作用）。
 */
(function () {
  'use strict';

  if (window.__fbOptionEliminatorLoaded) return;
  window.__fbOptionEliminatorLoaded = true;

  /* ------------------------------------------------------------------ *
   * 常量与默认设置
   * ------------------------------------------------------------------ */
  var CLASS_EXCLUDED = 'fb-opt-excluded';
  var CLASS_PRESSING = 'fb-opt-pressing';
  var ROOT_CLASS_STRIKE = 'fb-opt-strike-on';
  var TOAST_ID = 'fb-opt-toast';

  // 粉笔官方选择器（新版 spa.fenbi.com/ti + 老版 www.fenbi.com/spa/tiku）+ 通用兜底
  var BASE_SELECTORS = [
    // ---- 新版粉笔（Angular 17）：spa.fenbi.com/ti/exam/... ----
    // app-choice-radio / app-choice-true-false：ul.choice-radios > li.choice-radio > label.choice-radio-label
    'li.choice-radio',
    'label.choice-radio-label',
    // app-choice-checkbox（多选题）：ul.choice-checkboxs > li.choice-checkbox > label.choice-checkbox-label
    'li.choice-checkbox',
    'label.choice-checkbox-label',
    // ---- 老版粉笔（Angular 16）：www.fenbi.com/spa/tiku/... ----
    'li.theme-ques-option',                        // fb-ng-choice-option 组件的选项行
    '.fb-question-options .options > li',
    '.fb-question-options ul.options li',
    'ul.options.choice-options > li',              // 解析页/其他模板
    'ul.options.truefalse-options > li',           // 判断题
    // ---- 预留钩子 ----
    '[data-fb-option]',
    '[data-option-index]'
  ];

  var DEFAULTS = {
    enabled: true,        // 总开关
    holdMs: 400,          // 长按判定时长（毫秒）
    opacity: 0.3,         // 排除后的透明度
    strike: false,        // 是否同时加删除线
    rightClick: false,    // 右键单击也可排除
    touch: true,          // 触屏长按（阻止长按弹出系统菜单）
    customSelector: '',   // 用户自定义选择器（逗号分隔）
    showHint: true        // 首次使用时显示一次提示
  };

  var ext = (typeof chrome !== 'undefined' && chrome && chrome.storage) ? chrome : null;

  /* ------------------------------------------------------------------ *
   * 运行状态
   * ------------------------------------------------------------------ */
  var settings = assign({}, DEFAULTS);
  var excludedHash = new WeakMap();   // element -> 排除时的文本快照
  var press = null;                   // 当前按压状态
  var clickGuard = { el: null, until: 0 };
  var validateTimer = null;
  var observer = null;
  var hintShownThisPage = false;

  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    }
    return target;
  }

  /* ------------------------------------------------------------------ *
   * 选择器与识别
   * ------------------------------------------------------------------ */
  function optionSelectors() {
    var list = BASE_SELECTORS.slice();
    var custom = (settings.customSelector || '').trim();
    if (custom) {
      custom.split(',').forEach(function (s) {
        s = s.trim();
        if (s) list.push(s);
      });
    }
    return list;
  }

  function safeClosest(node, selector) {
    if (!node || node.nodeType !== 1 || typeof node.closest !== 'function') return null;
    try {
      return node.closest(selector);
    } catch (err) {
      return null; // 非法选择器
    }
  }

  /**
   * 通用兜底识别：即使粉笔再次改版、class 全变了也能命中。
   * 条件：行级元素（li/label/div/tr/a/button）内部**恰好** 1 个 radio/checkbox，
   * 文本较短，且本身是 label 或存在 ≥2 个同标签兄弟 —— 避免把整个题目容器当选项行。
   */
  function looksLikeOptionRow(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName;
    if (tag !== 'LI' && tag !== 'LABEL' && tag !== 'DIV' && tag !== 'TR' && tag !== 'A' && tag !== 'BUTTON') return false;
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 400) return false;
    var inputs;
    try {
      inputs = el.querySelectorAll('input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"]');
    } catch (err) {
      return false;
    }
    if (!inputs || inputs.length !== 1) return false;
    if (tag === 'LABEL') return true;
    var parent = el.parentElement;
    if (!parent || !parent.children) return false;
    var same = 0;
    for (var i = 0; i < parent.children.length; i++) {
      if (parent.children[i].tagName === tag) same++;
    }
    return same >= 2;
  }

  /** 从事件（含 Shadow DOM / iframe 内的事件）解析出被点击的"选项行"元素 */
  function resolveOption(e) {
    if (!e) return null;
    var nodes = [];
    if (typeof e.composedPath === 'function') {
      try { nodes = e.composedPath() || []; } catch (err) { nodes = []; }
    }
    if (!nodes.length || nodes.indexOf(e.target) === -1) nodes.unshift(e.target);

    var selectors = optionSelectors();
    var genericHit = null;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!node || node.nodeType !== 1) continue;
      for (var j = 0; j < selectors.length; j++) {
        var hit = safeClosest(node, selectors[j]);
        if (hit && hit.isConnected !== false) return hit;
      }
      // 结构兜底：class 全变时也能识别；沿路径向外走，取最外层候选 =
      // 最接近"整行选项"的那个元素（例如 li.choice 而不是它内部的 label）
      if (looksLikeOptionRow(node)) genericHit = node;
    }
    return genericHit;
  }

  /** 选项文本快照：题目切换后（Angular 复用 DOM 节点）据此自动清除排除状态 */
  function hashOf(el) {
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    var pos = -1;
    if (el.parentElement && el.parentElement.children) {
      pos = Array.prototype.indexOf.call(el.parentElement.children, el);
    }
    return pos + '|' + text;
  }

  function isEditable(node) {
    for (var el = node; el && el.nodeType === 1; el = el.parentElement) {
      var tag = (el.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (el.isContentEditable) return true;
    }
    return false;
  }

  function excludedElements() {
    return Array.prototype.slice.call(document.querySelectorAll('.' + CLASS_EXCLUDED));
  }

  function countExcluded() {
    return excludedElements().length;
  }

  /** 所有命中"选项行"的元素（选择器 + 结构兜底），去掉被其他命中元素包含的重复项（如 li 与其内部 label） */
  function optionNodes() {
    var set = new Set();
    optionSelectors().forEach(function (sel) {
      var found;
      try { found = document.querySelectorAll(sel); } catch (err) { return; }
      for (var i = 0; i < found.length; i++) set.add(found[i]);
    });
    try {
      var candidates = document.querySelectorAll('li,label');
      var limit = Math.min(candidates.length, 1500);
      for (var j = 0; j < limit; j++) {
        if (looksLikeOptionRow(candidates[j])) set.add(candidates[j]);
      }
    } catch (err) { /* ignore */ }

    var list = [];
    set.forEach(function (el) { list.push(el); });
    return list.filter(function (el) {
      for (var i = 0; i < list.length; i++) {
        var other = list[i];
        if (other !== el && typeof other.contains === 'function' && other.contains(el)) return false;
      }
      return true;
    });
  }

  function countOptions() {
    return optionNodes().length;
  }

  /* ------------------------------------------------------------------ *
   * 诊断信息（供 popup「复制诊断报告」使用；粉笔改版时用于定位问题）
   * ------------------------------------------------------------------ */
  var lastPressInfo = null;

  function describeEl(el) {
    if (!el || el.nodeType !== 1) return String(el);
    var s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    var c = (typeof el.className === 'string' ? el.className : '').trim().replace(/\s+/g, '.');
    if (c) s += '.' + c;
    return s;
  }

  function chainOf(el, max) {
    var out = [];
    var n = el;
    var i = 0;
    while (n && n.nodeType === 1 && i < (max || 6)) {
      out.push(describeEl(n));
      n = n.parentElement;
      i++;
    }
    return out;
  }

  function recordPress(e) {
    var el = e.target;
    var text = ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
    if (text.length > 60) text = text.slice(0, 60) + '…';
    lastPressInfo = {
      时间: new Date().toISOString(),
      事件: e.type,
      命中元素: describeEl(el),
      祖先链: chainOf(el, 6),
      文本: text,
      能识别为选项行: !!resolveOption(e)
    };
  }

  function genericSamples() {
    var out = [];
    var nodes;
    try { nodes = document.querySelectorAll('li,label'); } catch (err) { return out; }
    var limit = Math.min(nodes.length, 4000);
    for (var i = 0; i < limit && out.length < 5; i++) {
      if (!looksLikeOptionRow(nodes[i])) continue;
      out.push({
        元素: describeEl(nodes[i]),
        祖先链: chainOf(nodes[i], 4),
        文本: ((nodes[i].textContent || '').replace(/\s+/g, ' ').trim() || '').slice(0, 40)
      });
    }
    return out;
  }

  function diagnose() {
    var selStats = {};
    optionSelectors().forEach(function (sel) {
      var n;
      try { n = document.querySelectorAll(sel).length; } catch (err) { n = 'ERR'; }
      selStats[sel] = n;
    });
    return {
      version: '1.1.0',
      url: location.href,
      host: location.hostname,
      在iframe内: window.top !== window.self,
      标题: document.title,
      设置: assign({}, settings),
      选择器命中: selStats,
      识别到的选项数: countOptions(),
      已排除数: countExcluded(),
      最近一次按下: lastPressInfo,
      结构兜底命中样例: genericSamples()
    };
  }

  /* ------------------------------------------------------------------ *
   * 排除 / 恢复
   * ------------------------------------------------------------------ */
  function excludeOption(el) {
    el.classList.add(CLASS_EXCLUDED);
    el.setAttribute('data-fb-opt-excluded', '1');
    excludedHash.set(el, hashOf(el));
  }

  function restoreOption(el) {
    el.classList.remove(CLASS_EXCLUDED);
    el.classList.remove(CLASS_PRESSING);
    el.removeAttribute('data-fb-opt-excluded');
    excludedHash.delete(el);
  }

  function toggleOption(el) {
    if (el.classList.contains(CLASS_EXCLUDED)) restoreOption(el);
    else excludeOption(el);
  }

  function clearAll() {
    var n = 0;
    excludedElements().forEach(function (el) { restoreOption(el); n++; });
    return n;
  }

  /** 题目切换自愈：文本与排除时不一致 -> 视为新题目，自动恢复 */
  function validateAll() {
    if (!settings.enabled) {
      if (countExcluded()) clearAll();
      return;
    }
    excludedElements().forEach(function (el) {
      var snapshot = excludedHash.get(el);
      if (snapshot === undefined || snapshot !== hashOf(el)) restoreOption(el);
    });
  }

  function scheduleValidate() {
    if (validateTimer) return;
    if (!countExcluded()) return;
    validateTimer = setTimeout(function () {
      validateTimer = null;
      validateAll();
    }, 250);
  }

  /* ------------------------------------------------------------------ *
   * 长按手势
   * ------------------------------------------------------------------ */
  function clearPressTimer() {
    if (press && press.timer) {
      clearTimeout(press.timer);
      press.timer = null;
    }
  }

  function endPress() {
    clearPressTimer();
    if (press && press.el) press.el.classList.remove(CLASS_PRESSING);
    press = null;
  }

  function fireLongPress() {
    if (!press) return;
    var el = press.el;
    press.fired = true;
    press.el.classList.remove(CLASS_PRESSING);
    toggleOption(el);
    clickGuard.el = el;
    clickGuard.until = Date.now() + 900;   // 吞掉长按后浏览器补发的 click
    try { if (navigator.vibrate) navigator.vibrate(10); } catch (err) { /* ignore */ }
    maybeShowHint();
  }

  function onPointerDown(e) {
    if (!settings.enabled) return;
    if (e.button !== undefined && e.button !== 0) return;      // 只处理左键
    if (e.pointerType === 'touch' && !settings.touch) return;  // 触屏开关
    if (isEditable(e.target)) return;

    var el = resolveOption(e);
    if (!el) return;

    endPress();
    press = {
      el: el,
      x: typeof e.clientX === 'number' ? e.clientX : null,
      y: typeof e.clientY === 'number' ? e.clientY : null,
      fired: false,
      timer: null
    };
    el.classList.add(CLASS_PRESSING);   // 长按期间禁止选中文字（不干扰 click）

    var holdMs = Number(settings.holdMs);
    if (!isFinite(holdMs)) holdMs = DEFAULTS.holdMs;
    press.timer = setTimeout(fireLongPress, Math.max(80, holdMs));
  }

  function onPointerMove(e) {
    if (!press || press.fired) return;
    if (press.x === null || typeof e.clientX !== 'number') return;
    var dx = e.clientX - press.x;
    var dy = e.clientY - press.y;
    if (dx * dx + dy * dy > 100) endPress();   // 移动超过 10px 视为滚动/拖拽
  }

  function onPointerUp() { endPress(); }

  function onClickCapture(e) {
    if (!clickGuard.el) return;
    if (Date.now() > clickGuard.until) { clickGuard.el = null; return; }
    var el = resolveOption(e);
    if (!el) return;
    if (el !== clickGuard.el && !clickGuard.el.contains(el)) return;
    clickGuard.el = null;
    e.stopPropagation();
    e.stopImmediatePropagation();
    e.preventDefault();
  }

  function onContextMenu(e) {
    var el = resolveOption(e);
    if (!el) return;
    if (settings.rightClick) {
      e.preventDefault();
      e.stopPropagation();
      toggleOption(el);
      return;
    }
    // 触屏长按会触发系统菜单，这里屏蔽掉，避免打断长按排除
    var fromTouch = e.pointerType === 'touch' ||
      (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents);
    if (settings.touch && fromTouch) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function onSelectStart(e) {
    if (press && !press.fired && resolveOption(e)) e.preventDefault();
  }

  function onDragStart(e) {
    if (resolveOption(e)) e.preventDefault();
  }

  /* ------------------------------------------------------------------ *
   * 首次使用提示
   * ------------------------------------------------------------------ */
  function maybeShowHint() {
    if (!settings.showHint || hintShownThisPage || !ext) return;
    hintShownThisPage = true;
    try {
      ext.storage.local.get({ fbOptHintShown: false }, function (res) {
        if (res && res.fbOptHintShown) return;
        showToast('长按选项即可「排除」，再次长按恢复');
        try { ext.storage.local.set({ fbOptHintShown: true }); } catch (err) { /* ignore */ }
      });
    } catch (err) { /* ignore */ }
  }

  function showToast(text) {
    var old = document.getElementById(TOAST_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var box = document.createElement('div');
    box.id = TOAST_ID;
    box.textContent = text;
    box.setAttribute('data-fb-opt-ui', '1');
    (document.body || document.documentElement).appendChild(box);
    setTimeout(function () { box.classList.add('fb-opt-toast-out'); }, 3200);
    setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 4000);
  }

  /* ------------------------------------------------------------------ *
   * 设置
   * ------------------------------------------------------------------ */
  function applyVisualSettings() {
    var root = document.documentElement;
    root.style.setProperty('--fb-opt-opacity', String(settings.opacity));
    root.classList.toggle(ROOT_CLASS_STRIKE, !!settings.strike);
    root.classList.toggle('fb-opt-enabled', !!settings.enabled);
    if (!settings.enabled) clearAll();
  }

  function loadSettings(cb) {
    if (!ext) { applyVisualSettings(); if (cb) cb(); return; }
    try {
      ext.storage.sync.get(DEFAULTS, function (items) {
        settings = assign({}, DEFAULTS, items || {});
        applyVisualSettings();
        if (cb) cb();
      });
    } catch (err) {
      applyVisualSettings();
      if (cb) cb();
    }
  }

  function onSettingsChanged(changes, area) {
    if (area && area !== 'sync') return;
    var touched = false;
    for (var key in DEFAULTS) {
      if (changes && Object.prototype.hasOwnProperty.call(changes, key)) {
        settings[key] = changes[key].newValue;
        touched = true;
      }
    }
    if (touched) applyVisualSettings();
  }

  /* ------------------------------------------------------------------ *
   * 与 popup 通信
   * ------------------------------------------------------------------ */
  function registerMessageHandler() {
    if (!ext || !ext.runtime || !ext.runtime.onMessage) return;
    ext.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'fb-opt-status') {
        sendResponse({
          ok: true,
          enabled: settings.enabled,
          excluded: countExcluded(),
          options: countOptions()
        });
      } else if (msg.type === 'fb-opt-clear') {
        sendResponse({ ok: true, cleared: clearAll() });
      } else if (msg.type === 'fb-opt-diagnose') {
        sendResponse({ ok: true, report: diagnose() });
      } else if (msg.type === 'fb-opt-settings-changed') {
        loadSettings(function () { sendResponse({ ok: true }); });
        return true; // 异步响应
      }
      return true;
    });
  }

  /* ------------------------------------------------------------------ *
   * 启动
   * ------------------------------------------------------------------ */
  function startObserver() {
    if (observer || typeof MutationObserver !== 'function') return;
    observer = new MutationObserver(function () {
      scheduleValidate();
    });
    observer.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function start() {
    registerMessageHandler();
    startObserver();
    loadSettings();
    if (ext && ext.storage && ext.storage.onChanged) {
      try { ext.storage.onChanged.addListener(onSettingsChanged); } catch (err) { /* ignore */ }
    }

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
    document.addEventListener('click', onClickCapture, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    document.addEventListener('selectstart', onSelectStart, true);
    document.addEventListener('dragstart', onDragStart, true);
    window.addEventListener('scroll', onPointerUp, true);
    window.addEventListener('blur', onPointerUp, true);
    // 诊断用：记录所有按下（不做任何手势处理，开销可忽略）
    window.addEventListener('pointerdown', recordPress, true);
    window.addEventListener('mousedown', recordPress, true);
  }

  window.__fbOptionEliminator = {
    version: '1.1.0',
    CLASS_EXCLUDED: CLASS_EXCLUDED,
    DEFAULTS: DEFAULTS,
    resolveOption: resolveOption,
    looksLikeOptionRow: looksLikeOptionRow,
    diagnose: diagnose,
    toggleOption: toggleOption,
    excludeOption: excludeOption,
    restoreOption: restoreOption,
    validateAll: validateAll,
    clearAll: clearAll,
    countExcluded: countExcluded,
    countOptions: countOptions,
    optionNodes: optionNodes,
    optionSelectors: optionSelectors,
    getSettings: function () { return assign({}, settings); },
    setSettings: function (patch) { settings = assign({}, settings, patch); applyVisualSettings(); },
    fireLongPress: fireLongPress,
    showToast: showToast
  };

  // 立即绑定事件（document 级监听不依赖 DOM 就绪），保证任何时机注入都能生效
  if (document.documentElement) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start);
  }
})();
