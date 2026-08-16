# Agent Note: 在发布 Session 前拒绝不支持的 agent preset

Status: implemented

[English](2026-08-16-reject-unsupported-agent-preset-before-session-publication.md) | 中文

## Problem

未配置 agent preset 名单的部署会在 `session.create` 省略 `agentPreset` 时使用 Host 组装。同一条组装路径也会接受显式 preset id，在未记录该 id 的情况下发布新的 Agent 与 Session，然后才以接管冲突拒绝请求。调用方既看到误导性的错误，也看到由不支持请求创建的 Session。

## Decision

Host 组装解析器会区分省略 preset 与显式 id。没有名单时，省略仍使用共享 Host 组装；显式 id 则会在创建 Agent 前产生名单不可用错误。`session.create` 通过既有 `noRoster()` 响应把该错误映射为字段稳定的 `agent-preset-not-found`。

已有 Session 的接管仍是独立情形。系统会在需要解析器前检查其已记录组装，因此在已有的无 preset Session 上指定 preset 仍返回 `agent-preset-conflict`，不会改变该 Session 的身份。

## Verification

API proxy preset 测试套件通过公开 Host API 创建会话，比较拒绝前后的 `session.list`，并固定完整的类型化错误。相邻接管测试继续固定已有 Session 的独立冲突行为。

## Alternatives considered

**没有名单时，在 `session.create` 处理器中拒绝每一个显式 preset。** 若不复制解析器的身份判断，该检查无法区分新建与接管已有无 preset Session，并会替换后者既有的冲突响应。

**先创建 Session，再在发现缺少名单后回滚。** Session 注册表与 Host 通知都能观察到发布行为。回滚无法消除不支持请求造成的瞬时副作用。

## Consequences

不支持的显式 preset 无法新增 Session 行或 Agent，调用方会收到一项稳定的名单错误。无名单部署的默认行为与已有 Session 身份检查保持不变。解析器新增一种内部失败类型，使 RPC 处理器能够保留既有协议错误词汇。
