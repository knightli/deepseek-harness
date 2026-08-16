# Agent Note: 重连 interaction 的 generation 归属

Status: implemented

[English](2026-08-16-reconnect-generation-interaction-ownership.md) | 中文

## Problem

浏览器连接拥有相互独立的 mux 与 host stream。任一 stream 结束时，Controller 会 abort 当前 connection generation 并启动下一代，但异步 sibling iterator 仍可能在 abort 后 yield 已排队的信封。如果该信封在下一 generation 启动后继续投递，旧 transport 数据就会被归入新的 runtime 状态。

原生 interaction UI 还存在另一项时序竞态。重连中的 Host 会在 mux stream 打开后立即回放仍处于 pending 的审批或问题，早于 readiness handshake 调用 `onConnected`。若随后的 Session resync 清除所有 pending wait，就会从可见对话中移除这项已回放且仍然有效的请求，而 Host 仍在等待。反之，若让旧响应函数继续可用，则可能回答已经失效的 RPC id。

## Decision

`ConnectionController` 分配单调递增的 generation，并在任一 stream 能够投递信封之前调用 `onGenerationStart`。每个 pump 都捕获该 generation 与其 `AbortController`；只有二者仍然有效时才调用业务 sink。Controller 会保留两个 iterator 与 pump Promise，abort 并对每个 iterator 调用 `return()`，然后在替换 generation 或让可等待的 `stop()` 完成前 join 两个 pump。stream cancellation 仍是 best effort，但忽略 abort 的 sibling 既无法把延迟数据发布到后续 generation，也无法在 teardown 后继续被持有。

`SessionManager` 与每个常驻 `Session` 会用交付 approval／question 的 generation 标记 pending 项。断连时保留已实例化 wait 与 sidebar 状态，作为可见的 Host-owned 状态，但所有响应函数都会在本地拒绝。对尚未实例化的 Session，其已缓冲可应答 frame 会被丢弃，因为失效 RPC id 没有已经渲染的 owner。新 generation 的回放会在 readiness 前替换仍有效的标识；ready 对账会移除未被回放的陈旧状态，即使常驻 Session 仍处于 cold 状态也一样，同时保留已由 ready generation 回放的 wait，并且只允许该 generation 响应。

`ConnectionHandle.connectionState` 为 `connected` 与 `reconnecting` 提供一个引用稳定的可观察 source。`ui-layout` 通过既有注入钩子通道传递它。重连期间，`AppFrame` 会在应用子树之外渲染既有 `ConnectionBanner`，并把同一个三栏根 `<fieldset>` 设为 disabled 与 inert。reset fieldset CSS 会保留网格几何，不替换 sidebar、conversation、composer、history、status 或 interaction 组件。

## Verification

Connection 测试使用忽略 abort 的 sibling stream，证明同时送入旧 stream 与当前 stream 的 frame 只会一次到达业务 sink，stop 会显式关闭 sibling iterator，并且即使 describe 与 stream-open callback 仍在等待，stop 也能完成。Runtime wire 测试通过公开 connection sink 与 Session snapshot 驱动 generation start、disconnect、ready 前回放、ready 对账（包括常驻 cold Session）、响应与解决。布局组件测试证明重连会显示 banner、禁用并 inert 原生 frame、禁用后代控件，并在恢复后反转这些状态。一项无密钥 assembled snapshot 会启动真正构建出的 Client bundle，断开 fixture stream，观察 stock reconnect banner 与被禁用的原生 approval，再证明 ready-generation 回放让同一个 interaction 恢复可用。

## Alternatives considered

**在 disconnect 或 `onConnected` 时立即清除 interaction。** 立即清除会把 Host 尚未解决的请求呈现为不存在；在 `onConnected` 清除则会与 stream 打开后、readiness 之前合法到达的回放竞态。

**在回放前继续使用上一代响应函数。** RPC id 属于已经失败的物理连接，无法证明仍可应答；本地拒绝可阻止陈旧操作进入 carrier。

**相信所有 transport 都会在 AbortSignal 触发后立即停止 yield。** `AsyncIterable` cancellation 是协作式的，已排队项目可能在 abort 后继续存在。connection owner 必须在信封进入业务状态的时刻执行 generation 归属检查。

**增加 reconnect store 或替换 interaction surface。** Connection 状态已有 object-layer owner，slot renderer 也已经能够把可观察 source 绑定为 hook；第二个 store 或平行 interaction UI 会复制权威并绕过原生 DSH composition。

## Consequences

断线期间，可见的审批或问题可能在 Host 已经解决后仍暂时留在屏幕上。它明确不可应答，reconnect banner 会说明应用不可用状态，而 ready 后的回放对账会在 Host 不再报告它时将其移除。这选择保留最后一次观察到的 Host 事实，而不是宣称一项尚未观察到的解决结果。

Connection 包新增一个公开 observable、一个 generation callback 与可等待的 stop handle；runtime 会在瞬时 wait 旁携带 generation metadata；layout 包会依赖 connection service 与 UI primitives。持久事件、wire frame、Session 日志格式、provider 行为和应用 store 均不改变。
