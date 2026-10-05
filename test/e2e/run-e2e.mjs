/**
 * 端到端测试：在真实 Chromium 内核浏览器（Edge）中以「已加载扩展」的方式运行。
 * 覆盖两套真实页面结构：
 *   - 老版 www.fenbi.com/spa/tiku（li.theme-ques-option）
 *   - 新版 spa.fenbi.com/ti/exam（li.choice-radio / li.choice-checkbox）
 * 验证：manifest 可加载、content script/CSS 注入、长按排除、click 被吞、短按正常、恢复。
 *
 * 运行： node test/e2e/run-e2e.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const srcExt = path.join(root, 'fenbi-option-eliminator');

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
];

const PAGES = [
  { file: 'fixture.html', name: '老版 www.fenbi.com/spa/tiku' },
  {
    file: 'fixture-v2.html',
    name: '新版 spa.fenbi.com/ti/exam',
    extraChecks: [
      ['长按不会勾选该单选项（label 默认行为被取消）', (r) => r.checkedAfterLongPress === null,
        (r) => `checked=${r.checkedAfterLongPress}`],
      ['短按正常勾选对应选项', (r) => r.checkedAfterShortPress === '8-1',
        (r) => `checked=${r.checkedAfterShortPress}`]
    ]
  }
];

const BASE_CHECKS = [
  ['长按后选项被排除（class）', (r) => r.excludedClass === true],
  ['同一时刻仅 1 个选项被排除', (r) => r.excludedCount === 1, (r) => `count=${r.excludedCount}`],
  ['排除后透明度生效（content.css 已注入）', (r) => Number(r.computedOpacity) < 1, (r) => `opacity=${r.computedOpacity}`],
  ['长按后的 click 被吞掉（未误选）', (r) => r.optionClicksAfterLongPress === 0, (r) => `clicks=${r.optionClicksAfterLongPress}`],
  ['长按后的 click 被 preventDefault', (r) => r.clickDefaultPrevented === true],
  ['短按仍可正常选择', (r) => r.shortPressClicks === 1, (r) => `clicks=${r.shortPressClicks}`],
  ['短按不产生排除', (r) => r.shortPressExcluded === false],
  ['再次长按可恢复', (r) => r.restoredAfterSecondLongPress === true],
  ['最终无残留排除', (r) => r.finalExcludedCount === 0, (r) => `count=${r.finalExcludedCount}`]
];

function findBrowser() {
  for (const p of CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('未找到 Edge/Chrome 可执行文件');
}

/** 复制扩展并放宽匹配范围到本地测试服务器（仅测试副本，不改动交付物） */
function prepareExtension(workDir) {
  const extDir = path.join(workDir, 'ext');
  fs.cpSync(srcExt, extDir, { recursive: true });
  const manifestPath = path.join(extDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const matches = ['http://127.0.0.1/*', 'http://localhost/*'];
  manifest.host_permissions = matches;
  manifest.content_scripts.forEach((cs) => { cs.matches = matches; });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return extDir;
}

function startServer() {
  const server = http.createServer((req, res) => {
    const file = path.join(here, path.basename(new URL(req.url, 'http://x').pathname));
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buf);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function runBrowser(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function loadPage(bin, extDir, workDir, page) {
  const { server, port } = await startServer();
  const url = `http://127.0.0.1:${port}/${page.file}`;
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,msEdgeTranslate',
    `--user-data-dir=${path.join(workDir, 'profile-' + page.file)}`,
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    '--virtual-time-budget=12000',
    '--dump-dom',
    url
  ];

  let { stdout } = await runBrowser(bin, args, 120000);
  let match = stdout.match(/E2E-RESULT:(\{[\s\S]*?\})<\/pre>/);

  if (!match) {
    // 某些环境不支持 --load-extension 的新 headless，回退到有头模式
    console.log('（headless 未取得结果，回退到最小化窗口模式…）');
    const headed = args.filter((a) => a !== '--headless=new' && a !== '--disable-gpu');
    headed.splice(headed.indexOf('--dump-dom'), 0, '--window-size=900,700', '--window-position=-2000,-2000');
    ({ stdout } = await runBrowser(bin, headed, 120000));
    match = stdout.match(/E2E-RESULT:(\{[\s\S]*?\})<\/pre>/);
  }

  server.close();
  return { match, stdout };
}

async function main() {
  const bin = process.argv[2] || findBrowser();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fenbi-e2e-'));
  const extDir = prepareExtension(workDir);

  console.log(`浏览器: ${bin}`);
  console.log(`扩展副本: ${extDir}`);

  let totalFailed = 0;
  let totalChecks = 0;

  for (const page of PAGES) {
    console.log(`\n----- ${page.name}  (${page.file}) -----`);
    const { match, stdout } = await loadPage(bin, extDir, workDir, page);

    if (!match) {
      console.log('✗ 未在页面中取得测试结果（扩展可能未被加载）');
      console.log(stdout.slice(-1500));
      totalFailed++;
      totalChecks++;
      continue;
    }

    const r = JSON.parse(match[1]);
    const checks = BASE_CHECKS.concat(page.extraChecks || []);
    for (const [name, test, extra] of checks) {
      const ok = !!test(r);
      console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && extra ? '  → ' + extra(r) : ''}`);
      totalChecks++;
      if (!ok) totalFailed++;
    }
  }

  fs.rmSync(workDir, { recursive: true, force: true });
  console.log(`\nE2E 结果：${totalChecks - totalFailed} 通过，${totalFailed} 失败\n`);
  process.exit(totalFailed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
