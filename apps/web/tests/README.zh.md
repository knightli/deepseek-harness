# apps/web 浏览器 e2e

[English](README.md) | 中文

这些测试在进程内启动真实的 web 组合，并用真实 Chromium 通过真实 HTTP 驱动它。该 lane
的运行机制——模式、fixture、golden，以及与 `dsh web` 之间刻意保留的组合差异——记录在
[`scaffold.ts`](scaffold.ts) 和
[浏览器 e2e Agent Note](../../../.agents/notes/implemented/testing/2026-07-24-web-gui-browser-e2e-lane.md)中。

## 这些是 Host 面的测试

它们在根 `tsconfig.host.json` 中做类型检查，而不在 Client aggregate 中，因为它们直接读取
Host 服务：`ctx.apiProxy`、Host 侧 `SessionStore`、`ctx.sessionProjectionCache`。运行时驱动
浏览器并不使一个文件成为 Client 程序的一部分——两个 face 在相同的键上以不同服务合并 cordis
`Context`，因此单个程序无法同时看见两者。把这些文件挪进 Client aggregate 会让每一处
Host 服务访问都无法编译。

## 借用测试世界与 Loader fixture

`launchWebScaffold()` 默认拥有并删除临时 workspace 与持久化根目录。重启场景可以传入
`workspaceCwd` 和 `persistenceRoot` 来借用由调用方拥有的根目录：此时 `close()` 只关闭组装后的
Host，调用方必须等该关闭完成后才能复用这些根目录，并在最后一台 Host 停止后删除两者。

组装后的外部 Agent 场景会把确定性工厂暴露为 Loader builtin，但仍通过 `cordis:` 配置行挂载。
scaffold 把测试 fixture 复制到隔离 profile，并用生产模块解析器导入，因此 scope 与 registry
包的 singleton 和已发布组合使用的是同一实例。不要把这条路径换成直接调用
`ctx.agents.setFactory()`：那只会测试私有 harness 捷径，而不是应用的 Loader seam。只在第一台
Host 上重置进程缓存的 fixture trace，并从实际挂载该 fixture 的 scaffold 读取它。

## 不要在此 import `@deepseek-ai/dsh-client-*`

import 一个 Client 包——无论值还是类型——都会把它整个 TypeScript 工程、以及它引用的每个工程
拉进 **Host 构建图**。这已经坑过本 lane 一次：四个 Client 消费方包引用了 `api/remotes` 的
Client face，而该 face 必须等 Host tsdown 生成 `@deepseek-ai/dsh-goal/remote` 之后才能编译，
于是 Host 构建阶段变成在等一个由它自己产出的产物。

当某个场景需要 Client 持有的常量或纯函数时，改为在此处镜像一份，并紧挨着一条注释掉的
import 点明源模块。这样漂移会表现为选择器未命中或镜像值过期——是响亮的失败，绝不会是静默
通过。`scaffold.ts` 按此规则镜像欢迎声明的 namespace、确认字段、版本和被断言的中文文案。

有两类 Client import 是长期成立的。`assembled-boot.ts` 驱动 shell 本身，因此它从
`@deepseek-ai/dsh-client-web` import `AppWebEntry`、从
`@deepseek-ai/dsh-client-modules/client` import boot manifest 类型：启动真实 shell 正是该
harness 的用途，且这两个包本来就在 Host 图中。另外，chat 场景从
`@deepseek-ai/dsh-client-runtime/client` import `conversationContextKey`，因为
`client/runtime` 经未拆分的 `directory-picker` 包可达，且不会再牵入别的东西。这种可达性是
偶然而非保证——一旦它离开该图，就像其余情形那样镜像该 helper。

没有任何机制强制这条规则；靠 review 守住它。
