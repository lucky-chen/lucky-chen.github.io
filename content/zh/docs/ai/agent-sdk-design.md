---
title: Agent 工程：SDK 需求拆解与运行时架构
date: '2025-12-22'
categories:
  - AI
weight: 5
---

# 背景

本文从 Agent SDK 切入，将其作为 AI 入门的实践入口，通过以下 Agent 运行时与编排的共性需求理解 AI 应用工程：

- 运行时承载
- 接口边界
- 编排控制
- 上下文管理
- 工具接入
- 模型接入
- 权限控制
- 可观测性

<!--more-->

# 需求定义与拆解

SDK 需要提供以下可复用的运行时能力：

- **运行时承载**：管理会话生命周期、多轮执行、运行状态和结果写回。
- **API 边界**：提供稳定的会话与执行接口，隔离内部实现变化。
- **编排与执行控制**：根据请求选择执行路径，管理停止条件、失败处理和状态更新。
- **Context Management**：区分会话历史、阶段记忆和检索结果，按预算装配与裁剪上下文。
- **MCP / Tool 接入与执行**：管理工具注册、发现、调用分发和执行。
- **权限控制**：在执行前判断操作权限，并限制执行环境。
- **模型接入**：封装 provider 差异，统一模型调用和输出格式。
- **过程记录**：记录执行步骤、工具调用、失败位置和资源消耗，支持问题定位。
- **扩展能力**：为 retrieval、memory、checkpoint、compression 和 multi-agent 保留接口。

# 架构设计

## 整体架构

SDK 采用分层 runtime 架构，分别管理接口、生命周期、编排、上下文、工具、模型接入、观测与持久化。

```text
+----------------------------+
|        Application         |
| terminal / external app    |
+----------------------------+
             |
             v
+----------------------------+
|         Interface          |
| session / agent api        |
+----------------------------+
             |
             v
+----------------------------+
|    Runtime Controller      |
| lifecycle / execution      |
+----------------------------+
             |
             v
+----------------------------+
|    Agent Orchestration     |
| chat / ReAct / peo         |
+----------------------------+
     |            |            \
      v            v             v
+-------------+ +-------------+ +------------------+
|   Context   | | Capability  | |      Model       |
| Management  | | and Tooling | |   Integration    |
+-------------+ +-------------+ +------------------+
       \                            /
        \                          /
         v                        v
     +-------------------------------+
     |         Observability         |
     |       trace / metrics         |
     +-------------------------------+
              |             \
              v              v
     +--------------------------------+
     |            Data Layer          |
     |      storage / persistence     |
     +--------------------------------+
```

## Application Layer

职责：

- 提供终端和外部应用入口，处理用户输入输出并调用运行时。

包含模块：

- `TerminalSessionDemo`：读取终端输入、调用 runtime API 并展示结果。
- External Application Integrations：将 SDK 接入外部应用或宿主系统。

## Interface Layer

职责：

- 对外提供稳定的会话和执行接口，隐藏内部运行时实现。

包含模块：

- `Api`：定义 SDK 对外接口。
- `RuntimeApi`：提供 session 创建、打开和关闭接口。
- `ISession`：提供会话读取、状态查询和执行入口。
- Agent / Session API Contracts：约定 Agent 和 session API 的调用方式。

## Runtime Controller Layer

职责：

- 管理 session 生命周期、执行过程与运行状态。
- 调度运行并统一返回结果格式。

包含模块：

- `Runtime`：初始化运行时，管理 session 生命周期并分发请求。
- `AgentSession`：执行单个 session 的请求，更新状态并统一结果格式。
- `RunCheckpoint`：为 checkpoint、resume 和后台执行预留恢复接口。

## Agent Orchestration Layer

职责：

- 根据请求特点和运行状态选择执行模式。

包含模块：

- `AgentSelector`：选择执行模式。
- `ChatAgent`：处理直接对话请求。
- `ReActAgent`：循环调用工具，并根据观察结果继续执行。
- `PEOAgent`：按 plan-execute-observe 分阶段执行。
- `MultiAgentProtocol`：为多 agent 协作预留协议接口。

## Context Management Layer

职责：

- 管理会话历史、阶段记忆和检索结果。
- 按预算装配和裁剪上下文。

包含模块：

- `SessionTranscript`：保存会话历史，供后续轮次使用。
- `RuntimeMemory`：保存 agent memory（阶段记忆和摘要）。
- `RetrievalProvider`：获取检索结果。
- `ContextAssembler`：装配不同来源的上下文。
- `ContextBudgetPolicy`：控制上下文预算和裁剪策略。

## Capability and Tooling Layer

职责：

- 管理工具注册、发现、调用分发与执行。
- 执行权限检查，约束工具运行环境。

包含模块：

- `McpGateway`：接收工具调用请求并分发执行。
- `McpToolRegistry`：管理工具注册、发现和查找。
- `RuntimePermissionPolicy`：执行前检查权限和能力约束。
- `ExecutionEnvironment`：定义本地、沙箱和远端执行环境。

## Model Integration Layer

职责：

- 封装 provider 和调用方式的差异，统一模型接口与输出。

包含模块：

- `ModelFactory`：创建模型实例并选择接入方式。
- Provider Adapters：适配不同 provider 的接口。
- `StreamingEventAdapter`：统一流式事件与输出格式。

## Observability Layer

职责：

- 记录关键事件、调用链和运行指标，支持追踪与诊断。

包含模块：

- `Trace`：记录关键事件和调用链。
- `Metrics`：统计运行指标、资源消耗和调用情况。
- Diagnostics / Usage：提供诊断信息和使用记录。

## Data Layer

职责：

- 通过统一接口持久化 transcript、memory、checkpoint、trace 和 metrics。

包含模块：

- `Storage`：定义持久化接口。
- File / Remote Persistence Backends：实现文件或远端存储。

# 当前实现状态

| Layer | 模块 | 当前状态 | 说明 |
| --- | --- | --- | --- |
| `Application Layer` | `TerminalSessionDemo` | 基础实现 | 提供终端入口，可手动运行并验证 session 流程。 |
| `Interface Layer` | `Api` / `RuntimeApi` / `ISession` | 基础实现 | 提供面向 session 的接口。 |
| `Interface Layer` | `AgentApi` / `IAgent` | 基础实现 | 提供 session API 之外的直接 agent 调用入口。 |
| `Runtime Controller Layer` | `Runtime` / `AgentSession` | 基础实现 | 支持 session 生命周期、执行、状态更新与结果格式统一；复杂运行控制仍待扩展。 |
| `Runtime Controller Layer` | `RunCheckpoint` | 部分完成 | 已预留 checkpoint 接口；恢复、重试和后台执行尚未完成。 |
| `Agent Orchestration Layer` | `AgentSelector` / intent routing | 部分完成 | 支持执行路径选择。 |
| `Agent Orchestration Layer` | `ChatAgent` / `ReActAgent` / `PEOAgent` | 基础实现 | 已实现三类执行路径。 |
| `Agent Orchestration Layer` | `MultiAgentProtocol` | 预留扩展 | 已预留协议，尚未接入当前执行流程。 |
| `Context Management Layer` | `SessionTranscript` / `RuntimeMemory` / `ContextAssembler` / `ContextBudgetPolicy` | 部分完成 | 支持历史、阶段记忆、上下文装配和预算控制；复杂场景处理仍待完善。 |
| `Context Management Layer` | `RetrievalProvider` | 部分完成 | 已定义检索接口；完整 retrieval / RAG 流程尚待实现。 |
| `Capability and Tooling Layer` | `McpGateway` / `McpToolRegistry` / `RuntimePermissionPolicy` / `ExecutionEnvironment` | 基础实现 | 支持工具接入、分发、权限控制和执行环境定义。 |
| `Model Integration Layer` | `ModelFactory` / `StreamingEventAdapter` | 基础实现 | 支持统一模型调用与流式事件适配。 |
| `Model Integration Layer` | Provider Adapters | 部分完成 | 已接入 mock 和现有 provider，覆盖范围有限。 |
| `Observability Layer` | `Trace` / `Metrics` | 基础实现 | 已记录执行流程中的关键事件与指标。 |
| `Observability Layer` | Diagnostics / Usage | 部分完成 | 已有基础运行记录；完整诊断视图尚未实现。 |
| `Data Layer` | `Storage` / File Persistence | 基础实现 | 已实现存储接口和文件持久化。 |
| `Data Layer` | Remote Persistence Backends | 预留扩展 | 已预留接口，尚未实现远端存储。 |

# 设计原则与对照

## SDK 设计原则

- **区分共享运行时与业务逻辑**：SDK 管理会话、执行和能力接入，应用定义业务任务与规则。
- **集中执行控制**：工具调用经过注册、分发、权限检查和执行环境约束。
- **分别管理上下文来源**：transcript、agent memory 和 retrieval 各自维护，由预算策略决定当前轮次使用的内容。

## 与业界 Agent SDK 的对照维度

- **运行控制**：会话生命周期、执行模式、状态更新、停止与恢复。
- **能力覆盖**：工具和模型接入、多 agent、长期记忆与权限策略。
- **运行保障**：追踪、持久化及复杂场景的稳定性。

当前项目主要用于梳理运行时分层与接口职责。恢复、重试、后台执行、多 agent 和远端持久化等能力仍有待实现，具体状态见上表。

## 与既有工程经验的对照

沿用的工程方法：

- 明确需求与系统边界，区分 SDK 职责和应用职责。
- 通过稳定接口隔离内部实现变化。
- 分离执行控制、能力接入和数据持久化。

Agent 系统需要额外关注：

- **LLM 输出的不确定性**：输出变化会影响执行控制、调试和结果验证。
- **动态上下文**：每轮根据历史、记忆、检索结果和预算选择输入，决定保留、压缩或移除哪些内容。
- **动态执行路径**：运行时决定工具调用、后续步骤和停止时机。
- **外部操作约束**：访问数据源和执行工具时检查权限、限制执行环境，并记录结果与状态变化。

# 范围与限制

本文描述项目的运行时设计与实现记录；状态表中的基础实现、部分完成和预留扩展不代表已达到生产可用要求。

完整技术地图见 [AI 技术体系总览](/zh/docs/ai/ai-technology-stack/)。总览按应用与编排、训练与推理框架、模型结构与算法、计算与基础设施四层组织知识。
