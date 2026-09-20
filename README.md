# dsh-plugin-jev

把 TypeSafe 的 Jev（System One 决策模型）接进 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，
注册一个原生工具 jev_decide。

## 为什么是工具，不是模型

Jev 不生成文本：它接收 state + 类型化问题，返回类型化答案与校准置信度，接口不是
Chat Completions / Anthropic Messages。DSH 的 LLM seam 需要流式文本与 tool_calls，
所以 Jev 不能当主模型；正确的接法是把它做成工具。

本插件零依赖：不 import 任何 @deepseek-ai 包，而是通过 ctx.tools.register 注册一个符合
DSH 强制 JSON Schema 子集（JsonSchemaNode）的原始工具定义——这正是 MCP 工具走的注册路径。

## 触发政策：插件自己声明「何时该用」（A/B 两个面）

历史问题是「插件已装、工具可调用，但没人告诉模型什么时候该用它」。本插件不再把「何时用」
埋在文档里，而是自己声明一份政策，并同时挂到两个面上：

    A  工具描述       jev_decide.description 以政策开头，顺序为：用途 -> 默认开判据 ->
                      四条豁免 -> 七个决策时刻 -> 预算 -> 既有问题语法与返回形状。
                      native 模式下模型直接在工具目录里看到；PTC 模式下它进一步退化为
                      生成式 SDK 里的一行 JSDoc（@deepseek-ai/dsh-tools 的 renderToolsSdk）。
    B  常驻政策段     插件用官方惯用的可选依赖写法 ctx.inject(['systemPrompt'], cb) 注册一个
                      名为 jev-decision-policy 的 prompt section（interpolate:false）。
                      本仓库是 host 层 bundle，因此该 section 对 web profile 的**每个会话全局
                      生效**，无需模型先「发现」这个工具。

A 与 B 的政策正文由 lib/index.js 里同一组 POLICY 常量拼装（policyBlock()），不会出现两处
各写一份而漂移；B 只额外加「工具返回类型化答案」与「PTC 下须在 run_code 程序内调用」两句。
两者都不发网络请求：section 的 text 必须是同步字符串，政策是静态文本。

政策本体：

    默认开   只要答案是一个判断而非一次查找，先问 Jev —— meaning / intent / relevance /
             fit / risk 这类结论，默认都要先过一次 Jev。
    四条豁免 ①答案已被上下文里的明确指示固定 ②有可自跑的机械检查 ③有可读的文件或命令输出
             ④调用方已经自己决定。
    七个时刻 ①两个（或更多）都能自洽的方案 ②含义 / 意图 / 相关性 ③分类或路由
             ④按 rubric 打分 ⑤需要校准的 yes-no 或概率 ⑥又长又含混的状态
             ⑦下一步不可逆或昂贵。
    预算     一次调用带一个 state 加它的全部问题；criteria 写具体；不要把问题拆到多次调用里。

常驻 token 预算：description ≤1500 字符（当前约 1.4k），section 正文 ≤1200 字符（当前约 0.8k）；
测试对四条锚点（When to use / Exempt only when / Decision moments / Budget:）与两个长度上限
都有断言。B 面可用 config.policySection 关闭或改序位，见「配置」章节。

## 官方传输（唯一）

    transport: typesafe    官方 TypeSafe API
                           POST {baseURL}/v1/systemone
                           body { state, questions, model }
                           问句类型 choice | score | noul（boolean 是等分别名）
                           需要 TypeSafe API key

    baseURL  默认 https://api.typesafe.ai
    model    默认 jev-latest

2026-09-20 实测：POST https://api.typesafe.ai/v1/systemone，body {state, questions, model}，
model=jev-latest 由服务端解析为 jev-1.13.0；单次调用 0.5–0.6s；连续 4 次调用全部 HTTP 200。
响应形如 {"model":"jev-1.13.0","answers":{…},"usage":{…}}，插件把它原样返回，不改写形状。

写成 noul 还是 boolean 都可以：noul 是 canonical 类型，boolean 只是别名，插件在构造请求前
统一归一化为 noul。仓库里只有这一条传输路径。

## 文件

    package.json             包元数据（type: module, main: lib/index.js）
    lib/index.js             插件本体：name / inject / apply，注册 jev_decide
    dsh.patch.yml            overlay 示例（官方 TypeSafe 传输）
    examples/                confidence-gated routing 说明与示例（走官方 API）
    test/smoke.mjs           冒烟测试：mock 官方端点，无需 dsh、无需密钥
    test/policy-section.mjs  触发政策测试：A 面描述锚点与长度、B 面 section 的延迟注册与边界
    test/mock-typesafe.mjs   假端点 fixture：由 test/fixture-check.mjs 驱动，也可手动演练
    test/fixture-check.mjs   启动并校验 mock-typesafe.mjs 的 fixture 检查
    test/loader-overlay.mjs  可选集成测试：真实 dsh --dump-config 解析 overlay
    test/bundle-install.mjs  独立验证器：bundle 层识别、包内相对 name 解析、同 id 两行风险
    LICENSE                  MIT
    .gitignore

发布产物（`npm pack`）只含 lib/、README.md、LICENSE、package.json 与 dsh.patch.yml
（见 package.json 的 files 字段）；test/ 与 examples/ 不随包发布。

## 安装

前提：`dsh plugin` 只认 `--profile`（单数）且必须显式给；写成复数会直接失败
（2026-09-20 实测，退出码 1）：

    $ dsh plugin --profiles web
    error: required option '--profile <name>' not specified

`dsh plugin` 本身只是把剩余参数转发给 profile 目录里的 pnpm：

    dsh plugin --profile <name> <pnpm-args...>   # add <spec> / remove <spec> / why <spec> ...

**关键语义**：`dsh plugin --profile <name> add <spec>` 只负责把包装进 profile 的
node_modules；它会不会顺带被激活，取决于这个包自己有没有声明 bundle 层：

- 包在 package.json 里声明了 `dsh.bundle.patch`（本仓库自 2026-09-20 起声明为 `./dsh.patch.yml`，
  见 package.json 的 dsh 字段）：plugin-manager 会把**本次新增**的依赖自动选成 profile 层，
  插件随之注册。
- 没声明：只当普通依赖装上，plugin-manager 会打印
  `dsh: warning: <pkg> declares no dsh.bundle — installed as a plain dependency, not a profile layer`，
  插件**不会**注册，必须自己再写一条 insert 行（entry 的 name 写包名）。

四种装法：

方式一：不落盘，用 overlay 启动（在克隆下来的仓库根目录执行）

    dsh web --patch "$(pwd)/dsh.patch.yml"

方式二：写进用户 patch 层，永久生效
把 overlay 里的 insert 行追加到 ~/.dsh/profiles/web/cordis.patch.yml。
必须是 insert 行：裸的 "id: tool-jev" 只会去覆盖已存在条目并打印警告。
注意 name 用仓库里的绝对路径，例如 /path/to/dsh-plugin-jev/lib/index.js。

方式三：当包安装进 profile

    dsh plugin --profile web add /path/to/dsh-plugin-jev

装完要不要再手写 insert 行，按上面「关键语义」判断：包声明了 dsh.bundle.patch 就自动激活，
否则把 insert 行抄进 profile patch（name 写包名）。

方式四：一条命令装包并激活（推荐；已在隔离 profile jevtest 上独立验证通过）

    同上命令即可：dsh plugin --profile web add /path/to/dsh-plugin-jev

本仓库声明了 dsh.bundle.patch，所以这条命令装完即生效。实测（隔离 profile jevtest，
pnpm v12.3.4，本地路径按 `link:` 处理，本次 481ms、耗时随环境波动；无需联网——包无依赖，
pnpm 未发生 fetch）：该 profile 的 dsh.profile.bundles 变为
`["@deepseek-ai/dsh-base", "dsh-plugin-jev"]`；`dsh --profile jevtest --dump-config` 里
`id: tool-jev` **恰好一行**，name 解析到
`~/.dsh/profiles/jevtest/node_modules/dsh-plugin-jev/lib/index.js`，并带 `# == dsh-plugin-jev` 层标记。
（web 上未重复实测；web 若保留方式二那行就是 2 行，见注意 1。验收细节与原始输出见
reports/bundle-install-verification.md。）

从方式二（手写 insert 行）迁到方式四，四条注意：

1. **必须先删掉旧行**：删掉 ~/.dsh/profiles/<profile>/cordis.patch.yml 里那条同 id（tool-jev）
   的 insert 行。否则配置层会出现同 id 两行（实测：user layer 1 行 + bundle 层 1 行 = 2 行）；
   运行期是否会两次注册 jev_decide 本轮未验证，按最保守处理：必须删旧行。
2. **已经是普通依赖时要先 remove 再 add**：plugin-manager 的 reconcile 只识别**本次新增**的依赖
   （源码注释 "without re-enabling retained dependencies"）。若该包名早已作为普通依赖存在，
   直接 add 不会激活、也不会打印任何警告（实测 bundles 不变、`id: tool-jev` 0 行）；
   先 `dsh plugin --profile web remove dsh-plugin-jev`，再 add 才会激活。
3. **要不要重启取决于走哪条安装路径**（2026-09-20 实测）：
   - `plugin_manager install_bundle`（Harness 内）**实时生效、无需重启**：返回
     `application: applied` 之后，运行中的会话立刻就能调用 jev_decide（同一会话实测调用成功）。
   - `dsh plugin --profile <profile> add`（CLI）只把包写进 profile，跑着的进程不会知道多了一个
     bundle 层，需要重启一次 dsh web。
4. **在用户层改配置时必须重写整份 config**：loader 的裸 `id:` 覆盖是**整份替换**，不是字段合并。
   实测：只写 `- id: tool-jev` + `config: {retries: 5}`，该行的 baseURL / keyFile / model /
   apiKeyEnv / timeoutMs 全部消失，只剩 retries。bundle 层的 dsh.patch.yml 只设了
   transport / model / apiKeyEnv / timeoutMs（其余走插件默认值），所以如果你原来在旧 insert 行里
   写过别的值（例如 `retries: 1`，而插件默认是 0），装完 bundle 后要把它连同完整 config 抄进用户层：

       - id: tool-jev
         config:
           transport: typesafe
           baseURL: https://api.typesafe.ai
           model: jev-latest
           keyFile: ~/.config/typesafe/key
           apiKeyEnv: TYPESAFE_API_KEY
           timeoutMs: 60000
           retries: 1

另注：`dsh --dump-config` 会把 <profile>/cordis.yml 重写为规范空根（prepareProfile 的既有行为），
因此那个文件的 mtime 必然变化、内容恒定；cordis.patch.yml 与仓库文件不受影响。

package.json 的 files 已包含 dsh.patch.yml，它会随 `npm pack` 发布。patch 里 name 写的是相对路径
`./lib/index.js`，而相对 name 按 **patch 文件所在目录**解析（2026-09-20 实测：patch 放在
/tmp/bt/pkg/ 下时解析为 file:///tmp/bt/pkg/lib/index.js），所以同一个文件既能当仓库 overlay
（解析到 <仓库>/lib/index.js），也能当安装在包里的 bundle patch（解析到
node_modules/dsh-plugin-jev/lib/index.js）。

web profile 是 patchReload: live，patch 改动热重载；bundle 层与新增依赖包建议重启一次
dsh web（同方式四注意 3）。

## 配置

    transport                 默认 typesafe         只接受 typesafe；写入已移除的旧传输名会在注册阶段报错（含 'removed'）
    baseURL                   默认 https://api.typesafe.ai  官方端点根地址
    model                     默认 jev-latest        请求 body 里的 model
    apiKeyEnv                 默认 TYPESAFE_API_KEY  首选密钥环境变量名
    keyFile                   默认 ~/.config/typesafe/key
    timeoutMs                 默认 60000             单次 HTTP 请求超时
    toolTimeoutMs             默认 timeoutMs*(retries+1)+5000   注册表工具级超时
    retries                   默认 0                 仅对超时/网络/5xx 重试，4xx（含 429）永不重试
    maxStateBytes             默认 262144            state 字节上限
    maxQuestions              默认 64                单次问题数上限
    policySection             可选，默认 { enabled: true, order: getSectionOrder('MCP_SERVERS') + 10 }
                              enabled:false 时不注册 B 面常驻政策段；order 必须是有限数

timeoutMs / toolTimeoutMs / maxStateBytes / maxQuestions 必须是正有限数，retries 必须是非负整数；
否则 apply() 在注册阶段就抛错（例如 `tool-jev: timeoutMs must be a positive finite number`）。

policySection 只控制 B 面（常驻政策段），不影响 A 面描述与工具本身，字段全部可选：

    policySection.enabled    默认 true。写成 false 时插件仍正常注册 jev_decide（工具目录不变，
                             避免抖动破坏请求缓存），只是零次注册 jev-decision-policy section。
    policySection.order      默认 ctx.systemPrompt.getSectionOrder('MCP_SERVERS') + 10（当前中央
                             序位表下 MCP_SERVERS = 3100，即默认 3110；位于 MCP 段与 TOOLS_SDK
                             之间）。显式写入的有限数原样使用（可为负）；缺省值延迟到有 ctx 时才
                             求值。getSectionOrder 抛错或返回非有限值时回退常量 3110，且不阻断
                             工具注册。

enabled 必须是 boolean、order 必须是有限数，否则 apply() 在注册阶段抛 'tool-jev:' 前缀的 Error
（如 `tool-jev: policySection.order must be a finite number`）。字段整体缺省即 enabled:true，
所以不改任何 profile 文件也能获得 B 面；若在用户层写 `id: tool-jev` 覆盖，注意那是整份替换
config，但 policySection 缺省仍按默认值生效（见「安装」注意事项 4）。

密钥解析顺序：$apiKeyEnv -> $JEV_API_KEY -> keyFile。密钥永远不作为工具参数传入，因此不会
进入对话记录。推荐放文件：

    mkdir -p ~/.config/typesafe && printf '%s' 'apikey_...' > ~/.config/typesafe/key && chmod 600 ~/.config/typesafe/key

（上面是占位符，请替换成真实 key；key 不要写进仓库任何文件。）

## 工具契约

    jev_decide(state: string, questions: object, model?: string)

questions 的键由调用方自定，值与 criteria 的形状是精确契约：

    { "type": "choice", "instructions": "...", "criteria": { "option_key": "含义" } }
        criteria 必须是非空对象（option_key -> 含义）；数组 / 字符串 / null 会被本地拒绝
        -> answers[key].choice + probabilities + confidence
    { "type": "score",  "instructions": "...", "criteria": ["等级0含义", "等级1含义"] }
        criteria 必须是非空数组；对象会被本地拒绝
        -> answers[key].score + legend（或 probabilities）+ confidence
    { "type": "noul" | "boolean", "instructions": "yes/no 问题" }
        noul 是 canonical 类型，boolean 是等分别名，发出前统一归一化为 noul
        -> answers[key].noul（yes 的概率），实测该条目只有 type 与 noul，不带 confidence

工具返回提供方响应体，渲染为一份 JSON 文本块。执行前本地校验（都在发请求之前，因此不会
消耗额度）：state 非空且不超字节上限、questions 非空且数量受限、type 必须是 choice | score |
noul（boolean 归一化为 noul）、choice/score 的 criteria 必须匹配上面两种形状、instructions 非空。
错误文案与实测一致，例如：

    tool-jev: state must be a non-empty string
    tool-jev: state is 300000 bytes, over maxStateBytes 262144
    tool-jev: at most 64 questions per call (got 65)
    tool-jev: questions.q.criteria must be a non-empty object mapping option_key to meaning for a choice question (got null)
    tool-jev: questions.q.criteria must be a non-empty array of level meanings for a score question (got an object)

响应信封同样校验：缺少 answers 对象的响应（`{}`、数组等）会让工具直接失败，不会把
undefined 交给模型。

## Confidence-gated routing

- examples/confidence-routing.md：confidence 决定「能不能无人值守执行」的三档策略
  （>=0.8 自动 / >=0.5 升级复核 / 否则转人工）、如何用标注数据标定阈值。官方 API 把
  confidence 放在 answers[key].confidence。
- examples/route-demo.mjs：三档策略与阈值扫描的可运行实现，直接调用官方 API
  （POST https://api.typesafe.ai/v1/systemone，body 带 model）。默认两个内置样例各调用
  一次官方 API；--calibrate 按 JEV_CALIBRATE_LIMIT 真实调用官方 API 做阈值扫描。

    环境变量：JEV_AUTO_THRESHOLD / JEV_REVIEW_THRESHOLD 调阈值，
    JEV_CALIBRATE_LIMIT 限制样本数，JEV_SAMPLE_DELAY_MS 控制样本间隔；
    TYPESAFE_KEY_FILE 指向密钥文件，默认 ~/.config/typesafe/key。

## 迁移说明：Vercel 传输已移除（2026-09-20）

用户已拿到官方 TypeSafe API key 并在运行时验证通过，因此本插件彻底移除了 Vercel AI Gateway
传输，只保留官方 TypeSafe API 一条路径；仓库、测试、文档与打包清单里不再有可用的 Vercel 路径。

- 旧配置仍然写 transport: vercel 时，apply() 在注册阶段直接抛错，绝不静默改用官方端点
  （那会用错误的密钥打官方 API）：

      tool-jev: transport must be "typesafe": the Vercel AI Gateway transport was removed, so only transport "typesafe" (the official TypeSafe API) is supported (got "vercel")

  transport 缺省或写成 typesafe 都正常注册。
- 已移除的配置字段：gatewayBaseURL、gatewayProtocolVersion、gatewaySpecVersion、gatewayModel、
  vercelKeyFile。
- 历史实现（Vercel 网关路由、协议头、ai-model-id、noul<->boolean 翻译、Vercel 密钥解析）保留在
  git 历史与 reports/ 里；本轮不改写带日期的历史记录。
- examples/ 已随本轮迁移改写：route-demo.mjs 调用官方端点（body 带 model），confidence 从
  answers[key].confidence 读取，密钥文件默认 ~/.config/typesafe/key；不再包含旧传输路径。

## 验证

自动套件（无网络、无密钥、不需要 dsh）：

    node test/smoke.mjs           # 76 项断言，mock 官方端点
    node test/policy-section.mjs  # 41 项断言：A/B 两面触发政策的契约（无网络、无密钥、无需 dsh）
    node test/fixture-check.mjs   # 6 项断言：spawn test/mock-typesafe.mjs 并校验它

需要本机 dsh 的集成测试（`loader-overlay.mjs` 在没有 dsh 时打印 SKIP 并以 0 退出；
`bundle-install.mjs` 需要 dsh，没有 dsh 时判 FAIL 并以 1 退出——不把「验证不到」当通过）：

    node test/loader-overlay.mjs   # 3 项断言
    node test/bundle-install.mjs   # 37 项断言（正常环境）：bundleManifest 真实代码路径、包安装布局下
                                   # 相对 name 解析、同 id 两行风险、仓库文件未被改动（零网络、零第三方依赖）

smoke.mjs 覆盖内容：

1. 注册契约与 render：工具名、required [state, questions]、output.schema（含 required answers）、
   toolTimeoutMs、isConcurrencySafe、文本渲染。
2. 迁移护栏：旧传输配置（transport 写已移除的值）在注册阶段抛错，文案含 removed 与 typesafe
   且不静默降级；transport: typesafe 与缺省值仍正常注册。
3. 官方请求组装：URL /v1/systemone、Bearer 鉴权、body {state, questions, model}、per-call model
   覆盖、boolean 别名在 wire 上归一化为 noul。
4. 密钥解析：$apiKeyEnv -> $JEV_API_KEY -> keyFile；缺密钥文案去重（默认下 $TYPESAFE_API_KEY
   与 $JEV_API_KEY 各出现一次；apiKeyEnv 与回退同名时该名只出现一次）。
5. 本地校验：空 state、非法 type、空问题集、choice/score 的 criteria 形状（非法形状不发出任何请求）。
6. 错误路径：HTTP 401/404、非法 baseURL、非法 transport、空/畸形响应信封（`{}` 与数组）。
7. 取消与超时：预中止 signal 报 `call aborted by the caller`（name=AbortError，不含 timed out）；
   慢响应在 timeoutMs=50 下报 `timed out after 50 ms`。
8. 重试：retries:1 时 5xx 与超时各重发一次（总请求数=2）、最终错误保留 `HTTP 500`；
   429 与 4xx 永不重试，且 429 提示是通用限流措辞（不再有旧传输专属措辞）；retries:0 不重试。
9. 并发：同一 tool 实例并发两次 execute（state 不同、响应乱序返回）各自拿到自己的答案。
10. 工具描述：必须指向 answers[key].noul，且不再出现 `.probability` 或旧传输措辞；并逐字携带
    四个政策锚点（`When to use` / `Exempt only when` / `Decision moments` / `Budget:`）。

policy-section.mjs 覆盖内容（用假 ctx 记录注册，不启 dsh、不发请求）：

1. A 面描述：SPEC outputs.schema(1) 的全部逐字锚点、六个既有语法/返回形状子串、
   description.length <= 1500。
2. B 面注册：apply() 内不急于注册，只记录一次 `ctx.inject(['systemPrompt'], cb)`；flush 延迟
   回调后 section 恰好注册一次，name=jev-decision-policy、interpolate=false、无 complete 键、
   text 以 `## Jev decision policy` 开头、含 jev_decide / Exempt only when / Decision moments /
   run_code（PTC），且 length <= 1200。
3. 序位：默认委托 `getSectionOrder('MCP_SERVERS') + 10`（用假返回 7777 验证不是写死 3110）；
   config.policySection.order 显式覆盖生效；getSectionOrder 抛错时回退 3110 且不冒泡。
4. 失败路径：systemPrompt 始终缺席时 apply() 不抛错、工具恰注册一次；enabled=false 时零 section、
   工具恰一次；enabled='yes' 与 order=NaN 各抛 'tool-jev:' 前缀 Error；顶层 inject 仍为 ['tools']。
5. A/B 同源：从 description 里反推共享政策块（`When to use` 到 `Question grammar` 之间），逐句断言
   section 正文逐字包含，并显式断言完整的 `Default:` 与 `Budget:` 整句 —— 于是「B 面正文与 A 面
   脱钩」的取巧实现会在测试里失败。期望值从 A 面实测输出反推，不 import 未导出的内部常量。

fixture-check.mjs 对 /v1/systemone 发一次请求，断言 SENTINEL_DEPT 与日志里的 authorization，
结束时杀掉子进程并清理临时日志。

loader-overlay.mjs 执行 `dsh --profile web --patch <repo>/dsh.patch.yml --dump-config`，
断言退出码 0、输出含 tool-jev、且 name 解析为 file://<repo>/lib/index.js。

examples/route-demo.mjs 不属自动套件：它需要真实 TypeSafe key，并会调用官方 API。
`--calibrate` 由 JEV_CALIBRATE_LIMIT 限制样本数、按 JEV_SAMPLE_DELAY_MS 间隔调用官方 API；
三档门控策略与 JEV_AUTO_THRESHOLD / JEV_REVIEW_THRESHOLD 语义不变。

手动端到端演练（**需模型额度，不属自动套件**）：mock-typesafe.mjs 也能当假端点，让真实模型
去调用 jev_decide，用于观察 tool_call / tool_result 事件流：

    node test/mock-typesafe.mjs &                 # 监听 127.0.0.1:8799，日志写 /tmp/jev-mock.log
    printf '%s' dummy > /tmp/jev-mock-key
    cat > /tmp/jev-mock-patch.yml <<YAML
    - insert:
        - id: tool-jev
          name: '$(pwd)/lib/index.js'
          config:
            transport: typesafe
            baseURL: http://127.0.0.1:8799
            keyFile: /tmp/jev-mock-key
            timeoutMs: 10000
    YAML
    dsh --profile headless --patch /tmp/jev-mock-patch.yml \
      "调用 jev_decide 判断这段文本属于哪个部门：客户三天连不上 Stripe"

这个演练需要 headless profile 已配置可用模型；它只证明「模型能调用工具并读到结果」，
不验证真实官方 API 的响应形状（那部分由 smoke.mjs 的固定响应覆盖）。

## 边界

- 只提供工具，不注册 llm provider；想让它出现在模型选择器需要另写协议 shim。
- 默认不重试（retries: 0）：提供方的 429/5xx 直接作为工具错误暴露给模型，由 agent 自行决定
  是否重试。开启 retries: N 后，插件只对超时、网络错误与 5xx 重试，最多 N 次，退避为
  500ms*(attempt-1)（首次重试等 500ms）；4xx（含 429）与调用方取消永不重试。toolTimeoutMs
  默认随 retries 放大为 timeoutMs*(retries+1)+5000，避免工具级超时先于最后一次重试触发。
- 不缓存：每次 execute 都是一次新请求。
- PTC 模式与 native 模式都能调用它：PTC 下模型通过生成的 SDK 间接调用同一个已注册工具。
  B 面政策段因此专门写明「PTC 下须在 run_code 程序内调用 jev_decide」，而不是当成顶层工具调用。
- B 面（常驻政策段）是「可选依赖」：profile 里没有 systemPrompt 服务时静默缺席，A 面照常生效，
  apply() 不抛错；插件顶层 inject 始终只有 ['tools']，不把 systemPrompt 变成硬依赖。
- 工具注册与状态无关：无论 policySection.enabled 是 true 还是 false，jev_decide 都恰好注册一次，
  不做按状态的注册/注销（工具目录抖动会破坏请求缓存稳定性）。
- 官方 API 的长期配额未知：2026-09-20 实测 4 次调用均 HTTP 200（0.5–0.6s）。若触发 429，
  插件按 F6 语义永不重试，错误保留提供方 body 并附带通用限流提示；examples/route-demo.mjs
  用同一个官方端点，内置退避与样本间隔来适配限流。

## License

MIT
