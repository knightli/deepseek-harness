# Agent Note: 失败关闭的会话能力准入

Status: implemented

[English](2026-08-17-fail-closed-session-capability-admission.md) | 中文

## Problem

某个 Agent 实现可能自行持有文本执行，却不具备 DSH 图片、模型选择或从 seed fork 的行为。Host 会强制执行其中部分差异，但原生 Web 会话曾在能力读取结算前暴露图片输入和分支操作。切换会话时还可能渲染一帧来自上一会话的已加载快照。与此同时，寻址冷持久会话的未知斜杠命令会先恢复并发布 Agent，然后 Host 才发现没有对应处理器。

这些乐观路径会让不可用控制项变得可操作，也会让明确缺失的命令在返回错误前改变进程状态。

## Decision

`AgentFactory.sessionCapabilities` 是可选的工厂级声明。省略它会保留 stock 行为，包括从 seed fork；`forkFromSeed: false` 会拒绝通用 fork 准入。注册表会从拥有实时 Agent 的工厂，或将要恢复冷会话的活跃工厂读取该声明，而且不会执行恢复。Host 在 `session.models.capabilities` 中返回 `imageInput`、`modelSelection` 和 `fork`，并在相应写入路径中强制执行同一组事实。

runtime Session 持有唯一的 `SessionModels` 权威，并以只读 `modelDirectory` observable 公开。`ConversationSnapshot.sessionCapabilities` 派生自同一个值；stock 模型选择插件把加载、owner 事件刷新与选择委托给 Session，不再保留第二份 groups／current／routable 投影，也不自行发出 RPC。因此，每个消费者都会加入或复用 ready generation 中同一次已结算读取。断连、generation start、显式 refresh invalidation，以及切换到已寻址 subagent transport，都会同步撤回该权威，使读取与选择失效，并以 request identity、connection generation、answerable generation 和普通会话地址拦截迟到结算。pending、业务错误、传输失败和迟到响应都保持不可用。owner 事件会先使 runtime 既有的常驻 Session map 失效，再重新加载存活 facade，因此从未 materialize 或已 dispose 的 facade 不会遗留离屏缓存。composer 模型入口从常驻 `useSession` selector 派生可见性，使 ordinary／addressed 切换无需重建 provide bundle 即可收敛。InputBar 与 ChatView 使用同一个 selector；能力不可用时，图片粘贴与拖放会保留草稿和附件栏，transcript 中也不会出现分支操作。

命令注册表公开 `has(name)`，作为覆盖所有全局及作用域注册的只读、无需 Agent 的粗粒度索引。false 能证明明确缺失。`session.prompt` 会在查找 Agent 前以 `unknown-command` 拒绝该缺失，因此冷会话保持冷状态，也不记录事件。true 允许解析 Agent，但不授予作用域可用性：恢复后仍以现有 `find(agent, name)` 为权威，执行时也仍记录 stock `command/run` 和 `command/done` 事件对。两条准入路径都不包含按提供方、Agent 实现或命令名称设置的例外。

## Verification

runtime 测试要求 pending 与失败 generation 保持不可用，断连、generation start 与 refresh invalidation 同步清空，重复消费者共享同一次读取，已寻址 child 不发出普通模型 RPC，并丢弃跨 generation／地址变化迟到的读取或选择。两个 subscriber 观察同一个 Session 权威，而 API 只记录一次 `session.models` 调用。client 测试要求 stock 模型入口订阅同一数据源，owner invalidation 命中 facade 从未 materialize 或已 dispose 的常驻 Session，并要求同一个已挂载 composer 控制项在 ordinary／addressed 切换中隐藏和恢复；同时，从受支持的 session A 切换到不可用或明确拒绝的 session B 时，B 的首次 render 必须保留图片草稿与附件栏状态，且不暴露分支操作。artifact gate 会先构建包，再把真实 `pnpm pack` 输出到绝对临时目录，通过 `tarballFiles` 列出 tarball，并逐项比较全部 77 个官方 member，其中包括 69 个声明文件和 3 个 runtime JavaScript 文件；required workflow lane 会调用这套完全相同的 artifact graph。

公共 Host 测试会向持久冷会话发送未知命令，并要求稳定的 `unknown-command` 响应、工厂恢复调用为零、没有实时 Agent 或会话，以及公开会话列表保持不变。已注册命令可以恢复会话，并必须保留命令生命周期事件对。注册表测试会在全局层和彼此独立的作用域层中持有同一名称，再逐一 dispose，证明直到最后一项注册离开前，粗粒度索引都保持 true。

## Alternatives considered

**乐观展示控制项并依赖 Host 拒绝。** Host 仍是权威，但启用的控制项会承诺当前会话可能未实现的操作。图片粘贴或拖放还可能在拒绝到达前扰动本地草稿状态。

**只在 passive effect 中重置能力状态。** effect 在 render 后运行，因此会话或连接切换可能提交来自上一键的 UI。能力状态应归属于 Session generation 生命周期，并且必须在新 generation render 前清空。

**先恢复每个冷会话，再检查斜杠名称。** 精确的作用域解析确实需要 Agent，但所有注册中都不存在的名称已经是明确缺失。为它执行恢复会创建被拒命令完全不需要的进程状态。

**在 Host 中硬编码不支持的提供方或命令名称。** 这类分支会把通用 DSH 准入耦合到某项部署，并随着 Agent 实现和命令插件变化而漂移。

## Consequences

原生控制项在加载中、传输失败、Session 替换和 connection generation 变化时都失败关闭；当前 generation 的读取成功后，受支持会话会恢复同一组 stock 控制项。业务状态仍位于常驻 Session 对象层，`contract/` 仅保留声明，打包产物也维持精确的官方清单。现有 Agent 工厂无需修改即可保留从 seed fork；无法履行该行为的工厂只需声明一个向后兼容字段。

未知斜杠名称无法唤醒冷会话。由于 `has(name)` 有意保持粗粒度，只在其他作用域注册的名称仍可能触发恢复，随后才由精确 `find()` 拒绝；该索引会阻止明确缺失触发恢复，但不会取代作用域解析，也不会向客户端广播可用性。
