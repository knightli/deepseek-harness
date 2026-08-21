# Agent Note: 工作区分叉拒绝对用户可见

Status: implemented

[English](2026-08-21-workspace-fork-rejection-is-visible.md) | 中文

## Problem

原生 Workspace Browser 会为每个已列出的 Session 显示“分叉会话”菜单项。其组合适配器会启动 `sessions.fork`，成功时打开子 Session，却会吞掉所有拒绝。于是，当某个部署的 Agent 报告 `fork` 不可用时，Host 边界虽然会正确拒绝请求，但原生 DSH UI 不会给用户任何可见结果。

## Decision

Workspace Browser 注入的 `forkSession` 动作现在返回 `Promise<void>`。适配器等待 Host 完成分叉，只在成功后打开子 Session，并把拒绝交还给发起该手势的原生 browser surface 处理。适配器把 runtime 的结构化 `SessionForkError` 映射为 UI 安全的三态结果：已证明的准入拒绝、已知的创建后失败，以及 transport 不确定性导致的发布结果未知。该 surface 通过现有 `Toast` primitive 发布不同的本地化提示，绝不渲染 carrier 或 Host 的原始文本；结果未知时会要求先刷新 Session 列表再重试。每次发布的序号负责重新挂载相同提示；稳定的完成回调则防止无关的 browser 重渲染重置 Toast 生命周期。

本变更保持 capability-neutral：它不检查 Agent 名称，不复制 Session capability，不隐藏菜单，不替换 sidebar，也不引入平行 interaction store。Host admission 仍是权威；准入失败时，当前 Session 选择保持不变。

## Verification

适配器测试证明成功路径会打开返回的子 Session；没有子 Session、创建后失败和 transport 结果未知都会以稳定动作结果向调用方传播，且不会发生第二次打开。Workspace Browser 测试从原生行菜单发起动作，观察三种结果各自的 `role="alert"` 文案，证明原始错误没有渲染，确认当前选择未改变，并验证无关重渲染不会延长 Toast 的四秒生命周期。聚焦的 `ui-workspace` 组件测试、client library build、文档门以及下游 assembled WebUI 验收共同覆盖该 package 边界。

## Alternatives considered

**吞掉拒绝，只依赖没有出现子 Session 行。** 没有可见反馈时，明确的 capability 拒绝与点击失效无法区分。

**把 Session capability 复制到 workspace state 并禁用菜单。** 这会只为一个动作新增第二份 capability projection 及其同步契约。Host 已提供稳定的 fail-closed admission；把拒绝呈现出来是更小的通用 seam。

**渲染原始错误消息。** Carrier 细节不是稳定的用户契约，也可能泄露实现数据。固定的本地化文案能让 UI 保持确定且安全。

## Consequences

`WorkspaceBrowserInjected.forkSession` 变为可等待且可感知结果。现有成功分叉继续保持打开子 Session 的行为；不受支持的分叉会在没有子 Session 时显示一次原生瞬时 alert，创建后设置失败则显示另一条提示并保留列表中的子 Session，transport 不确定性不会声称是否发布，并要求先刷新再重试。三条路径都不移动当前选择。
