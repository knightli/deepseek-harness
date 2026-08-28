# Agent Note: 外部 Session 权威

Status: implemented

[English](2026-08-22-external-session-authority.md) | 中文

## 问题

Host 此前把每个持久化 Session 都视为本地权威。对于把其他运行时所拥有会话投影进来的部署，虽然可以列出已导入的历史，但之后再次打开该行时，没有公共机制对账新增历史，也无法把重命名路由回真正的拥有者。如果把某个部署的专用逻辑直接放进通用 API gateway，就会让 Host 绑定到单一 provider，并有形成第二份执行历史的风险。

## 决策

`@deepseek-ai/dsh-host-apiproxy` 暴露可选的 `SessionAuthority` service。`refresh(sessionId)` 会在向客户端提供外部拥有的冷态或空闲 Session 尾页、或恢复该 Session 之前执行；`rename(sessionId, title)` 会先修改外部拥有者，再把对方接受的标题投影进本地 Session。rename 返回 `undefined` 表示该 Session 不归外部权威所有，Host 随即保留普通的本地重命名路径。

目录刷新与 transcript 刷新保持分离。`refreshCatalog()` 可以建立只有 header 的 Session 行，`listMetadata(sessionId)` 则同步暴露上一次成功刷新得到的 `nonBlank: true` 提示，使这些经外部确认的会话在 transcript 投影前仍然可见。该提示不能把本地非空 Session 标为空白，Host 汇总列表行时也不执行外部 I/O。

该 seam 只依赖精确身份。provider 决定某个 `SessionId` 是否存在外部 binding；Host 不会根据标题、cwd、时间戳或内容猜测身份，也不会创建平行 Session。已经挂载并处于 running 状态的 Agent 仍是当前运行时权威，refresh 不会打断它。

外部标题使用 `SessionTitleService.projectExternal` 与 `clearExternal`。持久化事件 `session/title-cleared` 让权威可以明确移除自己的投影标题，包括替换更早的本地 fallback；同一权威仍持有空投影围栏，阻止其他外部权威、本地 rename、refresh 与自动 fallback 覆盖。因此外部报告无标题时，通用标题投影会回到 `null`，而不是保留过期展示文本。

provider 失败会在 gateway 边界收敛。对外的 history、prompt 与 rename 结果只包含稳定的 Host 错误，不会暴露 provider 路径、协议细节或凭据。Agent 解析会把外部 writer 不可用映射为带目标 `sessionId` 的 `thread-busy`；被拒绝的请求不会发布本地工作。部署 provider 自己拥有逐 Session 串行、资源生命周期与卸载 drain，因为通用 Host 无法知道外部运行时如何共享。

## 曾考虑的替代方案

**让 Host 直接理解 Codex thread ID 与 app-server 进程。** 不采用，因为 API gateway 必须保持 provider-neutral；Codex 身份、进程所有权与对账属于部署插件。

**只在 Host 启动时刷新。** 不采用，因为另一个 Host 可以在本 Host 启动后继续推进同一外部会话。尾页打开与冷恢复才是用户接力时需要新快照的边界。

**在目录刷新时加载每个外部 transcript。** 不采用，因为侧栏发现必须保持仅元数据；预先投影全部历史会让一条缓慢或异常的会话拖延整个列表。

**只在本地标题日志中镜像外部重命名。** 不采用，因为这样会展示执行权威从未接受的值，并会在下一次刷新时被覆盖。

**把外部无标题当作无操作。** 不采用，因为当权威明确报告无标题时，这会继续保留过期的本地或外部文本。

## 后果

部署可以把一个由外部拥有的会话投影到 stock DSH Session/history/title 视图，并按精确 binding 恢复，而不复制执行状态。成功的目录刷新可以立即暴露该行，同时保持完整历史的懒加载。尾页读取、writer 获取与已接受的重命名成为异步权威边界，并会在不确定时失败关闭。provider 必须串行化同一 Session 的 refresh 与 rename，并在卸载时 drain 这些操作。Host 测试固定目录可见性、公共错误收敛、`thread-busy` wire 分支与精确的外部标题投影；部署层的真实可运行 Host 测试还必须证明具体 provider 在刷新时保持单一运行时拥有者。
