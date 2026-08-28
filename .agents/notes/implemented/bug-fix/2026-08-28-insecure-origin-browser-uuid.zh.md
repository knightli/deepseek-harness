# Agent Note: 不安全来源的浏览器 UUID 兼容

Status: implemented

[English](2026-08-28-insecure-origin-browser-uuid.md) | 中文

## Problem

已认证的 Web 客户端支持通过明文 HTTP 访问显式信任的私有局域网权威，但这类浏览器来源不是安全上下文。浏览器可能在其中暴露 `crypto.getRandomValues`，却不提供 `crypto.randomUUID`。客户端包若在就绪握手时调用 `crypto.randomUUID`，会在发出 `host.describe` 之前失败，随后连接清理会关闭两条本来健康的 WebSocket 下行。因此，传输与 Gateway 探针可能通过，而页面仍显示断开连接。

## Decision

立即加载的 `@deepseek-ai/dsh-client-connection` 浏览器 apply 会在原生 `crypto.randomUUID` 存在时保留它。当该方法缺失时，它会在挂载 API 客户端或加载下游客户端插件前，安装一个由 `crypto.getRandomValues` 支撑的 RFC 4122 版本 4 实现。

兼容方法位于 connection 包的私有 `random-uuid.ts` 模块中。该包已拥有第一阶段浏览器协议启动，并已使用同一生成器提供本地 RPC 与 fixture UUID。在这个边界一次安装，还会覆盖 API-proxy RPC 关联标识和客户端消息身份等打包后的消费方，无需新增公开包，也无需在每个调用点重复回退逻辑。

明文 HTTP 仍是不安全传输。这项兼容只是让现有合同已允许的、经认证且显式信任的私有局域网部署能在对应浏览器环境中工作。

## Alternatives considered

**要求所有局域网访问都使用 HTTPS。** 本次修复否决该方案，因为证书配置与信任分发不在当前私有局域网 Gateway 合同内；改变部署合同也无法修正已交付的明文 HTTP 路径。

**在每个 `crypto.randomUUID` 调用点添加回退。** 已否决，因为这会复制对安全敏感的 UUID 代码，容易遗漏调用点，也会让未来打包进来的客户端包重复同一环境检查。

**创建新的共享 UUID 包。** 已否决，因为它会为一条浏览器启动兼容规则扩展包与制品图。立即执行的 connection 插件已先于受影响的下游客户端运行，是现有最窄的归属边界。

## Consequences

- 安全上下文浏览器继续使用原生实现，不会被替换。
- 不安全来源仍需要 `crypto.getRandomValues`；缺失 Web Crypto 的环境仍会失败，不会回退到弱随机。
- connection apply 会在下游客户端插件加载前，对浏览器 `crypto` 对象执行一次变更。
- 该变更恢复了经认证、显式信任的明文 HTTP 局域网来源上的浏览器就绪，但不增加机密性或传输完整性。

## Testing

connection apply 测试使用具有不安全来源形状的 `crypto` 对象挂载真实 `WebApiClient`，并证明 `host.describe` 与 `respond` 都到达 HTTP。配套用例证明原生 `randomUUID` 实现会被保留。组装 Web 测试按生产顺序加载不含 `crypto.randomUUID` 的已构建客户端 bundle，达到已渲染的 Session 树，并证明下游 UUID 创建仍可用。
