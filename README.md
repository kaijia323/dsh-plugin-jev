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
    test/                    mock 两端点的冒烟测试与假服务端
    LICENSE                  MIT
    .gitignore

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

web profile 是 patchReload: live，patch 改动热重载；新增依赖包建议重启一次 dsh web。

## 配置

    transport             typesafe | vercel                默认 typesafe
    baseURL               默认 https://api.typesafe.ai     原生端点根地址
    gatewayBaseURL        默认 https://ai-gateway.vercel.sh/v4/ai
    model                 默认 jev-latest（vercel 下为 typesafe-ai/jev）
    apiKeyEnv             默认 TYPESAFE_API_KEY / AI_GATEWAY_API_KEY
    keyFile               默认 ~/.config/typesafe/key（vercel 下为 ~/.config/vercel/ai-gateway-key）
    timeoutMs             默认 60000                        单次 HTTP 请求超时
    toolTimeoutMs         默认 timeoutMs + 5000             注册表工具级超时
    maxStateBytes         默认 262144                       state 字节上限
    maxQuestions          默认 64                           单次问题数上限

密钥解析顺序：$apiKeyEnv -> 该传输的约定变量（typesafe: $JEV_API_KEY；
vercel: $AI_GATEWAY_API_KEY、$VERCEL_AI_GATEWAY_API_KEY）-> keyFile。
密钥永远不作为工具参数传入，因此不会进入对话记录。推荐放文件：

    mkdir -p ~/.config/typesafe && printf '%s' 'ts_...' > ~/.config/typesafe/key && chmod 600 ~/.config/typesafe/key
    mkdir -p ~/.config/vercel   && printf '%s' 'vck_...' > ~/.config/vercel/ai-gateway-key && chmod 600 ~/.config/vercel/ai-gateway-key

## 工具契约

    jev_decide(state: string, questions: object, model?: string)

questions 的键由调用方自定，值有三种：

    { "type": "choice", "instructions": "...", "criteria": { "option_key": "含义" } }
        -> answers[key].choice + probabilities（原生另有 confidence）
    { "type": "score",  "instructions": "...", "criteria": ["等级0含义", "等级1含义"] }
        -> answers[key].score + legend / probabilities
    { "type": "noul" | "boolean", "instructions": "yes/no 问题" }
        -> 原生 answers[key].noul；网关 answers[key].probability

工具返回提供方响应体，渲染为一份 JSON 文本块。执行前本地校验：state 非空且不超字节上限、
questions 非空且数量受限、type 必须匹配所选传输、choice/score 必须带 criteria、instructions 非空。

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

    node test/smoke.mjs

覆盖内容：

1. 注册契约与 render：工具名、参数必填、输出 schema、timeoutMs、文本渲染。
2. 两种传输的请求：URL、鉴权头、协议版本头、ai-model-id、body 组装、noul<->boolean 翻译。
3. 密钥解析：$apiKeyEnv -> 传输约定变量 -> keyFile；缺失密钥的报错文案。
4. 校验与错误路径：空 state、非法 type、缺 criteria、空问题集、HTTP 401/404、非法 baseURL、非法 transport。
5. mock 端点的 combo 检查：dsh web --patch <overlay> --dump-config 能正确把 overlay 的
   './lib/index.js' 解析成 file URL 并插入 tool-jev 条目。
6. 端到端：用 test/mock-typesafe.mjs 起假端点，dsh headless 让模型真实调用 jev_decide，
   事件流出现 tool_call / tool_result(completed)，请求头与 body 与实现一致。

## 边界

- 只提供工具，不注册 llm provider；想让它出现在模型选择器需要另写协议 shim。
- 不缓存、不重试：提供方的 429/5xx 直接作为工具错误暴露给模型，由 agent 自行决定是否重试。
- PTC 模式与 native 模式都能调用它：PTC 下模型通过生成的 SDK 间接调用同一个已注册工具。
- Vercel 通道要求账号绑卡后才服务请求；免费额度对该模型有速率限制，连续调用会返回 429，
  批量或生产使用需要付费额度。examples/route-demo.mjs 内置退避与样本间隔来适配这一点。

## License

MIT
