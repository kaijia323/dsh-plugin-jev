# task-5 独立验证报告：dsh-plugin-jev 缺陷修复

- 验证者：verify-fix（独立验证者，非实现者）
- 被验证对象：`specs/bugfix-jev-plugin-defects.yaml`（13 条 acceptance_criteria）
- 代码/文档冻结点：`lib/index.js` 23:27、`test/smoke.mjs` 23:29、`test/fixture-check.mjs`+`test/loader-overlay.mjs` 23:30、`package.json` 23:27、`README.md` 23:30
- 仓库基线：git `a9f10d4`（全部修复均为未提交工作区改动）
- 写入范围：**仅本文件**。未修改 `lib/index.js`、`package.json`、`test/**`、`README.md`、`specs/**`、`~/.dsh/**`。探针脚本全部位于 `/tmp/jev-verify/`，验证结束后已清理。
- 结论摘要：**13 条 AC 全部通过**；同时发现 **2 项 SPEC 层面的不一致**（profile patch 未开启 `retries: 1`；运行中的 web profile 仍在提供修复前的旧工具契约），详见 §5。这两项不使任何一条 AC 判负，但也不应被掩盖。

---

## 1. 独立复跑：三个测试套件

均为我本人复跑，非引用队友报告。smoke 连续 3 次、fixture 连续 2 次以排除时序抖动。

| 套件 | 退出码 | PASS | FAIL | 备注 |
|---|---|---|---|---|
| `node test/smoke.mjs` ×3 | 0 / 0 / 0 | 67 / 67 / 67 | 0 / 0 / 0 | 每次 "SMOKE OK (21 mock requests)"，完全稳定 |
| `node test/fixture-check.mjs` ×2 | 0 / 0 | 9 / 9 | 0 / 0 | "FIXTURE OK"，子进程端口/日志清理正常 |
| `node test/loader-overlay.mjs` ×2 | 0 / 0 | 3 | 0 | "LOADER OK"，name 解析为 `file:///home/dsh/temp/dsh-plugin-jev/lib/index.js` |

---

## 2. 对抗性探针（修复前 vs 修复后）

我自写了与 `test/smoke.mjs` 无关的探针 `/tmp/jev-verify/probe.mjs`（77 条断言），并用 `git show HEAD:lib/index.js` 取出修复前实现，**同一探针跑两个版本**，以证明「修复前坏、修复后好」，排除断言空转。

| 版本 | PASS | FAIL | 退出码 |
|---|---|---|---|
| 修复后 `lib/index.js` | 77 | 0 | 0 |
| 修复前 `HEAD:lib/index.js` | 22 | **33** | 1（并在 `t.isConcurrencySafe is not a function` 处 TypeError 终止——本身就是 HEAD 缺 F8 声明的证据） |

修复前失败的 33 条覆盖：D2 全部文案断言、D4 全部形状断言与「拒绝时不发请求」、D6 预中止/中途取消语义、D7 全部信封断言、F6 重试次数与新 signal 断言、`toolTimeoutMs` 派生。

### 2.1 逐项对抗结论（任务点名的攻击面）

| 攻击点 | 我的独立构造 | 观察结果 |
|---|---|---|
| **D2** `$AI_GATEWAY_API_KEY` 恰好 1 次 | vercel 缺省 + 无任何密钥 env + `keyFile=/nonexistent/key` | 文案 `tool-jev: no API key. Set $AI_GATEWAY_API_KEY or $VERCEL_AI_GATEWAY_API_KEY, or write the key to /nonexistent/key.` 出现次数 **1**，且与 SPEC `examples` 逐字一致。额外攻击：自定义 `apiKeyEnv=PROBE_CUSTOM_KEY` 时列出 3 个变量且**无重复名** |
| **D4** criteria 形状 + 请求计数 | `choice:null`、`[]`、`'x'`、`{}`、`score:{}`、`score:null`、`score:'x'` 各一次 | 7 种**全部被拒**且错误含 `criteria`；`requestLog` 增量 **0**；`noul` 无 criteria 仍被接受**且确实发出 1 次请求**；合法 choice 对象 / score 数组均通过；线上抓包确认没有任何畸形 criteria 到达 wire |
| **D6** 取消 vs 超时 | 预中止 signal；真超时（timeoutMs=50）；**中途 abort**（HANG + 60ms 后 abort，retries=1） | 预中止 → `aborted by the caller`，不含 `timed out`，`name===AbortError`，**0 次请求**；真超时 → `timed out after 50 ms`，不含 `aborted by the caller`；中途取消 → 报 caller abort（非 timeout）且 **只发 1 次请求（未重试）**。三条文案两两可区分 |
| **D7** 响应信封 | `{}`、`[]`、`{answers:5}`、`{answers:{}}`、正常对象 | `{}`/`[]`/`{answers:5}` 全部报错且文案含 `answers` 或 `must be an object`；`{answers:{}}` 与正常对象成功；**网关路由同样被拒** |
| **F6** 重试语义 | 分别统计每个 state 的请求增量 | 500 → **2**、503 → **2**、429 → **1**、400 → **1**、`retries:0` + 500 → **1**；429 错误带 `free-tier quota` + `paid AI Gateway allowance` 提示；`toolTimeoutMs = timeoutMs*(retries+1)+5000`（1000/2 → 8000，缺省 → 65000） |
| **F6** 重试是否复用已 abort 的 signal | **关键构造**：`timeoutMs=100,retries=1`，mock 第 1 次请求延迟 400ms（必超时）、第 2 次立即返回 `ATTEMPT2` | **成功**，总请求 **2**，返回值来自 **第 2 次尝试**。若复用已超时的 signal，第 2 次会立刻 abort 而失败——已排除该缺陷 |
| **F8** 并发串扰 | 5 个不同 state 并发（服务端按 index 反序延迟，响应乱序返回）+ 反序再发 3 个 | 每个 execute 都拿到**自己 state 对应**的 sentinel；请求数恰为 5；反序映射亦正确；`isConcurrencySafe()` 返回 `true` |
| **D3**（SPEC symptom，非 13 AC 之一） | 两种传输的 description/parameters 文本 | vercel 文案读 `.probability` 且**不再**指示读 `.noul`、明确「no .noul/.boolean/confidence」；typesafe 文案读 `.noul` 且不提 `.probability`；vercel 传 `noul` 拼写在 wire 上被翻译为 `boolean` |

### 2.2 用「真·注册表校验器」复核 output.schema（超出 smoke 的证明力）

`test/smoke.mjs` 里的 `outputSchemaViolation()` 是**手写镜像**，不是真实注册表。我另外直接导入 DSH 自带的 `validateJsonSchemaValue` / `assertSupportedJsonSchema` / `assertObjectJsonSchema`，对插件真实注册的 schema 求值，并**分别用两套已安装副本**（含运行中 web 进程实际使用的那套 `499c6f07…`）复跑，均通过：

- `parameters` 与 `output.schema` 均被 `assertSupportedJsonSchema` + `assertObjectJsonSchema` 接受（属于 DSH 强制子集）；
- 缺 `state` / 缺 `questions` / 多传未知参数（`additionalProperties:false`）均产生真实 violation；
- `output.schema` 对 `{}`（报 `missing required "answers"`）、`[]`、`{answers:5}`、`undefined` 均拒绝；对 CANNED 与**真实网关 200 响应形状**均通过。

---

## 3. 13 条 AC 逐条结论

| # | AC（摘要） | 判定 | 我亲自观察到的证据 |
|---|---|---|---|
| 1 | smoke 退出码 0、FAIL 0、PASS ≥ 44 | **通过** | 3 次复跑均 exit=0、**PASS=67**、FAIL=0（≥44 有余量） |
| 2 | vercel 缺省无密钥文案 `$AI_GATEWAY_API_KEY` 恰 1 次且含 `$VERCEL_AI_GATEWAY_API_KEY` | **通过** | 见 §2.1 D2，计数 1，与 SPEC example 逐字一致 |
| 3 | `choice criteria=null` 与 `score criteria={}` 被拒、含 `criteria`、请求数不增 | **通过** | 见 §2.1 D4：7 种非法形状全拒，请求增量 **0** |
| 4 | 预中止含 `aborted by the caller` 不含 `timed out`；50ms 超时含 `timed out after 50 ms` | **通过** | 见 §2.1 D6，两条文案互斥且可区分 |
| 5 | `{}` / `[]` 报错且含 `answers` 或 `must be an object` | **通过** | §2.1 D7 + §2.2 真实注册表校验器 |
| 6 | `retries:1` 两次 500 → 总请求 2 且错误含 `HTTP 500`；429 → 总请求 1 | **通过** | §2.1 F6：500→2、429→1、400→1、503→2、retries:0→1 |
| 7 | 同实例并发 2 次不同 state 各取自己 sentinel，无串扰 | **通过** | §2.1 F8：5 并发 + 反序均一一对应 |
| 8 | `node test/fixture-check.mjs` exit 0；mock-typesafe 不再是死代码 | **通过** | exit=0/PASS=9；`test/fixture-check.mjs` 用 `spawn(process.execPath,[mockPath])` 真实拉起 |
| 9 | `dsh --profile web --patch ./dsh.patch.yml --dump-config` exit 0 且 name = `file:///…/lib/index.js` | **通过** | exit=0；`PASS tool-jev name resolves to file:///home/dsh/temp/dsh-plugin-jev/lib/index.js`（dsh 0.1.6-alpha.2） |
| 10 | README 验证节只对应真实测试；`grep -n headless` 仅在手动演练/loader 说明 | **通过** | README 引用的 12 个路径**全部存在**；`headless` 仅命中 190/193，均在 175 行起的「手动端到端演练」；README 声称「67 项断言」与实际 67 一致 |
| 11 | `npm pack --dry-run --json` 含 `dsh.vercel.patch.yml` 与 `lib/index.js` | **通过** | 产物 = LICENSE, README.md, dsh.patch.yml, **dsh.vercel.patch.yml**, **lib/index.js**, package.json |
| 12 | engines.node `>=20.3`；lib 不 import `@deepseek-ai`；package.json 无 dependencies | **通过** | `engines.node=">=20.3"`；`grep @deepseek-ai lib/index.js test/*.mjs` → NONE；`dependencies`/`devDependencies` 均 undefined |
| 13 | git diff 只涉及 README.md/package.json/lib/index.js/test/ 与 profile patch；required 仍 `['state','questions']` | **通过（附注）** | `git diff --name-only` = README.md, lib/index.js, package.json, test/smoke.mjs；新增未跟踪 `test/fixture-check.mjs`、`test/loader-overlay.mjs`；无越界改动。required 实测 `["state","questions"]`。**附注：SPEC 要求同步修改的 profile patch 并未修改，见 §5.1** |

**未能验证条目：无。** 13 条均有我本人跑出的证据，未使用任何队友报告内容作为替代。

---

## 4. 回归：原有 36 条用例是否被改弱

方法：`git show HEAD:test/smoke.mjs` 取出旧文件，与现文件做**断言体逐一比对**（解析括号配对提取 `check()/expectError()` 全文，而非只比标签）。

- 旧版 36 次断言调用 → 全部 36 条**在新套件中仍然存在并全部 PASS**，无删除、无改名。
- `comm` 比对：HEAD 的 36 个 PASS 标签与新运行的 36 个**逐一对应**，新增 31 条（67−36）。
- 15 条断言体文本有差异，**差异全部且仅仅是**把 `lastAuth`/`lastBody`/`lastGatewayHeaders` 三个全局变量替换为 `lastNative()/lastGateway()/lastGateway()` 访问器（读取同一请求日志的最后一条）。运算符与期望值**完全不变**，且在并发下比全局变量更安全。
- 无任何一条断言被放松（无 `includes` 替换 `===`、无期望值放宽、无 try/catch 吞错）。
- 额外独立验证：**修复前的 36 条旧用例直接跑在修复后的 `lib/index.js` 上，仍是 36 PASS / 0 FAIL**（`/tmp/jev-verify/orig-smoke.mjs`），说明修复未破坏既有行为。

---

## 5. 发现的矛盾 / 与 SPEC 不符 / 存疑项

我没有为了让报告好看而消灭这些。

### 5.1 【SPEC 未落实】profile patch 未开启 `retries: 1`

- SPEC `scope.in_scope` 与 `fix.approach` F6 明确要求：「`~/.dsh/profiles/web/cordis.patch.yml`：为该挂载开启 `retries: 1`」。
- 实际读取 `~/.dsh/profiles/web/cordis.patch.yml`：`tool-jev` insert 行的 config 只有 `transport / gatewayBaseURL / model / keyFile / apiKeyEnv / timeoutMs: 60000`，**没有 `retries` 键**，因此部署侧仍是库默认 `retries: 0`。
- 影响：SPEC 用来处置「观测到 1/5 瞬时超时」的**操作性缓解并未生效**（代码能力已具备，只是没打开）。AC6 只要求 `retries:1` 下的行为，该 AC 由测试以显式配置覆盖，故 **AC6/AC13 仍判通过**；但这是 SPEC 修复计划的一半未交付，建议 Lead 在最终答复中明确，或补一行 `retries: 1`。
- 佐证 README 未虚假声称：README 只把 `retries` 描述为默认 0 的配置项，**未**声称已在 profile 中开启——文档侧是诚实的。

### 5.2 【修复未在运行中的会话生效】live 注册表仍是修复前的旧契约

- `cordis_inspect_query(host/Tool.listTools)` 返回的 `jev_decide` 描述与参数说明，**逐字等于修复前 `HEAD:lib/index.js`**：写的是 “noul needs … returns answers[key].noul” 与 “criteria is required for choice and score”，即 D3 修复前的旧文案；新版传输感知文案（`.probability` / 禁止读 `.noul` / criteria 形状说明）**没有出现**。
- 根因（已定位）：`include:tool-jev`（`file:///home/dsh/temp/dsh-plugin-jev/lib/index.js`）`enabled=true, fiberPhase="active"`，但承载它的 `dsh … web` 进程 **启动于 22:53:47**，而 `lib/index.js` 的 mtime 是 **23:27:59**（晚 34 分钟）。进程加载的是修改前的模块；patchReload 只对 patch 变更生效，**不会**因文件内容变化重新 import。
- 影响：D3（工具描述与真实网关响应一致）与 D6/D7/F6/F8 的新行为在**源码层**已被我验证正确，但在**当前运行中的 web 会话里尚未生效**。真正让会话使用者受益需要重启 `dsh web`（或触发一次该 entry 的重新挂载）。
- SPEC `failure_handling` 已预设此场景并要求「如实报告『需重启 dsh web 才生效』，不得声称已生效」——本报告即按此执行。**AC 列表本身不包含「live 生效」要求**，故不改变 §3 的判定。

### 5.3 【存疑但非缺陷】真实网关本次未限流，与任务预期不同

- 任务预告「预期 429」。我按约束只发起 **1 次**真实外部调用（通过修复后的插件代码、vercel 传输、真实 keyFile），结果 **HTTP 200**，elapsed 1194ms——免费额度窗口已恢复。
- 真实响应体：`{"answers":{"urgent":{"type":"boolean","probability":0.67}},"rounding":{…},"usage":{…},"warnings":[],"providerMetadata":{…}}`。这**独立证实了 D3 的前提**：网关 yes/no 确实返回 `{type:"boolean",probability}`、**没有** `.noul`，旧描述会诱导模型读 undefined；新描述正确。该响应体也通过收紧后的 `output.schema`（真实校验器）。
- 顺带观察（不影响任何 AC）：本次 `providerMetadata.typesafe.confidence` 是**空对象 `{}`**，而 README/examples 称 confidence 位于 `providerMetadata.typesafe.confidence`。字段存在但为空，README 的措辞尚不算错，建议后续轮次留意。
- 因只允许 1 次调用，**429 的真实文案未在真实网关上复现**；429 提示路径由 mock 全覆盖（§2.1 F6）。

### 5.4 【已核对无误】reports/ 与 specs/ 未被本轮误改

- `reports/final-verification.md`(23:01)、`reports/live-provider.md`(22:59)、`reports/static-contract.md`(23:00) 的 mtime **早于**本轮修复（23:25–23:30）。
- `specs/research-jev-plugin-verification.yaml`(23:01)、`specs/specs.html`(22:57) 同样早于本轮；`specs/bugfix-jev-plugin-defects.yaml`(23:25) 是本轮 SPEC 本身，属预期新增。
- `git status --short` 中 `reports/`、`specs/` 为未跟踪目录（非 tracked 文件被改动），`test/fixture-check.mjs`、`test/loader-overlay.mjs` 为 SPEC 要求的新增文件。无越界改动。

---

## 6. 证据与产物

- 探针脚本（验证结束前位于 `/tmp/jev-verify/`，随后清理）：`probe.mjs`（77 条对抗断言）、`real-registry.mjs` / `real-registry-running.mjs`（真实 DSH 校验器）、`live-once.mjs`（唯一 1 次真实调用）、`extract.mjs`（断言体差异比对）、`orig-smoke.mjs`（HEAD 版 36 条）。
- 关键原始输出已摘录于本报告；所有断言均可由 `node test/smoke.mjs`、`node test/fixture-check.mjs`、`node test/loader-overlay.mjs` 与上述探针复现。
- 本报告是本次验证唯一写入仓库的文件。
