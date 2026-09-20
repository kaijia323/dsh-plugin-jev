# bundle 安装路径独立验证报告

> 脱敏说明（2026-09-20，公开仓库）：本文件把绝对路径 `/home/<user>/…` 统一写成 `~/…`，其余行与原始输出
> 逐字一致，未做其它改写（替换前该文件有 32 行含此前缀、替换后 0 行；按出现次数计是 33 次）。

- **SPEC**：`specs/feature-jev-bundle-install.yaml`（`feature-jev-bundle-install`，9 条 `acceptance_criteria`）
- **验证者**：`bundle-verify`（独立验证者，非实施者；`test/bundle-install.mjs` 由本 agent 从零编写）
- **验证对象版本**：`package.json` 已含 `"dsh": {"bundle": {"patch": "./dsh.patch.yml"}}`（task-2 completed）；
  `git status --short` = `M README.md`、`M dsh.patch.yml`、`M package.json`、`?? specs/…`、`?? test/bundle-install.mjs`
- **验证时间**：2026-09-20 22:26–22:41（本机时区 +0800）
- **验证环境**：`node v24.21.0`；`dsh 0.1.6-alpha.2`（pnpm 全局 shim）；`pnpm v12.3.4`；`npm`（node 自带）；
  `DSH_HOME=~/.dsh`；仓库 `~/temp/dsh-plugin-jev`
- **重要事实（实测）**：本次真装**未出现网络依赖**——`dsh plugin … add <本地路径>` 被 pnpm 解析为 `link:`，
  481ms 完成。因此**没有任何一条验收标准需要按 `failure_handling` 降级**；全部为在真实 pnpm 安装路径上观察到的结果。

## 结论速览

| # | acceptance_criterion（摘要） | 判定 | 一句话结论 |
|---|---|---|---|
| 1 | `dsh plugin --profile jevtest add <repo>` 后 bundles 含包名；dump-config 恰好 1 行 `id: tool-jev`，解析到该 profile 的 node_modules | **通过** | 真实 pnpm 安装；bundles `["@deepseek-ai/dsh-base","dsh-plugin-jev"]`，1 行，指向 jevtest 包内 lib/index.js |
| 2 | 真实 `bundleManifest('dsh-plugin-jev', <profileDir>, anchor)` 返回非 undefined 且 `patch === './dsh.patch.yml'`；改造前返回 undefined | **通过** | 对**真实安装后的 jevtest** 调用返回完整 manifest；对删掉 `dsh` 字段的副本返回 `undefined` |
| 3 | 仓库 overlay 用法不变：`dsh --profile web --patch <repo>/dsh.patch.yml --dump-config` 退出 0 且解析为 `file://<repo>/lib/index.js` | **通过** | 退出 0，解析正确；同时观察到同 id 出现 **2 行**（见「发现 F2」） |
| 4 | `npm pack` tarball 含 dsh.patch.yml / lib/index.js / README.md / package.json | **通过** | 5 条 = 所需 4 条 + npm 自动纳入的 LICENSE（超集） |
| 5 | 删掉 `dsh` 字段的副本 `add` 后 stderr 含 `declares no dsh.bundle` 且 bundles 不新增该包名；仓库本体不被改 | **通过** | 两种副本实测命中原文警告；bundles 与 dump-config 均无该包；仓库 3 文件 hash 不变 |
| 6 | 无回归：smoke 72 / fixture-check 6 / loader-overlay 3 断言，退出码均 0 | **通过** | 72 / 6 / 3，退出码 0/0/0，断言数不变 |
| 7 | README 写明 (i) 正确命令 (ii) `--profiles` 报错 (iii) add 只装依赖 (iv) **必须删旧同 id 行** | **部分通过** | (i)(ii)(iii) 已在；(iv) **完全缺失**——README 全文无相关措辞（T5 范围） |
| 8 | 验证后 jevtest 已删除；web/cordis.patch.yml 与 lib/index.js 的 mtime 与验证前一致 | **通过** | jevtest 已删除；两者 sha256+mtime 前后逐字节一致 |
| 9 | `test/bundle-install.mjs` 由验证者独立编写，不调用/复制被验证者脚本；报告逐条附命令与原始输出 | **通过** | 仅 import `node:` 内置模块；唯一 spawn 目标是 `dsh`；并附**敏感性（mutation）测试**证明非恒绿 |

**总计：8 条通过，1 条部分通过（#7），0 条失败。**

未通过的部分只有一处，且属 T5 文档范围，不是 bundle 机制问题：
**README 缺少「切换成 bundle 层前必须删掉 user layer 里同 id（tool-jev）的 insert 行」这条迁移警告。**

---

## 独立性声明（对应 criterion 9）

- `test/bundle-install.mjs` 由本 agent 编写，**未**读取、import 或 spawn `test/smoke.mjs` / `test/fixture-check.mjs` /
  `test/loader-overlay.mjs` / `test/mock-typesafe.mjs`（`grep` 结果：无任何引用）。
- 仅 import `node:child_process`、`node:crypto`、`node:fs`、`node:module`、`node:os`、`node:path`、`node:url`（无第三方依赖）。
- 验证器唯一的子进程目标是从 `PATH` 上的 `dsh` shim 反解出的真实 `dsh`；唯一写入目录是它自己的 `mkdtempSync` 临时目录。
- 验证器调用的是**真实产品代码路径**：`@deepseek-ai/dsh-plugin-manager/operations` 的 `bundleManifest()`，
  以及 `@deepseek-ai/dsh-app-boot` 的 `resolveBundleDir()` / `loadOverlayPatches()`（与 `dsh --dump-config`、plugin-manager `reconcile()` 同一套实现），
  而不是复刻这些逻辑。

**非空洞（敏感性）证明**：把 harness 原样复制到用 `git archive HEAD` 取出的 **T2 之前**的仓库副本中运行（`package.json` 无 `dsh` 字段）：

```
$ M=$(mktemp -d); git -C ~/temp/dsh-plugin-jev archive HEAD | tar -x -C $M
$ cp ~/temp/dsh-plugin-jev/test/bundle-install.mjs $M/test/
$ (cd $M && node test/bundle-install.mjs); echo "EXIT=$?"
[FAIL] 1.3 repo package.json declares dsh.bundle.patch === './dsh.patch.yml'
[FAIL] 1.4 bundleManifest(name, posProfile, anchor) returns a manifest (not undefined)
[FAIL] 1.5 returned manifest.dsh.bundle.patch === './dsh.patch.yml'
[FAIL] 1.6 returned manifest identifies the package as dsh-plugin-jev
PASS=33 FAIL=4 SKIP=0
EXIT=1
```

即：harness 在改造前会准确失败在 `dsh.bundle` 断言上（且负样本 1.9 仍 PASS），在改造后 37 条全绿 —— 说明它测的是真实差异，不是恒绿。

---

## 逐条验收：命令 + 原始输出

### criterion 1 —— 隔离 profile 真装并自动激活：**通过**

```console
$ dsh plugin --profile jevtest add ~/temp/dsh-plugin-jev   # = add "$(pwd)"
EXIT=0
--- stdout ---
Already up to date

dependencies:
+ dsh-plugin-jev link:../../../temp/dsh-plugin-jev

Update available! 12.3.4 → 12.5.1.
Done in 481ms using pnpm v12.3.4
--- stderr ---
dsh: initialized profile jevtest at ~/.dsh/profiles/jevtest
```

`~/.dsh/profiles/jevtest/package.json`：

```json
{
  "name": "dsh-profile-jevtest",
  "private": true,
  "dependencies": { "dsh-plugin-jev": "link:~/temp/dsh-plugin-jev" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "dsh-plugin-jev"] } }
}
```

`~/.dsh/profiles/jevtest/node_modules/dsh-plugin-jev` → `../../../../temp/dsh-plugin-jev`（符号链接）。

```console
$ dsh --profile jevtest --dump-config
EXIT=0
count id: tool-jev = 1
345:# == dsh-plugin-jev
346:- id: tool-jev
347-  name: >-
348-    file://~/.dsh/profiles/jevtest/node_modules/dsh-plugin-jev/lib/index.js
349-  config:
350-    transport: typesafe
```

- bundles 含 `dsh-plugin-jev` ✅
- `id: tool-jev` **恰好一次** ✅
- name 解析到 **该 profile 下** `node_modules/dsh-plugin-jev/lib/index.js` ✅
- 层标记 `# == dsh-plugin-jev` 证明它是作为 **bundle 层**（而非普通依赖）被选中的 ✅
- `pnpm-lock.yaml` 佐证真实安装：`dsh-plugin-jev: {specifier: link:~/temp/dsh-plugin-jev}`

### criterion 2 —— plugin-manager 真实代码路径：**通过**

在**真实安装后的** jevtest profile 上调用（anchor = 真实 dsh 安装包的 package.json）：

```console
$ node --input-type=module -e '
  const req = createRequire(join(DSHREAL,"lib/bin.js"));
  const ops = await import(req.resolve("@deepseek-ai/dsh-plugin-manager/operations"));
  const ab  = await import(req.resolve("@deepseek-ai/dsh-app-boot"));
  ops.bundleManifest("dsh-plugin-jev", "~/.dsh/profiles/jevtest", join(DSHREAL,"package.json"));'

anchor                = ~/.local/share/pnpm/global/v11/4a521-…/node_modules/@deepseek-ai/dsh/package.json
profileDir            = ~/.dsh/profiles/jevtest
resolveBundleDir      = ~/.dsh/profiles/jevtest/node_modules/dsh-plugin-jev
bundleManifest===undefined ? false
bundleManifest        = {"name":"dsh-plugin-jev","version":"0.1.0",…,"dsh":{"bundle":{"patch":"./dsh.patch.yml"}},…}
dsh.bundle.patch      = "./dsh.patch.yml"
```

改造前形态（`test/bundle-install.mjs` 1.7–1.9，副本布局与安装布局完全一致，仅删掉 `dsh` 键）：

```
[PASS] 1.7 negative fixture package.json has no 'dsh' key
[PASS] 1.8 negative fixture package still RESOLVES (so undefined below is a missing-field result, not a resolution failure)
       resolvedDir=/tmp/dsh-bundle-verify-…/neg-profile/node_modules/dsh-plugin-jev
[PASS] 1.9 bundleManifest(name, negProfile, anchor) returns undefined for a package without dsh.bundle
```

另：harness 在 T2 之前的仓库副本上运行会失败在 1.3–1.6（见上文敏感性证明），即「改造前返回 undefined」已被双向证实。

### criterion 3 —— 仓库 overlay 用法不变：**通过**

```console
$ dsh --profile web --patch ~/temp/dsh-plugin-jev/dsh.patch.yml --dump-config
EXIT=0
587-# == ~/.dsh/profiles/web/cordis.patch.yml
588:- id: tool-jev
589-  name: file://~/temp/dsh-plugin-jev/lib/index.js
598-# == ~/temp/dsh-plugin-jev/dsh.patch.yml
599:- id: tool-jev
600-  name: file://~/temp/dsh-plugin-jev/lib/index.js
count id: tool-jev = 2
```

- 退出码 0 ✅，name 解析为 `file://~/temp/dsh-plugin-jev/lib/index.js` ✅
- **同时观察到 2 行 `id: tool-jev`**：web 的 user layer 自带同一行，本次 `--patch` 又把同一文件叠了一层。
  这不是缺陷，而是 criterion 7-(iv) 必须写进 README 的直接证据（见「发现 F2」）。
- 注：`dsh --dump-config` 会**无条件重写** `<profile>/cordis.yml` 为规范空根（内容为常量），因此 web/cordis.yml 的 mtime 会变、内容 hash 不变；
  criterion 8 监控的 `cordis.patch.yml` 与 `lib/index.js` 均未被触碰（见 criterion 8）。

### criterion 4 —— tarball 清单：**通过**

```console
$ cd $(mktemp -d) && npm pack --ignore-scripts ~/temp/dsh-plugin-jev
EXIT=0
dsh-plugin-jev-0.1.0.tgz
npm notice Tarball Contents
npm notice 1.1kB LICENSE
npm notice 15.2kB README.md
npm notice 816B dsh.patch.yml
npm notice 20.8kB lib/index.js
npm notice 720B package.json
npm notice total files: 5

$ tar -tzf dsh-plugin-jev-0.1.0.tgz | sort
package/LICENSE
package/README.md
package/dsh.patch.yml
package/lib/index.js
package/package.json
```

所需 4 条（dsh.patch.yml / lib/index.js / README.md / package.json）全部在包内 ✅；
多出的 `LICENSE` 是 npm 对 `license` 字段的标准行为，属**超集**，不构成失败。

### criterion 5 —— 失败路径（删掉 dsh 字段）：**通过**

前置关键点（实测）：plugin-manager 的 `reconcile()` 只遍历 `beforeDeps` **之外**的新增依赖，
所以该测试必须在「该包名还不是依赖」的新鲜 profile 上进行（否则连警告都不会打印）。因此先重置 jevtest。

```console
# 副本 A：保留原名 dsh-plugin-jev，仅删掉 dsh 字段
$ dsh plugin --profile jevtest add /tmp/t4-nodsh/pkg-samename
EXIT=0
--- stderr ---
dsh: initialized profile jevtest at ~/.dsh/profiles/jevtest
dsh: warning: dsh-plugin-jev declares no dsh.bundle — installed as a plain dependency, not a profile layer
--- bundles ---
["@deepseek-ai/dsh-base"]
--- dependencies ---
{"dsh-plugin-jev":"link:/tmp/t4-nodsh/pkg-samename"}
--- dump-config id: tool-jev 行数 ---
0

# 副本 B：异名 dsh-plugin-jev-nodsh（证明警告点名具体包、bundles 不新增“该包名”是真实断言）
$ dsh plugin --profile jevtest add /tmp/t4-nodsh/pkg-distinctname
EXIT=0
--- stderr ---
dsh: warning: dsh-plugin-jev-nodsh declares no dsh.bundle — installed as a plain dependency, not a profile layer
--- bundles ---
["@deepseek-ai/dsh-base"]
```

仓库本体未被改动（副本操作前后）：

```
03243e73e4165d4c2d88af07fc994ca43043031d4235eadb369111dcfbd4e0b0  package.json
124532697a4a36e2490e34ddffa8310f976ddf9b115358df3cd567d03086a004  dsh.patch.yml
f9b67f40923925d24424331e83eff48ee0fd77a9ed621602cf69c70674ac03b6  lib/index.js
```

随后用 `rm -rf ~/.dsh/profiles/jevtest` + 重新真装恢复并复验 criterion 1（第二次观察结果相同：bundles 含 `dsh-plugin-jev`、1 行、指向包内 lib/index.js）。

### criterion 6 —— 无回归：**通过**

```console
$ node test/smoke.mjs          ; EXIT=0 ; PASS 行数 = 72 ; 末行 "SMOKE OK (21 mock requests)"
$ node test/fixture-check.mjs  ; EXIT=0 ; PASS 行数 = 6  ; 末行 "FIXTURE OK"
$ node test/loader-overlay.mjs ; EXIT=0 ; PASS 行数 = 3  ; 末行 "LOADER OK"
```

`loader-overlay.mjs` 原文末三行：

```
PASS dsh --dump-config exits 0
PASS dump-config output contains tool-jev
PASS tool-jev name resolves to file://~/temp/dsh-plugin-jev/lib/index.js
```

断言数 72/6/3，与 criterion 6 要求一致；三套退出码均 0。

另跑本 agent 的 `node test/bundle-install.mjs`：`EXIT=0`，`PASS=37 FAIL=0 SKIP=0`。

### criterion 7 —— README 文档：**部分通过（唯一未满足项）**

| 子项 | 要求 | 判定 | 证据 |
|---|---|---|---|
| (i) | 正确命令 `dsh plugin --profile <name> add <spec>` | **通过** | README 出现 3 处；`dsh plugin --profile <name> <pnpm-args...>` 说明正确 |
| (ii) | `--profiles` 实测报错文案 | **通过** | README:53 `error: required option '--profile <name>' not specified` |
| (iii) | add 只装依赖、需 `dsh.bundle.patch` 或手写 insert 行 | **通过** | README:67 原文含 `dsh: warning: <pkg> declares no dsh.bundle — installed as a plain dependency, not a profile layer` |
| (iv) | bundle 安装后**必须删掉** user layer 里同 id 的绝对路径 insert 行，否则同 id 两行并存 | **失败（缺失）** | README 全文 grep `删/删除/旧行/重复/两条/同 id/migrat/duplicate` 计数 **0**（仅 `重启` 1 处、`两次` 1 处且与迁移无关） |

失败点定位：`README.md`「## 安装」章节（第 49–95 行）只写到「同一文件既能当仓库 overlay 也能当 bundle patch」，
**没有**任何「切换到 bundle 层前先删掉 `~/.dsh/profiles/<name>/cordis.patch.yml` 里同 id（tool-jev）的 insert 行」的步骤。
criterion 3 与 harness 3.4–3.7 已实测证明该风险真实存在（baseline 1 行 → 叠加 bundle 层后 2 行）。

> 按 SPEC 的 T5（task-5）分工，这一段由 Lead 在最终文档收尾时补写；本 agent **只报告、未修改 README**。

### criterion 8 —— 隔离与未改动证明：**通过**

```console
$ rm -rf ~/.dsh/profiles/jevtest
$ ls ~/.dsh/profiles/
headless  node_modules  web            # jevtest 已不存在
$ test -e ~/.dsh/profiles/jevtest && echo YES || echo NO
NO
```

被监控文件（验证开始前 vs 全部验证+清理后）：

| 文件 | 前 sha256 | 后 sha256 | 前 mtimeMs | 后 mtimeMs |
|---|---|---|---|---|
| `~/temp/dsh-plugin-jev/lib/index.js` | `f9b67f40…ac03b6` | `f9b67f40…ac03b6` | `1789913877` | `1789913877` |
| `~/.dsh/profiles/web/cordis.patch.yml` | `3ac312d4…81a66a` | `3ac312d4…81a66a` | `1789913761` | `1789913761` |

mtime 均为 `2026-09-20 22:17:57.446857782 +0800` / `2026-09-20 22:16:01.558570798 +0800`，**前后完全一致** ✅。

附带说明（非 criterion 8 监控对象，但如实记录）：`~/.dsh/profiles/web/cordis.yml` 的 **mtime 会变**（本次 22:39:22），
因为 dsh 的 `prepareProfile()` 在每次加载任何 profile（含 `--dump-config`）时都会把它重写为常量 `PROFILE_ROOT_CONFIG`。
其**内容 hash 恒定** `c300dcf2ebc5f02062d6591268d29d3db6fe45e0cb138f5467276fe2ba06076e`，且与 headless 的同名文件逐字节相同。
这是 dsh 既有行为，不是仓库缺陷，也不是任何一次 `--patch` 造成的编辑。本 agent 从未写过 `~/.dsh/profiles/web/**`。

### criterion 9 —— 独立性与可复现证据：**通过**

见上文「独立性声明」。本报告每条验收标准均附：可复现命令 + 原始输出片段；无一处使用「基本通过」这类模糊判定。

---

## 验证过程中发现的额外事实（只报告，未修改仓库）

### F1（操作陷阱，已实测复现）——已存在的普通依赖不会被再次 add 升级为 bundle 层

`reconcile()` 的循环是 `if (beforeDeps.has(name)) continue;`，即**只对本次新增的依赖**做 bundle 识别。
实测序列：

```
step0 rm -rf ~/.dsh/profiles/jevtest
step1 dsh plugin --profile jevtest add <无 dsh 字段的同名副本>
      exit=0  bundles=["@deepseek-ai/dsh-base"]  rows=0
step2 dsh plugin --profile jevtest add ~/temp/dsh-plugin-jev     # 包名已存在于 dependencies
      exit=0  bundles=["@deepseek-ai/dsh-base"]  rows=0     # ← 没有自动激活，也没有任何警告
      stdout: "+ dsh-plugin-jev link:../../../temp/dsh-plugin-jev"       # pnpm 确实换成了本仓库
step3 dsh plugin --profile jevtest remove dsh-plugin-jev
      exit=0  bundles=["@deepseek-ai/dsh-base"]
step4 dsh plugin --profile jevtest add ~/temp/dsh-plugin-jev
      exit=0  bundles=["@deepseek-ai/dsh-base","dsh-plugin-jev"]  rows=1   # ← 激活成功
```

**影响**：任何「先把 dsh-plugin-jev 装成普通依赖（改造前）→ 升级到含 `dsh.bundle.patch` 的版本 → 原地 `add` 一次」的路径，
**不会**自动激活插件（dump-config 里 `id: tool-jev` 为 0 行），而且**不会打印任何警告**。
可用规避：`dsh plugin --profile <p> remove dsh-plugin-jev` 后再 `add`（本报告 step3+step4 已验证有效），
或在 README 里写「删旧同 id 行 + 重启」之外再补一条「先 remove 再 add」。
这属 plugin-manager 的既有设计（reconcile 注释：*without re-enabling retained dependencies*），**不是本仓库的缺陷**，但会直接影响用户按 README 操作的成功率，故必须记录。

### F2（criterion 3/7-iv 的实证）——同 id 两行会并存

- `test/bundle-install.mjs` 3.2b：单文件内「绝对路径行 + 相对行」→ headless 上恰好 **2 行** `id: tool-jev`，
  分别解析到 `file://~/temp/dsh-plugin-jev/lib/index.js` 与 `file://<patch所在目录>/lib/index.js`（3.3）。
- 3.5–3.6：真实场景 `dsh --profile web --dump-config` baseline = **1 行**；加 bundle 层 patch 后 = **2 行**。
- 结论：从 user layer 绝对路径行迁到 bundle 层时，**必须先删旧行**，否则运行期两次 apply → 两次注册 `jev_decide`。
- SPEC `open_questions` 里「重复 id 行到底是注册冲突还是后者覆盖」——本轮只观察到**配置层两行并存**这一事实
  （与 SPEC context (c) 一致），**未**在运行期加载插件观察注册结果，故不对「冲突 or 覆盖」下结论；
  建议 README 按最保守写法（必须删旧行）记录，与 SPEC 的指示一致。

### F3（环境事实）——`--dump-config` 会重写 profile 根文件

见 criterion 8 的附带说明。任何「用 dump-config 证明某 profile 目录未被触碰」的写法都必须把
`cordis.yml` 排除在 mtime 监控之外（本 harness 正是这么做的：对 `cordis.yml` 只断言内容 hash + 内容等于规范空根）。

---

## 清理记录

| 项目 | 结果 |
|---|---|
| `~/.dsh/profiles/jevtest` | 已删除（`ls ~/.dsh/profiles/` 只剩 `headless node_modules web`） |
| `/tmp/t4-nodsh*`、`/tmp/t4-pack-*`、`/tmp/bv-mutant-*`、`/tmp/bv-probe*`、`/tmp/dsh-bundle-verify-*` | 已删除 |
| 本 agent 写入仓库的文件 | 仅 `test/bundle-install.mjs`（本报告 `reports/bundle-install-verification.md`） |
| 未写过的路径 | `package.json`、`README.md`、`dsh.patch.yml`、`lib/index.js`、`~/.dsh/profiles/web/**`（`git status` 佐证：这些文件的改动均来自 T1/T2） |

### 复现本报告所需的全部命令

```console
# 独立 harness（37 断言，零网络，自带 fixture 与清理）
cd ~/temp/dsh-plugin-jev && node test/bundle-install.mjs

# criterion 1：隔离真装
dsh plugin --profile jevtest add ~/temp/dsh-plugin-jev
cat ~/.dsh/profiles/jevtest/package.json
dsh --profile jevtest --dump-config | grep -c 'id: tool-jev'          # => 1
dsh --profile jevtest --dump-config | grep -A2 'id: tool-jev'         # name 指向该 profile 包内 lib/index.js

# criterion 2：真实代码路径（anchor 用 dsh 安装包的 package.json）
node --input-type=module -e '…bundleManifest("dsh-plugin-jev","~/.dsh/profiles/jevtest", anchor)…'

# criterion 3：overlay 不回归
dsh --profile web --patch ~/temp/dsh-plugin-jev/dsh.patch.yml --dump-config; echo $?

# criterion 4：tarball
cd $(mktemp -d) && npm pack --ignore-scripts ~/temp/dsh-plugin-jev && tar -tzf *.tgz

# criterion 5：失败路径（须在“该包名尚未成为依赖”的新鲜 profile 上）
rm -rf ~/.dsh/profiles/jevtest
dsh plugin --profile jevtest add <无 dsh 字段的副本>

# criterion 6：无回归
node test/smoke.mjs; node test/fixture-check.mjs; node test/loader-overlay.mjs

# criterion 8：清理与指纹
rm -rf ~/.dsh/profiles/jevtest
sha256sum ~/temp/dsh-plugin-jev/lib/index.js ~/.dsh/profiles/web/cordis.patch.yml
```

---

# 复核与修正记录（task-6，含 T5 对抗复核与 harness 修正）

本节为**追加**内容：上一节的 9 条判定与原始输出保持原样，未改写。本节记录两件事：
(a) 对 T5（README 收尾）的只读对抗复核发现与 Lead 的修正结果；(b) 本 agent 自己 harness 的一个计数瑕疵及修正。

## 1. 对 T5 README 的只读对抗复核（发现 → 修正 → 复验）

复核共提出 3 处必须改（A/B/C）、3 处措辞建议（D/E/F）。**全部 6 条已采纳并复验**。

### A（原本是过度声明 → 已解决）

- **原问题**：README 曾断言「运行期会两次 apply → 两次注册 jev_decide」。
  该断言**超出验证证据**：本报告只观察到**配置层**同 id 两行并存，明确未在运行期加载插件观察注册结果
  （SPEC `open_questions` 问的正是这个）。
- **修正后（README:105–107）**：

  ```
  1. **必须先删掉旧行**：删掉 ~/.dsh/profiles/<profile>/cordis.patch.yml 里那条同 id（tool-jev）
     的 insert 行。否则配置层会出现同 id 两行（实测：user layer 1 行 + bundle 层 1 行 = 2 行）；
     运行期是否会两次注册 jev_decide 本轮未验证，按最保守处理：必须删旧行。
  ```

- **复验判定：已解决 ✅**。`grep -nE "两次 apply|会两次"` 只命中这一处，且该处已带「本轮未验证」限定。
  SPEC criterion 7-(iv) 只要求写「同 id 两行并存」，此措辞满足且不越界。

### B（括注与实测不符 → 已解决）

- **原问题**：README 曾把 `loader-overlay.mjs` 与 `bundle-install.mjs` 归入同一括注
  「环境没有 dsh 时打印 SKIP 并以 0 退出」。实测 `bundle-install.mjs` 在无 dsh 时**判 FAIL 并 exit 1**：

  ```
  $ env -i HOME=$HOME PATH=/usr/bin:/bin node test/bundle-install.mjs ; echo EXIT=$?
  EXIT=1        # 修正前：PASS=14 FAIL=18 SKIP=0（1.2/1.8 等 5 条被静默漏计，总数 32 ≠ 37）
  $ env -i HOME=$HOME PATH=/usr/bin:/bin node test/loader-overlay.mjs ; echo EXIT=$?
  EXIT=0
  SKIP dsh is not installed on PATH      # test/loader-overlay.mjs:40-41
  ```

- **修正后（README:217–218）**：

  ```
  需要本机 dsh 的集成测试（`loader-overlay.mjs` 在没有 dsh 时打印 SKIP 并以 0 退出；
  `bundle-install.mjs` 需要 dsh，没有 dsh 时判 FAIL 并以 1 退出——不把「验证不到」当通过）：
  ```

  且 README:221 把断言数标注为「37 项断言（**正常环境**）」。
- **复验判定：已解决 ✅**。措辞与实测行为一致（无 dsh → 非 0 退出）。低价值残留：该括注未逐字提到
  「部分条目记 SKIP」，但「不把「验证不到」当通过」已覆盖语义，无需再改。

### C（web 专属路径属外推 → 已解决）

- **原问题**：方式四曾把实测数字与 `~/.dsh/profiles/web/node_modules/...`、`dsh --profile web --dump-config`
  绑定，但 criterion 1 强制在隔离 profile `jevtest` 上验证；web 上只验过 overlay 与 baseline。
  且「web 上恰好一行」若不先删方式二那行，实际是 **2 行**（已实测 baseline 1 + bundle 层 1 = 2），与注意 1 自相矛盾。
- **修正后（README:94–101）**：实测限定为「隔离 profile jevtest」，`dsh --profile jevtest --dump-config`，
  name 路径为 `~/.dsh/profiles/jevtest/node_modules/dsh-plugin-jev/lib/index.js`，并加括注：

  ```
  （web 上未重复实测；web 若保留方式二那行就是 2 行，见注意 1。验收细节与原始输出见
  reports/bundle-install-verification.md。）
  ```

- **复验判定：已解决 ✅**（README:94–101）。残留（低严重度、无需改）：README:111 的
  `dsh plugin --profile web remove dsh-plugin-jev` 演示命令用的是 `web`，而 remove→add 循环是在
  `jevtest` 上实测的；这与方式四的示例约定一致，且机制与 profile 无关，不构成过度声明。

### D / E / F（措辞建议 → 均已采纳）

| 项 | 原措辞 | 修正后 | 判定 |
|---|---|---|---|
| D | 「2026-09-20 独立验证通过」 | README:90「已在隔离 profile jevtest 上独立验证通过」 | 已解决 ✅（并消除了「在 web 上验过」的误读） |
| E | 「481ms，无网络」 | README:95「本次 481ms、耗时随环境波动；无需联网——包无依赖，pnpm 未发生 fetch」 | 已解决 ✅（单次耗时与「未抓包」均已如实限定） |
| F | 注意 3 含「新的 JS 模块实例」且与文末 patchReload 句重复 | README:112「bundle 层是启动期解析的层，重启后更稳妥」；README:123–124 合并去重 | 已解决 ✅（删除了无证据的解释性断言） |

### 复核中未发现的其他问题

- README:43、221–222 对 `test/bundle-install.mjs` 覆盖范围的描述（bundle 层识别 / 包内相对 name 解析 /
  同 id 两行风险 / 仓库文件未被改动 / 零网络 / 零第三方依赖）与本 harness 实际断言一致。
- 数字 72 / 6 / 3 / 37 本轮再次确认与本 agent 的观察一致，四条 exit=0。
- criterion 7 的四个子项在修正后全部具备（(iv) 见 README:103–107），**criterion 7 由「部分通过」升级为通过**。
  上一节的原始判定保留为历史记录（当时 (iv) 确实缺失），此处记录其后续状态。

## 2. 本 harness 的计数瑕疵与修正（task-6 授权修改）

- **问题**（由本 agent 自查发现并如实上报）：正常环境下共 37 条断言，但降级环境（PATH 无 `dsh`）下
  **E.3 / E.4 / E.5 / 1.2 / 1.8 这 5 条是条件守卫、既不 PASS 也不 FAIL**，被静默漏计，
  导致 `PASS=14 FAIL=18 SKIP=0`（合计 32 ≠ 37），汇总数字不自洽。
- **修正**：为这 5 条补齐 `else` 分支，语义定为 **SKIP**（前置条件「本机 dsh 安装」不存在，断言无法求值）。
  SKIP 只在**前置整体缺失**时使用；若 dsh 存在但 `bundleManifest` / `resolveBundleDir` 解析失败，
  仍走原来的 **FAIL** 分支（不把「环境坏了」伪装成 SKIP）。
  修正只改了降级路径，正常路径断言与结论未变。
- **修正后双环境原始输出**：

  环境 1（PATH 有 dsh，正常）：

  ```
  $ node test/bundle-install.mjs ; echo EXIT=$?
  EXIT=0

  == summary ==
  PASS=37 FAIL=0 SKIP=0
  cleaned scratch dir: /tmp/dsh-bundle-verify-j0TeWW
  ```

  环境 2（`env -i HOME=$HOME PATH=/usr/bin:/bin`，无 dsh）：

  ```
  $ env -i HOME=$HOME PATH=/usr/bin:/bin node test/bundle-install.mjs ; echo EXIT=$?
  EXIT=1
  [PASS] E.1 repo package.json parses as an object
  [FAIL] E.2 dsh shim is on PATH
  [SKIP] E.3 dsh package directory resolved from the shim target
  [SKIP] E.4 plugin-manager operations.bundleManifest is a function (real code path)
  [SKIP] E.5 dsh-app-boot exposes resolveBundleDir + loadOverlayPatches
  [SKIP] 1.2 resolveBundleDir resolves the symlinked package under the fake profile
  [SKIP] 1.8 negative fixture package still RESOLVES (so undefined below is a missing-field result, not a resolution failure)
  …
  == summary ==
  PASS=14 FAIL=18 SKIP=5
  ```

- **达标核对**：环境 1 → `PASS=37 FAIL=0 SKIP=0`、exit 0 ✅；环境 2 → `37 = 14 + 18 + 5` 自洽、exit 1 ✅
  （「验证不到」未被当作通过）。
- 复验命令（可复现）：

  ```console
  cd ~/temp/dsh-plugin-jev
  node test/bundle-install.mjs ; echo "EXIT=$?"
  env -i HOME=$HOME PATH=/usr/bin:/bin "$(command -v node)" test/bundle-install.mjs ; echo "EXIT=$?"
  ```

## 3. 本轮未改动的东西

- 只改了 `test/bundle-install.mjs`（上述 5 条 else 分支）并追加本报告；`README.md` 为**只读复核**，未改一字。
- 未碰 `package.json` / `dsh.patch.yml` / `lib/index.js` / `~/.dsh/profiles/web/**`。
- 本轮未创建 `~/.dsh/profiles/jevtest`（harness 只用 `--profile headless` / `--profile web` 做 dump-config 与
  自身 mkdtemp 内的假 profile 布局），因此无需清理 profile；scratch 目录由 harness 自行删除。
