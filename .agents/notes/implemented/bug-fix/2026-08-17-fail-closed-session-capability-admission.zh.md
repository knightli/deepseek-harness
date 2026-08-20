# Agent Note: 失败关闭的会话能力准入

Status: implemented

[English](2026-08-17-fail-closed-session-capability-admission.md) | 中文

## Problem

某个 Agent 实现可能自行持有文本执行，却不具备 DSH 图片、模型选择或从 seed fork 的行为。Host 会强制执行其中部分差异，但原生 Web 会话曾在能力读取结算前暴露图片输入和分支操作。切换会话时还可能渲染一帧来自上一会话的已加载快照。与此同时，寻址冷持久会话的未知斜杠命令会先恢复并发布 Agent，然后 Host 才发现没有对应处理器。

这些乐观路径会让不可用控制项变得可操作，也会让明确缺失的命令在返回错误前改变进程状态。

## Decision

`AgentFactory.sessionCapabilities` 是可选的工厂级声明。seeded fork 准入要求精确的正向声明 `forkFromSeed: true`；false 或省略都会 fail closed。stock AgentLoop 会声明 true，因为它的创建路径会验证并快照 seed。每次 `setFactory()` 调用都会创建独立的注册表槽位、快照该声明，并把精确的可调用 effect disposer 作为不透明 `AgentFactoryRegistration` 回执返回。注册表的创建与恢复包装仅在返回的 Promise 结算前携带该槽位。直接发布的已注册工厂必须向 `enter()` 提供精确回执；同一工厂对象较早注册留下的过期回执、其他注册表的回执和原始工厂对象都会被拒绝。省略回执绝不会借用活跃工厂的声明，因此直接注册的外部 Agent 仍属未知。stock AgentLoop 会把回执保存在 traced Service 对象之外，并在操作入口、setup 或持久化 await 之前捕获它，因此声明式精确 `sessionId` 创建和 `resumeSessionId` 恢复会保留正确的注册 epoch。`enter()` 会在读取声明快照前验证该 epoch，并在提交实时条目前紧邻位置再次验证。fork 执行还有一道独立的第二道门：Host 从实时 source 的发布快照或冷 source 的活跃注册快照建立 source eligibility 后，`AgentRegistry.create()` 会捕获执行槽位，并在调用其工厂前要求该槽位自身声明 `forkFromSeed: true`。因此，注册 A 可以准入 source，再由同样具备能力的替代注册 B 执行；但 false 或省略声明的 B 会以 `AgentFactoryCapabilityUnavailableError` 失败，Host 会把这一 typed refusal 映射为稳定的 `fork-unavailable` wire error。Host 在普通 `session.models.capabilities` 中返回 `imageInput`、`modelSelection` 和 `fork`，并在相应写入路径中强制执行同一组事实。通过授权的已寻址 `subagent.history` tail 只会在目录与谱系复核后携带 `{ fork }`；它不会宣称图片或模型权威，旧分页也会省略 capabilities。

runtime Session 持有唯一的普通 `SessionModels` 权威，并以只读 `modelDirectory` observable 公开。`ConversationSnapshot.sessionCapabilities` 派生自同一个值；stock 模型选择插件把加载、owner 事件刷新与选择委托给 Session，不再保留第二份 groups／current／routable 投影，也不自行发出 RPC。因此，每个消费者都会加入或复用 ready generation 中同一次已结算读取。断连、generation start、显式 refresh invalidation，以及切换到已寻址 subagent transport，都会同步撤回该权威，使读取与选择失效，并以 request identity、connection generation、answerable generation 和普通会话地址拦截迟到结算。pending、业务错误、传输失败和迟到响应都保持不可用。已寻址 history 会把仅 fork 的事实安装到独立的 `ConversationSnapshot.forkAvailable` 字段；地址、断连与 generation epoch 会独立撤回并拦截它，因此它不会成为图片或模型权威。owner 事件会调用模型选择插件的私有 closure；该 closure 遍历 public sessions list，并经每个 binding 调用 `refreshModels`；每次 refresh 先撤回再开始一次替换读取，存活 facade 则加入该请求。composer 模型入口经框架派生的 props share 接收 `useSession` 与 `useDirectory`，使 ordinary／addressed 切换无需重建 provide bundle 或组件自有订阅机制即可收敛。InputBar 与 ChatView 使用同一个 Session selector；能力不可用时，图片粘贴与拖放会保留草稿和附件栏，transcript 中也不会出现分支操作。

命令注册表公开 `has(name)`，作为覆盖所有全局及作用域注册的只读、无需 Agent 的粗粒度索引。false 能证明明确缺失。`session.prompt` 会在查找 Agent 前以 `unknown-command` 拒绝该缺失，因此冷会话保持冷状态，也不记录事件。true 允许解析 Agent，但不授予作用域可用性：恢复后仍以现有 `find(agent, name)` 为权威，执行时也仍记录 stock `command/run` 和 `command/done` 事件对。两条准入路径都不包含按提供方、Agent 实现或命令名称设置的例外。

## Verification

runtime 测试要求 pending 与失败 generation 保持不可用，断连、generation start 与 refresh invalidation 同步清空，重复消费者共享同一次读取，已寻址 child 不发出普通模型 RPC，并丢弃跨 generation／地址变化迟到的读取或选择。两个 subscriber 观察同一个 Session 权威，而 API 只记录一次 `session.models` 调用。client 测试要求 stock 模型入口订阅同一数据源，私有 owner-event refresh 命中 facade 从未 materialize 或已 dispose 的 Session，并要求同一个已挂载 composer 控制项在 ordinary／addressed 切换中隐藏和恢复；keyless Web replay 还会经真实 Loader、app、browser 与 profile composition 驱动 ordinary parent 切到 addressed child 再返回，并断言该控制项转换。同时，从受支持的 session A 切换到不可用或明确拒绝的 session B 时，B 的首次 render 必须保留图片草稿与附件栏状态，且不暴露分支操作。artifact gate 会先构建包，再把真实 `pnpm pack` 输出到绝对临时目录，通过 `tarballFiles` 列出 tarball，并逐项比较全部 77 个官方 member，其中包括 69 个声明文件和 3 个 runtime JavaScript 文件；required workflow lane 会调用这套完全相同的 artifact graph。生成的 Cordis inspect catalog 会记录可选 `ConversationSnapshot.forkAvailable` 字段，使 runtime introspection 与导出的 client 声明保持一致。

注册表测试要求直接发布的外部 Agent 在活跃工厂具备能力时仍视为未声明。它们还覆盖：注册 A 被 dispose、注册 B 接管后才继续的延迟 create 与 resume；调用 Promise 结算后的 detached async-local 后代；同一工厂对象重新注册为 B 后遗留的 A 回执；原始工厂对象；其他注册表的回执；traced Cordis 工厂发布；以及注册或发布期间的重入替换。每条过期路径都必须在注册表变更前失败，而精确的当前回执则能以相同 session id 成功。seeded-create 矩阵要求 false 与省略声明的执行槽位在工厂调用前拒绝，并要求 true 槽位收到 seed。公共 Host 竞态测试会在 A(true) 完成 source 准入后暂停冷 source 检查，把 A 替换为 B(false 或省略)，然后要求稳定的 `fork-unavailable`、B 工厂零调用以及 Agent 与 Session 注册表均不变；对称的 A(true) 到 B(true) 用例则要求 B 执行并发布 child。keyless shipped-Web composition 会创建精确配置的 Agent，经公共 Host HTTP fork 它，再使用同一持久化根目录通过 `resumeSessionId` 重启，验证已实体化历史，并通过同一公共操作 fork 恢复后的 Agent。公共 Host 测试覆盖已寻址能力读取的 live／cold child、one-shot／continuable 模式，以及 true、false 与省略三种工厂声明。测试要求只有通过授权的 tail page 才查询无激活的注册表声明，错误路径与旧分页不查询，并要求直接 fork 准入只接受同一个精确 true 声明。client 测试会在断连与 generation start 时撤回已寻址 fork 权威，拒绝旧地址和旧 generation 的迟到结算，从 ready generation 恢复它，并保证不发出 `session.models` 请求。另有公共 Host 测试会向持久冷会话发送未知命令，并要求稳定的 `unknown-command` 响应、工厂恢复调用为零、没有实时 Agent 或会话，以及公开会话列表保持不变。已注册命令可以恢复会话，并必须保留命令生命周期事件对。注册表测试会在全局层和彼此独立的作用域层中持有同一命令名称，再逐一 dispose，证明直到最后一项注册离开前，粗粒度索引都保持 true。

## Alternatives considered

**乐观展示控制项并依赖 Host 拒绝。** Host 仍是权威，但启用的控制项会承诺当前会话可能未实现的操作。图片粘贴或拖放还可能在拒绝到达前扰动本地草稿状态。

**只在 passive effect 中重置能力状态。** effect 在 render 后运行，因此会话或连接切换可能提交来自上一键的 UI。能力状态应归属于 Session generation 生命周期，并且必须在新 generation render 前清空。

**先恢复每个冷会话，再检查斜杠名称。** 精确的作用域解析确实需要 Agent，但所有注册中都不存在的名称已经是明确缺失。为它执行恢复会创建被拒命令完全不需要的进程状态。

**把活跃工厂或它的原始规范对象视为每个直接注册 Agent 的发布方。** 外部 Agent 可以在无关的具备能力工厂处于活跃状态时进入注册表，而且同一个工厂对象可以在 dispose 后进入新的注册 epoch。回退到活跃槽位会把未知实现变成 seeded-fork 正向声明；比较原始对象则会让旧操作借替代注册完成发布。两者都会违反失败关闭准入，因此直接发布必须改为证明精确的逐注册回执。

**在 Host 中硬编码不支持的提供方或命令名称。** 这类分支会把通用 DSH 准入耦合到某项部署，并随着 Agent 实现和命令插件变化而漂移。

## Consequences

原生控制项在加载中、传输失败、Session 替换和 connection generation 变化时都失败关闭；当前 generation 的读取成功后，受支持会话会恢复同一组 stock 控制项。业务状态仍位于常驻 Session 对象层，`contract/` 仅保留声明，打包产物也维持精确的官方清单。工厂必须显式声明 seeded-fork 支持，并在注册表的创建或恢复包装之外发布时保留 `setFactory()` 返回的精确回执。由于 Cordis 可能包装存入 traced Service 函数字段的回执，该回执应放在 closure、模块私有 `WeakMap` 或其他普通 holder 中，而不是这类字段。stock AgentLoop 会在声明式创建和恢复中遵守该规则，而未声明的外部 Agent 则保持不可用。

未知斜杠名称无法唤醒冷会话。由于 `has(name)` 有意保持粗粒度，只在其他作用域注册的名称仍可能触发恢复，随后才由精确 `find()` 拒绝；该索引会阻止明确缺失触发恢复，但不会取代作用域解析，也不会向客户端广播可用性。
