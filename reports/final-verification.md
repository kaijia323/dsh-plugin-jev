# 最终判定：dsh-plugin-jev 做什么、是否有效

- **对象**：`/home/dsh/temp/dsh-plugin-jev`（git `a9f10d4`，工作树仅新增 `reports/`、`specs/`，源码零改动）
- **挂载点**：`~/.dsh/profiles/web/cordis.patch.yml` 的 insert 行 → `include:tool-jev`
- **SPEC**：`specs/research-jev-plugin-verification.yaml`（research 类型，v2，status=done）
- **判定**：**H1 有效（实现层通过），但当前免费额度下操作受限**
- **证据来源**：lead 独立复核 + `reports/static-contract.md`（task-1）+ `reports/live-provider.md`（task-2）

---

## 一、这个插件做什么

把 TypeSafe 的 **Jev（System One 决策模型）**注册成 DSH 原生工具 `jev_decide`。

Jev 不产出文本，只接受 `state` + 类型化问题、返回类型化答案与校准置信度，接口不是 Chat
Completions，所以正确接法是工具而非 LLM provider（`lib/index.js:1-20` 的设计说明与实现一致）。

| 维度 | 内容 |
|---|---|
| 工具名 | `jev_decide(state: string, questions: object, model?: string)` |
| 问句原语 | `choice`（返回 `.choice` + `probabilities`）、`score`（返回 `.score` + `probabilities`）、`noul`/`boolean`（返回 `.probability`） |
| 传输 A | `transport: typesafe` → `POST {baseURL}/v1/systemone`，body `{state, questions, model}` |
| 传输 B（**当前挂载**） | `transport: vercel` → `POST https://ai-gateway.vercel.sh/v4/ai/evaluation-model`，头 `ai-model-id: typesafe-ai/jev` 等三个协议头，body `{state, questions}` |
| 密钥来源 | `$apiKeyEnv` → 传输约定变量（vercel: `AI_GATEWAY_API_KEY`/`VERCEL_AI_GATEWAY_KEY`）→ `keyFile`；**密钥从不作为工具参数**，不进对话记录 |
| 本地校验 | state 非空且 ≤262144 B、questions 非空且 ≤64 条、type 属于传输允许集、choice/score 必须带 criteria、instructions 非空 |
| 依赖 | 零依赖（`lib/index.js:22-24` 仅 import node 内置模块，`package.json` 无 dependencies） |

典型用途：路由分类、评分量表、可预知答案空间的 yes/no 判定，以及用 confidence 做「自动执行 /
升级复核 / 转人工」的三档门控（`examples/confidence-routing.md`）。

## 二、是否有效：分三层给结论

### 第 1 层 · 注册与挂载：✅ 通过（Lead 取证）

```
plugin_manager list_plugins →
  entryId: include:tool-jev
  moduleName: file:///home/dsh/temp/dsh-plugin-jev/lib/index.js
  enabled: true   fiberPhase: active   patchId: tool-jev
```

行是 `active` 而非 `failed`/`restart-required`；`jev_decide` 真实出现在本会话工具表并被实际调用。
Lead 另用 mock ctx 直接驱动 `apply()`，注册结果：`name=jev_decide`、`timeoutMs=65000`、
`output.render` 为函数 — 与源码 `lib/index.js:352-367` 一致。

### 第 2 层 · 契约与本地逻辑：✅ 通过（Lead 复跑 + 队友深审）

- **Lead 亲自复跑**：`node test/smoke.mjs` → **exit=0，36 PASS / 0 FAIL**，末行 `SMOKE OK (7 mock requests)`；队友两次运行结果一致。
- **参数子集合规**：队友把真实注册出的 `parameters` 与 `output.schema` 喂给 DSH 自己的 `assertSupportedJsonSchema`，双 `SUBSET-OK`。Lead 复核了该断言的实现：白名单外的关键字在 dsh-tools 里是**抛错**而非忽略（`lib/index.js:197-206`），因此这是强证据而非目测。
- **配置与校验路径**：README「配置」10 项、密钥三级回落、两传输 URL/头/body/`noul`⇄`boolean` 双向翻译，逐条与代码一致；`apply()` 抛错路径实测复现（见第三节 D2）。

### 第 3 层 · 真实提供方端到端：⚠️ 实现已验证可用，当前被免费额度限流

**队友 live 腿（4/5 成功，带完整元数据）**：

| # | 时间(+08:00) | 问句 | provider 窗口 | 结果 |
|---|---|---|---|---|
| 1 | 22:57:41 | choice + noul | 193 ms | ✅ 200 |
| 2 | 22:57:51 | score + noul | 159 ms | ✅ 200 |
| 3 | 22:57:57 | 同 #1 | 无 | ❌ 60 s 超时 |
| 4 | 22:59:18 | 同 #1 | 176 ms | ✅ 200 |
| 5 | 22:59:29 | noul | 148 ms | ✅ 200 |

原文形状（`reports/live-provider.md:79-98`）：

```json
{ "route": { "type": "choice", "choice": "billing_escalation",
             "probabilities": { "billing_escalation": 0.78, "billing_refund": 0.22, "churn_risk": 0, "technical": 0 } } }
{ "churn_severity": { "type": "score", "score": 2.29, "probabilities": { "2": 0.71, "3": 0.29 } } }
{ "urgent": { "type": "boolean", "probability": 0.83 } }
```

**Lead 独立复核（受阻，但同向）**：22:59-23:01 之间 Lead 自己发了 4 次调用，**全部 HTTP 429**，
原文（截断自提供方响应体）：

```
Error: tool-jev: typesafe-ai/jev returned HTTP 429: {"error":{"message":"Free tier requests on this
model are rate-limited. Upgrade to paid credits at ...","type":"rate_limit_exceeded", ...}}
```

这次 429 本身就是有效证据：请求**通过了鉴权并到达正确路由**（否则会先报插件自己的
`no API key`），错误被精确暴露为「状态码 + 提供方原始 body」。它同时把「实现正确」与
「额度够用」两件事分开了。

**可靠性小结**：离散答案稳定（两次相同 payload 都判 `billing_escalation`，urgent 均 0.83），
概率有 ~1pt 抖动（refund 0.22→0.21，confidence 0.70→0.72）→ 调用方不应断言概率精确相等。
已排除 401/403、404、DNS/TLS（同主机无鉴权探测 0.61 s 返回 400）；两次超时/限流的根因分别是
**提供方慢响应触发插件自身 60 s 上限**（`lib/index.js:279,293`）与**免费额度限流**，都不是插件缺陷。

## 三、发现的缺陷（按严重度）

| # | 级别 | 问题 | 证据 |
|---|---|---|---|
| D1 | **重要** | README「验证」节声称 `test/smoke.mjs` 覆盖 5 类内容，其中**第 5、6 项（`dsh web --patch --dump-config`、`dsh headless` + mock 端点端到端）在仓库里根本不存在** | Lead 复跑：`grep -rnE 'spawn\|child_process\|dump-config\|headless\|mock-typesafe' test/` 除 `mock-typesafe.mjs` 自身外无任何命中；`test/mock-typesafe.mjs` 无调用方=死代码 |
| D2 | 中（行为） | vercel 缺省 `apiKeyEnv` 时错误文案自重复 | Lead 探针实测：`no API key. Set $AI_GATEWAY_API_KEY (or $AI_GATEWAY_API_KEY)`；根因 `lib/index.js:103` 与 `:269` 同名 |
| D3 | 中 | 工具描述说 yes/no 返回 `answers[key].noul`，网关实际返回 `{type:"boolean",probability}` — 读 `.noul` 会得到 `undefined` | `lib/index.js:320` vs `reports/live-provider.md:97`；且 boolean 问题无 `typesafe.confidence` 条目 |
| D4 | 中 | `criteria` 形状不校验：README 说 choice 是对象、score 是数组，实现只查 `!== undefined`，`null`/字符串原样转发给提供方 | `lib/index.js:201-205`；队友探针 `criteria:null → ACCEPTED` |
| D5 | 轻微 | `npm pack` 漏掉 `dsh.vercel.patch.yml`（`package.json` `files` 未列），按 README「方式三」安装会丢 vercel overlay | 队友 `npm pack --dry-run --json` |
| D6 | 轻微 | 取消被误报为超时：预中止 signal 也报 `timed out after 60000 ms`，未抛 DSH 的 `TOOL_ABORTED` | `lib/index.js:290-297`；队友探针 |
| D7 | 轻微 | `output.schema` 仅 `{type:'object'}`，对响应形状零校验；提供方若改字段名，工具仍报成功 | `lib/index.js:360-363` |
| D8 | 轻微 | README 漏列 `gatewayProtocolVersion`/`gatewaySpecVersion` 两个可配置项；typesafe body 含 `model` 未记录；`engines.node>=20` 宽于 `AbortSignal.any` 实际要求(≥20.3) | `lib/index.js:48-50,111-116,236`；`package.json:16-18` |

## 四、未验证与残留风险

1. **原生 TypeSafe 传输未实测**：`~/.config/typesafe/` 不存在、`TYPESAFE_API_KEY` 未设置，仅有 mock 覆盖；`api.typesafe.ai/v1/systemone` 的真实存在性未证实。
2. **免费额度恢复窗口未测**：Lead 连续 4 次 429 覆盖约 2.5 分钟，更长窗口（小时/日）未验证；稳定使用需付费额度。
3. **批量/并发未测**：注册定义未声明 `isConcurrencySafe`；自带套件用全局变量记录请求，结构上无法测并发。
4. **mock 属循环验证**：测试自定义的路由无法证明真实端点字段未漂移（README 自认该网关路由「未公开承诺稳定性」）。
5. **60 s 超时**：小样本中 1/5 命中，建议调用方对 `timed out after 60000 ms` 重试一次或提高 `timeoutMs`。

## 五、SPEC 验收标准对照

| AC | 结论 | 证据 |
|---|---|---|
| AC1 smoke exit 0 / FAIL 0 | ✅ | Lead 复跑 exit=0、36 PASS、0 FAIL |
| AC2 挂载态 active/enabled/moduleName | ✅ | `plugin_manager list_plugins` 第二条 |
| AC3 parameters 无越界关键字 | ✅ | 队友 DSH 自身断言双 `SUBSET-OK` + Lead 复核白名单抛错语义 |
| AC4 至少一次真实调用返回 JSON 或可定位状态码 | ✅ | 队友 4×200 带完整形状；Lead 4×429 带状态码与 body（AC 的 or 分支） |
| AC5 失败路径可复现 | ✅ | smoke 的 401/404/无密钥/非法 transport/空 state/非法 type + Lead D2 探针 |
| AC6 结论带证据、无单一来源 | ✅ | 三条腿各自带原始输出；关键结论均有 lead 复核或 DSH 自身断言 |
| AC7 失败必须给状态码或错误名 | ✅ | 429/401/404/`TimeoutError`/`AbortError` 全部落盘 |

## 六、边界声明

未修改 `lib/`、`test/`、`README.md`、任何 `*.yml`、`~/.dsh` 或密钥文件（`git status` 仅 `?? reports/ ?? specs/`）；
密钥文件内容从未被读取或打印。新增文件：本报告、`reports/static-contract.md`、`reports/live-provider.md`、`specs/research-jev-plugin-verification.yaml`、`specs/specs.html`。
