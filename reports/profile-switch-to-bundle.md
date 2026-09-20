# web profile 切换到 bundle 安装（2026-09-20）

> 脱敏说明（2026-09-20，公开仓库）：本文件把绝对路径 `/home/<user>/…` 统一写成 `~/…`，并把备份目录的
> 时间戳写成 `<timestamp>`（真实目录用 `ls -d /tmp/jev-switch-*` 查），其余内容未改写。

本文件记录一次**部署侧变更**（发生在 ~/.dsh/profiles/web，不在本仓库内），以及它的证据与回滚方式。
对应 SPEC：`specs/feature-jev-bundle-install.yaml`（v3 起把这条 open_question 标记为已执行）。

## 变更前

- 插件行由 profile 用户层的一条 **insert** 提供，`name` 指向仓库绝对路径：
  `~/.dsh/profiles/web/cordis.patch.yml` → `name: '~/temp/dsh-plugin-jev/lib/index.js'`
- `sha256(cordis.patch.yml)` = `3ac312d4562e6f69ca2f8d2e0e1f59070df2db294964477dd3153fc5a581a66a`
- web bundles = `[@deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app, @deepseek-ai/dsh-experimental-agent-team-profile, @deepseek-ai/dsh-experimental-agent-team-web-profile]`
- `dsh --profile web --dump-config` 里 `id: tool-jev` **1 行**，config =
  `transport: typesafe / baseURL: https://api.typesafe.ai / model: jev-latest /
  keyFile: ~/.config/typesafe/key / apiKeyEnv: TYPESAFE_API_KEY / timeoutMs: 60000 / retries: 1`

## 执行的步骤

1. 备份到 `/tmp/jev-switch-<timestamp>/`（`cordis.patch.yml.before`、`package.json.before`）。
2. 删除用户层里那条 `insert` 行（改为注释说明迁移）。
3. `plugin_manager install_bundle`，target = `~/temp/dsh-plugin-jev`：

   ```json
   {"stage":"enable","target":"dsh-plugin-jev","enabled":true,"changed":true,
    "application":"applied",
    "packageResult":{"exitCode":0,"output":"... + dsh-plugin-jev link:../../../temp/dsh-plugin-jev ... Done in 796ms using pnpm v12.3.4"}}
   ```

4. 因 bundle 层的 `dsh.patch.yml` 只设 `transport/model/apiKeyEnv/timeoutMs`（`retries` 走插件默认 0，
   而旧行是 1），在用户层补一条 `id: tool-jev` 的**完整 config 覆盖**，把行为拉回逐字一致。

## 变更后（实测）

- `dsh --profile web --dump-config`：

  ```
  # == dsh-plugin-jev, patched by ~/.dsh/profiles/web/cordis.patch.yml
  - id: tool-jev
    name: file://~/.dsh/profiles/web/node_modules/dsh-plugin-jev/lib/index.js
    config:
      transport: typesafe
      baseURL: https://api.typesafe.ai
      model: jev-latest
      keyFile: ~/.config/typesafe/key
      apiKeyEnv: TYPESAFE_API_KEY
      timeoutMs: 60000
      retries: 1
  ```

- `id: tool-jev` **恰好 1 行**；`name` 由 bundle 层提供（profile 内包副本，`link:` 到仓库）；
  config 与变更前**逐字一致**（含 `retries: 1`）。
- 层标记 `# == dsh-plugin-jev, patched by ~/.dsh/profiles/web/cordis.patch.yml` 证明组合方式是
  「bundle 层提供行 + 用户层打补丁」。
- web bundles 末尾新增 `dsh-plugin-jev`；`dependencies` 新增 `"dsh-plugin-jev": "link:~/temp/dsh-plugin-jev"`。
- **实时生效、未重启**：变更后在同一运行会话里调用 `jev_decide` 成功返回 `model: jev-1.13.0`
  （工具未注册时会直接报错，所以这是一次真实的注册验证）。

## 本轮新发现（已写进 README 方式四「注意 4」）

loader 的裸 `id:` 覆盖是**整份替换** config，不是字段合并。子进程实测：只写
`- id: tool-jev / config: {retries: 5}`，该行的 `baseURL/keyFile/model/apiKeyEnv/timeoutMs`
全部消失，只剩 `retries`。因此从方式二迁移且想保留原配置的人，必须把完整 config 抄进用户层。

同时修正了 README 方式四「注意 3」：是否重启取决于安装路径 ——
`plugin_manager install_bundle` 实时生效（本次实测），CLI `dsh plugin … add` 需要重启。

## 回滚

```bash
# 方式 A：整份恢复（推荐）
cp /tmp/jev-switch-<timestamp>/cordis.patch.yml.before ~/.dsh/profiles/web/cordis.patch.yml
cp /tmp/jev-switch-<timestamp>/package.json.before   ~/.dsh/profiles/web/package.json
# 方式 B：只把插件从 bundle 层移回用户层
#   1) 编辑 cordis.patch.yml：删掉 `- id: tool-jev` 覆盖块，改回原来的 `- insert:` 块
#      （内容见本文件「变更前」与 git 历史）
#   2) plugin_manager remove_bundle dsh-plugin-jev
```

回滚后 `dsh --profile web --dump-config` 应重新出现 `name: file://~/temp/dsh-plugin-jev/lib/index.js`，
且 `id: tool-jev` 仍为 1 行。

## 注意

`link:` 安装意味着 profile 里的包是**指向本仓库的符号链接**：仓库的 `lib/index.js` 改了会即时生效
（开发方便），但仓库被移动或删除会同时打断 profile。要改回「仓库位置无关」，可把包发到 registry 后
用 `dsh plugin --profile web add dsh-plugin-jev` 覆盖安装。
