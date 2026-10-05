/* ============================================================================
 * 粉笔网页版「长按排除」—— DOM 诊断脚本（不依赖扩展）
 * ----------------------------------------------------------------------------
 * 用法：
 *   1) 打开你平时刷题的那个粉笔页面
 *   2) 按 F12 打开开发者工具 → 切到「控制台 / Console」
 *   3) 把本文件全部内容复制粘贴进去，回车
 *   4) 按控制台提示，用鼠标在**一个选项行上长按约 0.5 秒**再松手
 *   5) 控制台会打印一份 DIAG 报告，并自动复制到剪贴板，把它发给我即可
 *
 * 说明：
 *   - 如果题目是嵌在 iframe 里的（控制台左上角有 frame 下拉框），
 *     请把下拉框切换到题目的那个 frame 再执行一次。
 *   - 本脚本只读取 DOM，不修改页面、不上传任何数据。
 * ========================================================================== */
(function () {
  'use strict';

  if (window.__fbDiagRunning) {
    console.warn('[DIAG] 诊断脚本已在运行中，报告见 window.__fbDiag');
    return;
  }
  window.__fbDiagRunning = true;

  var report = {
    时间: new Date().toISOString(),
    URL: location.href,
    标题: document.title,
    就绪状态: document.readyState,
    域名: location.hostname,
    是否在iframe内: window.top !== window.self,
    同源iframe数量: (function () {
      try { return document.querySelectorAll('iframe').length; } catch (e) { return -1; }
    })(),
    当前选择器命中: {},
    通用候选统计: [],
    字母选项行候选: [],
    长按捕获: null
  };

  /* ---------- 工具函数 ---------- */
  function clsOf(el) {
    var c = el.getAttribute && el.getAttribute('class');
    return (c || '').trim().replace(/\s+/g, '.');
  }
  function desc(el) {
    if (!el || el.nodeType !== 1) return String(el);
    var s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    var c = clsOf(el);
    if (c) s += '.' + c;
    var role = el.getAttribute('role');
    if (role) s += '[role=' + role + ']';
    return s;
  }
  function chain(el, max) {
    var out = [];
    var n = el;
    var i = 0;
    while (n && n.nodeType === 1 && i < (max || 8)) {
      out.push(desc(n));
      n = n.parentElement;
      i++;
    }
    return out;
  }
  function text(el, n) {
    var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return t.length > (n || 80) ? t.slice(0, n || 80) + '…' : t;
  }
  function count(sel) {
    try { return document.querySelectorAll(sel).length; } catch (e) { return 'ERR'; }
  }
  function outer(el, n) {
    var h = el.outerHTML || '';
    h = h.replace(/\s+/g, ' ');
    return h.length > (n || 600) ? h.slice(0, n || 600) + '…' : h;
  }

  /* ---------- 1. 扩展当前使用的选择器命中情况 ---------- */
  [
    'li.theme-ques-option',
    '.fb-question-options',
    '.fb-question-options .options > li',
    '.fb-question-options ul.options li',
    'ul.options.choice-options > li',
    'ul.options.truefalse-options > li',
    'ul.options > li',
    '.fb-label',
    '.fb-radioInput',
    '[data-fb-option]',
    '[data-option-index]'
  ].forEach(function (sel) {
    report.当前选择器命中[sel] = count(sel);
  });

  /* ---------- 2. 通用候选：按 class 频次找出"选项类"元素 ---------- */
  var freq = {};
  var sample = {};
  var all = document.querySelectorAll('*');
  var limit = Math.min(all.length, 20000);
  for (var i = 0; i < limit; i++) {
    var el = all[i];
    var c = clsOf(el);
    var id = el.id || '';
    if (!/[a-z]/i.test(c + id)) continue;
    if (!/option|choice|answer|opt[-_]|item|ques|radio|select|card|row/i.test(c + ' ' + id)) continue;
    if (el.childElementCount > 30) continue;
    var key = el.tagName.toLowerCase() + (id ? '#' + id : '') + (c ? '.' + c : '');
    freq[key] = (freq[key] || 0) + 1;
    if (!sample[key]) {
      sample[key] = {
        文本: text(el, 60),
        祖先链: chain(el, 4),
        HTML: outer(el, 400)
      };
    }
  }
  Object.keys(freq)
    .sort(function (a, b) { return freq[b] - freq[a]; })
    .slice(0, 25)
    .forEach(function (k) {
      report.通用候选统计.push({
        元素: k,
        数量: freq[k],
        样例文本: sample[k].文本,
        样例链: sample[k].祖先链
      });
    });

  /* ---------- 3. 字母选项行候选：文本以 A./A、/A 开头 ---------- */
  var letterRe = /^[\s\u3000]*[A-DＡ-Ｄa-d][\s\u3000]*[.、．:：)）]/;
  var letterFreq = {};
  var letterSample = {};
  for (var j = 0; j < limit; j++) {
    var e2 = all[j];
    if (!e2.firstChild) continue;
    if (e2.childElementCount > 12) continue;
    var t2 = (e2.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t2 || t2.length > 200) continue;
    if (!letterRe.test(t2)) continue;
    var key2 = desc(e2);
    letterFreq[key2] = (letterFreq[key2] || 0) + 1;
    if (!letterSample[key2]) {
      letterSample[key2] = { 文本: t2.slice(0, 60), 祖先链: chain(e2, 5), HTML: outer(e2, 400) };
    }
  }
  Object.keys(letterFreq)
    .sort(function (a, b) { return letterFreq[b] - letterFreq[a]; })
    .slice(0, 15)
    .forEach(function (k) {
      report.字母选项行候选.push({
        元素: k,
        数量: letterFreq[k],
        样例文本: letterSample[k].文本,
        样例链: letterSample[k].祖先链,
        样例HTML: letterSample[k].HTML
      });
    });

  /* ---------- 4. 长按捕获：记录你实际按的那个元素 ---------- */
  var press = null;

  function onDown(e) {
    press = { t: Date.now(), target: e.target, type: e.type };
  }

  function optionishAncestor(el) {
    var n = el;
    var depth = 0;
    var best = null;
    while (n && n.nodeType === 1 && depth < 8) {
      var c = clsOf(n);
      if (/option|choice|answer|opt[-_]|item/i.test(c + ' ' + (n.id || '')) && (n.textContent || '').length < 400) {
        best = n;
      }
      n = n.parentElement;
      depth++;
    }
    return best;
  }

  function dump(tag, e) {
    var target = e.target;
    var held = press ? Date.now() - press.t : 0;
    var opt = optionishAncestor(target);
    var info = {
      触发方式: tag,
      事件类型: press ? press.type : '(未知)',
      按住时长ms: held,
      命中元素: desc(target),
      命中元素文本: text(target, 100),
      命中元素祖先链: chain(target, 8),
      启发式选项行: opt ? desc(opt) : null,
      启发式选项行文本: opt ? text(opt, 100) : null,
      启发式选项行祖先链: opt ? chain(opt, 6) : null,
      选中区上下文: (function () {
        var sel = window.getSelection && window.getSelection();
        return sel && sel.toString ? String(sel).slice(0, 40) : '';
      })(),
      事件默认被阻止: e.defaultPrevented
    };
    report.长按捕获 = info;

    var out = '===== 粉笔长按诊断报告 DIAG =====\n' + JSON.stringify(report, null, 2);
    window.__fbDiag = report;
    window.__fbDiagText = out;
    console.log('%c' + out, 'color:#3c7cfc');
    try {
      copy(out); // Chrome/Edge 控制台内置函数
      console.log('%c[DIAG] 报告已复制到剪贴板，直接粘贴发给我即可。', 'color:#2BC8A0');
    } catch (err) {
      console.log('[DIAG] 复制失败，请手动执行 copy(window.__fbDiagText)');
    }
    cleanup();
  }

  function onUp(e) {
    if (!press) return;
    var held = Date.now() - press.t;
    if (held < 180) { press = null; return; }
    dump('长按(>=180ms)', e);
  }

  function onClick(e) {
    if (!press) return;
    var held = Date.now() - press.t;
    if (held >= 180) dump('长按后click', e);
  }

  function onContext(e) {
    dump('右键/长按菜单', e);
  }

  function cleanup() {
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('mousedown', onDown, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('contextmenu', onContext, true);
    clearTimeout(timer);
    window.__fbDiagRunning = false;
  }

  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('mousedown', onDown, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('mouseup', onUp, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('contextmenu', onContext, true);

  var timer = setTimeout(function () {
    console.warn('[DIAG] 30 秒内没有捕获到长按。已输出静态报告，请执行 copy(window.__fbDiagText) 或截图发我。');
    var out = '===== 粉笔长按诊断报告 DIAG(静态) =====\n' + JSON.stringify(report, null, 2);
    window.__fbDiag = report;
    window.__fbDiagText = out;
    console.log('%c' + out, 'color:#3c7cfc');
    try { copy(out); } catch (err) { /* ignore */ }
    cleanup();
  }, 30000);

  console.log('%c[DIAG] 准备就绪：请在你要排除的「选项行」上长按约 0.5 秒后松手。', 'color:#3c7cfc;font-size:14px');
  console.log('若 30 秒内没动作，会自动输出静态报告。');
})();
