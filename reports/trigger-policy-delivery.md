# trigger-policy 交付报告（A+B）

- 日期：2026-09-20
- SPEC：`specs/feature-jev-trigger-policy.yaml`（version 2，status done）
- 目标：让 jev 插件在**插件层自己触发**，而不是继续依赖模型自发想起一个陌生工具
- 范围：只做 A（工具描述政策化）+ B（注册常驻 prompt section）；C/D/E 按 SPEC `out_of_scope` 未做

## 一、问题与判据

改动前的实测基线：`~/.dsh/sessions` 全量 **250 个会话**中只有 **7 个**调用过 `jev_decide`，
累计 **18 次**，其中 13 次来自 3 个手工测试会话；真实 GUI 聊天里接近 0 次。
原因是结构性的：`describeTool()` 全文是"能干什么 + 语法 + 返回形状"，唯一的"何时用"是四条
**领域白名单**（routing / classification / rubric scoring / yes-no），没有任何 prompt 层级的
存在感。而本仓库最近 21 个会话中 13 个跑 `ptc` 预设 —— 该模式下工具描述被 `renderToolsSdk`
渲染成生成式 TS SDK 里的一行 JSDoc，更不显眼。

因此判据不是"文字改了"，而是"插件层自身具备触发能力，且不破坏既有零依赖与运行时语义"。

## 二、交付内容

### A 面 —— 工具描述政策化（`lib/index.js`）

`describeTool()` 重写为：用途 → **默认开判据（按判断的形状，不按领域）** → **四条豁免** →
**七个决策时刻** → 预算 → 保留全部既有语法/返回形状句子。
description 实测 **1441 字符**（预算 ≤1500）。

政策本体（A/B 共享同一组常量 `POLICY` + `policyBlock()`，无第二份副本）：

> When to use: call jev_decide whenever the answer is a judgment, not a lookup.
> Default: ask Jev before turning a judgment about meaning, intent, relevance, fit, or risk into a conclusion.
> Exempt only when the answer is fixed by an explicit instruction, a mechanical check, readable file or command output, or the caller's own decision.
> Decision moments: two self-consistent options; meaning, intent, or relevance; classifying or routing; rubric scoring; a calibrated yes/no; a long or ambiguous state; an irreversible next step.
> Budget: one call carries one state plus every question about it; keep criteria concrete.

即：把"领域白名单"换成"**默认开 + 黑名单豁免**"，并给出七个覆盖会话全程的**时刻**而非任务类型 ——
这正是解决"触发太窄"的关键。

### B 面 —— 常驻 prompt section（`lib/index.js`）

用官方可选依赖写法注册，**顶层 `inject` 仍为 `['tools']`**：

```js
ctx.inject(['systemPrompt'], (inner) => {
  inner.systemPrompt.section({
    name: 'jev-decision-policy',
    interpolate: false,
    order: /* 默认 getSectionOrder('MCP_SERVERS') + 10 = 3110，可被 config.policySection.order 覆盖 */,
    text: policySectionText(),   // 837 字符，≤1200
  });
});
```

因为插件是 host 层 bundle，这一节对**该 profile 的全部会话全局生效**，无需改任何 preset。
配置新增可选字段 `policySection: { enabled?: boolean, order?: number }`，缺省即 `enabled: true` ——
所以 web profile 现有的裸 `id: tool-jev` 覆盖（整份替换 config、不含该字段）**不需要改动就已生效**。

配套：`test/policy-section.mjs`（新增，41 项断言）、`test/smoke.mjs`（+4 条锚点断言）、
`README.md`（A/B 两个触发面 + 字段说明 + 计数同步）、`dsh.patch.yml`（仅注释）。

## 三、验证结果（区分代码级 / 运行级）

| 层级 | 证据 | 结论 |
|---|---|---|
| 代码级 | 五套测试 EXIT=0：smoke **76** / policy-section **41** / loader **3** / fixture **6** / bundle **37** | 通过 |
| 代码级 | `dsh --profile web --dump-config` 与改动前基线逐字 **IDENTICAL**，`id: tool-jev` 恰 1 行 | 通过 |
| 代码级 | 仍零依赖（仅 import `node:` 内置模块）；未改 transport/key/timeout/retries/output.render 语义 | 通过 |
| 运行级 | **headless profile + `--patch` 隔离启动**（不装包、不起服务、不碰 web profile）：request tools 表中 `jev_decide` 描述 = 1441 字符且四锚点齐备；`system/message` 中逐字出现 `## Jev decision policy` | 通过 |
| 运行级（web host） | 撰写时读到旧 1185 字符描述；**用户重启后**同一查询读到 1441 字符、四锚点齐备 | **已生效** |

运行级 e2e 证明了单元测试证明不了的三件事：`ctx.inject(["systemPrompt"], cb)` 在本部署的真实
插件上下文里**确实会 fire**；host 层 bundle 注册的 section **对该会话全局可见**；
`interpolate: false` 下正文原样进入系统提示词。
证据与复现命令：`reports/trigger-policy-e2e-runtime.md`；独立复现见 `reports/trigger-policy-verification.md` 第三节。

## 四、独立验证与已闭合的缺口

- 12 条 acceptance_criteria 全部通过（代码级 11 条 + 活体如实记录 1 条）。
- 变异测试（在 `/tmp` 副本上，仓库文件未动）：改 name / 写死 order / 加 `complete:true` /
  改坏共享 `policyBlock()` → 分别 1/1/1/3 FAIL，均被识破。
- **验证者发现唯一覆盖缺口**：SPEC 要求"A/B 必须同源"，但当时没有任何断言覆盖 ——
  把 B 面正文换成只含锚点的硬编码短串而 A 面不动时，37+76 全绿。
- **已闭合**：T8 在 `test/policy-section.mjs` 增加 ACX2 四条断言（从 description 反推共享政策块、
  逐句要求 section 逐字包含，并显式断言完整的 `Default:` 与 `Budget:` 整句）。
  T9 独立复验确认：同一变异体由 **37 PASS / 0 FAIL** 变为 **38 PASS / 3 FAIL 且 3 条全是 ACX2**，
  A 面 7 条断言仍全 PASS —— 是独立杀死，不是顺带命中。
- 诚实披露的固有边界：ACX2 保证的是 **A≡B（不漂移）**，不是政策正文的丰富度；
  丰富度的下界仍由 ACX1 固定的逐字子串给出。这是"只比两面文字、不读内部常量"的黑盒断言的固有边界。

## 五、生效方式与后续

- **A/B 已生效**。撰写时它需要重启才生效：加载器的 profile HMR 只监听 `package.json` 的 bundles 列表
  与 patch 文件，**不监听插件包的 `lib/*.js`**，所以改 JS 不会热加载。**用户随后重启了 host**，
  Lead 以 `Tool.listTools` 只读核对确认 `jev_decide` 描述已是 1441 字符、四锚点齐备 ——
  A 面在真实 web host 上确认落地；B 面与 A 面同模块、同一次 `apply()`，但 Inspect 没有列出
  prompt section 的只读方法，故 B 面属同代推断而非直接观测。生效未改动任何 profile 文件。
- 观测基线已记录：250 会话 / 18 次调用。重启后可在真实聊天里对比使用率。
- 未做的 C（`systemPrompt.context` 自适应提醒）、D（`tools.guard` 不可逆动作硬闸门）、
  E（插件自带 skill）保留在本 SPEC 的 `out_of_scope`，是否追加由 A+B 的观测结果决定。

## 六、副作用与合规

- 未修改任何 profile 文件；本轮执行期间未重启 `127.0.0.1:3080`（重启由用户自行完成）。
- 运行 `dsh --dump-config` 与 headless e2e 时，dsh 按其既有行为 byte-identical 重写了
  machine-managed 根 `cordis.yml`（内容 sha256 不变，仅 mtime 变）—— 已由验证者交叉确认。
- e2e 在 `/tmp` 下运行，未在项目工作目录产生副作用。
- 验证之后仍由 Lead 写入的两处（已在此披露）：`README.md` 覆盖清单补第 5 条（对应 ACX2，纯文档）、
  本 SPEC 的 `status: done` / `version: 2` 与完结结论。两处均不改变代码与测试，Lead 已重跑全部验收命令。
