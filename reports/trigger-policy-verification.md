# trigger-policy 独立验证报告（T7 / task-3）

- 验证者：verifier（独立于 impl-plugin 与 tests-author）
- 日期：2026-09-20
- 对象：`specs/feature-jev-trigger-policy.yaml` 的 12 条 acceptance_criteria
- 仓库：`~/temp/dsh-plugin-jev`
- 脱敏说明：本报告初稿含本机绝对路径，发布前统一改写为 `~/…`（`/tmp/…` 为临时目录，保持不变）；正文结论未改动。
- **提交前状态更新（Lead 追加）**：撰写本报告时 web host 仍加载旧 JS，故把活体一项记为 `restart-required`；
  用户随后重启 host，Lead 以 `Tool.listTools` 只读核对确认 `jev_decide` 描述已是 1441 字符、四锚点齐备 ——
  该项已关闭，直接证据见 `reports/trigger-policy-e2e-runtime.md` 的「重启后复核」。
- 结论：**12/12 条 acceptance_criteria 通过**（代码级 11 条 + 活体如实记录 1 条）。
  另有 1 条「测试覆盖缺口」（SPEC context 的 A/B 单一来源设计点无任何断言，可被取巧实现绕过）
  和 1 条「运行级已证但仅限 headless」的说明；均不影响本次交付，详见文末。
- **更新（T9 增量复验，见文末「T8 增量复验」章节）**：上述唯一覆盖缺口已由 tests-author 在 T8
  修补（`test/policy-section.mjs` 新增 ACX2 块，PASS 37→41；`lib/index.js` sha256 未变）。
  我独立复验确认 ACX2 **独立地**杀死了 M5 型取巧（3 条 ACX2 FAIL，A 面 7 条结论仍全 PASS）。
  本章以下 T7 原文保持不变，作为历史记录。

## 证据分级约定

- **代码级已证**：`node` 进程内直接调用真实 `lib/index.js` 的导出，或读源码行号可复核。
- **运行级已证**：真实 Cordis host 启动过程中产生的会话日志（request/header、system/message）逐字核对。
- **运行级未生效**：用户正在服务的 `127.0.0.1:3080` web host 上仍未加载新 JS → `restart-required`。

---

## 一、12 条 acceptance_criteria 逐条结论

| # | 准则 | 结论 | 可复现证据 |
|---|---|---|---|
| AC1 | 【正常·A】smoke 通过且断言 4 锚点 | **通过（代码级 + 运行级）** | `node test/smoke.mjs` → EXIT=0，76 PASS，末行 `SMOKE OK (21 mock requests)`；4 条锚点断言在 `test/smoke.mjs:183-187`。我另用真实导出独立复核：description 同时含 schema(1) 全部 6 个锚点（`When to use` / `Default: ask Jev before turning a judgment about meaning, intent, relevance,` / `Exempt only when` / `Decision moments` / `Budget:` / `jev_decide`）均为 true。运行级见第三节证据 A。 |
| AC2 | 【正常·B】延迟 `ctx.inject(['systemPrompt'],cb)` 后 section 注册一次且字段合规 | **通过（代码级 + 运行级）** | `node test/policy-section.mjs` → EXIT=0，37 PASS：`test/policy-section.mjs:119-161`（inject 恰好 1 次且 services=['systemPrompt']；apply 内不急切注册；flush 后恰好 1 个 section；name=`jev-decision-policy`；interpolate=false；order=假 `getSectionOrder('MCP_SERVERS')+10`=3110；text 以 `## Jev decision policy` 开头；含 `jev_decide`；含 `Exempt only when`/`Decision moments`/`run_code`；无 `complete` 键）。实现：`lib/index.js:630-650`、`lib/index.js:633`、`lib/index.js:636-644`。运行级见第三节证据 B。 |
| AC3 | 【边界·长度】description ≤1500、section ≤1200 | **通过（代码级）** | 独立 `node` 实测：`description.length = 1441`、`section.text.length = 837`；断言在 `test/policy-section.mjs:178-179`。README `README.md:44` 写「约 1.4k / 约 0.8k」一致。 |
| AC4 | 【边界·序位覆盖】`policySection.order=-5000` 恰为 -5000 | **通过（代码级）** | `test/policy-section.mjs:193-197` PASS；实现 `lib/index.js:639-642`（显式 order 优先，缺省才走 `defaultSectionOrder`）。 |
| AC5 | 【失败·服务缺席】不抛错且 tools.register 恰 1 次 | **通过（代码级）** | `test/policy-section.mjs:199-209` PASS（无 systemPrompt 时 apply 不抛、tools=1、section=0）。实现 `lib/index.js:631-635`（无 inject 直接 return；回调内再判空）。另独立验证「systemPrompt 在 apply 之后才出现」也正常：回调挂起、服务出现后 flush 注册 1 个 section（order=3110）。 |
| AC6 | 【失败·显式关闭】enabled=false：tools 恰 1 次、section 0 次 | **通过（代码级）** | `test/policy-section.mjs:211-216` PASS；实现 `lib/index.js:683`（仅 enabled 为真才调 `registerPolicySection`）。 |
| AC7 | 【失败·非法配置】`enabled='yes'` 与 `order=NaN` 各抛 `tool-jev:` 前缀 Error | **通过（代码级）** | `test/policy-section.mjs:218-228` PASS；实现 `lib/index.js:118-120`、`lib/index.js:123-125`。 |
| AC8 | 【回归·语法保留】6 个既有子串仍在 | **通过（代码级）** | `test/policy-section.mjs:182-191` PASS；我独立复核 6 个全 true。常量在 `lib/index.js:495-506`。 |
| AC9 | 【回归·测试全绿】loader-overlay/fixture-check/bundle-install EXIT=0 | **通过（代码级）** | 独立复跑：`node test/loader-overlay.mjs` EXIT=0 / 3 PASS / `LOADER OK`；`node test/fixture-check.mjs` EXIT=0 / 6 PASS / `FIXTURE OK`；`node test/bundle-install.mjs` EXIT=0 / `PASS=37 FAIL=0 SKIP=0`。 |
| AC10 | 【回归·组合不变】dump-config 中 `id: tool-jev` 恰 1 次且 config 键集不变 | **通过（代码级）** | `dsh --profile web --dump-config > /tmp/dump-web.txt` EXIT=0；`diff /tmp/dump-web.txt reports/trigger-policy-baseline.txt` → **EXIT=0，0 行差异**（比「唯一允许新增 policySection」更强：profile 未写该字段，故逐字相同）；`grep -c 'id: tool-jev'` = **1**；基线文件为**本地未发布产物**（含 profile 布局与 keyFile 路径，已列入 `.git/info/exclude`），可用同一命令重新生成。 |
| AC11 | 【回归·零依赖】dependencies 未变、import 仅 node: 内置 | **通过（代码级）** | `lib/index.js:20-22` 仅 `node:fs/promises`、`node:os`、`node:path`；`git diff package.json` 仅新增 `"test:policy"` 一行，无 dependencies 字段变动。 |
| AC12 | 【活体·不重启】不改 profile、不重启、只读核对并如实记 restart-required | **通过（如实记录）** | 未重启 web host、未改任何 profile 的 patch/package；`cordis_inspect_query(host/Tool/listTools)` 读到的 `jev_decide` 描述为**旧文本**（1185 字符，无任何新锚点，见第四节）。故 A/B 在**用户 web host 上均未生效**，如实记为 **`restart-required`**。 |

---

## 二、必做项 (a)(b)(c) 专项

### (a) README 写死的断言计数 vs 实际运行输出 —— **一致，无过期项，无需归属**

| README 位置 | README 声称 | 实际运行（本次独立复跑） |
|---|---|---|
| `README.md:284` | smoke「76 项断言」 | `grep -c '^PASS '` = **76**，EXIT=0 |
| `README.md:285` | policy-section「37 项断言」 | **37**，EXIT=0，`POLICY OK` |
| `README.md:286` | fixture-check「6 项断言」 | **6**，EXIT=0 |
| `README.md:291` | loader-overlay「3 项断言」 | **3**，EXIT=0 |
| `README.md:292` | bundle-install「37 项断言」 | `PASS=37 FAIL=0 SKIP=0` |

结论：README 五处计数与实际逐一对上；**无失败项、无需向任何 owner 报归属**。

### (b) `test/policy-section.mjs` 是否真读实现产物，而非自证 —— **是，且我做了变异实验**

测试第 22 行 `import { apply, inject as pluginInject } from '../lib/index.js'`，是对真实模块的导入；
测试通过真实 `apply()` 注册的 tool/section 读取断言。为排除「自证」，我把仓库复制到 `/tmp/mutant`，
只改**副本**的 `lib/index.js`（**未触碰仓库文件**，仓库 `lib/index.js` sha256 全程保持
`d3ca46c8…`），逐个植入缺陷并运行副本里的 `test/policy-section.mjs`：

| 变异（在副本上） | 结果 | 说明 |
|---|---|---|
| M0 副本原样 | EXIT=0，0 FAIL | 基线自洽 |
| M1 `name` 改成 `broken-name` | EXIT=1，1 FAIL | `AC2 section.name...` 识破 |
| M2 把 order 写死成 `3110`（不再调 `getSectionOrder`） | EXIT=1，1 FAIL | `ACX order is derived from ... not hardcoded` 识破 |
| M3 加 `complete: true` | EXIT=1，1 FAIL | `AC2 section object omits "complete"` 识破 |
| M4 改坏共享 `policyBlock()` | EXIT=1，3 FAIL | A 面锚点同时失效，识破 |

→ **至少 4 条断言确实以真实实现为输入，不是自证。**

**但存在一处取巧实现无法识破（本轮最重要的对抗性发现）：**

| M5（取巧） | 结果 |
|---|---|
| 只把 `policySectionText()` 换成硬编码的两行 `'## Jev decision policy'` + `'Exempt only when Decision moments jev_decide run_code'`，`describeTool()` 不动 | `policy-section.mjs` **37 PASS / EXIT=0**；`smoke.mjs` **76 PASS / EXIT=0** |

即：SPEC context 第 44-45 行的设计硬点——「A 与 B 的文字必须由同一组常量拼装，禁止两处各写一份导致漂移」
「B 的正文以 A 的政策块为准」——**没有任何断言覆盖**。12 条 acceptance_criteria 只固定了逐字子串，
而输出侧 `outputs.schema(3)` 对 section 的最低要求（含 `Exempt only when`、`Decision moments`、
PTC 一句）M5 恰好都满足，所以字面上仍算合规。

- 对**本次交付**的判定：实际实现**没有**取巧——`policySectionText()`（`lib/index.js:525-532`）
  确实调用共享的 `policyBlock()`（`lib/index.js:514-516`），`describeTool()`（`lib/index.js:540-549`）
  也从同一 `POLICY` 常量（`lib/index.js:485-507`）拼装，二者对 `defaultRule` 逐字一致（独立 node 实测）。
  因此锚点不是被取巧方式满足的。
- 对**测试套件**的判定：检测力有缺口。**归属 owner：tests-author**。建议补一条断言，
  例如 `section.text.includes(POLICY 的 defaultRule / budget 全文)`，或断言 section 含
  `Budget:` 与完整 `Default: ask Jev before turning a judgment about meaning, intent, relevance, ...`
  （当前只断言了 4 个短锚点中的 2 个 + 2 个变形）。这是**加固建议，非验收失败**。

### (c) 活体只读核对 —— **未热加载，如实记 `restart-required`**

1. `cordis_inspect_query(platform=host, provider=Tool, method=listTools)`：
   运行中 host 的 `jev_decide.description` 以
   `Ask TypeSafe Jev, a System One decision model, for typed judgments about arbitrary state. Jev never writes prose: every question returns a typed answer plus a calibrated confidence, so use it for routing, classification, rubric scoring, and yes/no checks where the answer space is known in advance. ...`
   开头；含旧版专有子串 `use it for routing, classification` 与 `or the equivalent { type: "boolean", ... }`；
   新锚点 `When to use` / `Default: ask Jev ...` / `Exempt only when` / `Decision moments` / `Budget:` **全部为 false**。
2. 交叉核对：把当前 web host 自己的会话日志
   `~/.dsh/sessions/--home-dsh-temp-dsh-plugin-jev--/<最新会话>/session.v3.jsonl.zstd`
   （多帧 zstd，按 magic `28b52ffd` 逐帧解压）解出实际发出的 `request/header`：
   `jev_decide` 描述长度 **1185**，与新锚点全 false、旧标记全 true。
3. `git show HEAD:lib/index.js` 的旧代码描述长度也是 **1185**，且 `grep -c systemPrompt` = **0**
   （旧代码**根本没有** B 面注册）。而磁盘上的安装路径
   `~/.dsh/profiles/web/node_modules/dsh-plugin-jev` 是**指向本仓库的 symlink**，
   其 `lib/index.js` sha256 与仓库新代码一致。

→ 磁盘已是新代码，运行中的 web host 仍是旧代码：**A 面与 B 面在 127.0.0.1:3080 上均未生效，
记为 `restart-required`**（未重启 host；由用户决定何时重启）。

---

## 三、运行级证据（Lead 线索的独立复现）

方法（不碰 web profile、不装包、不起服务、不重启 host）：

```bash
mkdir -p /tmp/jev-e2e-verify && cd /tmp/jev-e2e-verify
dsh --profile headless --patch ~/temp/dsh-plugin-jev/dsh.patch.yml "Respond with exactly: OK"
# → EXIT=0，模型正常作答 OK；会话日志落在
#   ~/.dsh/sessions/--tmp-jev-e2e-verify--/session-a09b16d8-08ca-4c2b-bc41-817a4502aae0/session.v3.jsonl.zstd
```

`--patch` 的 `name: './lib/index.js'`（`dsh.patch.yml:24`）按 patch 所在目录解析 → 被测仓库本体。
会话日志解码：8 个 zstd 帧 → 23 条记录（**我自己的运行**，非 Lead 的 `/tmp/jev-e2e`）。

### 证据 A：工具描述进入真实请求的 tools 表 → **运行级已证**

- request 中 tools 共 25 个，`jev_decide` 在列；
- `description.length = 1441`（与代码级一致）；
- 6 个 schema(1) 锚点全 true；6 个 schema(2) 保留子串全 true；
- 旧代码标记 `use it for routing, classification` = **false**（证明加载的是新代码，不是旧缓存）。

### 证据 B：常驻 prompt section 进入真实 system 提示词 → **运行级已证**

- `system/message` 中出现 `## Jev decision policy`；含 `Exempt only when`、`Decision moments`、
  `In PTC mode call jev_decide from inside a run_code program`；
- 该段文本与仓库 `policySectionText()` 输出**逐字相同**（`sys.includes(sectionText) === true`，长度 837）；
- 该会话 system prompt 中 `## ` 级 section 只有这一个（headless 下无 mcp-resource-servers）；
- 这证明了单元测试证明不了的事：真实 Cordis 上下文里 `ctx.inject(["systemPrompt"], cb)` 会 fire，
  且 section 对该会话全局可见、`interpolate:false` 下正文原样出现。

> **注意**：以上运行级证据来自 **headless profile 的一次真实启动**，它是与 web host 隔离的另一进程。
> 它证明「代码在真实 host 语境下正确」，**不等于**「用户当前那个 web host 已生效」。
> 第四节那条 `restart-required` 不因本节而改变。

---

## 四、冒险/对抗性检查（SPEC 未覆盖但可能被破坏的路径）

| 路径 | 结论 | 证据 |
|---|---|---|
| `systemPrompt` 在 `apply()` 之后才出现 | **安全** | 独立测试：apply 时无服务 → tools=1、sections=0；之后挂上服务并触发 inject 回调 → sections=1、name 正确、order=3110。实现 `lib/index.js:633-635`。 |
| `getSectionOrder('MCP_SERVERS')` 抛错 | **安全** | `test/policy-section.mjs:240-256` PASS；我独立复现：不冒泡、tool 仍 1 个、order 回退 3110。实现 `lib/index.js:606-618`。 |
| `getSectionOrder` 不存在（非有限返回） | **安全（推理）** | 调用处抛出的 TypeError 被 `lib/index.js:614-616` 的 catch 吞掉 → 3110；`typeof base === 'number'` 分支另行兜底，只写诊断。 |
| section name 与既有 `mcp-resource-servers` 冲突 | **安全（按契约推理）** | 本插件用 `jev-decision-policy`（`lib/index.js:637`），与 `mcp-resource-servers` 不同名。`systemPrompt.section` 契约（活体 Service 查询）为「同一层内重名才 throw；scoped 覆盖 global」。**未做运行级共存验证**（headless 那次没有 mcp-resource-servers 段，web host 未热加载）。 |
| text 含 `{{ }}` 触发插值错误 | **安全** | section 文本经正则检查**无任何花括号**；且 `interpolate:false`。运行级也原样出现。 |
| 按状态注册/注销工具（目录抖动） | **不存在** | 全文件仅 `lib/index.js:661` 一处 `ctx.tools.register`，无 unregister/remove（grep 复核）；enabled 取值不影响 A 面注册次数。 |
| prompt provider 内做网络调用 | **不存在** | `policySectionText()`（`lib/index.js:525-532`）是纯字符串拼装；`fetch` 只出现在 `attemptRequest`（工具执行路径）。 |
| 取巧：section 正文另写一份、只保留锚点子串 | **未被测试识破** | 见第二节 (b) 的 M5。**这是覆盖缺口，归属 tests-author**（加固建议）。 |

---

## 五、未验证 / 无法验证 显式清单

1. **用户 web host 上 B 面是否注册**：无法在未重启前提下直接观测——`cordis_inspect_list` 暴露的
   Host provider 只有 Service/Event/Builtin/Tool，`systemPrompt` 的 Service 契约只有 `section()` 等
   注册方法，**没有列出已注册 section 的只读方法**。只能由「加载的是旧代码（旧代码 `grep systemPrompt`=0）」
   推断为未注册。故：**web host 上 B 面 = 未注册（推断）+ 需重启核验**。
2. **web host 上 A 面新描述**：同上，`Tool.listTools` 已证明是旧 1185 字符描述 → 未生效。
3. **B 面与既有 `mcp-resource-servers` 段在同一真实 host 中的共存**：headless e2e 的 system prompt
   里没有该段，web host 又未热加载 → 共存只为「按不同名 + 契约推理」，无运行级证据。
4. **真实 TypeSafe API 的响应形状/网络路径**：本次改动不涉及；smoke 用 mock 端点，未打真实 API。
5. **触发率是否真的提升**（SPEC open_question：对比 250 会话 18 次调用）：本轮明确不设阈值，未观测。
   本报告只证明「A/B 两个面在代码级与 headless 运行级存在且正确」。
6. **重启后 web host 是否必然加载新代码**：未做（不重启）。只能确认 HMR 未生效这一现状。

---

## 六、副作用与合规声明

- **未修改任何被验证的实现/测试/文档文件**：`lib/index.js`、`test/smoke.mjs`、`test/policy-section.mjs`、
  `README.md`、`dsh.patch.yml`、`package.json` 的 sha256 在验证前后不变（`lib/index.js` =
  `d3ca46c84179f27f70cc606d4a40ceffd0625a6e85a38f93ec1e29c2e55cd839`）。
- **未重启** `127.0.0.1:3080` 的 web host；**未改动**任何 profile 的 `cordis.patch.yml` / `package.json`
  （web 的这两个文件 sha256 前后一致）。
- 诚实披露：按 task-3 第 4 步执行 `dsh --profile web --dump-config` 时，dsh 按其既有行为**重写了
  machine-managed 根文件** `~/.dsh/profiles/web/cordis.yml`（内容 sha256 前后一致
  `c300dcf2…`，仅 mtime 变）；headless e2e 同样重写了 `~/.dsh/profiles/headless/cordis.yml`
  （内容仍是 canonical 空根 `[]`，与 web 版 sha256 相同）。二者均为 **byte-identical 重写**，
  与 `test/bundle-install.mjs` 已记录的现象一致，非本次改动引入的语义变化。
- 变异实验全部在 `/tmp/mutant`、`/tmp/m*.js` 的副本上进行；会话日志写入 `~/.dsh/sessions/`
  下 `--tmp-jev-e2e-verify--` 与 `--home-dsh-temp-dsh-plugin-jev--`（dsh 自身行为）。

## 七、最终判定

- **代码级已证**：AC1-AC11（smoke 76、policy-section 37、四套回归、dump-config 逐字同基线、
  零依赖、长度 1441/837、序位覆盖、三条失败路径、六条语法保留）。
- **运行级已证（仅 headless 隔离启动）**：A 面真实进入 request tools 表（1441 字符 + 四锚点）；
  B 面真实进入 system prompt（837 字符，逐字同 `policySectionText()`）。
- **运行级未生效（web host）**：A/B 均为旧代码 → **`restart-required`**，如实记录，不谎报通过。
- **唯一待改进项（非验收失败）**：测试未覆盖 SPEC context「A/B 同源」设计点，M5 型取巧可实现
  37+76 全绿；归属 **tests-author**，建议补 1 条 section 含完整政策块（defaultRule/budget）的断言。

---

# T8 增量复验（T9 / task-5）

- 验证者：verifier（独立复跑，不采信 tests-author 自证）
- 范围：**仅** T7 之后变化的部分——`test/policy-section.mjs` 新增 ACX2 块、`README.md:285` 计数；
  `lib/index.js` 据称未动。T7 章节对主产物的结论继续有效。
- 结论：**补洞有效且独立**——M5 型取巧在 T8 后被 3 条 ACX2 断言杀死，而 A 面 7 条结论仍全 PASS；
  不存在伪阳性/自证；ACX2 对空白与「A/B 同步改词」的合理重构不误报。**无失败项。**
  仅 2 条非阻塞观察（README 覆盖说明未同步、ACX2 对 description 块序敏感）。

## T8.1 `lib/index.js` 未改动 —— 通过

```
sha256sum lib/index.js
d3ca46c84179f27f70cc606d4a40ceffd0625a6e85a38f93ec1e29c2e55cd839  lib/index.js
```
与 T7 记录逐字一致 → A/B 实现本体未变，T7 的代码级与运行级结论无需重证。

## T8.2 M5 是否被独立杀死 —— 通过（关键实验）

**先证明「T8 前测试文件」可用且未混入其他改动**：把当前 `test/policy-section.mjs` 去掉
260-302 行的 ACX2 块后，sha256 = `b9ec3fb9…`，与 T7 时该文件的 sha256 **逐字相同**；
T7 我保存在 `/tmp/mutant/test/policy-section.mjs` 的副本也是同一 hash。→ 本增量只有 ACX2 一处。

**变异体 M5（A 面保持完好）**：仅把 `policySectionText()` 换成
`'## Jev decision policy'` + `'Exempt only when Decision moments jev_decide run_code'`，
`describeTool()` 与 `POLICY`/`policyBlock()` 全部不动（已用脚本核实 A 面仍调用 `policyBlock()`）。

| 变异体 | 测试版本 | EXIT | PASS | FAIL | 失败断言 |
|---|---|---|---|---|---|
| M0 原样 | T8 前 (`b9ec3fb9…`) | 0 | 37 | 0 | — |
| M0 原样 | T8 后 (`0c617f18…`) | 0 | 41 | 0 | — |
| **M5 取巧** | **T8 前** | **0** | **37** | **0** | —（T7 的缺口，复现一致） |
| **M5 取巧** | **T8 后** | **1** | **38** | **3** | 全部为 ACX2 |

M5 + T8 后的 3 条 FAIL（逐字）：

```
FAIL ACX2 every shared policy sentence of the description appears verbatim in the section (A/B single source)
     :: shared=5 missing=["When to use: call jev_decide whenever the answer is a judgme","Default: ask Jev before turning a judgment about meaning, in","Exempt only when the answer is fixed by an explicit instruct","Decision moments: two self-consistent options; meaning, inte","Budget: one call carries one state plus every question about"]
FAIL ACX2 the complete shared "Default:" sentence appears in the section, not just the anchor
     :: sentence="Default: ask Jev before turning a judgment about meaning, intent, relevance, fit, or risk into a conclusion."
FAIL ACX2 the complete shared "Budget:" sentence appears in the section, not just the anchor
     :: sentence="Budget: one call carries one state plus every question about it; keep criteria concrete."
```

**「独立、非 A 面顺带命中」的证据**：M5 下 A 面 7 条断言仍全部 `PASS`
（`AC1 description is registered…`、四条短锚点、两条 schema(1) 锚点——逐一 grep 复核）；
38 PASS = 原有 37 全过 + ACX2 第 1 条，3 FAIL 全部是 ACX2。
→ ACX2 是**唯一**杀死者，且它比较的是 B 面正文（section.text）与从 A 面反推的共享块，
不是靠 A 面回归。

## T8.3 五套测试复跑 —— 通过

| 命令 | EXIT | PASS | 关键输出 |
|---|---|---|---|
| `node test/smoke.mjs` | 0 | 76 | `SMOKE OK (21 mock requests)` |
| `node test/policy-section.mjs` | 0 | 41 | `POLICY OK` |
| `node test/loader-overlay.mjs` | 0 | 3 | `LOADER OK` |
| `node test/fixture-check.mjs` | 0 | 6 | `FIXTURE OK` |
| `node test/bundle-install.mjs` | 0 | 37 | `PASS=37 FAIL=0 SKIP=0` |

与 Lead 提供的终验对照一致（未照抄，独立复跑）。按 Lead 指示**本轮未跑 headless e2e**
（`lib/index.js` 未变，B 面运行级证据 T7 已独立取得）。

## T8.4 README 断言计数逐处核对 —— 通过

| README 行 | 声称 | 实际 | 结论 |
|---|---|---|---|
| `README.md:284` smoke | 76 项断言 | 76 | 一致 |
| `README.md:285` policy-section | **41** 项断言 | 41 | 一致（T8 已由 37 更新为 41） |
| `README.md:286` fixture-check | 6 项断言 | 6 | 一致 |
| `README.md:291` loader-overlay | 3 项断言 | 3 | 一致 |
| `README.md:292` bundle-install | 37 项断言 | 37 | 一致 |

`grep -nE '[0-9]+ *项断言' README.md` 只有这 5 处；无其他残留的「37」（bundle 的 37 是正确值）。
`README.md:44` 的「description 约 1.4k / section 约 0.8k」与实测 1441/837 一致。

**非阻塞观察（文档）**：`README.md:315-326` 的「policy-section.mjs 覆盖内容」只有 4 条
（A 面/B 面注册/序位/失败路径），**没有**提到新增的 ACX2「A/B 同源」检查。计数正确，
但覆盖说明与测试内容不同步。归属 README owner（T7 记 README 属 impl 写范围；本次计数改动由
tests-author 完成），非验收失败，建议一并补一句。

## T8.5 ACX2 是否对措辞/重构过度敏感 —— 判断：不过度敏感（1 处结构性耦合，见下）

对 T8 后测试逐个跑变异体（每个只改 `lib/index.js` 副本，仓库文件未动；测试文件为 T8 后版本）：

| 变异体 | 意图 | 结果 | 判定 |
|---|---|---|---|
| S2 仅把 section 的 `join('\n\n')` 改成 `join('\n')` | 纯换行/空白差异 | EXIT=0 / 41 PASS | **不误报**（ACX2 两侧都 `replace(/\s+/g,' ')` 折叠空白） |
| S3 改共享常量 `POLICY.defaultRule` 的一个词（A、B 同时变） | 合理的同源改词重构 | EXIT=0 / 41 PASS | **不误报**（期望句子从 A 反推，A 变则期望跟着变） |
| S1 在 section 里把 `policyBlock()` 拼两次 | 重复拼接 | EXIT=1 / 40 PASS / 1 FAIL，FAIL = `AC3 section text length <= 1200 :: length=1455` | 被**长度断言**（非 ACX2）拦下；ACX2 本身按 `includes` 判句，重复不违反“同源” |
| S4 只改 A 面政策句、B 面保持原文 | 真实漂移（反方向） | EXIT=1 / 39 PASS / 2 FAIL（均为 ACX2，指向缺 `Default:` 整句） | **真阳性**，能查出 A→B 漂移 |
| S5 把 grammar 挪到政策块之前 | 结构调整 | EXIT=1 / 37 PASS / 4 FAIL（`policyStart=201 policyEnd=90`，共享块为空） | **结构性敏感**：ACX2 依赖 `'When to use'` 在 `'Question grammar'` 之前；该顺序由 SPEC steps T2 明确规定，故属可接受，但须知这是耦合 |

关于 S1/S5 的解读：ACX2 的判据是「A 的政策区间的每一句都逐字出现在 B」，
所以它**只惩罚漂移、不惩罚冗余或顺序**；长度与顺序分别由 AC3 与 SPEC 的 T2 约束覆盖，
三条断言合力后没有可利用的缺口。换行、空白、同源改词都不误报，
说明它没有退化成「对实现措辞过度敏感」的脆弱断言（唯一耦合是 `'Question grammar'` 这个
被 SPEC outputs.schema(2) 固定保留的哨兵串）。

## T8.6 ACX2 是否自证或存在伪阳性 —— 无自证；有 1 条固有（非 ACX2 可解）残余

- **非自证**：ACX2 不 import 任何未导出的内部常量；它把期望值从**自己观察到的 A 面输出**
  （`policy-section.mjs:165` 的真实注册 description）反推，再要求 B 面正文逐句包含。
  即「两个可观测面互相印证」，不是「实现自己声明自己正确」。
- **非空洞（anti-vacuity）**：`policy-section.mjs:287-290` 强制反推出的共享块必须包含
  `When to use / Default: / Exempt only when / Decision moments / Budget:` 五个锚点，
  且句子数 > 0，否则第 2 条 ACX2 check 直接 FAIL —— 所以“空块”不能被当成通过。
- **固有残余（诚实披露）**：我构造 S6——**A、B 两侧同时**换成一份又短又空的
  “锚点齐全”政策块（含五个锚点 + schema(1) 的长 Default 前缀 + `jev_decide`）→
  T8 后测试 **41 PASS**。这说明 ACX2 保证的是 **A≡B（不漂移）**，不是**政策正文的丰富度**；
  丰富度的唯一下界仍是 AC1 固定的那几个逐字子串。
  这是任何「不读内部常量、只比两面文字」的黑盒断言的固有边界，不是 T8 的缺陷；
  若要更强，只能导出共享常量并断言 K 个来源都引用它（会破坏零导出/黑盒前提）。**不建议**为它追加断言。

## T8.7 合规与副作用

- 未修改 `lib/index.js`、`test/**`、`README.md`、`package.json`、`dsh.patch.yml`：仅**追写**
  本报告（唯一写范围）。变异体全部在 `/tmp/t9/**` 副本上，仓库文件 sha256 验证前后不变。
- **未重启** `127.0.0.1:3080`；**未跑** headless e2e（遵 Lead 指示）；未改任何 profile 文件。

## T8.8 T9 增量结论

- 12 条 acceptance_criteria 维持 **全部通过**；T7 唯一覆盖缺口**已闭合且经独立复验**。
- T8 后五套测试全绿（76/41/3/6/37），README 五处计数逐字一致。
- 非阻塞观察 2 条：① `README.md:315-326` 覆盖说明未提 ACX2（归属 README owner）；
  ② ACX2 依赖 `'When to use'` 先于 `'Question grammar'` 的块序（由 SPEC T2 规定，可接受）。
- 无失败项，无需返工。web host 仍为 `restart-required`（本节未重启、未复跑运行级）。
