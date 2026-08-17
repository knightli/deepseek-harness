# Agent Note: 基于仓库相对路径的 CSS Module 标识

Status: implemented

[English](2026-08-17-repository-relative-css-module-identities.md) | 中文

## Problem

Client bundle 插件把样式表的绝对路径传给 Lightning CSS。Lightning CSS 会把该文件名纳入 CSS Module 哈希，因此同一提交位于两个干净 checkout 时会生成不同的类名和不同的 `lib/client.js` 字节。可复现的 package materialization 无法区分源码漂移与 checkout 位置漂移。

## Decision

CSS Module loader 继续使用绝对样式表路径读取文件和注册 watch，但作为 `filename` 传给 Lightning CSS 的值改为仓库相对 POSIX 路径。转换会拒绝空路径、绝对结果和所有父目录穿越，因此仓库外的样式表无法取得仓库内标识。

仓库相对路径仍是标识输入的一部分。同一源码路径在不同 checkout root 下会生成相同类名，不同 package 或样式表路径仍会形成不同哈希输入。

## Verification

Client bundle CSS 测试会为两个绝对 root 下的同一相对样式表计算 Lightning CSS 标识并要求结果相同。测试还要求不同相对路径生成不同标识、仓库外路径失败，并继续证明 loader watch 的是绝对源文件。

## Alternatives considered

**接受不同 checkout root 生成不同 package 字节。** 这会让 artifact provenance 依赖未记录的机器路径，并使两次独立 fresh-build 的比较失去意义。

**在 bundle 完成后重写生成的类名。** 后处理必须把 JavaScript、内嵌 CSS 和 source map 作为同一个 artifact 理解，并会在受支持的编译器之后引入第二条转换链。

**始终在一个固定绝对路径构建 artifact。** 全局路径会串行化互不相关的构建，在中断后遗留陈旧状态，而且仍会把机器特定的文件系统布局编码进发布字节。

## Consequences

CSS Module 标识可以跨干净 checkout 位置复现，并继续对仓库相对文件位置敏感。由该构建插件处理的样式表必须位于仓库 root 内；逃逸路径会在作为 CSS Module 标识输入读取前终止构建。
