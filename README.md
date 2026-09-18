# dsh-plugin-jev

把 TypeSafe 的 Jev（System One 决策模型）接进 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，
注册一个原生工具 jev_decide。

## 为什么是工具，不是模型

Jev 不生成文本：它接收 state + 类型化问题，返回类型化答案与校准置信度，接口不是
Chat Completions / Anthropic Messages。DSH 的 LLM seam 需要流式文本与 tool_calls，
所以 Jev 不能当主模型；正确的接法是把它做成工具。

本插件零依赖：不 import 任何 @deepseek-ai 包，而是通过 ctx.tools.register 注册一个符合
DSH 强制 JSON Schema 子集（JsonSchemaNode）的原始工具定义——这正是 MCP 工具走的注册路径。

## 两种传输

    transport: typesafe   原生 TypeSafe API
                          POST {baseURL}/v1/systemone
                          问句类型 choice | score | noul
                          需要 TypeSafe API key

    transport: vercel     Vercel AI Gateway
                          POST {gatewayBaseURL}/evaluation-model
                          问句类型 choice | score | boolean
                          只需要 Vercel AI Gateway key
                          模型 id 默认 typesafe-ai/jev

写成 noul 或 boolean 都可以，插件按传输自动翻译。Vercel 只把评测模型暴露给 AI SDK 7 的
experimental_evaluate（不在 OpenAI 兼容端点上）；本插件直接调用底层网关路由，请求头为
ai-gateway-protocol-version、ai-evaluation-model-specification-version、ai-model-id，
body 为 { state, questions }。该端点是未公开承诺稳定性的内部路由，升级前请重跑 test/smoke.mjs。

## 文件

    package.json             包元数据（type: module, main: lib/index.js）
    lib/index.js             插件本体：name / inject / apply，注册 jev_decide
    dsh.patch.yml            overlay 示例（原生 TypeSafe 传输）
    dsh.vercel.patch.yml     overlay 示例（Vercel AI Gateway 传输）
    examples/                confidence-gated routing 说明与可运行示例
    test/smoke.mjs           冒烟测试：mock 两端点，无需 dsh、无需密钥
    test/mock-typesafe.mjs   假端点 fixture：由 test/fixture-check.mjs 驱动，也可手动演练
    test/fixture-check.mjs   启动并校验 mock-typesafe.mjs 的 fixture 检查
    test/loader-overlay.mjs  可选集成测试：真实 dsh --dump-config 解析 overlay
    LICENSE                  MIT
    .gitignore

发布产物（`npm pack`）只含 lib/index.js、README.md、LICENSE、package.json 与两个 overlay；
test/ 与 examples/ 不随包发布。

## 安装

方式一：不落盘，用 overlay 启动（在克隆下来的仓库根目录执行）

    dsh web --patch "$(pwd)/dsh.patch.yml"
    dsh web --patch "$(pwd)/dsh.vercel.patch.yml"

方式二：写进用户 patch 层，永久生效
把 overlay 里的 insert 行追加到 ~/.dsh/profiles/web/cordis.patch.yml。
必须是 insert 行：裸的 "id: tool-jev" 只会去覆盖已存在条目并打印警告。
注意 name 用仓库里的绝对路径，例如 /path/to/dsh-plugin-jev/lib/index.js。

方式三：当包安装进 profile（entry 的 name 写包名）

    dsh plugin --profile web add /path/to/dsh-plugin-jev

package.json 的 files 已包含 dsh.patch.yml 与 dsh.vercel.patch.yml，两个 overlay 都会随
`npm pack` 发布，装包后可以直接引用包内 overlay 或把 insert 行抄进 profile patch。

web profile 是 patchReload: live，patch 改动热重载；新增依赖包建议重启一次 dsh web。

## 配置

    transport                 typesafe | vercel                默认 typesafe
    baseURL                   默认 https://api.typesafe.ai     原生端点根地址
    gatewayBaseURL            默认 https://ai-gateway.vercel.sh/v4/ai
    gatewayProtocolVersion    默认 0.0.1                        ai-gateway-protocol-version 请求头
    gatewaySpecVersion        默认 4                            ai-evaluation-model-specification-version 请求头
    model                     默认 jev-latest（vercel 下为 typesafe-ai/jev）
    apiKeyEnv                 默认 TYPESAFE_API_KEY / AI_GATEWAY_API_KEY
    keyFile                   默认 ~/.config/typesafe/key（vercel 下为 ~/.config/vercel/ai-gateway-key）
    timeoutMs                 默认 60000                        单次 HTTP 请求超时
    toolTimeoutMs             默认 timeoutMs*(retries+1)+5000   注册表工具级超时
    retries                   默认 0                            仅对超时/网络/5xx 重试，4xx（含 429）永不重试
    maxStateBytes             默认 262144                       state 字节上限
    maxQuestions              默认 64                           单次问题数上限

timeoutMs / toolTimeoutMs / maxStateBytes / maxQuestions 必须是正有限数，retries 必须是非负整数；
否则 apply() 在注册阶段就抛错（例如 `tool-jev: timeoutMs must be a positive finite number`）。

密钥解析顺序：$apiKeyEnv -> 该传输的约定变量（typesafe: $JEV_API_KEY；
vercel: $AI_GATEWAY_API_KEY、$VERCEL_AI_GATEWAY_API_KEY）-> keyFile。
密钥永远不作为工具参数传入，因此不会进入对话记录。推荐放文件：

    mkdir -p ~/.config/typesafe && printf '%s' 'ts_...' > ~/.config/typesafe/key && chmod 600 ~/.config/typesafe/key
    mkdir -p ~/.config/vercel   && printf '%s' 'vck_...' > ~/.config/vercel/ai-gateway-key && chmod 600 ~/.config/vercel/ai-gateway-key

## 工具契约

    jev_decide(state: string, questions: object, model?: string)

questions 的键由调用方自定，值有三种，criteria 的形状是精确契约：

    { "type": "choice", "instructions": "...", "criteria": { "option_key": "含义" } }
        criteria 必须是非空对象（option_key -> 含义）；数组 / 字符串 / null 会被本地拒绝
        -> 原生 answers[key].choice + probabilities（另有 confidence）
    { "type": "score",  "instructions": "...", "criteria": ["等级0含义", "等级1含义"] }
        criteria 必须是非空数组；对象会被本地拒绝
        -> answers[key].score + legend / probabilities
    { "type": "noul" | "boolean", "instructions": "yes/no 问题" }
        -> 原生：answers[key].noul（yes 的概率）
        -> 网关：answers[key] = { "type": "boolean", "probability": 0.83 }，读 answers[key].probability；
           网关该条目没有 .noul、没有 .boolean，也没有 confidence 条目

工具返回提供方响应体，渲染为一份 JSON 文本块。执行前本地校验（都在发请求之前，因此不会
消耗额度）：state 非空且不超字节上限、questions 非空且数量受限、type 必须匹配所选传输、
choice/score 的 criteria 必须匹配上面两种形状、instructions 非空。错误文案与实测一致，例如：

    tool-jev: state must be a non-empty string
    tool-jev: state is 300000 bytes, over maxStateBytes 262144
    tool-jev: at most 64 questions per call (got 65)
    tool-jev: questions.q.criteria must be a non-empty object mapping option_key to meaning for a choice question (got null)
    tool-jev: questions.q.criteria must be a non-empty array of level meanings for a score question (got an object)

响应信封同样校验：缺少 answers 对象的响应（`{}`、数组等）会让工具直接失败，不会把
undefined 交给模型。

## Confidence-gated routing

- examples/confidence-routing.md：confidence 决定「能不能无人值守执行」的三档策略
  （>=0.8 自动 / >=0.5 升级复核 / 否则转人工）、如何用标注数据标定阈值，以及两种传输里
  confidence 的位置差异（原生在 answers[key].confidence；网关在
  providerMetadata.typesafe.confidence，且概率被 round 到两位小数）。
- examples/route-demo.mjs：可运行实现。

    node examples/route-demo.mjs                  # 内置样例
    node examples/route-demo.mjs "任意 state"      # 自定义输入
    node examples/route-demo.mjs --calibrate      # 对标注样本扫阈值，输出准确率/覆盖率

    环境变量：JEV_AUTO_THRESHOLD / JEV_REVIEW_THRESHOLD 调阈值，
    JEV_CALIBRATE_LIMIT 限制样本数，JEV_SAMPLE_DELAY_MS 控制样本间隔。

## 验证

自动套件（无网络、无密钥、不需要 dsh）：

    node test/smoke.mjs           # 67 项断言，mock 两端点
    node test/fixture-check.mjs   # spawn test/mock-typesafe.mjs 并校验它

加载器集成测试（可选，需要本机 dsh；环境没有 dsh 时打印 SKIP 并以 0 退出）：

    node test/loader-overlay.mjs

smoke.mjs 覆盖内容：

1. 注册契约与 render：工具名、required [state, questions]、output.schema（含 required answers）、
   toolTimeoutMs、isConcurrencySafe、文本渲染。
2. 两种传输的请求：URL、鉴权头、协议版本头、ai-model-id、body 组装、noul<->boolean 翻译。
3. 密钥解析：$apiKeyEnv -> 传输约定变量 -> keyFile；缺密钥文案（vercel 缺省下
   $AI_GATEWAY_API_KEY 只出现一次，并列出 $VERCEL_AI_GATEWAY_API_KEY）。
4. 本地校验：空 state、非法 type、空问题集、choice/score 的 criteria 形状（非法形状不发出任何请求）。
5. 错误路径：HTTP 401/404、非法 baseURL、非法 transport、空/畸形响应信封（`{}` 与数组）。
6. 取消与超时：预中止 signal 报 `call aborted by the caller`（name=AbortError，不含 timed out）；
   慢响应在 timeoutMs=50 下报 `timed out after 50 ms`。
7. 重试：retries:1 时 5xx 与超时各重发一次（总请求数=2）、最终错误保留 `HTTP 500`；
   429 与 4xx 永不重试；retries:0 不重试。
8. 并发：同一 tool 实例并发两次 execute（state 不同、响应乱序返回）各自拿到自己的答案。

fixture-check.mjs 对 /v1/systemone 与 /gateway/evaluation-model 各发一次请求，断言
SENTINEL_DEPT / GATEWAY_SENTINEL 与日志里的 authorization、ai-model-id，结束时杀掉子进程
并清理临时日志。

loader-overlay.mjs 执行 `dsh --profile web --patch <repo>/dsh.patch.yml --dump-config`，
断言退出码 0、输出含 tool-jev、且 name 解析为 file://<repo>/lib/index.js。

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
不验证真实网关的响应形状（那部分由 smoke.mjs 的固定响应覆盖）。

## 边界

- 只提供工具，不注册 llm provider；想让它出现在模型选择器需要另写协议 shim。
- 默认不重试（retries: 0）：提供方的 429/5xx 直接作为工具错误暴露给模型，由 agent 自行决定
  是否重试。开启 retries: N 后，插件只对超时、网络错误与 5xx 重试，最多 N 次，退避为
  500ms*(attempt-1)（首次重试等 500ms）；4xx（含 429）与调用方取消永不重试。toolTimeoutMs
  默认随 retries 放大为 timeoutMs*(retries+1)+5000，避免工具级超时先于最后一次重试触发。
- 不缓存：每次 execute 都是一次新请求。
- PTC 模式与 native 模式都能调用它：PTC 下模型通过生成的 SDK 间接调用同一个已注册工具。
- Vercel 通道要求账号绑卡后才服务请求；免费额度对该模型有速率限制，连续调用会返回 429，
  批量或生产使用需要付费额度。上一轮真实调用记录：5 次里 4 次 HTTP 200、1 次瞬时 60s 超时；
  随后连续 4 次调用全部 HTTP 429（免费额度窗口内持续限流），需等待窗口恢复或改用付费额度。
  examples/route-demo.mjs 内置退避与样本间隔来适配这一点。

## License

MIT
