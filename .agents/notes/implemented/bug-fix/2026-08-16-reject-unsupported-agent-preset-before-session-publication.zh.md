# Agent Note: 在发布 Session 前拒绝不支持的 agent preset

Status: implemented

[English](2026-08-16-reject-unsupported-agent-preset-before-session-publication.md) | 中文

## Problem

未配置 agent preset 名单的部署会在 `session.create` 省略 `agentPreset` 时使用 Host 组装。同一条组装路径也会接受显式 preset id，在未记录该 id 的情况下发布新的 Agent 与 Session，然后才以接管冲突拒绝请求。调用方既看到误导性的错误，也看到由不支持请求创建的 Session。

## Decision

`session.create` 会在进入按 Session id 共用的创建 single-flight 前执行请求本地 admission。没有名单时，省略仍使用共享 Host 组装；全新 identity 显式指定 id 时，会在创建 Agent 前返回既有 `noRoster()` 响应及字段稳定的 `agent-preset-not-found`。live 与 persisted identity 则继续进入既有的 ownership、cwd 与不可变 composition 检查。

即使已记录的 preset 抵达共享 composition 解析器，该解析器仍保留无名单时的既有行为。因此，移除名单后的冷恢复与 fork 不受影响，而在已有的无 preset Session 上指定 preset 仍返回 `agent-preset-conflict`。全新发布边界会在防御性无名单检查旁捕获同一个确切 roster，并且发生在创建项目目录的挂起点之前。其 setup 调用 `mountForPublication()` 并把 receipt 返回 Agent 工厂；该 receipt 会在全部 setup await 结束后、紧邻发布前同步重新验证被捕获的 roster 代际、常驻 scope/root fiber 与精确 scope binding。卸载或同 fiber 重启因而会返回字段稳定的空 roster 错误，并回滚尚未发布的 Agent 与 Session，而不会发布一个 Host composition world。

按 Session id 共用的 single-flight 会随 Promise 一并记录完整的调用方本地 `{ cwd, presetId }` admission tuple。加入不同 tuple 的等待方会在 owner 结束后重新执行自身按序的 ownership、cwd 与不可变 composition admission，不论 owner 成功还是失败。一个调用方的 roster、cwd 或 persisted-preset 结果因此不会变成另一个调用方的错误分类。

## Verification

API proxy preset 测试套件比较拒绝前后的 `session.list`，观察公开 Host stream 以证明没有 publish-and-rollback frame 外泄，固定完整的类型化错误，验证 composition 在目录创建前已被捕获，让显式命名与省略调用方争用同一个 Session id，并覆盖 owner 成功或失败、等待方同时在 cwd 与 preset 上不同的情形。一项无密钥 real-Loader 测试会挂载 Session registry、Agent registry、runtime fixture 与 ApiProxyService，再通过 fetch/SSE carrier 驱动行为，并证明 factory 调用、Session 与 Host frame 均为零。AgentPresets 套件会在真实 Agent setup 取得 receipt 后暂停，卸载或重启精确 roster fiber，并证明 commit 拒绝、registry 回滚及旧 receipt 永久撤销。

测试还会先在只禁用可选 roster 的情况下启动已发布的 `dsh web` profile；其公开 HTTP 结果和未变化的 Session 列表固定在 `apps/web/tests/snapshots/no-roster-preset-admission/protocol.expected.json`。第二项已发布 profile 测试会挂载真实 `standard` preset，在 Host 预解析与 Agent setup 之间暂停公开 HTTP `session.create`，卸载真实 roster entry，并证明相同的稳定错误且没有新增 Session identity。相邻接管测试继续固定已有 Session 的独立行为。

## Alternatives considered

**从共享 composition 解析器抛出名单不可用异常。** 全新创建、冷恢复与 fork 都使用该解析器，而并发调用方会按 Session id 共用同一个创建 Promise。把请求专属失败放在那里，既会破坏移除名单后的已记录历史路径，也会让一个调用方的 preset 污染另一个调用方的结果。

**先创建 Session，再在发现缺少名单后回滚。** Session 注册表与 Host 通知都能观察到发布行为。回滚无法消除不支持请求造成的瞬时副作用。

**把补丁扩大到 child `composeFrom()` 与两个 subagent driver。** stock child 路径不返回 preset receipt，因此 child 发布也可能穿越同一项通用 roster-HMR 边界。该路径早于本次 Host admission 缺陷，不经过 Task 3.6 的公开 `session.create` RED，需要独立 caller-public gate 与 composite commit 设计。把它折入这份 Host 薄补丁会悄然扩大获授权的 upstream 变更。

## Consequences

不支持的显式 preset 无法新增 Session 行或 Agent，调用方会收到一项稳定的名单错误。已准入的 Host setup 若在发布前失去 roster 代际，也会在精确发布边界得到同样的可观察结果。无名单部署的默认行为、已有 Session identity 检查、冷恢复与 fork 保持不变，并发分类则对完整请求 tuple 保持本地。只有显式指定 id、未配置名单且 identity 尚未 live 的请求，admission 才会额外读取一次 persistence 名单。

receipt 保证的是 Host 创建时的发布安全，而不是 roster HMR 全生命周期连续性。roster 卸载或重启仍会拆掉既有 live agent 使用的常驻组装，stock child `composeFrom()` 发布路径也仍在本补丁之外。二者都需要独立的生命周期设计与 gate，才能记录更强保证。
