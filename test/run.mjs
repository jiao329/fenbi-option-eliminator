/**
 * 粉笔长按排除选项 —— 内容脚本行为测试（jsdom）
 * 覆盖：老版 DOM（www.fenbi.com/spa/tiku）、新版 DOM（spa.fenbi.com/ti/exam）、未知 class 的结构兜底
 * 运行： node test/run.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const contentSource = fs.readFileSync(path.join(here, '..', 'fenbi-option-eliminator', 'src', 'content.js'), 'utf8');

const FIXTURES = {
  v1: {
    file: 'fixture.html',
    title: '老版 www.fenbi.com/spa/tiku',
    rows: 'li.theme-ques-option',
    inner: '.fb-radioInput',
    stem: '.question-content',
    count: 4
  },
  v2: {
    file: 'fixture-v2.html',
    title: '新版 spa.fenbi.com/ti/exam',
    rows: 'li.choice-radio',
    inner: '.input-radio',
    stem: '.content',
    count: 7
  },
  generic: {
    file: 'fixture-generic.html',
    title: '未知 class（结构兜底识别）',
    rows: 'li.zzz-item',
    inner: '.zzz-txt',
    stem: '.q-stem',
    count: 4
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOLD = 150; // 内容脚本最小长按阈值 80ms，这里留足余量

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}${extra ? '  → ' + extra : ''}`);
  }
}

function makeChrome(store = { sync: {}, local: {} }) {
  const changeListeners = [];
  const messageListeners = [];
  return {
    storage: {
      sync: {
        get(defaults, cb) { cb(Object.assign({}, defaults, store.sync)); },
        set(data, cb) { Object.assign(store.sync, data); if (cb) cb(); }
      },
      local: {
        get(defaults, cb) { cb(Object.assign({}, defaults, store.local)); },
        set(data, cb) { Object.assign(store.local, data); if (cb) cb(); }
      },
      onChanged: { addListener(fn) { changeListeners.push(fn); } }
    },
    runtime: {
      onMessage: { addListener(fn) { messageListeners.push(fn); } },
      lastError: null
    },
    __store: store,
    __fireChanged(changes, area) { changeListeners.forEach((fn) => fn(changes, area)); },
    __send(message) {
      let response = null;
      messageListeners.forEach((fn) => fn(message, {}, (r) => { response = r; }));
      return response;
    }
  };
}

function createPage(fixtureKey, opts = {}) {
  const fx = FIXTURES[fixtureKey];
  const html = fs.readFileSync(path.join(here, fx.file), 'utf8');
  const chromeFake = makeChrome(opts.store);
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://spa.fenbi.com/ti/exam/exercise/1_1_3t4mtur',
    beforeParse(window) { window.chrome = chromeFake; }
  });
  dom.window.eval(contentSource);
  const api = dom.window.__fbOptionEliminator;
  if (opts.settings !== null) {
    api.setSettings({ holdMs: 30, showHint: false, ...(opts.settings || {}) });
  }
  return { dom, window: dom.window, document: dom.window.document, api, chromeFake, fx };
}

function pointer(window, type, target, props = {}) {
  const ev = new window.Event(type, { bubbles: true, cancelable: true, composed: true });
  const data = { clientX: 100, clientY: 100, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', ...props };
  for (const [k, v] of Object.entries(data)) {
    Object.defineProperty(ev, k, { value: v, configurable: true });
  }
  target.dispatchEvent(ev);
  return ev;
}

function click(window, target) {
  const ev = new window.Event('click', { bubbles: true, cancelable: true, composed: true });
  target.dispatchEvent(ev);
  return ev;
}

function trackClicks(el) {
  const hits = [];
  el.addEventListener('click', (e) => hits.push(e));
  return hits;
}

/** 构造一个"未派发但带祖先路径"的事件，用于在测试里直接问 resolveOption 会命中谁 */
function fakeEvent(el) {
  const path = [];
  let n = el;
  while (n) {
    path.push(n);
    n = n.parentElement;
  }
  return { type: 'pointerdown', target: el, composedPath: () => path };
}

async function longPress(window, el) {
  pointer(window, 'pointerdown', el);
  await sleep(HOLD);
  pointer(window, 'pointerup', el);
}

/* ------------------------------------------------------------------ */
async function coreSuite(key) {
  const fx = FIXTURES[key];
  console.log(`\n===== [${key}] ${fx.title} =====`);

  {
    const { document, api } = createPage(key);
    check('识别出的选项行数量正确', api.countOptions() === fx.count, `期望 ${fx.count}，实际 ${api.countOptions()}`);
    check('选项行选择器命中', document.querySelectorAll(fx.rows).length > 0);
  }

  {
    const { document, window, api } = createPage(key);
    const row = document.querySelectorAll(fx.rows)[0];
    const inner = row.querySelector(fx.inner) || row;
    const dim = api.resolveOption(fakeEvent(inner)) || row;   // 扩展实际会变淡的元素
    const hits = trackClicks(row);

    pointer(window, 'pointerdown', inner);
    await sleep(20);
    check('未达时长不排除', !dim.classList.contains(api.CLASS_EXCLUDED));
    await sleep(HOLD);
    check('长按后变淡排除', dim.classList.contains(api.CLASS_EXCLUDED));
    check('排除计数为 1', api.countExcluded() === 1, `实际 ${api.countExcluded()}`);

    pointer(window, 'pointerup', inner);
    const ev = click(window, inner);
    check('长按后的 click 被拦截', hits.length === 0, `click 触发 ${hits.length} 次`);
    check('长按后的 click 被 preventDefault', ev.defaultPrevented);
    if (key === 'v2') {
      check('新版：长按不会勾选该单选项（label 默认行为被取消）',
        !window.__checkedIds || window.__checkedIds.length === 0, JSON.stringify(window.__checkedIds));
    }
  }

  {
    const { document, window, api } = createPage(key);
    const row = document.querySelectorAll(fx.rows)[1];
    const inner = row.querySelector(fx.inner) || row;
    const dim = api.resolveOption(fakeEvent(inner)) || row;

    await longPress(window, inner);
    check('第一次长按排除', dim.classList.contains(api.CLASS_EXCLUDED));
    await sleep(50);
    await longPress(window, inner);
    check('第二次长按恢复', !dim.classList.contains(api.CLASS_EXCLUDED));
    check('恢复后计数归零', api.countExcluded() === 0);
  }

  {
    const { document, window, api } = createPage(key);
    const row = document.querySelectorAll(fx.rows)[2];
    const inner = row.querySelector(fx.inner) || row;
    const dim = api.resolveOption(fakeEvent(inner)) || row;
    const hits = trackClicks(row);

    pointer(window, 'pointerdown', inner);
    await sleep(10);
    pointer(window, 'pointerup', inner);
    check('短按不排除', !dim.classList.contains(api.CLASS_EXCLUDED));
    const ev = click(window, inner);
    check('短按 click 正常派发', hits.length === 1, `实际 ${hits.length}`);
    check('短按 click 未被 preventDefault', !ev.defaultPrevented);
  }

  {
    const { document, window, api } = createPage(key);
    const row = document.querySelectorAll(fx.rows)[0];
    const inner = row.querySelector(fx.inner) || row;
    const dim = api.resolveOption(fakeEvent(inner)) || row;
    await longPress(window, inner);
    check('切题前已排除', dim.classList.contains(api.CLASS_EXCLUDED));

    const stem = document.querySelector(fx.stem);
    if (stem) stem.textContent = '切换后的新题干？';
    document.querySelectorAll(fx.rows).forEach((el, i) => { el.textContent = '新题选项 ' + i; });
    await sleep(450);
    check('切换题目后自动恢复', !dim.classList.contains(api.CLASS_EXCLUDED));
    check('切换题目后计数归零', api.countExcluded() === 0);
  }

  {
    const { document, window, api, chromeFake } = createPage(key);
    const row = document.querySelectorAll(fx.rows)[1];
    const inner = row.querySelector(fx.inner) || row;
    await longPress(window, inner);

    const status = chromeFake.__send({ type: 'fb-opt-status' });
    check('status 返回已排除数', status && status.excluded === 1, JSON.stringify(status));
    check('status 返回选项总数', status && status.options === fx.count, JSON.stringify(status));

    const cleared = chromeFake.__send({ type: 'fb-opt-clear' });
    check('clear 清除成功', cleared && cleared.cleared === 1 && api.countExcluded() === 0, JSON.stringify(cleared));

    chromeFake.__fireChanged({ holdMs: { newValue: 123 } }, 'sync');
    check('storage 变更实时同步', api.getSettings().holdMs === 123);
  }

  {
    const { document, window, api } = createPage(key, { settings: { rightClick: true } });
    const row = document.querySelectorAll(fx.rows)[0];
    const ev = new window.Event('contextmenu', { bubbles: true, cancelable: true, composed: true });
    row.dispatchEvent(ev);
    check('右键模式：单击右键即排除', row.classList.contains(api.CLASS_EXCLUDED));
    check('右键模式：菜单被屏蔽', ev.defaultPrevented);
  }

  {
    const { document, window, api } = createPage(key, { settings: { enabled: false } });
    const row = document.querySelectorAll(fx.rows)[0];
    const inner = row.querySelector(fx.inner) || row;
    await longPress(window, inner);
    check('总开关关闭后不生效', !row.classList.contains(api.CLASS_EXCLUDED));
  }

  {
    const { document, window, api } = createPage(key);
    const stem = document.querySelector(fx.stem);
    const ev = pointer(window, 'pointerdown', stem);
    await sleep(HOLD);
    check('题干区域不产生排除', api.countExcluded() === 0);
    const ev2 = click(window, stem);
    check('题干 click 未被拦截', !ev2.defaultPrevented);
    check('题干 pointerdown 未被 preventDefault', !ev.defaultPrevented);
  }

  {
    const { document, window, api, chromeFake } = createPage(key);
    const row = document.querySelectorAll(fx.rows)[0];
    await longPress(window, row.querySelector(fx.inner) || row);
    const diag = chromeFake.__send({ type: 'fb-opt-diagnose' });
    check('诊断报告可生成', !!(diag && diag.ok && diag.report));
    check('诊断报告含选择器命中统计', !!(diag && diag.report && diag.report['选择器命中']));
    check('诊断报告含最近一次按下', !!(diag && diag.report && diag.report['最近一次按下']));
    void api;
  }
}

/* ------------------------------------------------------------------ */
console.log('\n[0] 基础设置读取');
{
  const a = createPage('v1');
  check('默认长按阈值 400ms', a.api.DEFAULTS.holdMs === 400);
  const b = createPage('v1', { settings: null, store: { sync: { holdMs: 555 }, local: {} } });
  check('从 storage 读取自定义设置', b.api.getSettings().holdMs === 555, `实际 ${b.api.getSettings().holdMs}`);
  check('导出的版本号已更新', a.api.version === '1.1.0', a.api.version);
}

for (const key of Object.keys(FIXTURES)) {
  await coreSuite(key);
}

console.log('\n===== [自定义选择器] =====');
{
  const { document, window, api } = createPage('v1', { settings: { customSelector: 'li.fb-label, .my-option' } });
  const div = document.createElement('div');
  div.className = 'my-option';
  div.textContent = '自定义选项';
  document.body.appendChild(div);
  const ev = pointer(window, 'pointerdown', div);
  await sleep(HOLD);
  check('自定义选择器生效', api.resolveOption(ev) === div);
}

console.log('\n===== [新版单选/多选分别适配] =====');
{
  const { document, window, api } = createPage('v2');
  const checkbox = document.querySelector('li.choice-checkbox');
  await longPress(window, checkbox.querySelector('.input-checkbox'));
  check('新版多选题选项可排除', checkbox.classList.contains(api.CLASS_EXCLUDED));
  const radio = document.querySelector('li.choice-radio');
  check('单选未被误伤', !radio.classList.contains(api.CLASS_EXCLUDED));
}

console.log('\n===== [结构兜底：class 全变也能识别] =====');
{
  const { document, window, api } = createPage('generic');
  const row = document.querySelector('li.zzz-item');
  const resolved = api.resolveOption(fakeEvent(row.querySelector('.zzz-txt')));
  check('兜底识别命中整行元素（li 而非内部 label）', resolved === row,
    resolved ? resolved.tagName + '.' + resolved.className : String(resolved));
  check('兜底不会把整题容器当成选项行',
    api.resolveOption(fakeEvent(document.querySelector('.q-card'))) === null);
  check('兜底计数正确', api.countOptions() === 4, `实际 ${api.countOptions()}`);
  await longPress(window, row.querySelector('.zzz-txt'));
  check('兜底场景下长按可排除', row.classList.contains(api.CLASS_EXCLUDED));
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failures.length) console.log('失败项：\n  - ' + failures.join('\n  - '));
console.log('');
process.exit(failed === 0 ? 0 : 1);
