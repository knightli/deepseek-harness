# Agent Note: 实时 Agent 拥有外部文本提示词执行

Status: implemented

[English](2026-08-14-external-text-prompt-execution.md) | 中文

## 问题

Host 向每一种 `AgentFactory` 实现公开同一套会话提示词协议。仅检查 DSH LLM 注册表是否服务所选提供方，能够正确保护默认 agent loop，却也会拒绝一种自定义 Agent：它由自身 driver 消费公开 inbox 中的文本，从不经该注册表分发。

提示词执行权限属于一个实时 Agent 实例。创建选项描述所选模型路由，会话数据重建持久对话事实，Host 配置作用于整个组合；这些位置都无法表明某个返回的 Agent 拥有外部执行，同时又不放宽其他 Agent 的准入或持久化运行时实现事实。

## 决策

公开 `Agent` 接口携带可选实时能力 `promptExecution?: { kind: 'external-text' }`。该声明由 Agent 自身拥有；它不是 `AgentOptions` 字段，也不属于 `AgentFactory` 或 `AgentRegistry` 元数据。

`promptExecution` 缺席时，`session.prompt` 要求所选提供方存在 DSH LLM 路由；没有适配器服务时，它会在开启轮次前以 `model-unavailable` 失败。`external-text` 无需这条路由即可接收普通文本 follow-up 与 steering，因为 Agent 的 driver 拥有执行。它不接收其他模态：图片内容会在附件校验或持久化之前以 `attachment-error` 失败，原因为 `MODEL_DOES_NOT_SUPPORT_IMAGES`。

`session.models.routable` 表示 Host 是否接收所寻址实时 Agent 的普通文本。DSH 适配器服务所选提供方，或 Agent 声明 `external-text` 时，该值为 `true`；它不承诺图片准入，也与建议性目录的成员关系无关。外部 Agent 仍能获得目录供客户端兼容显示，但 `session.selectModel` 会在适配器解析前以 `model-unavailable` 失败，并保持当前会话选择与部署默认值不变。[默认模型决策](../feature/2026-08-07-default-model-follows-the-picker.md)继续拥有选择层级，[Web 模型选择器决策](../feature/2026-07-24-web-session-model-selector.md)继续拥有目录呈现。

这项能力既不持久化，也不通过推断获得。Agent 依赖外部文本执行且没有 DSH 路由的工厂，要在 create 与 resume 返回的每个 Agent 上声明它；普通自定义 Agent 可以省略。重启或恢复后的 Agent 若省略声明，就会执行默认 DSH 路由检查，只有所选提供方没有适配器服务时才不可路由。会话事件、持久化 schema、格式版本、工厂 API 与 Host 配置均不改变。

## 验证

`packages/host/apiproxy/tests/api-proxy-models.spec.ts` 固定准入规则的两侧：没有这项能力的 Agent 在其提供方没有适配器时仍不可路由，并收到 `model-unavailable`；`external-text` Agent 则报告 `routable: true`，把确切的排队文本投递给 `followup`、steering 文本投递给 `steer`，在附件工作前拒绝图片，并在不改变会话选择或部署默认值的前提下拒绝模型选择。子系统的 `type-equiv` 代码块逐字复制 `packages/core/agent/src/runtime-types.ts` 中的公开属性与 JSDoc。

## 考虑过的替代方案

**把执行模式放入 `AgentOptions`。** 选项描述默认循环消费的模型路由，并作为调用方输入跨越创建边界。外部执行是返回的实时实现所具有的属性；把它作为调用方配置接收，会允许调用方声称 Agent 并未实现的能力。

**查询 `AgentFactory` 或 `AgentRegistry`。** 工厂级答案无法表示 create 与 resume 后不同的实时 Agent 实现或能力；注册表查询则会把事实与拥有提示词投递的对象分离。

**增加 Host 全局绕过配置。** 组合级配置会在尚未证明由哪个 driver 消费文本时准入每个被寻址的 Agent，使一项外部集成削弱无关会话默认的失败关闭行为。

**注册虚假的 LLM 适配器。** 适配器注册表示 DSH 能解析模型元数据并分发请求。外部 driver 不需要这两项操作；虚假路由还会混淆图片与模型选择语义，而不是显式拒绝它们。

## 影响

树外 Agent 无需注册虚假模型适配器，就能通过原生 Host 提示词协议与 Web composer 接收普通文本。这项能力刻意保持狭窄：外部 Agent 不能通过该协议接收图片内容或模型选择，其可见模型目录只是兼容数据，不是可变执行路由。

依赖外部文本执行且没有 DSH 路由的工厂，必须在每条 create 与 resume 路径重复声明。重启后省略声明是安全的，只有所选提供方没有 DSH 适配器服务时才使会话文本不可路由；普通自定义 Agent 可以省略。支持其他外部模态或可变外部模型选择时，需要增加新的可辨识能力和明确的 Host 约定，而不能隐式扩大 `external-text`。
