# dsh-plugin-jev：静态契约审计 + 自带冒烟测试报告

- 审计对象：`/home/dsh/temp/dsh-plugin-jev`（git `a9f10d493f4ff3f0e03ee88c9f86aede0c743220`，工作树除 `?? specs/` 外干净）
- 审计范围（本腿）：`lib/index.js` 注册契约、配置解析、校验路径、两种传输的请求组装；`test/smoke.mjs` 实跑结果；README 与实现的一致性。
- 明确不在本腿：真实端点调用（live 腿）、web profile 挂载态（`plugin_manager list_plugins`）、PTC/SDK 生成路径。
- 运行环境：`node v24.21.0`；DSH 契约取自 `@deepseek-ai/dsh-tools@0.1.6-alpha.2`、`@deepseek-ai/dsh-llm@0.1.6-alpha.2`（本地 checkout）。
- 输入校验和（未修改）：
  - `lib/index.js` `6c76597a7c929d61b3ad57be3ef4071cf9839ecc81aa995e073da38c2335ace7`
  - `test/smoke.mjs` `7428fe641d9d74059a326bd7bb619e6957eae5a5cccd33977205ab672cdbc2c1`
  - `README.md` `3367bb28c7031d9bd168df9e06141c4aaf4d1fc35249eada8edf16543c1cf72c`

---

## 一、结论

**静态契约层：有效（通过）。** 依据三点，均有证据（见第二节）：

1. `lib/index.js:354-367` 的 `ctx.tools.register` 形参逐字段满足 DSH 的 `ToolDefinition` / `ToolSchema` / `ToolOutputDefinition` 契约。
2. `parameters`（`lib/index.js:326-345`）与 `output.schema`（`lib/index.js:360-363`）**通过了 DSH 自身的强制子集断言** `assertSupportedJsonSchema`。该断言对白名单外关键字是「拒绝」而非「忽略」，因此这是子集合规的强证据，不是目测结论。
3. 自带冒烟测试 `node test/smoke.mjs` 退出码 `0`，**36 PASS / 0 FAIL**，两次运行结果一致，输出 `SMOKE OK (7 mock requests)`。

**本腿不给出 H1/H2/H3 的最终判定**：H1/H2 的分界取决于真实端点能否返回类型化答案（live 腿），且挂载态与真实调用是 SPEC 的 AC2/AC4，属 lead 与 live 腿。

发现 **8 项文档-实现偏差**（1 项重要、1 项行为缺陷、6 项轻微），以及 **14 项本测试套件未覆盖的风险**。

---

## 二、证据

### 2.1 冒烟测试实跑

命令与输出（原样）：

```
$ cd /home/dsh/temp/dsh-plugin-jev && node test/smoke.mjs
PASS registers exactly one tool
PASS tool name is jev_decide
PASS declares output.render
PASS declares output.schema object root
PASS declares a positive timeoutMs
PASS parameters require state and questions
PASS render emits one text block
PASS render text carries the answers
PASS returns the API body unchanged
PASS sends the configured bearer token
PASS uses the configured default model
PASS forwards state verbatim
PASS forwards the question map verbatim
PASS honors a per-call model override
PASS unconfigured model defaults to jev-latest
PASS vercel transport registers one tool
PASS vercel returns the gateway body unchanged
PASS vercel sends the gateway bearer token
PASS vercel defaults to the typesafe-ai/jev model
PASS vercel sends the protocol version header
PASS vercel sends the evaluation spec version header
PASS vercel translates noul to boolean
PASS vercel keeps choice criteria
PASS vercel body has no model field
PASS falls back to the key file
PASS falls back to JEV_API_KEY
PASS reports a missing key with all sources
PASS vercel reports a missing gateway key
PASS rejects an empty state
PASS rejects an unknown question type
PASS rejects a choice without criteria
PASS rejects an empty question map
PASS surfaces an HTTP error with its status
PASS surfaces a 404 from a wrong endpoint
PASS rejects a malformed baseURL
PASS rejects an unknown transport

SMOKE OK (7 mock requests)
EXIT_CODE=0
```

复核计数（第二次运行）：

```
$ node test/smoke.mjs > /tmp/jev-smoke-rerun.txt 2>&1; echo "exit=$?"; grep -c '^PASS' /tmp/jev-smoke-rerun.txt; grep -c '^FAIL' /tmp/jev-smoke-rerun.txt
exit=0
36
0
```

结论：退出码 0、FAIL 计数 0、无 FAIL 原文可列。对应 SPEC AC1 通过。

### 2.2 注册契约对照 DSH

插件侧（`lib/index.js:354-367`）：`name` / `description` / `parameters` / `timeoutMs` / `output.{schema,render}` / `execute`。

DSH 侧契约：

- `ToolSchema`（`@deepseek-ai/dsh-llm/lib/types/types.d.ts:432-437`）：`name: string; description: string; parameters: Record<string, unknown>` — 插件三项齐备。
- `ToolDefinition`（`@deepseek-ai/dsh-tools/lib/types/index.d.ts:107-173`）：`output`（必需）+ `execute(args, exec)`；`timeoutMs?` 为「可选的正的协作式超时预算」。
- `ToolOutputDefinition`（同上 `index.d.ts:98-105`）：`schema: JsonSchemaNode` + `render(args, value): ContentBlock[]`。
- 注册实现（`@deepseek-ai/dsh-tools/lib/index.js:2876-2885`）实际校验：`output` 形状与 `render` 为函数；`assertSupportedJsonSchema(output.schema)`；`timeoutMs` 若存在必须正且有限；`name !== "run_code"`。

对照结果：

| 契约点 | 插件实现 | 判定 |
| --- | --- | --- |
| `name` 非保留名 | `'jev_decide'`（`lib/index.js:355`） | 通过（非 `run_code`） |
| `description: string` | `DESCRIPTION` 8 句拼接（`lib/index.js:314-323`） | 通过 |
| `parameters` 存在且为对象 | `PARAMETERS`（`lib/index.js:326-345`） | 通过 |
| `output.schema` | `{ type: 'object', description: ... }`（`lib/index.js:360-363`） | 通过 `assertSupportedJsonSchema` |
| `output.render` 返回 `ContentBlock[]` | `[{ type: 'text', text: JSON.stringify(value, null, 2) }]`（`lib/index.js:364`） | 通过（`TextBlock` = `{ type:'text'; text:string }`，`dsh-llm/lib/types/types.d.ts:46-49`） |
| `execute(args, exec)` | `(args, exec) => requestSystemOne(args, exec, resolved)`（`lib/index.js:366`） | 通过 |
| `timeoutMs` 正有限 | `resolved.toolTimeoutMs`，默认 `timeoutMs + 5000 = 65000`（`lib/index.js:44,123-126,358`） | 通过 |
| `exec.signal` 协作取消 | 合流进 `AbortSignal.any([timeout, exec.signal])`（`lib/index.js:279-289`） | 通过（但取消文案见 D-风险和 R4） |

### 2.3 子集合规性（AC3）

DSH 子集白名单（`@deepseek-ai/dsh-tools/lib/index.js:34-52`）：

```
const CONSTRAINT_KEYWORDS = new Set(["type","oneOf","properties","required","additionalProperties","items","enum","const"]);
const ANNOTATION_KEYWORDS = new Set(["description","title","default","examples"]);
```

白名单之外的关键字在 `@deepseek-ai/dsh-tools/lib/index.js:206` 被**记为违规并抛错**，而不是被忽略：

```
violations.push(`${path}.${key} is not a supported keyword (subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)`);
```

把插件真实注册出来的定义喂给 DSH 自己的断言（`node --input-type=module -e`，不落盘）：

```
SUBSET-OK parameters
SUBSET-OK output.schema
validator-rejects-array: ["\"args\" must be an object"]
validator-accepts-good: []
validator-missing-required: ["missing required property \"args.questions\""]
validator-extra-key: ["\"args.bogus\" is not a declared property (additionalProperties: false)"]
render-shape: [{"type":"text","text":"{\n  \"a\": 1\n}"}]
```

结论：`PARAMETERS` 只用到 `type/properties/required/additionalProperties/description`，**不含 `pattern`/`format`/`minimum`/`maximum` 等越界关键字**；`required: ['state','questions']`（`lib/index.js:329`）确实覆盖 `state` 与 `questions`；且 `additionalProperties: false` 在运行时真实生效（多余键被拒）。AC3 通过。

### 2.4 配置解析与校验路径（README「配置」节逐条核对）

| README 声明（行号） | 实现 | 一致？ |
| --- | --- | --- |
| `transport` 默认 `typesafe`（L64） | `DEFAULTS.transport`（`lib/index.js:37`），非法值抛 `transport must be "typesafe" or "vercel"`（L97-99） | 是 |
| `baseURL` 默认 `https://api.typesafe.ai`（L65） | `lib/index.js:38` | 是 |
| `gatewayBaseURL` 默认 `https://ai-gateway.vercel.sh/v4/ai`（L66） | `lib/index.js:47` | 是 |
| `model` 默认 `jev-latest`（vercel 下 `typesafe-ai/jev`）（L67） | `lib/index.js:102,117` | 是 |
| `apiKeyEnv` 默认 `TYPESAFE_API_KEY` / `AI_GATEWAY_API_KEY`（L68） | `lib/index.js:103` | 是 |
| `keyFile` 默认 `~/.config/typesafe/key`（vercel 下 `~/.config/vercel/ai-gateway-key`）（L69） | `lib/index.js:41-42,119-121` | 是 |
| `timeoutMs` 默认 60000（L70） | `lib/index.js:43` | 是 |
| `toolTimeoutMs` 默认 `timeoutMs + 5000`（L71） | `lib/index.js:123-126`；探针实测覆盖值生效（`toolTimeoutMs: 1234` → `1234`） | 是 |
| `maxStateBytes` 默认 262144（L72） | `lib/index.js:45` | 是 |
| `maxQuestions` 默认 64（L73） | `lib/index.js:46` | 是 |
| 密钥顺序 `$apiKeyEnv` → 传输约定变量 → `keyFile`（L75-76） | `lib/index.js:154-163`：typesafe 回落 `JEV_API_KEY`，vercel 回落 `AI_GATEWAY_API_KEY`/`VERCEL_AI_GATEWAY_KEY`；最后 `readKeyFile` | 是 |

校验路径（`assertQuestions` `lib/index.js:174-209`、`requestSystemOne` `lib/index.js:249-311`）实测：

```
PROBE maxQuestions=1 with 2 questions -> ERROR: tool-jev: at most 1 questions per call (got 2)
PROBE maxStateBytes=4 with 10-byte state -> ERROR: tool-jev: state is 10 bytes, over maxStateBytes 4
PROBE timeoutMs=50 vs 500ms server -> ERROR: tool-jev: request to .../v1/systemone timed out after 50 ms
PROBE non-object JSON body -> ERROR: tool-jev: the endpoint returned a non-object body
PROBE blank instructions -> ERROR: tool-jev: questions.q.instructions must be a non-empty string
PROBE empty keyFile (whitespace only) -> ERROR: tool-jev: no API key. Set $NO_ENV or $JEV_API_KEY, or write the key to /tmp/jev-probe-BRPzUJ/k.
```

自带套件已覆盖 `空 state`、`非法 type`、`缺 criteria`、`空问题集`、`HTTP 401/404`、`非法 baseURL`、`非法 transport`（`test/smoke.mjs:206-246`），对应 SPEC AC5 全部通过。

### 2.5 两种传输的请求组装（对照 README 第 15-31 行）

`buildRequest`（`lib/index.js:218-239`）实测与 README 一致：

```
PROBE typesafe boolean translated -> wire type = noul
PROBE wire criteria (null) = {"type":"choice","instructions":"?","criteria":null}
PROBE wire criteria (string) = {"type":"score","instructions":"?","criteria":"not-an-array"}
```

- typesafe：`POST {baseURL}/v1/systemone`，body `{ state, questions, model }`（`lib/index.js:234-237`）— README L17-19 一致。
- vercel：`POST {gatewayBaseURL}/evaluation-model`（`lib/index.js:222`），头 `ai-gateway-protocol-version` / `ai-evaluation-model-specification-version` / `ai-model-id`（`lib/index.js:225-227`），body `{ state, questions }` 且**无 `model` 字段**（`lib/index.js:229`）— README L23-31 一致；冒烟断言 `test/smoke.mjs:162-168` 通过。
- `noul` ⇄ `boolean` 双向翻译（`lib/index.js:191-192`）— README L28 一致。

---

## 三、文档-实现偏差

| # | 严重度 | 偏差 | 证据 |
| --- | --- | --- | --- |
| D1 | **重要** | README「验证」节（L117-126）声称 `node test/smoke.mjs` 覆盖 5 类内容，其中第 5 项（`dsh web --patch … --dump-config` 解析 file URL 并插入 `tool-jev`）与第 6 项（`test/mock-typesafe.mjs` 起假端点 + `dsh headless` 让模型真实调用）**在自带测试中完全不存在**。 | 仓库全域搜索（排除 node_modules/.git）`grep -rn "dump-config\|headless\|spawn\|child_process\|mock-typesafe" .` 只命中 `./README.md:123`、`./README.md:125` 两行；`test/smoke.mjs` 内 `grep -nE "dsh\|mock-typesafe\|spawn\|headless\|dump-config\|execFile"` 只命中注释里的包名（L2）。`test/mock-typesafe.mjs` 在仓库内**没有任何调用方**，是死代码。README 的「覆盖内容」把 4 项实测 + 2 项未实现混列。 |
| D2 | 中（行为缺陷，非文档） | vercel 传输在 `apiKeyEnv` 取缺省值时报错文案自重复。 | 实测：`VERCEL-DEFAULT-KEY-ENV MSG: tool-jev: no API key. Set $AI_GATEWAY_API_KEY (or $AI_GATEWAY_API_KEY), or write the key to /nonexistent/key. …`。根因：缺省 `apiKeyEnv`（`lib/index.js:103`）与括号里的固定回退（`lib/index.js:269`）同名。typesafe 侧无此问题：`Set $TYPESAFE_API_KEY or $JEV_API_KEY`。SPEC 自带示例（`specs/research-jev-plugin-verification.yaml:107`）复制了这条重复文案，说明偏差已被观察到但未修。 |
| D3 | 轻微 | README「配置」表（L64-73）漏列两个**可配置**字段：`gatewayProtocolVersion`（默认 `0.0.1`）与 `gatewaySpecVersion`（默认 `4`）（`lib/index.js:48-50,111-116`）；也未说明数值字段必须为正有限数（`lib/index.js:60-66`）。 | `lib/index.js:111-116` 读取这两个键；README 只在 L30 提到头名，未把它们列为配置项。 |
| D4 | 轻微 | README L29-31 的「body 为 `{ state, questions }`」只描述 vercel；**原生 typesafe 的 body 实际含 `model` 字段**（`lib/index.js:236`），README 未记录。 | `test/smoke.mjs:131` 断言 `lastBody.model === 'jev-test'`，证明原生 body 含 `model`；README L17-19 只写了 URL 与问句类型。 |
| D5 | 中 | README 语法（L88-90）声明 `choice` 的 `criteria` 是对象、`score` 的 `criteria` 是数组；实现只检查 `spec.criteria !== undefined`（`lib/index.js:201-205`），不做形状校验，`null`/字符串/数字都会原样转发给提供方。文档承诺的本地校验强度高于实现。 | 实测 `PROBE criteria:null -> ACCEPTED (request sent)`，线上 body `{"type":"choice","instructions":"?","criteria":null}`；`criteria:"not-an-array"` 同样原样转发。README L96 也只说「choice/score 必须带 criteria」，故属**措辞与语法示例**的偏差而非致命缺陷。 |
| D6 | 轻微（打包） | `package.json` 的 `files`（L11-15）只列 `lib` / `README.md` / `dsh.patch.yml`，**漏了 `dsh.vercel.patch.yml`**；而 README L56-58「方式三：当包安装进 profile」把这作为受支持路径，按该路径安装会丢掉 vercel overlay。 | `npm pack --dry-run --json` 产物清单：`LICENSE / README.md / dsh.patch.yml / lib/index.js / package.json`（无 `dsh.vercel.patch.yml`，也无 `test/`、`examples/`，后者属开发目录可接受）。 |
| D7 | 轻微 | README L96 写「type 必须匹配所选传输」；实现实际对两种拼写做**双向翻译**（`boolean`→`noul`、`noul`→`boolean`，`lib/index.js:191-192`），因此 type 不会被传输拒绝，只会被翻译。 | 实测 `PROBE typesafe boolean translated -> wire type = noul`。与 README L28「写成 noul 或 boolean 都可以」一致，但与 L96 措辞矛盾。 |
| D8 | 轻微 | `normalizeConfig` **无条件**校验 `baseURL` 与 `gatewayBaseURL`（`lib/index.js:106-110`），即使当前传输不使用其中之一；README L65-66 把它们描述为各自传输的字段。因此 vercel 部署下配错 `baseURL`（或反之）也会让插件在 `apply()` 阶段激活失败。 | `lib/index.js:104-110` 的返回对象同时构造两个 `endpoint(...)`。 |

另外两处「不算偏差但值得记录」：

- README L28「confidence 位置差异」与 L88-93 的 `answers[key].choice / probabilities / noul / probability / score` 属**上游提供方响应**的描述，插件对响应体**不做任何校验或重塑**（`lib/index.js:306-310,364`），因此这些声明无法由本仓库静态证明（见 R1、R2）。
- README L12-13「零依赖：不 import 任何 `@deepseek-ai` 包」**成立**：`lib/index.js:22-24` 只 import `node:fs/promises`、`node:os`、`node:path`；`package.json` 无 `dependencies`。

---

## 四、未覆盖风险（本测试套件未覆盖）

R1 **真实端点协议漂移**：mock 路由是测试自己定义的（`test/smoke.mjs:75` 的 `/v1/systemone`、`:86` 的 `/gateway/evaluation-model`），构成循环验证，**无法证明**真实 `https://api.typesafe.ai/v1/systemone` 或 `https://ai-gateway.vercel.sh/v4/ai/evaluation-model` 存在、字段名未变。README L31 自认该网关路由「未公开承诺稳定性」。属 live 腿。

R2 **响应形状零校验**：`output.schema` 仅 `{ type: 'object' }`（`lib/index.js:360-363`），实测 `validateJsonSchemaValue(output.schema, {})` 返回 `[]`。提供方若改名 `answers`/`confidence`/`probability`，工具仍报「成功」，模型读到的是无 `answers` 的对象。无契约测试锁定响应形状。

R3 **数组响应漏洞（fail-closed 但延迟）**：`lib/index.js:307` 用 `data === null || typeof data !== 'object'` 判定，数组满足条件而通过。实测 `PROBE array body returned by execute = []`，随后由注册表侧 `output.schema` 校验拒绝：`PROBE registry validates [] against output.schema -> ["\"value\" must be an object"]`。经 `ctx.tools.register` 的正常路径最终失败，但错误来源与文案（`the endpoint returned a non-object body`）不一致；若消费者直接调用 `execute`（PTC 桥、自定义调用方）则该守卫形同虚设。

R4 **取消语义未结构化**：`lib/index.js:290-297` 把 `AbortError` 与 `TimeoutError` 合并为「timed out」。实测预中止 signal → `ERROR: tool-jev: request to … timed out after 60000 ms`（把调用方取消误报为超时）；中途带 reason 中止 → `ERROR name=Error message=tool-jev: request to … failed: user cancelled`。两种文案都无法让上游区分「用户取消」与「真超时」；插件也未抛出 DSH 约定的 `TOOL_ABORTED` 结构化错误。

R5 **超时路径**：自带套件只注册了 `timeoutMs`（`test/smoke.mjs:114`），从未触发真实超时。探针已验证 L283-297 文案正确，但该验证不在回归套件内。

R6 **`maxStateBytes` / `maxQuestions` 上限拒绝**：自带套件无任何越界用例（`test/smoke.mjs:181-183` 的上限逻辑未触发）。探针验证通过。

R7 **非对象 body 拒绝**（`lib/index.js:307-309`）：自带套件未覆盖。探针验证通过（数组例外见 R3）。

R8 **空 key 文件回落**：`readKeyFile` 对纯空白文件返回 `undefined`（`lib/index.js:140`），自带套件只测了「文件不存在」。探针验证通过。

R9 **typesafe 侧 `boolean → noul` 反向翻译**（`lib/index.js:192`）：自带套件只测了 vercel 的 `noul → boolean`（`test/smoke.mjs:156,166`）。探针验证通过。

R10 **并发**：注册定义未声明 `isConcurrencySafe`（`lib/index.js:354-367`），DSH 据此默认 exclusive（`@deepseek-ai/dsh-tools/lib/index.js` `executionMode`），但 PTC 子调度或未来的并行分组是否会并发进入 `execute` 未验证。`test/smoke.mjs:58-62` 用全局 `lastBody/lastAuth/lastGatewayHeaders` 记录，结构上不可能测并发。

R11 **边界值**：`state` 字节数恰好等于 `maxStateBytes`、`questions` 恰好 64 条、`timeoutMs` 恰好等于 `toolTimeoutMs` 等边界均未测。

R12 **Node 版本下限**：实现依赖 `AbortSignal.any`（Node ≥ 20.3）与 `AbortSignal.timeout`（`lib/index.js:279,288`），而 `package.json:16-18` 只声明 `engines.node >= 20`，比实际最低要求宽松。本机 `node v24.21.0` 通过。

R13 **测试污染调用方环境**：`test/smoke.mjs:175,182` 直接 `delete process.env.JEV_API_KEY`、`:191` `delete process.env.GW_KEY`，未保存/恢复原值。仅影响测试进程，但会使「本机其他工具依赖该变量」的场景失真。

R14 **本腿范围外**：插件在 web profile 的挂载态（SPEC AC2：`plugin_manager list_plugins` 中 `fiberPhase=active`/`enabled=true`/`moduleName` 指向本仓库 `lib/index.js`）与真实调用（AC4）未覆盖，归 lead 与 live 腿。

---

## 五、与 SPEC 验收标准对照（本腿相关项）

| AC | 内容 | 本腿结论 | 证据 |
| --- | --- | --- | --- |
| AC1 | `node test/smoke.mjs` 退出码 0 且 FAIL 为 0 | 通过 | 2.1（36 PASS / 0 FAIL / exit 0） |
| AC2 | 挂载态 active/enabled/moduleName | 不在本腿 | 需 lead 或挂载腿取证 |
| AC3 | `parameters` 无越界关键字、`required` 覆盖 state+questions | 通过 | 2.3（`assertSupportedJsonSchema` 白名单拒绝语义 + SUBSET-OK 实测） |
| AC4 | 至少一次真实调用返回 JSON | 不在本腿 | live 腿 |
| AC5 | 失败路径可复现（no API key / 非法 transport / 空 state / 非法 type） | 通过 | 2.1（`reports a missing key with all sources`、`rejects an unknown transport`、`rejects an empty state`、`rejects an unknown question type`）+ 2.4 探针 |
| AC6 | 每条结论带证据、关键结论无单一来源 | 通过 | 本报告所有断言均附命令输出或 `file:line`；冒烟结果两次运行一致 |
| AC7 | 失败必须给状态码或错误名 | 通过（本腿） | 2.1 的 `HTTP 401`/`HTTP 404` 断言；R4 给出 `TimeoutError`/`AbortError` 归因分析 |

---

## 六、审计边界声明

- 本次审计**未修改** `lib/`、`test/`、`README.md`、任何 `*.yml`，未触碰 `~/.dsh`。
- 唯一写入文件为本报告；输入文件校验和见文首。
- 所有探针均通过 `node --input-type=module -e` 内联执行并使用本机回环 mock，未产生临时文件、未访问真实提供方端点、未消耗任何额度。
