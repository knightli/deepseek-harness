# @deepseek-ai/dsh-client-ui-model-selection

[English](README.md) | 中文

模型选择插件（浏览器侧）：**两个入口共用一份由 runtime Session 持有的目录**。`ModelDirectoryResolver`（`ctx.modelDirectories`）只为每个会话创建薄 facade：`/model` popupSelect 贡献项（经 `ctx.commandUi` 注册）与 composer 的具名 `conversation.input.model` slot 订阅同一个 `Session.modelDirectory` observable，并把 `loadModels`／`refreshModels`／`selectModel` 委托给该 Session。本插件不保留第二份 groups／current／routable store，也不直接发出 wire RPC。紧凑型 composer 触发器会打开两级 Model/Effort 菜单：模型仍按提供方分组，所选具体模型则提供由其适配器持有的推理强度名称、说明和默认值。`/model` 应用所选模型的默认推理强度，composer 随后可以选择任一已公布的推理强度。

Host 报告的 `ModelSelection` 是唯一的选择事实，其中包含提供方、模型与推理（reasoning）强度；但只有当该提供方／模型对仍在已公布分组中时才会回显。目录行缺席时，可路由的选择保持不变，但触发器会提示 `Select model`；系统不会合成陈旧行，且在用户选择已公布的模型之前不会显示 Effort 行。runtime 的 request identity 与 connection generation 会阻止旧响应覆盖新结果；断连会同步撤回目录，重连则在显示前重新加载 Host 恢复的选择。各提供方的元数据获取失败会内联列出，同时可用分组仍可选择；选择失败会保留先前的选择和目录。

当 Host 报告 `session.models.routable: false` 时，本插件经 `ctx.conversation.blocks` 注册一个 composer 阻塞块，输入框随之停用并显示本插件自己的文案；恢复后无需重新加载即自动清除。该值跟随 Host 对普通文本的准入，而不只表示适配器是否存在：DSH 适配器服务所选提供方，或实时 Agent 声明 `promptExecution: { kind: 'external-text' }` 时，该值均为 `true`。插件只跟随 `routable`：`null`（首次加载之前，或加载失败之后）绝不阻断，否则一个缓慢的 Host 会锁死本来可用的 composer；目录成员关系同样不阻断。对于 `external-text` Agent，目录只用于兼容显示；`session.selectModel` 返回 `model-unavailable`，目录则保留先前的选择和分组。触发器自己的 `Select model` 回退仍然只是显示，不决定提示词准入（[决策](../../../.agents/notes/implemented/architecture/2026-08-14-external-text-prompt-execution.md)）。

facade 按会话惰性解析（`ctx.modelDirectories.directoryFor(sessionId)`），随会话作用域一并 dispose（资源释放）；底层权威仍保留在常驻 runtime Session 上。composer 入口从框架的常驻 `useSession` 订阅派生可见性，而不是读取一次性注入的 boolean，因此 ordinary／addressed 切换无需重建 identity-stable provide bundle 即可收敛。已寻址 subagent 会话不公开任一入口，Session 会拒绝加载、选择与重连刷新，且不发出绑定普通 Agent 的模型 RPC，因为该 transport 会在直接 parent 继续执行路径之外激活持久化 child 历史。

转发的 owner 事件 `llm/adapters-updated` 与 `settings/document-updated` 会先使 runtime 既有常驻 Session map 中的每个权威失效。存活 facade 随即重新加载；从未 materialize facade 或 facade 已 dispose 的 Session，则必须在下一次 load 时重新读取。因此提供方拓扑、提供方目录与默认选择都能收敛，且无需平行的 UI Session registry 或单独的模型变更别名。

`/client` 导出面为插件本体（`apply`/`inject`）、`ModelDirectoryResolver`、`ModelDirectory` 及其状态形状、slot 注入面类型。

## 模型体验

间接影响。两个入口都通过仅供普通会话使用的 `session.selectModel` RPC 提交完整的 `ModelSelection`；Host 会在下一次提示词组装边界对其进行快照，因此后续请求采用所选提供方、模型与推理强度，而运行中的步骤保留已组装选择。只有当现有请求头记录一次实际采用该选择的请求后，选择才会持久化；菜单交互不会添加提示词内容。

#### KV Cache 影响

切换路由可能减少提供方侧后续请求的缓存复用，或使其失效；提示词前缀本身不受影响。

## 已知限制与暂缓事项

- **无创建期或已寻址 subagent 选择**——两个入口都要求既有普通会话的 agent；没有可纳入会话创建的草稿阶段模型选择，subagent 继续执行也有意不公开独立的模型选择约定。
- **目录名仅供呈现**——选择与持久化使用提供方／模型／推理强度 id；目录查询或确切模型元数据查询失败的提供方以不可选失败行列出，重新加载前保持原样。
- **不能任意输入推理强度**——composer 仅提供确切模型由适配器公布的推理强度；适配器没有推理元数据时不显示 Effort 行。
