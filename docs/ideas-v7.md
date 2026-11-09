# v7 改动记录 + 新功能/炫技灵感清单

## 一、v7 改动

### 1. 「定位当前」修复
- **根因**：旧代码用 `el.offsetTop` 计算滚动位置。`offsetTop` 相对于最近的定位祖先（offsetParent）——这里是 `.sheet`（`position` 非 static），而不是滚动容器 `.sheet-list`。因此它额外包含了标题栏 + 操作栏 + 搜索框约 **236px（≈4 行）**，导致列表滚过头：正在播放第 20 首，结果停在 #23–26。
- **修复**（`public/js/ui/sheet.mjs`）：
  - 用 `getBoundingClientRect` 差值 + `scrollTop` 求行中心：`rowCenter = er.top - lr.top - clientTop + scrollTop + er.height/2`，目标 = `rowCenter - clientHeight/2`，并夹在 `[0, scrollHeight - clientHeight]`。
  - rAF ease-out-cubic 平滑滚动（280–560ms，按距离），用户滚轮/按下/触摸即中断。
  - 到位后当前行红色双脉冲 `.is-located`（1.1s）。
  - 打开歌单弹层时自动无动画定位；点「定位当前」时若有搜索词先清空再定位。

### 2. 按钮按下后残留的浅色矩形框
- **根因**：触屏上 `:hover` 会「粘住」（点击后元素一直处于 hover 态，直到点别处），`.sheet-action:hover` 的浅色背景就一直留着；外加移动端默认的 tap highlight 与鼠标点击触发的 focus 轮廓。
- **修复**（`public/styles/player.css` + 新 `public/js/ui/pressFeedback.mjs`）：
  - 所有 `:hover` 规则包进 `@media (hover: hover) and (pointer: fine)`，触屏不再命中。
  - 全局 `-webkit-tap-highlight-color: transparent`。
  - `:focus:not(:focus-visible){outline:none}`；仅键盘导航显示双色焦点环（白 2px outline + 深色外晕）。
  - 新按压反馈：图标弹簧缩放（`:active` scale .88）+ 从按压点扩散的柔和圆形涟漪（径向渐变），松手淡出，**不留任何状态**；`prefers-reduced-motion` 下关闭。

### 3. 逐字卡拉 OK 歌词
- 服务端解析增强 LRC 的 `<mm:ss.xx>` 逐字时间标签（`server/services/lyrics.mjs`），去掉标签后的文本 + `words[]` 下发。
- 无逐字标签时估算：行时长按权重分配（中日韩每字 1，拉丁每词 0.55+0.12×长度，空格标点不占时）。
- 渲染：行内 `span.kara` 用 `linear-gradient + background-clip:text`，带 0.55em 羽化边；每帧只写一个 CSS 变量 `--fill`（px），无逐帧布局。`box-decoration-break: slice` 让渐变按阅读顺序跨越折行。
- 暂停/拖动冻结；已唱过的行先保持全亮，再通过 `@property --lit` 颜色过渡淡回灰色；保留原有的拖动选行与居中逻辑。

---

## 二、新功能 / 炫技灵感（按「价值 ÷ 工作量」排序）

工作量：S = 半天内，M = 1–2 天，L = 3 天以上。所有链接均已实际打开核对。

### A. 实用功能

| # | 功能 | 一句话说明 | 为什么适合本播放器 | 工作量 | 参考来源 |
|---|---|---|---|---|---|
| 1 | 锁屏/通知栏控制（Media Session） | 在系统锁屏、通知栏、蓝牙耳机按键上显示封面、歌名并能播放/暂停/切歌/拖进度 | 平板常锁屏听歌，现在锁屏后无法控制；纯前端 API，几十行代码 | S | https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API |
| 2 | 睡眠定时 | 15/30/60 分钟或「播完本首」后渐弱停止 | 已有 Web Audio 增益淡出，直接复用做长时间渐弱；睡前听歌刚需 | S | https://developer.mozilla.org/en-US/docs/Web/API/AudioParam/linearRampToValueAtTime |
| 3 | 歌词时间偏移 ±0.5s | 歌词快/慢时一键微调，并支持 LRC `[offset:]` 标签，按歌曲记住 | 本地 LRC 来源杂、经常不准；逐字高亮上线后偏差更明显 | S | https://en.wikipedia.org/wiki/LRC_(file_format) |
| 4 | 屏幕常亮（歌词模式） | 打开歌词页时阻止平板熄屏 | 平板放桌上当「歌词屏」是核心场景（注意：需 HTTPS 或 localhost） | S | https://developer.chrome.com/docs/capabilities/web-apis/wake-lock |
| 5 | 音乐库自动刷新 | 往音乐文件夹拷新歌后自动重新扫描、前端实时出现 | 现在加歌要手动重扫；Node 内置 `fs.watch` 即可，无需依赖 | M | https://nodejs.org/api/fs.html#fswatchfilename-options-listener |
| 6 | 均衡器 / 低音增强 | 5–10 段 EQ 预设（流行、人声、低音） | 音频已走 Web Audio 链路，插入 BiquadFilterNode 很顺 | M | https://developer.mozilla.org/en-US/docs/Web/API/BiquadFilterNode |
| 7 | 倍速 & 保持音高 | 0.75×–1.5× 播放，不变调 | 练歌、听有声内容有用；`preservesPitch` 默认就是 true | S | https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/preservesPitch |
| 8 | 安装到主屏 / 离线外壳（PWA） | 加 manifest + Service Worker，平板上像原生 App 全屏打开 | 去掉浏览器地址栏，体验更像网易云；壳资源可离线 | M | https://web.dev/learn/pwa/ |
| 9 | 手机当遥控器（局域网） | 同一 Wi‑Fi 下手机打开页面即可控制平板上的播放 | 服务器已监听 0.0.0.0；加一个 WebSocket 广播状态即可 | M | https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API |
| 10 | 大触控目标 & 粗指针适配 | 在 `pointer: coarse` 下把小图标按钮热区扩到 48px | 平板手指操作为主，减少误触 | S | https://web.dev/articles/accessible-tap-targets |

### B. 炫技效果

| # | 效果 | 一句话说明 | 为什么适合本播放器 | 工作量 | 参考来源 |
|---|---|---|---|---|---|
| 1 | 音频频谱可视化 | 唱片周围一圈随音乐跳动的频谱环 / 底部波形 | engine 里已有 AnalyserNode（调试用），接上 canvas 即可 | S | https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Visualizations_with_Web_Audio_API |
| 2 | 歌词逐字「上浮 + 发光」 | 在已完成的逐字填充上，再让当前字轻微上浮、末字辉光（Apple Music 风） | v7 卡拉 OK 已有逐字时间轴，加 transform 即可 | M | https://github.com/Steve-xmh/applemusic-like-lyrics |
| 3 | 封面流体背景 | 用封面主色做缓慢流动的网格渐变/流体背景，替代静态模糊 | 已有封面取色（nowPlaying 的 getImageData），升级成动态背景观感提升最大 | M | https://github.com/Steve-xmh/applemusic-like-lyrics （动态流体背景组件） |
| 4 | 低音律动 | 唱片/背景随低频能量轻微缩放、亮度脉动 | 复用 AnalyserNode 的低频段，只改 transform/opacity，开销极小 | S | https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Visualizations_with_Web_Audio_API |
| 5 | 共享元素转场 | 底栏小封面「飞」成播放页大唱片，返回时飞回 | 布局切换已用 View Transitions，扩展到底栏↔播放页 | M | https://developer.chrome.com/docs/web-platform/view-transitions |
| 6 | 弹簧物理动效统一 | 弹层、唱片切换、按钮统一用弹簧参数（刚度/阻尼），动作可打断 | 让全局手感一致、「活」起来；与 v7 按压弹簧一脉相承 | M | https://m3.material.io/styles/motion/overview ；https://emilkowal.ski/ui/great-animations |
| 7 | 唱片 3D 视差倾斜 | 手指按住/拖动唱片时随触点轻微 3D 倾斜 + 高光移动 | 唱片是视觉焦点，倾斜高光很「炫」，但要自己实现以免依赖 | S | https://github.com/micku7zu/vanilla-tilt.js |
| 8 | 桌面/悬浮歌词条 | 迷你模式：只剩一行大字逐字歌词 + 封面色背景，适合横放当歌词屏 | SPlayer 等同类播放器的招牌功能，我们逐字歌词已就绪 | M | https://github.com/imsyy/SPlayer |
| 9 | 设计规范文档化（DESIGN.md） | 把颜色、圆角、动效时长、按压规则写成 DESIGN.md，后续 AI 改 UI 风格不跑偏 | vibe coding 常用技巧；我们已多轮迭代，沉淀规则防回退 | S | https://github.com/VoltAgent/awesome-design-md/ ；https://github.com/maxbogo/awesome-ai-tools-for-ui |
| 10 | 统一交互状态层 | hover/press/focus 统一「状态层」叠色 + 双色焦点环，全站一套规则 | v7 已落地一半（hover 门控、焦点环），可继续推广到所有控件 | S | https://design.ramoslabs.com/patterns/interactive/ ；https://css-tricks.com/solving-sticky-hover-states-with-media-hover-hover/ |

### 其他参考（同类开源播放器，供整体借鉴）
- YesPlayMusic（第三方网易云风格播放器，整体 UI 参考）：https://github.com/qier222/YesPlayMusic
- SPlayer（逐字歌词、桌面歌词、频谱、本地曲库）：https://github.com/imsyy/SPlayer
- AMLL（类 Apple Music 歌词组件 + 流体背景，支持 TTML/YRC/QRC 逐字歌词）：https://github.com/Steve-xmh/applemusic-like-lyrics

> 说明：以上均为「参考思路，自行实现」；不提取、不复制任何网易云资源文件。
