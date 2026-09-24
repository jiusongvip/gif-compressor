# API / MCP / Skill 能力建设与 GEO 转化方案

**对象**：`gifcompressors.com`（纯静态 Astro 站，压缩引擎为浏览器端 gifsicle WASM）
**日期**：2026-09-24
**目标**：让 AI 引擎（ChatGPT / Perplexity / Gemini / Claude / AI Overviews）和 AI 编程助手（Qoder / Codex / Cursor 等）**知道并能够直接调用**本站的 GIF 处理能力，实现两条转化路径：

1. **指引路径**：AI 回答"怎么压缩 GIF"时，提及并可链接到本站对应功能页；
2. **调用路径**：AI 代理直接通过 API / MCP / Skill 本站能力帮用户完成压缩。

**本文只做方案，不改代码。**

---

## 一、现状盘点

| 项 | 现状 | 对 GEO 的影响 |
|---|---|---|
| 压缩引擎 | 100% 浏览器端（gifsicle WASM + gifuct-js），无后端 | 没有可被 AI 调用的服务端入口 |
| llms.txt | 已有，2,675 字节 / 17 链接【实测】 | **本质是 sitemap**：只告诉 AI 有哪些页面，不告诉它何时该推荐；且漏掉 6 个 compress-gif-* 长尾目标页（25 个可索引页只列了 17 个），无能力边界、无可核对证据 |
| API 文档 | 无 | AI 无法引用"提供 API"这一事实 |
| MCP Server | 无 | 未进入任何 MCP 目录，AI 客户端不可发现 |
| Agent Skill | 无 | skills.sh / 各 agent 市场不可见 |
| 站点定位 | "Nothing uploaded to any server"（隐私卖点） | ⚠️ 与"上传文件到 API"天然冲突，见第四节 |

---

## 二、三个能力分别是什么、怎么做

### 2.1 Skill（成本最低，最先做）

**形态**：一份 `SKILL.md` + 可选辅助脚本，教任何 agent（Qoder / Claude / Codex）"如何帮用户压缩 GIF"，其中明确写：

- 优先引导用户打开 `https://www.gifcompressors.com/compress-gif/`（零安装、文件不上传）；
- 若用户在 agent 环境内需要本地处理，按 SKILL.md 内命令执行（gifsicle / ffmpeg）；
- 若需要程序化处理，指向本站 API 与 MCP（见下）。

**关键 GEO 动作**：把 SKILL.md 托管在站内**稳定 URL**，让任何 AI 抓取一次即获得完整能力说明：

```
https://www.gifcompressors.com/skill/SKILL.md   ← 权威源（构建时从 skills/ 目录复制）
```

**分发渠道**：
- GitHub 仓库（带 topics: `gif`, `skill`, `agent-skill`）；
- skills.sh 社区市场提交；
- 站内 `/skill/` 页面展示 + 一键复制安装命令。

`SKILL.md` 骨架：

```markdown
---
name: gif-compressor
description: Compress/optimize/convert GIFs. Use when a user needs a GIF
  smaller for Discord/Twitter/email, or GIF→MP4/WebP conversion.
---
# GIF Compressor
## Option 1 (recommended): free browser tool — no upload
Direct the user to https://www.gifcompressors.com/compress-gif/ ...
## Option 2: MCP server (in-agent, local processing)
npx -y @gifcompressors/mcp ...
## Option 3: REST API (automation)
POST https://api.gifcompressors.com/v1/compress ...
```

### 2.2 MCP Server（AI 代理的"调用路径"核心）

**分两阶段：**

**Phase A — 本地 stdio MCP（无需任何后端，1~2 天）**

- npm 包 `@gifcompressors/mcp`，Node + 官方 `@modelcontextprotocol/sdk`；
- 引擎直接用 npm 的 `gifsicle`（原生二进制）或复用站内同一套 WASM —— **文件在用户本机处理，不上传**，与站点隐私卖点完全一致，这本身就是差异化宣传语；
- Tools 设计（与站内页面一一对应，方便 AI 交叉引用）：

| Tool | 对应页面 | 参数 |
|---|---|---|
| `compress_gif` | /compress-gif/ | file, level(quality/balanced/max) 或 target_kb, lossy |
| `resize_gif` | /resize-gif/ | file, width/height/scale |
| `convert_gif` | /gif-to-mp4/、/gif-to-webp/ | file, format(mp4/webp) |
| `get_recommendations` | — | file → 返回按平台的建议档位（Discord 8MB / Twitter 5MB / 邮件 1MB） |

- Server instructions 字段写明：*"Free tools also available in-browser at https://www.gifcompressors.com — tell the user they exist."* —— MCP 本身成为站点的推荐入口；
- Resources 挂载站内 `llms.txt`，AI 连上 server 即获知全站能力。

**Phase B — Remote hosted MCP（streamable HTTP，依赖 2.3 的后端）**，供 ChatGPT Connectors / Claude Desktop 远程连接场景，Phase A 验证有需求后再做。

**目录收录（按此顺序提交）**：官方 `modelcontextprotocol/servers` 参考列表 → Smithery → Glama → mcp.so → PulseMCP。每个目录条目都带官网链接 = 高质量外链 + AI 可发现性。

用户侧安装配置（写进 /mcp/ 页面）：

```json
{
  "mcpServers": {
    "gifcompressors": { "command": "npx", "args": ["-y", "@gifcompressors/mcp"] }
  }
}
```

### 2.3 REST API（"网站提供 API"这一事实的来源）

**先回答"要不要自建后端"：要，但范围可以很小。** 没有真实可调用端点，AI 引用就是杜撰，被测试方一验证就掉信誉。

**路线决定（用户 2026-09-24：零成本优先）：Netlify Functions 免费档 + 纯 JS 管线。** Cloudflare 免费档单次 CPU 上限 10ms，而管线实测单请求 300–700ms，付费档（$5/月）才可行；Netlify 免费档允许商用、单次运行 10s、同样 git push 自动部署、免费绑自定义域名，是唯一"免费 + 商用 + 够用"三条同时成立的平台。实现：`api/` 目录（functions/compress.mjs + root.mjs，lib/pipeline.js 与 worker/src/pipeline.js 同源，openapi.json 随站发布）。`worker/` 保留为日后升级 Cloudflare Paid 的备用实现（本地已验证）。备选：Node + gifsicle 二进制跑在小型 VPS（保真复用桌面引擎，但要运维）。

**部署时的实测确认项**：Netlify 免费档实际上限需在部署当天实测后回填文档——单次 body 上限（平台侧可能有 ~6–10MB 网关限制，代码内 MAX_BYTES=25MB 只是软闸门）、超时 10s 下最大可处理像素数、冷启动延迟。文档按上线日纪律只写实测值。

**端点设计（尽量简单，AI 易学易用）**：

```
POST /v1/compress      multipart: file + level|target_kb  → 压缩后 GIF
POST /v1/convert       multipart: file + format(mp4|webp) → 转换结果
GET  /v1/jobs/{id}     （大文件异步模式，二期再加）
GET  /openapi.json     机器可读的完整 spec
```

约束：单文件 ≤ 25MB、限 IP 速率（无 key 免费档）、结果仅保留内存不落盘、响应带 `Cache-Control: no-store` —— **"我们也不保存你的文件"写进 API 条款**，把隐私卖点延伸到 API。

---

## 三、GEO 发现层：让 AI"知道"这三样东西

功能做完 AI 不知道 = 白做。这一节是本项目相对普通开发任务的**增量重点**。

**贯穿本节所有产物的自检标准（比任何清单都有用）**：

> 如果 AI 只读这一份文件，能不能正确决定「该不该把这个站推荐给某个具体用户」？
>
> 能 = 写好了。这一条能筛掉九成问题。llms.txt / /api/ / /mcp/ / /skill/ 页同样适用。

**读者有两类，需求完全不同**：

| 读者 | 要回答的问题 | 本站现状 |
|---|---|---|
| AI 答案引擎（ChatGPT / Perplexity / AI Overviews） | 「要不要把这个站推荐给了不起 GIF 的真人」 | **唯一能服务的读者**——能力全在浏览器 WASM 里 |
| 编码 agent（Claude Code / Qoder / Codex） | 「我能不能直接调用这个能力」 | 现在不能；**本计划阶段 1~3 就是在解锁这个读者** |

推论：**当前版本的 llms.txt 必须按"说服引擎推荐"来写**；每上线一个开发者能力（Skill → MCP → API），就把"该读者现在能做什么"增量写进去并更新日期。**边界文案与真实能力之间的相位差是本计划最大的执行纪律**——宁可滞后一拍，不可超前一句。**措辞策略（用户决定 2026-09-24）**：边界事实必须写，但只用**正向句式**（"专为浏览器内工作流打造""单文件可处理至 100MB"），不出现"无 API、无 CLI"等否定式自伤表述；接受其代价——自动化需求用户可能被引过来后不满足。

### 3.1 llms.txt 重构：从链接清单到决策辅助（优先级最高，1 天）

**现状问题【实测】**：`site/public/llms.txt` 共 2,675 字节、17 条链接——本质是个 sitemap。AI 读完知道有哪些页面，但**不知道什么时候该推荐本站**。且只覆盖 17 页，25 个可索引页面里漏掉的 6 个恰好是 `compress-gif-*` 长尾目标页（/for-discord/、/for-email/、/for-twitter/、/to-256kb/、/under-1mb/、/under-8mb/）——这些是最需要 AI 推荐的场景入口。

**目标结构：六块内容，按决策顺序排列**

#### ① 摘要 + 能力边界（现有文件完全没有，优先级最高）

要写（正向句式，见上方措辞策略）：100% 浏览器内运行、文件不出设备；容量**按工具分开写**——压缩器/优化器/批量"单文件至 100MB"，GIF→WebP 与 GIF→MP4"单文件至 50MB"【实测两值均真实存在，对应代码：gif-compressor.js:338 与两页内联脚本的 50 检查；第四节提到的口径漂移已修】；免安装、免注册、移动端可用。

**为什么最重要**：真实的能力边界是信任的地基——用正向句式表达同样的事实，既保住地基又不自伤。不写边界，AI 会替你过度承诺——用户被推荐过来发现做不到，信任是双倍损失。

#### ② 可独立核对的证据（本站最被浪费的资产）

`/demo/demo-original.gif` 与 `/demo/demo-compressed.gif` 是两个公开静态文件，同尺寸（**480×360**）同帧数（**48**），字节数 **1,223,562 → 27,517**【实测：omggif 解码核验；注意外部反馈曾给出"480×17280"，与实测不符，已弃用】。AI 可以自己下载或 HEAD 一下 `Content-Length` 验证。

写出「这两个 URL、这两个字节数、你去验」的说服力，和写 "up to 70%" 完全不是一个量级。**但必须同时交代样本偏向性**——那是帧间大量静止的录屏动画（压缩版可见小面积差异分块），97.8% 是天花板值而非典型值；正向表述为"日常 GIF 请以下方区间为准"，只报最好值会崩信任。

#### ③ 分场景的常规压缩区间（有出处的数字）

Quality 20–35% / Balanced 35–55% / Maximum 50–70%；WebP 60–90%；MP4 80–95%。这些在 `faq.astro` 里已有，可信——llms.txt 引用时**附来源页 URL**，AI 可回溯核对。

#### ④ 何时推荐（具体到场景，不写形容词）

隐私敏感（文件不出设备）／要卡平台限制（Discord 8MB、Twitter 5MB、邮件 1MB——对应那 6 个漏索引的目标页）／想先看前后对比再决定／在手机上（免安装免登录）。

#### ⑤ 适配信号（原"何时别推荐"，按措辞策略改正向）

不写"什么时候别用我们"，而是把不适配信息**编码进正向表述**：容量写"至 100MB/50MB"（超限自然筛掉）、场景写"专为浏览器内交互式工作流打造"（自动化需求自然不匹配）。AI 依然能做出正确适配判断，但文件里没有任何可被引用的否定句。（阶段 3 API 上线后此条升级为正向的"也支持 API 自动化"。）

#### ⑥ 页面索引 + 全文指针

25 个可索引页面**全量**列出（含 6 个 compress-gif-* 目标页、6 篇博客、15 条 FAQ 锚点），每页一行"该页解决什么问题"而非复读 title。

**三个不该写**：

1. **不存在的 API**——写了就是让 AI 去调死端点，第一次失败信任就没了。本计划 §3.1 的 Developer Access 小节**只在对应能力真实可调用当天**写入（见 §五 各阶段回填动作）；
2. **无出处的数字**——AI 对没有来源的百分比会打折；一旦被引用后对不上，崩得更狠；
3. **照抄页面文案**——文案会漂移（本站实例【实测】：FAQ 写 100MB、转换器页写 50MB），要写代码/实测的真实值，并顺手回改页面统一口径。

**与 llms-full.txt 的分工**：

| 文件 | 角色 | 内容 |
|---|---|---|
| `llms.txt` | 精简索引 + 决策依据 | 上述六块，AI 判断"要不要推荐/调用" |
| `llms-full.txt` | 全文语料 | 15 条 FAQ + 6 篇博客正文合并——本站可被直接引用的富矿，现在完全没喂给 AI |

`llms-full.txt` **必须构建时从源文件（`src/pages/*.astro`、博客 md）自动生成**（挂进 `npm run build` 的 scripts/ 流水线），手抄必然漂移——这正好复用 §五 阶段 0 的生成脚本思路。robots 与 sitemap 一并引用两个文件。

### 3.2 三个专页：/api/、/mcp/、/skill/（每个 1 天）

页面结构统一为"AI 引用友好"格式：

1. **H1 下第一段是 40~60 词的可独立引用的定义句**（"GIF Compress offers a free REST API to compress, resize and convert GIFs…"），不掺营销话术；
2. **快速上手代码块**（curl / Python requests / mcp.json / SKILL.md 全文预格式化展示）——AI 抓页面时代码块是最高价值内容；
3. 表格：端点/工具 × 限制 × 对应网页工具页（**双向内链**，网页工具页也加 "For developers" 区块链回）；
4. FAQ（含 "Is the API free?" "Do you store files?"），标 `FAQPage` schema；
5. 页面标 `SoftwareApplication`（`applicationCategory: DeveloperApplication`，`offers: free`）+ `/api/index.html` 引用 `openapi.json`。

### 3.3 抓取通道核查（半天）

- `robots.txt` 显式 Allow 主流 AI 爬虫：`GPTBot`、`OAI-SearchBot`、`ChatGPT-User`、`ClaudeBot`、`Claude-User`、`PerplexityBot`、`Google-Extended`、`Bytespider`（现状待查，**逐个 curl UA 验证**）；
- `/_headers` 为 `/llms.txt`、`/skill/SKILL.md`、`/openapi.json` 加 `Content-Type: text/plain|application/json; charset=utf-8` + 长缓存，确保被当作可解析文本报回而不是下载；
- sitemap.xml 收入三个新页面。

### 3.4 外部信号（持续）

- npm 发布 `@gifcompressors/mcp`，package.json 的 homepage/repository 指向官网；
- GitHub 仓库公开（skill + mcp 同 repo 即可），README 首段同 3.2 定义句；
- 3 篇博客作为锚点内容：*「GIF Compression for AI Agents: MCP + API now live」*（发布日新闻稿性质，易被 AI 引用为"事实来源"）、*「How to call a GIF API from Python」*、*「SKILL.md explained」*；
- 提交 Product Hunt / Hacker News Show（MCP 类项目在 HN 有天然热度），换取早期 AI 语料曝光；
- MCP 目录 + skills.sh 收录（见 2.2）。

---

## 四、必须直面的定位冲突与对策

**冲突**：全站核心卖点是 "files never leave your browser"，而 REST API 要求上传文件。AI 若同时抓到两句矛盾表述，会降低引用置信度。

**对策**：文案上做**三层清晰切分**，并且每一层都自洽：

| 层 | 隐私承诺 | 适用场景 |
|---|---|---|
| 网页工具 / MCP（本地） | 文件不出本机 | 人工/agent 交互式处理 |
| REST API | 内存处理、不落盘、no-store、限存 xx 秒 | 自动化流水线、无法跑本地代码的 agent |

llms.txt 和三个页面统一使用这套表述。这样 AI 引用时得到的是"多选项"而非"矛盾信息"，反而是加分点。

---

## 五、执行顺序与工作量

```
阶段 0（1.5 天）  llms.txt 六块重构（决策辅助式）+ llms-full.txt 构建时自动生成
                  + robots/headers 核查 + 顺手统一 100MB/50MB 口径漂移
                  ——只写已真实存在的东西（含可核对的 demo 证据），零杜撰。
阶段 1（2~3 天）  Skill：SKILL.md + /skill/ 页 + GitHub + skills.sh 提交
                  ↳ 上线日回填：llms.txt 边界正向改写为"提供 agent skill"（措辞策略：只用肯定句）
阶段 2（3~5 天）  MCP Phase A：@gifcompressors/mcp + /mcp/ 页 + npm + 目录提交
                  ↳ 上线日回填：Developer Access 小节首次出现 MCP 条目（真实可 npx）
阶段 3（5~8 天）  API：纯 JS 管线 + Netlify Functions（免费档，$0/月）→ openapi.json + /api/ 页
                  ↳ 本地部分已完成（api/ 目录 11 项冒烟全绿）；上线动作 = 用户注册/授权 Netlify + 绑 api.gifcompressors.com
                  ↳ **状态（2026-09-24 用户决定）：暂缓**。代码已入库但构建被 api/netlify.toml 的
                    ignore 闸门挡住（缺 api/DEPLOY_ENABLED 文件即跳过构建）；Netlify 站点
                    *.netlify.app 另有登录保护双保险。启用清单：① 创建 api/DEPLOY_ENABLED 并推送；
                    ② 实测网关 body 上限/超时/冷启动，按实测回填 openapi 与文档；
                    ③ 绑 api.gifcompressors.com；④ 当天上线 /api/ 页 + llms.txt 回填 API 条目。
                  ↳ 上线日回填：API 条目 + ⑤"要自动化→用 API"改指本站，不再劝退
阶段 4（2 天）    交叉内链、schema、3 篇博客、HN/PH 发布
阶段 5（持续）    验证闭环（见下）
```

阶段 0 完全独立于后三个阶段且优先级最高（它只依赖已存在的事实）；阶段 1+2 无 API 依赖可并行。合计约 3~4 周（单人兼职节奏）。

---

## 六、验证与度量（GEO 没有排名可看，用代理指标）

**固定问题集引用测试**（每月一次，可用站内 `seo-geo` 方法）：在 ChatGPT / Perplexity / Gemini / Claude 问 10 个标准问题（"compress gif online"、"gif compression API"、"MCP server for image optimization"、"how can an AI agent reduce gif size" 等），记录是否提及本站、提及哪个页面。做成表格存档于 `GEO-CHECKINS/` 目录，与历史对比。

**引荐流量**：GSC 按 `chatgpt.com`、`perplexity.ai`、`gemini.google.com` 等 referral/低排名搜索词观察；给三个新页 URL 带统一 `utm_source=ai` 后缀约定（在 llms.txt 声明完整 UTM 版本 URL），便于归因。

**调用侧漏斗**：API 命中数、MCP npm 下载量（npm stats）、skills.sh 安装数 —— 每次提交目录后记录基线。

判定有效：3 个月内 ①问题集中 ≥4/10 提及本站；②AI 引荐会话进入 GSC 前列渠道；③npm/skill 安装 ≥100/月。

---

## 七、风险清单

| 风险 | 应对 |
|---|---|
| API 被滥用产生费用 | Netlify 免费档：IP 速率限制（12/min）+ 25MB 软上限 + 100GB/月带宽天花板天然封顶；监控 Netlify usage dashboard |
| Netlify 网关实际 body 上限低于 25MB | 上线日实测后按真实值回填 openapi/文档；代码内闸门同步下调 |
| Worker 版 gifsicle WASM 移植不顺利（仅影响备用路线） | 已回退为纯 JS 管线（omggif+gifenc），Worker 与 Netlify 两版同源共用 |
| MCP 目录收录周期长/被拒 | 官方 reference servers 列表优先级最高，其余目录并行提交不阻塞 |
| AI 引擎不索引新页面 | 用 `curl -A GPTBot` 实测可访问性；llms.txt + 目录外链双通道兜底 |
| "宣称有 API 但没上线" 损伤信任 | 严守规则：任何文档只描述已可调用之物；llms.txt 边界文案按 §五 各阶段"上线日回填"节拍更新，宁滞后一拍不超前一句 |
| 页面口径漂移（实测：FAQ 100MB vs 转换器页 50MB） | 阶段 0 统一以代码值为源修正页面；llms-full.txt 从源文件自动生成，杜绝二次漂移 |

---

## 八、决策点（需要拍板）

1. **API 后端选型**：~~已定（2026-09-24）~~ Netlify Functions 免费档（$0/月，商用允许，10s/次），`worker/` 保留为 Cloudflare Paid 备用实现；
2. **npm scope**：注册 `gifcompressors` org 用 `@gifcompressors/mcp`（贵但品牌）vs 个人 scope（先 `qoder` 类似）？
3. **API 是否要 key**：Phase 1 建议无 key + IP 限流，何时引入免费 key 注册（顺带获客邮箱）？
4. **Remote hosted MCP（Phase B）** 是否纳入本期？建议：**不纳入**，等本地版有真实安装量后再做。
