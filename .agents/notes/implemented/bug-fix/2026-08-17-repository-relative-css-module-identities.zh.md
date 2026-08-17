# Agent Note: 基于仓库相对路径的 CSS Module 标识

Status: implemented

[English](2026-08-17-repository-relative-css-module-identities.md) | 中文

## Problem

Client bundle 插件把样式表的绝对路径传给 Lightning CSS。Lightning CSS 会把该文件名纳入 CSS Module 哈希，因此同一提交位于两个干净 checkout 时会生成不同的类名和不同的 `lib/client.js` 字节。可复现的 package materialization 无法区分源码漂移与 checkout 位置漂移。

## Decision

CSS Module resolver 的虚拟模块 id 只编码仓库相对 POSIX 路径。loader 校验这个规范 id，在配置的仓库 root 下还原绝对样式表路径用于读取和注册 watch，并把同一个相对路径作为 `filename` 传给 Lightning CSS。空路径、绝对路径、反斜杠、驱动器或流分隔符、非规范路径段以及所有父目录穿越都会在文件 I/O 前失败，因此 checkout root 和逃逸文件都不会进入生成模块标识。

仓库相对路径仍是标识输入的一部分。同一源码路径在不同 checkout root 下会生成相同类名和 Rolldown region comment，不同 package 或样式表路径仍会形成不同哈希输入。loader 还会在构造序列化 JavaScript class map 前对 Lightning CSS export key 排序，在不改变任何 key 或 value 的前提下消除 transform 插入顺序对字节的影响。

## Verification

Client bundle CSS 测试会在两个不同绝对 checkout root 下创建相同样式表，并要求虚拟 id、生成模块源码和完整 Rolldown bundle 字节相等。测试还要求不同相对路径生成不同标识，证明非法及仓库外虚拟 id 会在 read/watch I/O 前失败，并继续证明 loader watch 的是还原后的绝对源文件。重复打乱 CSS export 插入顺序必须得到相同序列化结果，而 key 或 value 变化必须改变输出。

## Alternatives considered

**接受不同 checkout root 生成不同 package 字节。** 这会让 artifact provenance 依赖未记录的机器路径，并使两次独立 fresh-build 的比较失去意义。

**在 bundle 完成后重写生成的类名。** 后处理必须把 JavaScript、内嵌 CSS 和 source map 作为同一个 artifact 理解，并会在受支持的编译器之后引入第二条转换链。

**始终在一个固定绝对路径构建 artifact。** 全局路径会串行化互不相关的构建，在中断后遗留陈旧状态，而且仍会把机器特定的文件系统布局编码进发布字节。

## Consequences

CSS Module 标识和生成的 client-bundle 字节可以跨干净 checkout 位置复现，并继续对仓库相对文件位置与 export 内容敏感。由该构建插件处理的样式表必须位于仓库 root 内并使用规范的相对虚拟 id；非法或逃逸标识会在文件访问前终止构建。编译器 region comment、CSS Module 哈希和 source map 均保持启用，也不引入构建后重写步骤。
