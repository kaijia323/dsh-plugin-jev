# 修复交付与最终验收：dsh-plugin-jev 一轮清账

- **SPEC**：`specs/bugfix-jev-plugin-defects.yaml`（bugfix，v2，status=done）
- **团队**：`fix-core`（task-3 代码）/ `fix-tests-docs`（task-4 测试文档）/ `verify-fix`（task-5 独立验证），Lead 负责 SPEC、profile 配置、最终验收
- **判定**：**13/13 条验收标准通过；8 项缺陷全部修复；5 项风险中 3 项已处置/闭环，2 项受外部条件限制（如实标注）**

---

## 一、修复清单与证据

| # | 缺陷 | 修复 | 修复前 → 修复后（原始输出） |
|---|---|---|---|
| D1 | README 声称 2 项不存在的测试 | 验证节重写为真实三命令；`mock-typesafe.mjs` 变成被 `fixture-check.mjs` 驱动的 fixture；新增 `loader-overlay.mjs` 做真实加载器校验 | `grep test/` 无命中 → 三套件真实存在且全绿 |
| D2 | 无密钥文案自重复 | `keyEnvNames()` 去重后驱动解析与文案 | `Set $AI_GATEWAY_API_KEY (or $AI_GATEWAY_API_KEY)` → `Set $AI_GATEWAY_API_KEY or $VERCEL_AI_GATEWAY_API_KEY` |
| D3 | 描述说 yes/no 读 `.noul`，网关实为 `.probability` | `describeTool(transport)` 按传输生成描述 | 描述写 `.noul` → vercel 文案明确「读 `.probability`，无 `.noul`/`.boolean`/confidence」 |
| D4 | `criteria` 形状不校验 | choice=非空对象、score=非空数组，发请求前拒绝 | `criteria:null → ACCEPTED + 1 请求` → 本地拒绝且**请求增量 0** |
| D5 | `npm pack` 漏发 vercel overlay | `package.json` `files` 补 `dsh.vercel.patch.yml` | 产物 5 项 → 含两个 overlay + `lib/index.js` |
| D6 | 调用方取消被误报为超时 | 先判 `exec.signal.aborted` → `name=AbortError` 的 `call aborted by the caller` | `timed out after 60000 ms` → `call aborted by the caller`，真超时文案不变 |
| D7 | `output.schema` 对形状零校验 | `required:['answers']` + `answers:object`，并本地校验信封 | `{}`/`[]` 当成功返回 → 直接失败，不再把 `undefined` 交给模型 |
| D8 | README 漏列配置项、`engines` 偏宽 | 配置表补 `gatewayProtocolVersion`/`gatewaySpecVersion`/`retries`；`engines.node >=20.3` | — |

**风险处置**：

| 风险 | 处置 |
|---|---|
| 1/5 瞬时 60 s 超时 | 新增 `retries`（默认 0，仅超时/网络/5xx 重试，4xx 含 429 永不重试，每次重试用新 signal）；`toolTimeoutMs` 缺省改为 `timeoutMs*(retries+1)+5000`；**profile patch 已开 `retries: 1`**（`~/.dsh/profiles/web/cordis.patch.yml`，含注释与回退说明） |
| 免费额度 429 | 429 错误追加可操作提示（稍后重试 / 持续失败需付费额度），提供方原始 body 保留；README 边界节记录实测 |
| 并发未测 | 声明 `isConcurrencySafe: () => true` 并补并发用例（5 并发 + 反序响应，逐条对应） |
| mock 循环验证 | 补 `loader-overlay.mjs`（真实 `dsh --dump-config`）+ `fixture-check.mjs`（真实 spawn fixture） |
| 原生 TypeSafe 传输未实测 | 无密钥，无法实测；本轮只做到 mock 覆盖 + 文档诚实标注，未声称已实测 |

## 二、验收证据

Lead 在冻结产物上亲自复跑（非引用队友结论）：

```
node test/smoke.mjs          exit=0  PASS=67  FAIL=0   SMOKE OK (21 mock requests)
node test/fixture-check.mjs  exit=0  PASS=9   FAIL=0   FIXTURE OK
node test/loader-overlay.mjs exit=0  PASS=3   FAIL=0   LOADER OK
```

**「修复前会坏、修复后不坏」的证明**（两条独立路径）：

1. 测试腿把 `git show HEAD:lib/index.js` 放到 `/tmp` 跑新套件 → **16 FAIL**（D2 文案重复、D4 四种非法 criteria 全被接受并发请求、D6 预中止被误报超时、D7 `{}`/`[]` 当成功、F6 不重试、F8 无声明）。
2. 验证腿自写 77 条对抗探针：修复后 **77 PASS**；同一探针跑 HEAD 旧代码 **33 FAIL** 后因 `isConcurrencySafe is not a function` 崩溃。

**回归无削弱**：原 36 条断言逐条比对（解析断言体，非只比标签）——无删除、无放松，15 处差异仅是把全局变量换成访问器；旧 36 条直接跑在新 `lib/index.js` 上仍 36 PASS。

**超出测试套件的独立证明**：验证者直接导入 DSH 自带的 `validateJsonSchemaValue`/`assertSupportedJsonSchema`（含运行中进程使用的那份副本）复核 schema，而非 smoke 里的手写镜像。

## 三、两处必须说清的限制（验证者发现，Lead 已处理/确认）

### 3.1 profile `retries: 1` —— 本轮补齐 ✅

验证者判定「SPEC 要求但未交付」。Lead 已写入 `~/.dsh/profiles/web/cordis.patch.yml`（`retries: 1` + 注释 + 回退方法），改后 `include:tool-jev` 仍 `fiberPhase=active`。

### 3.2 运行中的会话仍执行修复前的旧模块 ⚠️ 需重启

Lead 独立探针（`criteria: null`）：

```
Error: tool-jev: typesafe-ai/jev returned HTTP 400: {"error":{"message":"Invalid input: expected
record, received null","param":[{"path":["questions","route","criteria"],...}]}}
```

该 `null` 被**转发到了提供方**——说明当前进程加载的仍是修复前代码（新代码会在本地拒绝、零网络请求）。根因：`dsh web` 进程 22:53:47 启动，`lib/index.js` 23:27:59 才改；profile 的 `patchReload: live` 只重放 patch，不会因文件内容变化重新 import 模块。

**影响与处置**：源码与测试层已验证正确，任何**新启动**的 `dsh web` 都会加载新代码；当前 GUI 进程内的 `jev_decide` 仍是旧契约（含 D3 的错误描述）。让本会话生效需要重启 `dsh web`。Lead **没有**重启服务（那会中断当前 GUI 会话，且不属用户请求范围）。附带收益：这条 400 探针不消耗额度，并顺带证明了 D4 的真实影响面——修复前畸形 criteria 会打到提供方并浪费一次往返。

### 3.3 免费额度已自愈

验证者的 1 次真实调用返回 **HTTP 200**（1194 ms），响应 `{"urgent":{"type":"boolean","probability":0.67}}`——独立证实 D3 的前提（网关确实没有 `.noul`），且该真实响应体通过收紧后的 `output.schema`。注意其 `providerMetadata.typesafe.confidence` 为 `{}`，与上一轮 observation 一致。

## 四、最终完整性

```
git status --short          M README.md, lib/index.js, package.json, test/smoke.mjs
                            ?? reports/, specs/, test/fixture-check.mjs, test/loader-overlay.mjs
git diff --stat             4 files changed, 651 insertions(+), 149 deletions(-)
```

- 对外契约未变：`name=jev_decide`、`required=['state','questions']`、返回提供方响应体。
- 零依赖保持不变：`lib/index.js` 中 `@deepseek-ai` 命中数 **0**；`package.json` 无 `dependencies`。
- `engines.node = ">=20.3"`；`files` 含两个 overlay。
- 冻结哈希：`lib/index.js 70ad2ea1…`、`package.json 246d450b…`、`README.md f6820892…`、`test/smoke.mjs 7c51eb4c…`。
- 越界检查：`reports/`、`specs/` 未被误改（mtime 均早于修复轮）；无 `~/.dsh` 其他文件被触碰。

## 五、残留未决（交给用户）

1. **是否重启 `dsh web`** 让本轮修复在当前 GUI 会话生效（不重启则新代码在下次启动时生效）。
2. 原生 TypeSafe 传输仍无密钥，无法实测；拿到邀请后可跑同一套件 + 1 次真实调用。
3. 免费额度的限流窗口时长未测（已知会自愈）；稳定批量使用建议付费额度。
4. 是否把 file URL 行升级为正式安装的 bundle（关乎包安装与版本管理，不在本轮范围）。
