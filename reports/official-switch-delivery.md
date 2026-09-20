# 交付报告：切换到官方 TypeSafe API 并移除 Vercel 传输

- **SPEC**：`specs/feature-jev-official-only.yaml`（feature，v2，status=done）
- **团队**：`purge-core`（task-6 代码）/ `purge-tests-docs`（task-7 测试文档 + task-9 examples 补漏 + task-7 重开增量）/ `purge-verify`（task-8 独立验证），Lead 负责 SPEC、运行时挂载、最终验收、提交
- **判定**：**11/11 条验收标准通过，0 条未验证**；插件现在只支持官方 TypeSafe API，仓库与运行时都没有可用的 Vercel 路径

---

## 一、你给的 key 如何落地（没有进仓库、没有进任何文件）

- 只写入 `~/.config/typesafe/key`（`umask 077` + `chmod 600`，108 字节），插件按 `$TYPESAFE_API_KEY` → `$JEV_API_KEY` → keyFile 解析。
- 验证者另外做了密钥泄漏扫描：用 node 读取该文件后逐字节比对仓库全部非 `.git` 文件 —— **0 个文件包含密钥值**。
- ⚠️ 提醒：这串 key 出现在本次会话的输入里，因此也存在于 `~/.dsh/sessions/` 的会话记录中。如果这个日志会被共享或备份，建议在 TypeSafe 后台轮换一次。

## 二、官方 API 实测（这是原生传输第一次被真实验证）

| 项 | 结果 |
|---|---|
| 端点 | `POST https://api.typesafe.ai/v1/systemone`（DNS 172.19.0.66，TLS 0.35s 内建连） |
| 鉴权 | `Authorization: Bearer <key>` |
| body | `{state, questions, model}` —— 缺 `model` 会 422（`Field required: body.model`），`model: "jev"` 会 400（`Unknown model`） |
| 模型 | `jev-latest` → 响应里解析为 **`jev-1.13.0`** |
| 延迟 | 0.5–0.7 s/次（11 次真实调用，全部 200，未触发限流） |
| 响应形状 | `{"model":"jev-1.13.0","answers":{...},"usage":{...}}`；choice → `.choice`+`probabilities`+`confidence`；noul → `.noul`（yes 概率）；score → `.score`+`confidence`+`legend`+`probabilities` |

本轮由三方各自独立打到真端点：Lead 的 curl 与插件探针、验证者的 2 次 `apply()+execute()` 调用、examples 的 3 次 demo 调用。运行中的会话（我在本会话里调的 `jev_decide`）也返回 `jev-1.13.0`。

## 三、Vercel 移除清单

| 位置 | 处理 |
|---|---|
| `lib/index.js` | 删除 vercel 传输分支、5 个 gateway 配置字段、`/evaluation-model` 路径、三个 gateway 协议头；589 → 525 行 |
| `transport` 键 | 保留为**迁移护栏**：只接受 `typesafe`，其它值（含 `vercel`）在密钥解析前直接抛错并含 `removed` + `typesafe`，绝不静默降级 |
| `dsh.vercel.patch.yml` | `git rm` |
| `package.json` | `files` 去掉该 overlay |
| `test/**` | 删 12 条 gateway 专属用例；`mock-typesafe.mjs` 删 gateway 路由与 `ai-model-id` 日志；`fixture-check.mjs` 同步；新增迁移护栏、`boolean`→`noul` 归一化、官方链路 D2 去重等 17 条 |
| `README.md` | 「两种传输」整节删除；配置表只剩官方字段；新增「迁移说明：Vercel 传输已移除（2026-09-20）」；examples 相关 4 处过时 caveat 修正 |
| `examples/` | `route-demo.mjs` 接官方端点（body 带 `model`、`TYPESAFE_KEY_FILE`、confidence 读 `answers[key].confidence`、删 gateway 头）；`confidence-routing.md` 同步 |
| `.gitignore` | 删 `ai-gateway-key` 行 |
| `~/.dsh/profiles/web/cordis.patch.yml` | 挂载改为 `transport: typesafe` + `baseURL: https://api.typesafe.ai` + `keyFile: ~/.config/typesafe/key` + `apiKeyEnv: TYPESAFE_API_KEY`（保留 `retries: 1`） |

## 四、验收证据（Lead 在冻结产物上自己跑的）

```
node test/smoke.mjs           exit=0  PASS=72  FAIL=0   SMOKE OK (21 mock requests)
node test/fixture-check.mjs   exit=0  PASS=6   FAIL=0   FIXTURE OK
node test/loader-overlay.mjs  exit=0  PASS=3   FAIL=0   LOADER OK

残留扫描（lib/ test/ package.json dsh.patch.yml README.md examples/ .gitignore）：
  README.md 8 行（全在「迁移说明」段） | lib/index.js 1 行（迁移报错） | test 5 行（迁移护栏 + 反残留负断言）
  examples/ 0 命中 | .gitignore 0 命中 | dsh.vercel.patch.yml 已不存在
```

**独立验证者（非本轮任何写入腿的作者）**：把 HEAD 归档实跑出 67 标签基线 → 当前 72 PASS，被删的 12 条**全部**是 `vercel*` 前缀，非 gateway 标签缺失 0、改名 0；并用自建 mock 做反向攻击（401/429 不重试、500 重试一次、预中止 vs 超时文案互斥、7 种非法 criteria 请求数 0）。详见 [purge-verification.md](purge-verification.md)。

## 五、留档的 3 条次要偏差（都不影响结论）

1. **F-V1**：`test/smoke.mjs` 的反残留负断言位于「注册契约」区块而非「迁移护栏」区块，按 AC3 字面算是第 4 处命中。它只是把「schema 里不得出现退役模型名」钉死，属加固性例外 —— Lead 判定可接受。
2. **F-V2**：task-8 描述里漏列 `examples/` 与 `.gitignore`，实际改动是 SPEC 的 T4 明确要求，不算越界。
3. **F-V3**：SPEC 的 examples 样例报错文案少了 `transport must be` 前缀，实现与 README 是一致的，AC5 只要求含 `removed` 与 `typesafe`。

## 六、运行时会话的真实状态

- 挂载行 `include:tool-jev` 为 `enabled=true` / `fiberPhase=active`，本会话调用 `jev_decide` 返回官方 `jev-1.13.0` 答案（已实测）。
- 该 web 进程于 2026-09-20 22:12 启动，之后 `lib/index.js` 又被本轮收敛改写；进程内仍持有**收敛前**的模块实例。对本部署无功能影响（配置本来就只走官方传输），但要让进程加载到「已移除 Vercel」的那份代码，仍需重启一次 `dsh web`。

## 七、复现命令

```bash
# 官方链路（插件代码路径，key 只经 keyFile）
node --input-type=module -e "…apply({keyFile:'~/.config/typesafe/key'})…"

# 套件
node test/smoke.mjs && node test/fixture-check.mjs && node test/loader-overlay.mjs

# 残留扫描
grep -rniE 'vercel|ai-gateway|evaluation-model|gatewayBaseURL|typesafe-ai/jev|gatewayModel|gatewayProtocolVersion|gatewaySpecVersion|ai-model-id' \
  lib/ test/ package.json dsh.patch.yml README.md examples/ .gitignore

# examples 真实演练（会调用官方 API）
node examples/route-demo.mjs
JEV_CALIBRATE_LIMIT=1 node examples/route-demo.mjs --calibrate
```
