# 粉笔刷题 · 长按排除选项（Edge 扩展）

在**粉笔网页版**刷题时，像 App 一样**长按选项即可将该选项变淡排除**，再次长按即可恢复。
纯本地扩展，不联网、不上传任何数据，只作用于 `fenbi.com` 域名下的页面。

---

## 一、安装（Edge，约 1 分钟）

1. 打开 Edge，地址栏输入 `edge://extensions/` 回车。
2. 打开左下角（或左侧）的 **开发人员模式** 开关。
3. 点击 **加载解压缩的扩展**。
4. 选择本文件夹：`fenbi-option-eliminator`（即包含 `manifest.json` 的那一层目录）。
5. 看到「粉笔刷题 · 长按排除选项」出现即安装成功。
6. 刷新已打开的粉笔页面（扩展只在页面加载时注入，不刷新不会生效）。

> 建议点击工具栏的拼图图标，把本扩展**固定**到工具栏，方便随时开关和调参。

## 二、使用

| 操作 | 效果 |
| --- | --- |
| 在选项行上**长按约 0.4 秒**（鼠标左键按住不动） | 该选项变淡 = 排除 |
| 在已排除的选项上**再次长按** | 恢复该选项 |
| 普通**单击**选项 | 正常选中答案，不受影响 |
| 长按后松手 | 不会误选答案（自动拦截这一次点击，包括 label→input 的原生勾选） |
| 切换上一题 / 下一题 | 排除状态自动清除，不会带到下一题 |

第一次长按时，页面右下角会显示一次使用提示（可在设置里关闭）。

### 设置面板
点击浏览器工具栏上的扩展图标：

- **总开关**：一键启用 / 停用。
- **长按判定时长**：150–900ms，默认 400ms（与 App 接近）。嫌触发慢就调小。
- **排除后透明度**：10%–70%，默认 30%（越小白越淡）。
- **排除后同时加删除线**：默认关闭。
- **右键单击也可排除 / 恢复**：默认关闭；开启后右键点选项即排除（会屏蔽该选项上的浏览器右键菜单）。
- **触屏长按**：默认开启，触摸屏设备长按生效并屏蔽系统长按菜单。
- **首次使用时显示提示**：默认开启。
- **自定义选项选择器（高级）**：见下文"失效排查"。
- **复制诊断报告**：一键把当前页面的真实 DOM 识别情况复制到剪贴板，长按没反应时用它反馈问题。
- **清除本页排除**：一键取消当前页所有排除。
- **恢复默认**：还原全部设置。

## 三、适用范围

**v1.1.0 已同时适配粉笔的两套网页版前端**（结构均取自线上 bundle 的真实组件）：

### 1. 新版粉笔：`spa.fenbi.com/ti/exam/...`（Angular 17，你现在用的这套）

```html
<div class="question-choice-container">
  <ul class="choice-radios">            <!-- 单选/判断；多选为 ul.choice-checkboxs -->
    <li class="choice-radio">            <!-- ← 扩展识别并变淡这一行（多选为 li.choice-checkbox）-->
      <label class="choice-radio-label" for="8-0">
        <input type="radio" class="option-radio" id="8-0">
        <div class="input-radio"> A </div>
        <p class="input-text">选项正文</p>
      </label>
    </li>
  </ul>
</div>
```

单选 `app-choice-radio`、多选 `app-choice-checkbox`、判断 `app-choice-true-false` 三种题型都已覆盖。

### 2. 老版粉笔：`www.fenbi.com/spa/tiku/...`（Angular 16）

```html
<div class="fb-question-options">
  <ul class="options font-color-gray-mid">
    <li class="theme-ques-option">        <!-- ← 扩展识别这一行 -->
      <label class="fb-label">
        <input class="fb-radio" type="radio">
        <span class="fb-radioInput radio-single">A</span>
      </label>
      <div class="options-material">选项正文</div>
    </li>
  </ul>
</div>
```

### 3. 结构兜底（粉笔再次改版也能用）

除上述 class 选择器外，扩展还有一层**结构识别**：只要是"行级元素（`li`/`label`/`div`/`tr`/`a`/`button`）内部恰好 1 个 `radio`/`checkbox`、文本较短、且是 `label` 或有 ≥2 个同标签兄弟"，
就会被当作选项行处理 —— 即使 class 名全变了，长按依然生效。另有 `all_frames`（iframe 内也生效）与 `composedPath()`（可穿透 Shadow DOM）。

## 四、失效排查

1. **长按没反应**
   - 打开扩展图标，看状态栏：
     - 「已排除 0 / 共 N 个选项」→ 识别正常，长按即可；
     - 「已注入脚本，但当前页面未检测到选项。」→ 说明粉笔又改版了，请点 **「复制诊断报告」** 把内容发我（内置诊断包含真实 DOM 结构，无需你截图）；
     - 「当前页面不是粉笔刷题页（或页面需刷新一次）」→ 扩展没注入，检查是否在 `fenbi.com` 域名、是否已刷新页面。
   - 点扩展面板里的 **「复制诊断报告」**，把报告发给开发者，可直接定位问题。
2. **长按有反应但识别不准 / 只对部分题型生效**
   - 在页面上右键选项 → **检查**，找到"整行选项"那个元素的 class，
     把它的 CSS 选择器填进设置里的**自定义选项选择器**（多个用英文逗号分隔），
     例如 `li.choice-radio, li.choice-checkbox`。自定义选择器会**追加**在内置选择器之后。
3. **长按后仍然选中了答案**
   - 说明长按判定时间偏长/偏短，调整"长按判定时长"；或改用右键模式。
4. **想临时停用**：点扩展图标关掉总开关，或到 `edge://extensions/` 停用扩展。

> 题外：仓库里还有 `diagnose/console-diagnose.js`，可以粘贴到 F12 控制台直接抓取页面真实 DOM（不依赖扩展），用于粉笔大改版时定位。

## 五、隐私

- 权限只有 `storage`（保存你的设置）和 `fenbi.com` 的站点访问权限。
- 不收集、不发送任何数据；排除状态只存在当前页面内存中，刷新即清空。

## 六、目录结构

```
fenbi-option-eliminator/
├─ manifest.json      # MV3 清单
├─ src/
│  ├─ content.js      # 核心：长按手势识别、排除/恢复、题目切换自愈
│  ├─ content.css     # 变淡样式、长按防选中、首次提示
│  ├─ popup.html/css/js  # 设置面板
├─ icons/             # 16/32/48/128 图标
└─ README.md
```

---

仅供个人学习与刷题提效使用，请遵守粉笔的用户协议；请勿用于批量抓取、自动答题等用途。
