# Agent Note：原子化有序 Session 历史插入

Status: implemented

[English](2026-08-22-atomic-session-history-insertion.md) | 中文

## 问题

某些权威会话提供方可能在后续 turn 已经投影以后，继续扩展一个更早、已经关闭的 turn。Session 物理日志按设计只能追加，所以普通 `Session.append()` 只能把后来发现的事件组写到物理尾部。改写或截断已经持久化的记录会削弱恢复、观察和审计保证；建立平行 transcript 存储则会产生第二个历史权威。

原有公共 history 路径还同时把物理 `seq` 用作持久化位置和展示顺序。因此，若不破坏客户端连续分页，或不把 provider 特例扩散到 Session、persistence、Host 与 UI，就无法把后来发现的事件组显示在已经保存的后续 turn 之前。

## 决策

由 `@deepseek-ai/dsh-session` 提供 provider-neutral 的原子 history capsule。`Session.insertHistoryGroup()` 接收稳定 receipt、稳定逻辑锚点以及一个或多个完整关闭的 turn，并且只追加一条必需的 `session/history-insert` 物理记录。普通 `Session.append()` 在类型和运行时都拒绝这个控制类型，因此调用者无法发布只组装了一部分的 capsule。

有序插入被刻意限制在“尚未发布”的准备阶段。调用者先 prepare 或 restore 一个 detached Session，完成全部插入，然后通过 `ctx.sessions.enter()` 与 `ctx.sessions.announce()` 发布。一旦 Session 已 attached 到 live store，`insertHistoryGroup()` 就会以 `LIVE_SESSION_UNSUPPORTED` 失败。这样可防止已经打开会话的客户端看到旧逻辑序号在运行中发生位移。

规范化的 `Session.history` fold 会把 capsule 展开为不可变 `entries` 和连续逻辑 `events`。普通物理事件的稳定逻辑身份由物理 seq 派生；插入成员的身份由 receipt 和成员序号派生。逻辑事件视图按照展示顺序重新编号执行 turn 与 step，但不会改动物理日志或 capsule bytes。`materializeSessionHistory()` 为脱离 live Session 的 persistence 读取提供同一 fold。

Receipt 是精确幂等键。重复应用完全相同的 command 是 no-op；用同一 receipt 表示不同 bytes 会失败关闭。缺失锚点、在 turn 内部插入、不完整事件组、畸形嵌套 message、重复 receipt 和损坏的来源引用，都会在 Session 发布或变更前被拒绝。一个 capsule 在 JSONL 中是一条 record，在 SQLite 中是一行，因此直接复用现有 backend 的 record 原子性与 torn-tail 合同，不增加 backend 专用事务协议。

Host history carrier 对规范化逻辑事件分页。普通 live 物理 append 在发送前转换为当前逻辑 seq；projection watermark 也在同一 wire 边界转换。Capsule 本身不属于 transcript，因此不会作为 transcript event 发送。分页把同一 insertion receipt 的全部成员视为不可拆分的事件组：如果请求边界或页面配额落在组内，页面会扩展或退回到 receipt 边界，不会暴露半个插入组。这样客户端 conversation assembler 可以继续使用现有的连续数字 seq 合同，而 persistence 与 projection 服务内部仍保留物理 seq。

Fork 请求仍以逻辑 history 边界为准。Host 会把所需的已完成 turn 前缀映射回物理来源记录，并验证该物理前缀重新物化后与请求的逻辑前缀精确相等。若一个前缀必须拆开 capsule 才能表达，就不存在可信的物理 seed，因此返回 `fork-unavailable`；包含完整 capsule 的完整前缀仍可 fork。Host 不会猜测邻近切点。

预发布 Session format 版本继续保持 `0`。旧 runtime 不会静默误读 capsule：该事件是 required event，不在旧版生成的 known-event catalog 中，因此 persistence load 会拒绝它。仓库预发布策略不提供兼容迁移；重新生成的 catalog 会记录这项新的 required vocabulary。

## 考虑过的替代方案

**把物理日志改写为时间顺序。** 不采用，因为它会改变 persistence 与 projection 消费方已经观察到的历史，并且让 crash recovery 依赖多记录改写事务。

**把每个插入成员作为普通事件逐条追加。** 不采用，因为 crash 或 observer failure 可能暴露半个关闭事件组，而且物理尾部顺序依然不等于展示顺序。

**建立 provider-specific 的旁路 transcript。** 不采用，因为它会产生第二个执行/历史权威，并绕过 stock Session、persistence、Host 与 client 行为。

**增加通用 history edit DSL。** 当前 seam 不采用，因为并不需要 move/delete/replace。单一的 anchored whole-group insertion 更小，可以作为一个领域操作整体校验；只有出现新的已证明需求时才扩展。

**使用小数或留空档的数字 seq。** 不采用，因为 client paging、surface reference、projection 与 persistence 都依赖连续 safe-integer seq。稳定逻辑身份加连续物化视图可以保留这些合同。

## 后果

- Session 物理存储继续保持 append-only、backend-neutral；一个逻辑事件组只对应一个物理 commit。
- 需要按时间顺序读取 transcript 的消费者使用 `Session.history` 或 `materializeSessionHistory()`；原始 `Session.events` 继续表示物理 persistence/audit 日志。
- 即使发生插入，Host history 与 live frame 对现有客户端仍保持连续；内部 projection watermark 继续以物理日志为权威。分页绝不会拆开同一个 receipt 事件组。
- Fork 保留逻辑边界语义，但只有在某个精确物理前缀能重新物化为该逻辑前缀时才成功；落在插入组内部的边界会失败关闭。
- 插入范围有意限制为：在稳定的后续 `turn/start` 锚点之前插入完整关闭的 turn。Mid-turn editing、删除、任意重排以及并发多写者合并仍不支持，并会失败关闭。
- 新 required event type 会明确进入兼容性 gate；旧的预发布 reader 会拒绝而不是跳过它。
