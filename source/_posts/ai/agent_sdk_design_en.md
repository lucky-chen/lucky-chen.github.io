---
title: How I Entered AI and Designed an Agent SDK
categories: [AI, Infra, Methodology]
date: 2025-12-07
tags: [Agent, Runtime, SDK, Architecture, Problem Analysis]
lang: en
---

# Background

This article is about how to enter a new field quickly. The method used here is **seeking truth from facts**, with three steps: **investigation**, **practice**, and **iteration through review**. The concrete example in this article is agent engineering in the AI domain.

- **Investigation**: what problems appeared when entering the AI field, how to approach it, and what initial assumptions were formed through investigation
- **Conclusions**: what core judgments were formed after investigation and practice
- **Practical engineering**: how those judgments were derived, designed, and validated through a real agent engineering project

Chinese version: [我进入 AI 领域的方式，以及 Agent SDK 的设计](/i18n/zh/ai/agent-sdk-design.html)

<!-- more -->

# Investigation

## Exploring and understanding what AI is

- Understand the basic principles of AI and its capability boundaries
- Understand engineering objects such as prompt, agent, context, and MCP
- Understand where AI is effective in real delivery and where it loses control

## Deriving a human-AI collaboration model from AI's characteristics

- Decide which problems are suitable for AI and which must remain human-led
- Reassign engineering focus toward requirement discovery, problem decomposition, architecture design, and execution control
- Form a practical way of working where humans and AI collaborate on engineering tasks

## Validating these judgments in practice and turning them into tools

- Use real projects to validate whether the previous judgments hold
- Turn effective methods into process, runtime, and tooling
- Make those capabilities reusable, extensible, and sustainable

# Conclusions from AI Project Retrospectives

- **From the AI technology perspective**: AI behaves more like a group of highly capable but not fully controllable executors. The key is to define goals, paths, and constraints first, then progressively compress highly uncertain problems into more concrete and more deterministic ones.
- **From the perspective of personal capability focus**: in the AI era, more value shifts upward into requirement discovery, problem definition, problem decomposition, solution design, process control, and result acceptance.
- **From the perspective of project practice**: several projects in different directions are validating the same point: AI works better inside systems that are already decomposed, constrained, and supported by documents and process, rather than replacing an entire workflow without boundaries.

| Project | Domain | Main Goal | Current Conclusion |
| --- | --- | --- | --- |
| `agent_runtime` | Infra | Provide a shared runtime foundation for agent systems, unifying session, orchestration, context, tooling, model, observability, and storage capabilities | Stable AI engineering depends not only on model calls, but on a controllable runtime |
| `sdlc` | Software delivery | Connect requirement, design, implementation, and verification into a staged delivery chain, and support continuous update based on existing artifacts | AI fits better into decomposed, constrained, and document-backed engineering processes than into full end-to-end replacement |
| `travel` direction project | Product / business | Validate AI capability in complex user scenarios such as requirement discovery, planning, and continuous task carrying | AI improves information processing and plan generation efficiency, but the real difficulty still lies in requirement discovery and problem definition under complex scenarios |

# Practical Engineering

## Why I Started with an Agent SDK

Conclusion: an `Agent SDK` is the right place to start because it is the most suitable layer for carrying the common problems in AI engineering.

- Runtime hosting
- Interface boundaries
- Orchestration control
- Context governance
- Tool integration
- Model integration
- Permission control
- Observability

It is foundational enough, general enough, and suitable enough to become a shared base reused by later projects.

## SDK Design

### Requirement Definition and Decomposition

From a requirement perspective, this `Agent SDK` is not solving one isolated feature problem. It is solving a group of recurring needs that repeatedly appear in real agent engineering. The goal is to compress these needs into shared foundational capabilities, so upper-layer projects no longer rebuild runtime foundations repeatedly and can instead evolve on top of unified boundaries.

- **A need for unified runtime hosting**: an agent system cannot stop at one-shot model calls. As soon as it enters multi-turn conversation, tool use, state carrying, and result write-back, it needs a unified capability to host session lifecycle, execution flow, and runtime state. Otherwise every project handles these basics separately, at high cost and with poor consistency.

- **A need for stable external interface boundaries**: upper-layer projects need stable, clear, and reusable entry points rather than direct exposure to internal implementation details. In other words, what external users need first is a stable boundary, not a larger pile of capabilities. Only with consistent access boundaries can later capability growth, runtime evolution, and cross-project reuse stay manageable.

- **A need for controllable agent orchestration and execution control**: different requests need different execution paths, and execution also needs explicit stopping conditions, failure handling, and state update mechanisms. The system therefore needs unified orchestration and execution control rather than scattering execution decisions across business logic, temporary rules, and prompts.

- **A need for context governance**: multi-turn agent systems naturally depend on context, but context is not just a single large input. Conversation history, stage memory, retrieval results, and context budget constraints are different by nature. If they are mixed together carelessly, the system quickly loses explainability and maintainability. What is really needed is not "more context", but governable context.

- **A need for MCP / tool integration and execution**: agents do more than generate text. They also need to access and execute external capabilities. Tool registration, discovery, dispatch, and execution should therefore become shared foundational capabilities rather than private implementations rebuilt by each project.

- **A need for permission control and safety boundaries**: tool calls and external capability access naturally introduce safety and permission risks. The system must define not only what can be executed, but also what must be blocked. Without this layer of control, stronger capabilities create larger risks.

- **A need for model integration and abstraction**: models are an important input to agent systems, but upper-layer projects should not directly absorb differences between model providers and invocation styles. What they really need is a unified model access boundary that hides switching, invocation differences, and output normalization.

- **A need for execution tracing and runtime fact recording**: AI systems cannot be judged only by final results. Execution steps, key events, tool calls, failure points, and resource usage all need to be recorded so the system becomes traceable, analyzable, and verifiable.

- **A need for future evolution**: this SDK will not stop at its current capability boundary. It will continue to extend into retrieval, memory, checkpoint, compression, and multi-agent capabilities. That means clear room for evolution must exist from the beginning.

### SDK Design

Once the requirements are made clear, the next step is to map them into an implementable and extensible technical architecture. Overall, this SDK adopts a layered runtime architecture. Different layers are responsible for interface exposure, lifecycle control, orchestration, context governance, capability integration, model integration, observability, and persistence.

Overall architecture:

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
| chat / react / peo         |
+----------------------------+
     |            |            \
      v            v             v
+-------------+ +-------------+ +------------------+
|   Context   | | Capability  | |      Model       |
| Governance  | | and Tooling | |   Integration    |
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

#### Application Layer

Responsibilities:
1. Provide terminal or external application entry points and solve the lack of directly usable SDK entry forms
2. Handle user input/output and runtime access and avoid tight coupling between interaction logic and internal runtime capabilities

Included modules:
- `TerminalSessionDemo`: provides a terminal interaction entry for reading input, invoking runtime APIs, and presenting results
- External Application Integrations: entry forms for external apps or host systems to connect to the SDK

#### Interface Layer

Responsibilities:
1. Expose stable session and execution interfaces and solve unstable external access boundaries
2. Hide internal runtime details and prevent upper-layer projects from directly coupling to internal implementation

Included modules:
- `Api`: defines and exposes the external boundary of the SDK
- `RuntimeApi`: defines stable lifecycle interfaces such as session create, open, and close
- `ISession`: defines session access, runtime state query, and execution entry points
- Agent / Session API Contracts: unify the contracts exposed externally

#### Runtime Controller Layer

Responsibilities:
1. Carry session lifecycle and solve the lack of a unified execution unit in multi-turn systems
2. Centralize execution flow and runtime state, avoiding control logic scattered outside the runtime
3. Normalize results and runtime scheduling through a unified execution boundary

Included modules:
- `Runtime`: runtime initialization, session lifecycle management, and unified entry dispatch
- `AgentSession`: the main execution chain, state carrying, and result normalization for a single session
- `RunCheckpoint`: reserved boundaries for checkpoint, resume, and background execution

#### Agent Orchestration Layer

Responsibilities:
1. Handle routing and execution-mode orchestration for agent requests
2. Select the proper execution path for different requests instead of forcing all requests into one pattern

Included modules:
- `AgentSelector`: chooses execution mode based on request characteristics and runtime state
- `ChatAgent`: handles direct conversational requests
- `ReActAgent`: handles iterative execution with tool use and observation feedback
- `PEOAgent`: handles staged plan-execute-observe execution
- `MultiAgentProtocol`: reserved protocol boundary for multi-agent collaboration

#### Context Governance Layer

Responsibilities:
1. Manage multiple context sources in multi-turn systems
2. Control context assembly, budgeting, and trimming

Included modules:
- `SessionTranscript`: carries session history as the base of multi-turn context
- `RuntimeMemory`: carries stage memory and summarized state
- `RetrievalProvider`: provides retrieval-based context input
- `ContextAssembler`: assembles context from multiple sources
- `ContextBudgetPolicy`: controls context budget, trimming, and constraints

#### Capability and Tooling Layer

Responsibilities:
1. Carry external capability access and invocation
2. Unify tool registration, dispatch, and execution boundaries
3. Manage permission control and execution environments

Included modules:
- `McpGateway`: receives tool invocation requests and dispatches them
- `McpToolRegistry`: manages tool registration, discovery, and lookup
- `RuntimePermissionPolicy`: performs permission checks and capability constraints before execution
- `ExecutionEnvironment`: defines local, sandboxed, or remote execution boundaries

#### Model Integration Layer

Responsibilities:
1. Unify model integration patterns
2. Hide differences across providers and invocation styles from upper layers

Included modules:
- `ModelFactory`: creates model instances and selects integration methods
- Provider Adapters: isolate provider differences
- `StreamingEventAdapter`: normalizes streaming events and outputs

#### Observability Layer

Responsibilities:
1. Record execution process and key events
2. Provide the foundation for tracing, analysis, and verification

Included modules:
- `Trace`: records key execution events and invocation chains
- `Metrics`: collects runtime metrics, resource consumption, and invocation statistics
- Diagnostics / Usage: supplements runtime diagnostics and usage facts

#### Data Layer

Responsibilities:
1. Persist runtime data and solve the problem that runtime facts are not stably retained
2. Unify the persistence boundary for transcript, memory, checkpoint, trace, and metrics, and provide stable data foundations for future evolution

Included modules:
- `Storage`: defines the unified persistence interface
- File / Remote Persistence Backends: provide file-based or remote persistence implementations

### Delivery Validation

The current implementation status can be summarized as follows:

| Layer | Module | Status | Notes |
| --- | --- | --- | --- |
| `Application Layer` | `TerminalSessionDemo` | Basic implementation | A terminal entry already exists for manual running and session-flow validation |
| `Interface Layer` | `Api` / `RuntimeApi` / `ISession` | Basic implementation | Session-oriented interface boundaries already exist, but still in a foundational form |
| `Interface Layer` | `AgentApi` / `IAgent` | Basic implementation | A direct-agent entry has been added as a complement to session APIs |
| `Runtime Controller Layer` | `Runtime` / `AgentSession` | Basic implementation | Session lifecycle, execution chain, state updates, and result normalization are in place, but more complex control scenarios remain to be extended |
| `Runtime Controller Layer` | `RunCheckpoint` | Partially complete | Checkpoint boundaries exist, but resume, retry, and background execution are still pending |
| `Agent Orchestration Layer` | `AgentSelector` / intent routing | Partially complete | Routing capability exists, but strategy and modes can continue to evolve |
| `Agent Orchestration Layer` | `ChatAgent` / `ReActAgent` / `PEOAgent` | Basic implementation | Three major execution paths are already landed, though still at a foundational orchestration level |
| `Agent Orchestration Layer` | `MultiAgentProtocol` | Reserved for extension | Reserved in architecture but not part of the current main execution path |
| `Context Governance Layer` | `SessionTranscript` / `RuntimeMemory` / `ContextAssembler` / `ContextBudgetPolicy` | Partially complete | Basic support for history, stage memory, context assembly, and budget control exists, but finer governance in complex scenarios is still pending |
| `Context Governance Layer` | `RetrievalProvider` | Partially complete | The retrieval boundary exists, but more complete and rigorous retrieval / RAG support is still pending |
| `Capability and Tooling Layer` | `McpGateway` / `McpToolRegistry` / `RuntimePermissionPolicy` / `ExecutionEnvironment` | Basic implementation | Tool integration, dispatch, permission control, and execution boundaries are in place, but still foundational |
| `Model Integration Layer` | `ModelFactory` / `StreamingEventAdapter` | Basic implementation | Unified model access and streaming-event adaptation exist, while model-side capability can continue to evolve |
| `Model Integration Layer` | Provider Adapters | Partially complete | Mock and current providers are connected, but provider coverage remains limited |
| `Observability Layer` | `Trace` / `Metrics` | Basic implementation | Key runtime events and metrics have entered the main path, but observability depth can still be improved |
| `Observability Layer` | Diagnostics / Usage | Partially complete | Basic runtime facts are recorded, but more complete diagnostics are still pending |
| `Data Layer` | `Storage` / File Persistence | Basic implementation | Unified storage interfaces and file persistence exist, but the data layer is still mainly focused on basic persistence |
| `Data Layer` | Remote Persistence Backends | Reserved for extension | Architectural boundaries exist, but remote persistence is not implemented yet |

### Summary of the Agent SDK

#### What this SDK design and implementation taught

- **Shared foundational capability**: an `Agent SDK` does not face isolated problems. It faces a set of recurring problems that appear together, including interface boundaries, execution control, context governance, tool integration, model invocation, observability, and persistence. The value of the framework lies in separating these concerns and turning them into shared infrastructure.
- **Capability control**: an `Agent SDK` is not only responsible for bringing external capabilities into the system. It must also control how those capabilities are used, including MCP boundaries, tool registration and dispatch, permission checks, and execution environment constraints.
- **Memory management**: multi-turn agent systems naturally need history carrying and stage memory, but those signals cannot grow without bound and cannot simply be mixed together. Transcript, memory, retrieval, and context budget need to be treated as separate governance problems.
- **Scenario hosting**: the key job of an `Agent SDK` is not just model access. It is to host real scenario requirements such as multi-turn state, tool execution, permission constraints, memory management, and result write-back, and organize them into a runnable system.

#### Comparison with industry Agent SDKs

Common points:

- **They solve the same category of problems**: all of them deal with multi-turn runtime hosting, tool organization, permission boundaries, runtime recording, and building relatively stable control over uncertain model behavior.
- **They share a similar architectural skeleton**: all of them need stable interface boundaries, unified runtime hosting, orchestration and routing, tool and model integration, observability, and persistence.

Differences:

- **Different maturity and capability depth**: compared with mature industry SDKs, this implementation is still foundational. It still has clear gaps in strategy maturity, breadth of capability, stability in complex scenarios, multi-agent support, long-term memory, and complex permission governance.
- **Different priority**: the current priority of this SDK is to validate what architectural boundaries, runtime layering, and capability organization an agent system should have at the engineering level, rather than to maximize feature completeness first.

#### Comparison with previous engineering experience

Common points:

- **Problem and requirement analysis**: the system still has to answer what problem it solves, who it serves, and where its boundaries are.
- **Stable external interfaces**: how external users access the system and how internal implementation evolves remain core engineering questions.
- **Capabilities must be organized**: which capabilities belong in shared infrastructure and which belong to upper-layer business logic is still a key architectural problem.
- **Clear module layering**: interface, control, capability, and data layers still need explicit boundaries and dependency discipline.
- **Common runtime-system concerns**: lifecycle management, capability boundaries, state carrying, observability, and persistence are still classic runtime-system concerns.

Differences:

- **LLM uncertainty**: model outputs are probabilistic by nature. The same input does not always produce the same result, which directly affects control, debugging, and verification.
- **Context dynamism**: context keeps evolving with history, memory, retrieval results, and budget constraints. This is not only a matter of more context, but of harder memory management: what to keep, what to compress, and what should enter the current execution round.
- **Dynamic execution paths**: whether to call tools, which tools to call, whether to continue, and when to stop often need to be decided at runtime.
- **Open capability boundaries**: agent systems actively connect to external tools, external data sources, and execution environments, which significantly amplifies safety and permission-governance complexity.
- **Higher verification requirements**: it is not enough to verify final results. The process, state, and runtime facts must also be trustworthy and traceable.

# Summary

When entering a new field, the priority is not to chase trends first. The priority is to keep correcting judgment through **investigation**, **practice**, and **iteration through review**. The method used here is **seeking truth from facts**.

- **Investigation**: first understand what it is, what its strengths and weaknesses are, and what industry solutions and experience already exist.
- **Practice**: form judgments from the investigation, then validate them through concrete engineering.
- **Iteration through review**: summarize and review practice results, supplement the earlier investigation, update the existing judgments, and continue validating them.

`Agent SDK`, as one of the earliest engineering foundations produced by this methodology, already shows that this direction is valid, that the architectural structure is complete, and that it can continue evolving as a shared base for later projects.

Chinese version: [我进入 AI 领域的方式，以及 Agent SDK 的设计](/zh/agent-sdk-design/)
