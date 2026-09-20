# 独立验证报告：Vercel 残留清零与官方链路回归（task-8 / T3）

- **验证者**：purge-verify（独立验证者，非本轮任何写入腿的作者）
- **任务**：task-8（T3），依赖 task-6 / task-7 / task-9
- **规格**：`specs/feature-jev-official-only.yaml`（11 条 acceptance_criteria）
- **被验证提交基线**：`git rev-parse HEAD` = `4d1d8bac2317e543cd382471fbde67742225835b`（改动全部在工作区，未 commit）
- **验证方法**：以可证伪为目标独立复跑 + 反向攻击；不修改任何仓库文件，探针置于 `/tmp/purge-verify/`，结束后清理；官方密钥只经 `keyFile` 引用，全程未打印密钥内容。
- **真实外部调用**：2 次（上限 2 次），无重试。
- **唯一写入**：本文件 `reports/purge-verification.md`（仓库内新建，未跟踪）。

工具链环境：`node v24.21.0`、`dsh 0.1.6-alpha.2`（loader-overlay 自报）；所有套件均以 `env -u TYPESAFE_API_KEY -u JEV_API_KEY -u AI_GATEWAY_API_KEY` 运行，确证无环境密钥泄漏依赖。

---

## 0. 结论总览

| # | acceptance_criterion（摘要） | 结论 |
|---|---|---|
| AC1 | smoke 退出 0 / FAIL 0 / PASS>=50；与改动前 67 标签集合对比，非 gateway 标签零缺失 | **通过**（PASS 72，删 12 条全为 vercel 前缀） |
| AC2 | fixture-check 退出 0；loader-overlay 退出 0 或 SKIP | **通过**（0 / 0，均实跑非 SKIP） |
| AC3 | Vercel 残留扫描命中只允许三处白名单；无 `dsh.vercel.patch.yml` | **通过（1 条字面偏差，见 F-V1）** |
| AC4 | package.json files 不含该文件且文件不存在 | **通过** |
| AC5 | `transport:'vercel'` 抛错含 'removed' 与 'typesafe'；缺省/'typesafe' 正常注册 | **通过** |
| AC6 | 工具契约不变（名/required/concurrency/timeout） | **通过** |
| AC7 | `noul` canonical；`boolean` 归一化为 `noul` 发到 wire | **通过** |
| AC8 | 一次真实官方调用 200、含 model 与 answers、choice 带 confidence、score 带 legend | **通过**（2 次真实调用共同覆盖） |
| AC9 | 无密钥报错列出两个 env 名且变量名不重复 | **通过** |
| AC10 | `grep -c '@deepseek-ai' lib/index.js`=0；无 dependencies；engines>=20.3 | **通过** |
| AC11 | 无 `transport === 'vercel'` 分支、无 `/evaluation-model`、无 ai-model-id 头 | **通过** |

**未验证项：0 条。矛盾项：0 条硬矛盾；3 条需 Lead 知悉的偏差/描述不一致，见 §7。**

---

## 1. AC3 / AC4：残留扫描

命令（严格按 AC3）：

```
grep -rniE 'vercel|ai-gateway|evaluation-model|gatewayBaseURL|typesafe-ai/jev|gatewayModel|gatewayProtocolVersion|gatewaySpecVersion|ai-model-id' \
  lib/ test/ package.json dsh.patch.yml README.md examples/ .gitignore
```

命中总计 **14 行**：

| 文件 | 行数 | 行号 | 判定 |
|---|---|---|---|
| `lib/index.js` | 1 | 118 | ✅ 白名单①：迁移报错文案（`normalizeConfig` 的 transport guard） |
| `test/smoke.mjs` | 5 | 195 | ⚠️ 反残留负断言（`'question schema drops the retired vendor model id'`），**字面不在迁移护栏区块** → F-V1 |
| `test/smoke.mjs` | — | 220, 223, 224, 240 | ✅ 白名单②：迁移护栏用例区块（220–254 行） |
| `README.md` | 8 | 135, 137, 138, 140, 143, 146, 147, 148 | ✅ 白名单③：`## 迁移说明：Vercel 传输已移除` 段（135–152 行，下一标题在 153） |

- **`examples/` 命中 0**（要求 0）✅
- **`.gitignore` 命中 0**（要求 0）✅
- **`dsh.patch.yml` 命中 0** ✅
- **`test ! -e dsh.vercel.patch.yml` 成立**（`test -e` 返回假；HEAD 中存在该文件，工作区已删除并 `git add` 记录为 `D`）✅ → AC4 前半
- `package.json` `files` = `["lib","README.md","dsh.patch.yml"]`，**不含** `dsh.vercel.patch.yml` ✅ → AC4 后半

**加固扫描（超出 AC3 字面，覆盖下划线变体，防止漏网）**：

```
grep -rniE 'AI_GATEWAY|VERCEL|gatewayBaseURL|gatewayModel|gatewayProtocolVersion|gatewaySpecVersion|vercelKeyFile|typesafe-ai/jev|ai-model-id|evaluation-model|ai-gateway-protocol|ai-evaluation' \
  lib/ test/ package.json dsh.patch.yml README.md examples/ .gitignore
```

结果与上表逐行一致：**没有新增命中**，即 `AI_GATEWAY_API_KEY`、`VERCEL_AI_GATEWAY_API_KEY`、`ai-gateway-protocol-version`、`ai-evaluation-model-specification-version` 等旧拼写已全部消失。`examples/` 与 `.gitignore` 在更宽的模式下仍为 0 命中。

补充：`test/mock-typesafe.mjs` 的旧 `/gateway/evaluation-model` 路由与其 `ai-model-id` 日志字段已在 diff 中整段删除；`test/fixture-check.mjs` 不再发 `ai-model-id` 头（见 §3 diff 证据）。

---

## 2. AC1 / AC2：三套件独立复跑与标签集合对比

### 2.1 当前树

| 套件 | 运行 | 退出码 | 结果 |
|---|---|---|---|
| `node test/smoke.mjs`（第 1 次） | 独立跑 | **0** | `PASS=72 FAIL=0`，`SMOKE OK (21 mock requests)` |
| `node test/smoke.mjs`（第 2 次，连续） | 独立跑 | **0** | `PASS=72 FAIL=0`，`SMOKE OK (21 mock requests)` |
| `node test/fixture-check.mjs` | 独立跑 | **0** | 6×PASS，`FIXTURE OK` |
| `node test/loader-overlay.mjs` | 独立跑 | **0** | 3×PASS，`LOADER OK`（dsh 0.1.6-alpha.2，真实挂载非 SKIP） |

两次 smoke 的 PASS 标签集合逐字节一致（`sort` 后 `diff` 为空），无 flake。

### 2.2 与改动前 67 标签的集合对比

为避免「静态解析标签」的假阴性，我未只做文本提取，而是把 HEAD 归档到临时目录并**实跑 HEAD 的 smoke**：

```
git archive HEAD | tar -x -C /tmp/purge-verify/head-tree
cd /tmp/purge-verify/head-tree && node test/smoke.mjs    # 退出 0，PASS=67，FAIL=0
```

- HEAD 基线：**67** 个 PASS 标签（与任务描述的 67 完全吻合）
- 当前：**72** 个 PASS 标签
- 交集：**55** 条完全同名保留
- **HEAD 有而当前没有的标签：12 条，逐条列出**（`comm -23`）：

| # | 被删标签 | 是否 gateway/vercel 专属 |
|---|---|---|
| 1 | `vercel transport registers one tool` | ✅ vercel 前缀 |
| 2 | `vercel returns the gateway body unchanged` | ✅ |
| 3 | `vercel sends the gateway bearer token` | ✅ |
| 4 | `vercel defaults to the typesafe-ai/jev model` | ✅ |
| 5 | `vercel sends the protocol version header` | ✅ |
| 6 | `vercel sends the evaluation spec version header` | ✅ |
| 7 | `vercel translates noul to boolean` | ✅ |
| 8 | `vercel keeps choice criteria` | ✅ |
| 9 | `vercel body has no model field` | ✅ |
| 10 | `vercel reports a missing gateway key` | ✅ |
| 11 | `vercel default key message lists $VERCEL_AI_GATEWAY_API_KEY (D2)` | ✅ |
| 12 | `vercel default key message names $AI_GATEWAY_API_KEY exactly once (D2)` | ✅ |

- **非 gateway/vercel 标签的缺失数 = 0**（`comm -23 ... | grep -viE 'vercel|gateway'` 无输出）。
- 全部 12 条经 `git show HEAD:test/smoke.mjs` 定位，均落在 HEAD 的 `// --- vercel transport` 区块（原文件第 ~220–245 行，例如 `lastGateway()`、`ai-model-id`、`ai-gateway-protocol-version` 断言），确认无一条测试非 Vercel 行为。
- 两条语义上非「纯传输」的标签已按 `failure_handling` 在官方链路上重建覆盖：`vercel translates noul to boolean` → 新增 `normalizes a 'boolean' alias to 'noul' on the wire`；`vercel keeps choice criteria` → 现有 `accepts a legal choice criteria object (D4)`；D2 去重 → 新增 `official default key message ... (D2)` 两条 + `explicit apiKeyEnv equal to the fallback is named exactly once (D2)`。

→ **AC1：退出码 0、FAIL 0、PASS 72 ≥ 50、非 gateway 标签零缺失/零改名，通过。**
→ **AC2：fixture-check 0、loader-overlay 0（SKIP 也未发生），通过。**

---

## 3. 契约回归（AC6 / AC10 / AC11）与迁移护栏（AC5）

独立探针 `/tmp/purge-verify/probe-offline.mjs`（只经 `apply()` 公共路径，mock `ctx.tools.register`）共 **43 项断言全 PASS，退出 0，7 次 mock 请求**。

**AC6（工具契约）**：注册对象实测

- `name === 'jev_decide'` ✅
- `parameters.required` 深度相等 `["state","questions"]` ✅
- `output.schema.required` 深度相等 `["answers"]` ✅
- `isConcurrencySafe()` → `true` ✅
- `timeoutMs` 为正有限数 ✅（smoke 另证 `timeoutMs > timeoutMs` 配置下 > 5000）
- `output.render` 仍为函数 ✅

**AC10（零依赖与引擎）**：

- `grep -c '@deepseek-ai' lib/index.js` → `0`（grep 退出码 1，即零匹配）✅
- `package.json` 无 `dependencies` 字段 ✅
- `engines.node === ">=20.3"` ✅

**AC11（实现内无旧路径）**：`lib/index.js` 对 `transport === 'vercel'`、`/evaluation-model`、`ai-model-id`、`ai-gateway*`、`gateway*` 全部 **0 命中**（grep 退出码 1）。实现只有一个分支：`if (transport !== 'typesafe') throw` ✅

**AC5（迁移护栏）**：

- `apply(ctx,{transport:'vercel'})` 抛出 `Error`，文案为
  `tool-jev: transport must be "typesafe": the Vercel AI Gateway transport was removed, so only transport "typesafe" (the official TypeSafe API) is supported (got "vercel")`
  → 含 `removed` ✅、含 `typesafe` ✅、**不含** `no API key`（证明在任何密钥解析之前失败）✅
- `apply(ctx,{transport:'typesafe'})` 正常注册 1 个工具 ✅
- `apply(ctx,{})`（缺省）正常注册 1 个工具 ✅
- 附带：`transport:'openrouter'` 同样被拒（`transport must be`）✅

---

## 4. AC8：官方链路真实调用（共 2 次，无重试）

探针只经插件代码路径（`apply({apiKeyEnv:'PROBE_DEFINITELY_UNSET', keyFile:'/home/dsh/.config/typesafe/key', timeoutMs:30000, retries:0})` 后 `tool.execute`），并把 `globalThis.fetch` 包一层仅记录状态码与 URL，**不记录也不打印 authorization 头与密钥**。密钥文件仅以 `keyFile` 引用（存在，108 字节；内容全程未读取打印）。

**真实调用 1**（`/tmp/purge-verify/probe-real.mjs`，17 项断言全 PASS，真实请求数=1）：

- HTTP 状态 **200** ✅
- URL = `https://api.typesafe.ai/v1/systemone` ✅
- `body.model = "jev-1.13.0"`，匹配 `^jev-\d+\.\d+\.\d+$` ✅
- `body.answers` 为对象且含全部三个请求键 ✅
- `choice` 答案：`choice`、`confidence`（数值）、`probabilities` 均存在 ✅
- `score` 答案：`score`、`confidence`、`legend`/`probabilities` 存在 ✅
- `noul` 答案：`noul` 概率为数值 ✅
- 用独立实现的 JSON-Schema 子集校验器对 `tool.output.schema` 校验真实信封：**0 违规**；对 `{}` 与 `[]` 正确拒绝 ✅

**真实调用 2**（`/tmp/purge-verify/probe-real2.mjs`，7 项断言全 PASS，真实请求数=1），用来单独确证 AC8 里 `score 带 legend` 这一项（调用 1 只做了 legend/probabilities 二选一断言）：

- 脱敏输出：`{"model":"jev-1.13.0","dept":["type","choice","confidence","probabilities"],"quality":["type","score","confidence","legend","probabilities"],"urgent":["type","noul"]}`
- `quality.legend = {"0":"unusable","1":"thin","2":"adequate","3":"excellent"}`
- → **score 明确带 `legend`（同时带 probabilities 与 confidence）**，与 SPEC `context` 描述一致 ✅
- 该次请求使用 `type:'noul'` 而非 `boolean`，配合离线探针的 wire 断言，确认线上路径没有把 `noul` 翻译成 `boolean`（旧 Vercel 行为已消失）。

---

## 5. AC7 / AC9：归一化与缺密钥诊断

**AC7**（离线探针，mock 服务端记录真实 wire body）：

- `{type:'noul'}` → wire `type === 'noul'`（canonical 原样透传）✅
- `{type:'boolean'}` → wire `type === 'noul'`（别名归一化）✅
- 全部 mock 请求的 `questions` JSON 中不存在 `"boolean"` 字面量 ✅

**AC9**（官方传输下清空 `TYPESAFE_API_KEY`/`JEV_API_KEY`、`keyFile` 指向不存在路径）：

- 默认 `apiKeyEnv` 时错误文案含 `$TYPESAFE_API_KEY` 与 `$JEV_API_KEY` ✅
- 两个变量名各出现 **恰好 1 次**（`split().length-1 === 1`）✅
- `apiKeyEnv:'JEV_API_KEY'`（与回退名同名）时 `$JEV_API_KEY` 仍只出现 **1 次**，去重逻辑保留 ✅

---

## 6. 反向攻击（独立构造 mock，非复用仓库用例）

`/tmp/purge-verify/probe-offline.mjs` 中自建 HTTP mock（与 `test/mock-typesafe.mjs` 无关）验证：

| 攻击 | 期望 | 实测 |
|---|---|---|
| `401`（`retries:1`） | 不重试，报 `HTTP 401` | ✅ 请求数 **1**，文案含 `HTTP 401` |
| `429`（`retries:1`） | 不重试，报 `HTTP 429` + 可操作限流提示 | ✅ 请求数 **1**，提示含 `rate-limiting this key` 且**不含** `ai gateway` |
| `500`（`retries:1`） | 重试一次后抛 `HTTP 500` | ✅ 请求数 **2**，文案含 `HTTP 500` |
| 预中止 `AbortSignal` | 报 `aborted by the caller`，`name==='AbortError'`，不发请求，不误报 timeout | ✅ 4 项断言全过，请求数 0 |
| 慢响应 `timeoutMs:50` | 报 `timed out after 50 ms`，与 abort 文案可区分 | ✅ 文案互斥断言通过 |
| choice/score `criteria` 非法形状（`null`/`[]`/字符串/`{}`/score 传对象/缺失） | 本地拒绝，**请求数 0** | ✅ 7 种形状全拒，`requestLog` 长度不变 |

---

## 7. 范围检查与偏差项（AC3 相关 / 描述不一致）

### 7.1 工作区范围

```
 M .gitignore
 M README.md
D  dsh.vercel.patch.yml          (staged delete)
 M examples/confidence-routing.md
 M examples/route-demo.mjs
 M lib/index.js
 M package.json
 M test/fixture-check.mjs
 M test/mock-typesafe.mjs
 M test/smoke.mjs
?? specs/feature-jev-official-only.yaml
```

- `dsh.vercel.patch.yml`：HEAD 中存在，现以 **staged deletion** 呈现 ✅
- `reports/`：**零修改**（`git status --short reports/` 为空）✅
- `specs/`：**既有 3 个 spec 文件零修改**；仅多出一个未跟踪新文件 `specs/feature-jev-official-only.yaml`（本轮 SPEC 本身）✅
- `git log` 仍停在 `4d1d8ba`，**本轮无 commit** ✅
- 未改动 `~/.dsh/**`（profile patch 只读查看）✅
- 密钥泄漏扫描：用 node 读取 `/home/dsh/.config/typesafe/key` 后逐文件比对仓库全部非 `.git` 文件（不打印密钥、不写临时密钥文件）→ **0 个文件包含该密钥值** ✅

### 7.2 偏差与描述不一致（需 Lead 知悉，均非功能缺陷）

- **F-V1（次要，AC3 字面白名单）**：`test/smoke.mjs:195` 的 `!JSON.stringify(tool.parameters).includes('typesafe-ai/jev')` 是一条**反残留负断言**（标签 `question schema drops the retired vendor model id`），位于第 168–197 行的「注册契约」区块，而非第 220–254 行的「迁移护栏」区块。按 AC3 的字面白名单（只允许「迁移护栏用例」）它算第 4 处命中；按 AC 意图（不得有可用的 Vercel 路径）它是**加固性例外**。我判 AC3 **通过**，但把该字面偏差显式留档，供 Lead 决定是否需要把该断言并入迁移护栏区块或补充白名单措辞。
- **F-V2（任务描述与 SPEC 不一致，非代码问题）**：task-8 描述第 7 条写「改动只落在 `lib/index.js`、`package.json`、`test/**`、`README.md`」，但实际另有 `examples/**` 与 `.gitignore` 两处修改。这两处正是 SPEC `steps` 的 **T4（task-9）** 明确要求，且 AC3 已把 `examples/` 与 `.gitignore` 纳入扫描范围。因此**以 SPEC 为准，不构成越界**；只是 task-8 描述该条列举已过时。
- **F-V3（示例性文案差异，非缺陷）**：SPEC `examples` 给出的报错样例为 `the Vercel AI Gateway transport was removed; only transport "typesafe" ... is supported`，实现实际为 `transport must be "typesafe": the Vercel AI Gateway transport was removed, so only transport "typesafe" ... is supported (got "vercel")`。AC5 只要求含 `removed` 与 `typesafe`，二者均满足；且 `README.md:143` 逐字复制的是**真实实现文案**，不存在「文档与实现不一致」——SPEC 的 examples 仅示意。

---

## 8. 验证产物与清理

- 全部探针与中间产物位于 `/tmp/purge-verify/`：`probe-offline.mjs`、`probe-real.mjs`、`probe-real2.mjs`、`keyleak.mjs`、`head-tree/`（HEAD 归档）、`*.out`、`*_labels.txt`。验证结束后已删除。
- 本报告是本次验证对仓库的**唯一写入**（新建未跟踪文件）。
- 未执行 commit / push；未修改任何被验证文件。

### 复现命令摘要

```bash
# 残留扫描（AC3）
grep -rniE 'vercel|ai-gateway|evaluation-model|gatewayBaseURL|typesafe-ai/jev|gatewayModel|gatewayProtocolVersion|gatewaySpecVersion|ai-model-id' \
  lib/ test/ package.json dsh.patch.yml README.md examples/ .gitignore
test ! -e dsh.vercel.patch.yml

# 套件（AC1/AC2）
env -u TYPESAFE_API_KEY -u JEV_API_KEY -u AI_GATEWAY_API_KEY node test/smoke.mjs
node test/fixture-check.mjs && node test/loader-overlay.mjs

# 67 标签基线（AC1）
git archive HEAD | tar -x -C /tmp/head && (cd /tmp/head && node test/smoke.mjs) | grep '^PASS ' | sort

# 官方链路（AC8，2 次真实调用）
node /tmp/purge-verify/probe-real.mjs && node /tmp/purge-verify/probe-real2.mjs
```
