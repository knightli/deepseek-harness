# Agent Note: 在发布 Session 前拒绝不支持的 agent preset

Status: implemented

[English](2026-08-16-reject-unsupported-agent-preset-before-session-publication.md) | 中文

## Problem

未配置 agent preset 名单的部署会在 `session.create` 省略 `agentPreset` 时使用 Host 组装。同一条组装路径也会接受显式 preset id，在未记录该 id 的情况下发布新的 Agent 与 Session，然后才以接管冲突拒绝请求。调用方既看到误导性的错误，也看到由不支持请求创建的 Session。

## Decision

`session.create` 会在进入按 Session id 共用的创建 single-flight 前执行请求本地 admission。没有名单时，省略仍使用共享 Host 组装；全新 identity 显式指定 id 时，会在创建 Agent 前返回既有 `noRoster()` 响应及字段稳定的 `agent-preset-not-found`。live 与 persisted identity 则继续进入既有的 ownership、cwd 与不可变 composition 检查。

即使已记录的 preset 抵达共享 composition 解析器，该解析器仍保留无名单时的既有行为。因此，移除名单后的冷恢复与 fork 不受影响，而在已有的无 preset Session 上指定 preset 仍返回 `agent-preset-conflict`。全新发布边界会再次执行无名单检查，以防已有 identity 在 admission 后消失；若省略 preset 的等待方加入了这项请求专属失败，它会在 single-flight 清除后重试，因此仍可创建 identity，且不会继承另一个调用方的不支持 preset。

## Verification

API proxy preset 测试套件比较拒绝前后的 `session.list`，观察公开 Host stream 以证明没有 publish-and-rollback frame 外泄，固定完整的类型化错误，让显式命名请求与省略 preset 的请求争用同一个 Session id，并在 admitted identity 于创建前消失时重复这项竞争。一项无密钥 real-Loader 测试会挂载 Session registry、Agent registry、runtime fixture 与 ApiProxyService，再通过 fetch/SSE carrier 驱动行为，并证明 factory 调用、Session 与 Host frame 均为零。相邻接管测试继续固定已有 Session 的独立行为。

## Alternatives considered

**从共享 composition 解析器抛出名单不可用异常。** 全新创建、冷恢复与 fork 都使用该解析器，而并发调用方会按 Session id 共用同一个创建 Promise。把请求专属失败放在那里，既会破坏移除名单后的已记录历史路径，也会让一个调用方的 preset 污染另一个调用方的结果。

**先创建 Session，再在发现缺少名单后回滚。** Session 注册表与 Host 通知都能观察到发布行为。回滚无法消除不支持请求造成的瞬时副作用。

## Consequences

不支持的显式 preset 无法新增 Session 行或 Agent，调用方会收到一项稳定的名单错误。无名单部署的默认行为、已有 Session identity 检查、冷恢复、fork 与调用方中立的 Session id single-flight 均保持不变。只有显式指定 id、未配置名单且 identity 尚未 live 的请求，admission 才会额外读取一次 persistence 名单。
