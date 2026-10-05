/* 粉笔刷题 · 长按排除选项 —— 设置面板 */
(function () {
  'use strict';

  var DEFAULTS = {
    enabled: true,
    holdMs: 400,
    opacity: 0.3,
    strike: false,
    rightClick: false,
    touch: true,
    customSelector: '',
    showHint: true
  };

  var el = {
    enabled: document.getElementById('enabled'),
    holdMs: document.getElementById('holdMs'),
    holdMsVal: document.getElementById('holdMsVal'),
    opacity: document.getElementById('opacity'),
    opacityVal: document.getElementById('opacityVal'),
    strike: document.getElementById('strike'),
    rightClick: document.getElementById('rightClick'),
    touch: document.getElementById('touch'),
    showHint: document.getElementById('showHint'),
    customSelector: document.getElementById('customSelector'),
    status: document.getElementById('status'),
    clear: document.getElementById('clear'),
    diag: document.getElementById('diag'),
    reset: document.getElementById('reset')
  };

  var saveTimer = null;

  function activeTab(cb) {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        cb(tabs && tabs[0]);
      });
    } catch (err) {
      cb(null);
    }
  }

  function sendToTab(message, cb) {
    activeTab(function (tab) {
      if (!tab || tab.id === undefined) { if (cb) cb(null); return; }
      try {
        chrome.tabs.sendMessage(tab.id, message, function (res) {
          if (chrome.runtime.lastError) { if (cb) cb(null); return; }
          if (cb) cb(res);
        });
      } catch (err) {
        if (cb) cb(null);
      }
    });
  }

  function render() {
    el.holdMsVal.textContent = el.holdMs.value + ' ms';
    el.opacityVal.textContent = el.opacity.value + '%';
  }

  function collect() {
    return {
      enabled: el.enabled.checked,
      holdMs: Number(el.holdMs.value),
      opacity: Number(el.opacity.value) / 100,
      strike: el.strike.checked,
      rightClick: el.rightClick.checked,
      touch: el.touch.checked,
      showHint: el.showHint.checked,
      customSelector: el.customSelector.value.trim()
    };
  }

  function save(immediate) {
    render();
    if (saveTimer) clearTimeout(saveTimer);
    var doSave = function () {
      saveTimer = null;
      var data = collect();
      try {
        chrome.storage.sync.set(data, function () {
          sendToTab({ type: 'fb-opt-settings-changed' });
        });
      } catch (err) { /* ignore */ }
    };
    if (immediate) doSave();
    else saveTimer = setTimeout(doSave, 120);
  }

  function fill(settings) {
    el.enabled.checked = !!settings.enabled;
    el.holdMs.value = settings.holdMs;
    el.opacity.value = Math.round(Number(settings.opacity) * 100);
    el.strike.checked = !!settings.strike;
    el.rightClick.checked = !!settings.rightClick;
    el.touch.checked = !!settings.touch;
    el.showHint.checked = !!settings.showHint;
    el.customSelector.value = settings.customSelector || '';
    render();
  }

  function refreshStatus() {
    sendToTab({ type: 'fb-opt-status' }, function (res) {
      if (!res || !res.ok) {
        el.status.textContent = '当前页面不是粉笔刷题页（或页面需刷新一次）';
        el.status.className = 'status warn';
        return;
      }
      el.status.className = 'status';
      if (!res.options) {
        el.status.textContent = '已注入脚本，但当前页面未检测到选项。';
      } else {
        el.status.textContent = '当前页：已排除 ' + res.excluded + ' / 共 ' + res.options + ' 个选项';
      }
    });
  }

  /* 事件绑定 */
  ['enabled', 'strike', 'rightClick', 'touch', 'showHint'].forEach(function (key) {
    el[key].addEventListener('change', function () { save(true); });
  });
  ['holdMs', 'opacity'].forEach(function (key) {
    el[key].addEventListener('input', function () { save(false); });
  });
  el.customSelector.addEventListener('input', function () { save(false); });

  el.clear.addEventListener('click', function () {
    sendToTab({ type: 'fb-opt-clear' }, function () { refreshStatus(); });
  });

  el.diag.addEventListener('click', function () {
    sendToTab({ type: 'fb-opt-diagnose' }, function (res) {
      if (!res || !res.ok || !res.report) {
        el.status.className = 'status warn';
        el.status.textContent = '诊断失败：该页面没有注入脚本，请刷新页面后再试';
        return;
      }
      var text = JSON.stringify(res.report, null, 2);
      try { console.log('[粉笔长按排除] 诊断报告\n' + text); } catch (err) { /* ignore */ }
      var done = function (ok) {
        el.status.className = ok ? 'status' : 'status warn';
        el.status.textContent = ok
          ? '诊断报告已复制到剪贴板，粘贴发给开发者即可'
          : '复制失败：请在扩展面板右键→检查，从控制台复制';
      };
      try {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      } catch (err) {
        done(false);
      }
    });
  });

  el.reset.addEventListener('click', function () {
    fill(DEFAULTS);
    save(true);
  });

  /* 初始化 */
  try {
    chrome.storage.sync.get(DEFAULTS, function (items) {
      fill(Object.assign({}, DEFAULTS, items || {}));
      refreshStatus();
    });
  } catch (err) {
    fill(DEFAULTS);
    refreshStatus();
  }
})();
