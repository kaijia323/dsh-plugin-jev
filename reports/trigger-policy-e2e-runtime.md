# trigger-policy 运行期端到端证据（Lead 独立执行）

- 日期：2026-09-20
- 执行者：Lead（非 impl-plugin / tests-author / verifier 中任何一方）
- 目的：验证 spec `specs/feature-jev-trigger-policy.yaml` 的 A/B 两个触发面
  **在真实 Cordis host 上下文里确实生效**，特别是 B 面依赖的
  `ctx.inject(["systemPrompt"], cb)` 是否真的会 fire（这一点单元测试无法证明）。
- 结论：**两面具已运行期证实**。撰写时正在服务的 web host 仍是旧 JS（`restart-required`）；
  用户随后重启了 host，**追加核对见文末「重启后复核」** —— A 面已在真实 web host 上生效。
- 脱敏说明：本报告初稿里的本机绝对路径已统一改写为 `~/…`；`/tmp/…` 是临时工作目录，保持不变。

## 方法（不碰 web profile、不装包、不起服务）

用 headless profile + `--patch` 覆盖，把本仓库作为 overlay 插进一次真实启动：

```bash
mkdir -p /tmp/jev-e2e && cd /tmp/jev-e2e
dsh --profile headless --patch ~/temp/dsh-plugin-jev/dsh.patch.yml "Respond with exactly: OK"
# → EXIT=0，模型正常作答 OK
```

`--patch` 的 `name: './lib/index.js'` 按 patch 文件所在目录解析 →
`~/temp/dsh-plugin-jev/lib/index.js`（即被测代码本体）。
该路径**不写任何 profile 文件、不安装任何包、不启动任何服务器**，与正在服务
`127.0.0.1:3080` 的 web host 完全隔离。

会话日志：`~/.dsh/sessions/--tmp-jev-e2e--/session-7d0d10c1-f832-4849-b2e9-fad779e0617b/session.v3.jsonl.zstd`
（多帧 zstd，需逐帧解压后按行 JSON 解析 —— 单帧解码器只会读出第一帧。）

## 证据 A：工具描述进入真实请求的 tools 表

从会话日志的 `request/header` 记录中读出模型实际收到的工具表：

```
tools in request: ["bash","create_goal","edit","exit_plan_mode","get_goal","glob","grep",
"interrupt_agent","jev_decide","job_kill","job_list","job_output","list_agents","read",
"read_image","send_message","skill","subagent","subagent_fork","todo_write","update_goal",
"web_fetch","web_search","workflow","write"]

jev description length: 1441
A anchors: When to use=true  Exempt only when=true  Decision moments=true  Budget:=true
```

即：新描述（1441 字符，四条政策锚点齐备）**确实随请求发给了模型**，不是只存在于源码里。

## 证据 B：常驻 prompt section 进入真实系统提示词

从 `system/message` 记录中抽取（原文逐字，未改写）：

```
## Jev decision policy

Use jev_decide for typed judgments: it returns a typed answer plus a calibrated confidence, never prose.

When to use: call jev_decide whenever the answer is a judgment, not a lookup. Default: ask Jev before turning a judgment about meaning, intent, relevance, fit, or risk into a conclusion. Exempt only when the answer is fixed by an explicit instruction, a mechanical check, readable file or command output, or the caller's own decision. Decision moments: two self-consistent options; meaning, intent, or relevance; classifying or routing; rubric scoring; a calibrated yes/no; a long or ambiguous state; an irreversible next step. Budget: one call carries one state plus every question about it; keep criteria concrete.

In PTC mode call jev_decide from inside a run_code program, not as a top-level tool call.
```

这一条同时证明了三件单元测试证明不了的事：

1. `ctx.inject(["systemPrompt"], …)` 在本部署的真实插件上下文里**可用且会触发**
   （此前只有 `@deepseek-ai/dsh-schedule` / `@deepseek-ai/dsh-mcp-resources` 的同款先例作为间接依据）；
2. 插件以 host 层 bundle 身份注册的 section **对该会话全局可见**，无需任何 preset 改动；
3. `order` 解析与 `interpolate: false` 下的 `{{ }}` 行为在真实装配中没有出错（正文原样出现）。

## 未证实 / 限制（如实记录）

- **正在服务的 web host 未热加载新 JS**：`cordis_inspect_query` (host / Tool / listTools)
  读到的 `jev_decide` 描述仍是旧文本，B 面在该 host 上同样尚未注册。
  与加载器源码一致：profile HMR 只监听 `package.json` 的 bundles 列表与 patch 文件
  （`@deepseek-ai/dsh-hmr` 的 `refresh()`/`watchConfig()`），**不监听插件包的 `lib/*.js`**。
- 本次 e2e 走的是 headless profile 的真实启动，**不是** web profile 的同一进程；
  因此它证明的是"代码在真实 host 语境下正确"，不等于"用户当前那个 host 已生效"。
- 按 SPEC 约束，**未重启 web host**；该结论记为 `restart-required`，由用户决定何时重启。
- 本次 e2e 的 cwd 为 `/tmp/jev-e2e`，未在项目工作目录产生副作用；除会话日志外无写入。

## 重启后复核（用户重启 web host 之后由 Lead 追加）

用户重启 host 后，对**正在服务 127.0.0.1:3080 的那个进程**做只读核对：

```
cordis_inspect_query(platform=host, provider=Tool, method=listTools)
→ jev_decide.description 长度 = 1441，四个政策锚点齐备：
   "When to use"=true  "Exempt only when"=true  "Decision moments"=true  "Budget:"=true
   （重启前同一查询读到的是旧文本 1185 字符，五个新锚点全 false）
```

即 **A 面在真实 web host 上已生效**，上面「restart-required」一条就此关闭。
B 面与 A 面出自同一模块、同一 `apply()`；Inspect 只提供工具目录、没有列出 prompt section 的只读方法，
因此 B 面在 web host 上的生效由「同一模块代已加载」推断，而非直接观测 —— 这一限制如实保留。
加载器不监听插件包 `lib/*.js` 的结论仍然成立：本次生效来自**用户重启**，不是热加载。

## 复现命令

```bash
# 1) 运行期 e2e（约一次极小模型调用）
mkdir -p /tmp/jev-e2e && cd /tmp/jev-e2e
dsh --profile headless --patch ~/temp/dsh-plugin-jev/dsh.patch.yml "Respond with exactly: OK"

# 2) 从会话日志核对 A/B 两面
#    注意：session.v3.jsonl.zstd 是「多个 zstd 帧拼接」的文件，
#    node:zlib 的 zstdDecompressSync 只解第一帧（只会得到 session 头），
#    必须按 magic 28 b5 2f fd 切帧后逐帧解压。内联解码器：
node -e '
const {readFileSync}=require("node:fs"),{zstdDecompressSync}=require("node:zlib");
const MAGIC=Buffer.from("28b52ffd","hex");
const decode=(p)=>{const b=readFileSync(p);const out=[];let i=b.indexOf(MAGIC);
  while(i!==-1){try{out.push(zstdDecompressSync(b.subarray(i)).toString("utf8"))}catch{}i=b.indexOf(MAGIC,i+1)}
  return out.join("")};
const recs=decode(process.argv[1]).split("\n").filter(Boolean).map(l=>JSON.parse(l));
const hdr=recs.find(r=>r.type==="request/header");
const d=hdr.data.header.tools.find(t=>t.name==="jev_decide").description||"";
console.log("A: len="+d.length, ["When to use","Exempt only when","Decision moments","Budget:"].map(a=>a+"="+d.includes(a)).join(" "));
const sys=recs.filter(r=>r.type==="system/message").map(r=>(r.data.message.content||[]).map(c=>c.text||"").join("")).join("");
console.log("B present:", sys.includes("## Jev decision policy"));
' ~/.dsh/sessions/--tmp-jev-e2e--/*/session.v3.jsonl.zstd
```
