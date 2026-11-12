---
title: AI 技术体系总览：应用、训练推理、模型算法与计算基础
date: '2026-07-17'
categories:
- 
AI
weight: 1
---

# AI 技术体系总览

## 分层与职责

以大模型为核心，整体技术体系可自顶向下划分为 4 个层次：应用与编排、训练与推理框架、模型结构与算法、计算与基础设施。

| 层次 | 主要问题 | 负责内容 |
|---|---|---|
| 应用与编排 | 怎样用模型完成用户任务？ | Agent、Workflow、上下文、知识检索、工具与外部系统 |
| 训练与推理框架 | 怎样组织训练过程并提供模型服务？ | 数据流水线、训练执行、模型部署、生成执行与请求调度 |
| 模型结构与算法 | 模型怎样表示文本、学习参数并生成 token？ | Tokenizer、Transformer、训练目标、参数更新与生成算法 |
| 计算与基础设施 | 模型计算怎样在设备和集群上执行？ | 张量框架、算子与加速库、GPU、存储、通信与资源管理 |

<!--more-->

## 技术地图与层间关系

```text
应用与编排
├── Agent、Workflow
├── 上下文、记忆、Skills
└── RAG、工具与外部系统
              ↓
训练与推理框架
├── 预训练：数据流水线、训练循环、分布式训练、Checkpoint
├── 后训练：SFT、偏好优化、RL 的执行流程
└── 推理：模型服务、生成循环、缓存管理、批处理与调度
              ↓
模型结构与算法
├── 文本表示：Tokenizer、Embedding
├── 模型结构：Transformer、Attention、MLP、Norm、LM Head
├── 学习算法：训练目标、Loss、反向传播、Optimizer
└── 生成算法：自回归计算、KV Cache、token 选择
              ↓
计算与基础设施
├── 计算框架：PyTorch、JAX
├── 算子与加速：CUDA、计算库、通信库、编译器
└── 硬件与运行环境：GPU、存储、网络、容器、集群
```

箭头表示上层依赖下层的能力，不能理解为每次请求都依次执行预训练、后训练和推理。应用通常直接调用推理服务；训练则在独立任务中产出模型权重，再交给推理系统加载。

```text
训练数据 → 预训练 / 后训练框架 → 模型权重
                                     ↓ 加载
用户任务 → 应用与编排 ──────────→ 推理框架 → 回答或工具调用请求
                                     ↓
                              模型结构与生成算法
                                     ↓
                              计算框架与设备执行
```

这 4 层按职责边界划分，实际工程项目往往横跨多层。例如推理引擎既负责组织请求执行，也包含模型适配、算子调用与显存缓存实现；阅读源码时需按模块的具体职责判断归属。

## 站内文章阅读入口

| 想回答的问题 | 阅读入口 |
|---|---|
| 训练到推理怎样执行，输入与产物怎样衔接？ | [大模型工作流程：从训练到推理，以 nanochat 为例](/zh/docs/ai/llm-workflow-with-nanochat/) |
| GPT 怎样将输入变成 Logits？ | [LLM System（一）](/zh/docs/ai/llm-system-1/) |
| Loss、参数更新、缓存与采样怎样计算？ | [LLM System（二）](/zh/docs/ai/llm-system-2/) |
| 通用模型机制在 nanochat 中怎样实现？ | [nanochat 核心架构与实现](/zh/docs/ai/llm-system-nanochat/) |
| 应用层怎样设计 Agent 运行时？ | [Agent SDK 设计](/zh/docs/ai/agent-sdk-design/) |

# 应用与编排

这一层将用户目标、业务规则、模型能力、知识库和外部操作组织为具体的任务执行过程。输入是用户请求和业务上下文，输出可以是文本回答、结构化结果或外部系统的执行反馈。

```text
用户任务 → 上下文组装 → Agent / Workflow → 模型调用
                           ↑                   ↓
                           └── 工具执行、状态更新与结果判断

知识检索、会话历史、记忆与 Skills 按需参与上下文组装。
```

## Agent、Workflow 与能力复用

Workflow 定义固定的执行路径与步骤关系；Agent 允许模型在运行过程中自主决策后续动作。两者经常组合使用，由运行时统一管理会话、执行状态、工具分发和结束条件。

| 模块 | 负责内容 | 与其他模块的关系 |
|---|---|---|
| 上下文管理 | 选择并组织指令、历史、记忆、检索结果 | 决定本轮模型实际看到的信息 |
| 执行编排 | 控制步骤、模型调用、工具执行与状态转移 | 将模型输出连接到后续操作 |
| Skills | 复用任务指令、参考资料、脚本与模板 | 由运行时按任务需要发现和加载 |
| 执行记录 | 记录调用、状态、错误和资源使用 | 支持定位失败、评估效果与改进流程 |

应用运行时管理的会话历史和记忆，与推理引擎管理的 KV Cache 属于不同层面的状态：前者决定送入模型的输入内容，后者复用模型已经计算好的 K/V 向量。

**深入入口**：

- [Agent SDK 设计](/zh/docs/ai/agent-sdk-design/)：需求拆解、运行时分层、上下文与工具能力。
- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)：Agent 与 Workflow 的执行组织。
- [Context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)：上下文选择、压缩与记忆。
- [Agent Skills](https://agentskills.io/home)：任务指令与资源的封装、发现和加载。

## 知识检索与外部系统

RAG 处理外部知识如何进入模型上下文；工具调用处理外部操作如何被触发、执行并返回结果。

```text
知识源 → 清洗与切分 → 索引 → 检索与重排 → 上下文

模型请求工具调用 → 应用校验与执行 → 工具结果 → 下一轮上下文
```

应用层需要维护数据源、访问权限和数据更新机制。MCP 提供了统一的工具与资源协议接口，但具体操作是否放行、如何执行、结果如何使用，仍由应用及其运行环境控制。

**深入入口**：

- [Agent SDK 设计](/zh/docs/ai/agent-sdk-design/)：Context Management、MCP / Tool 接入与执行。
- [Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval)：检索与上下文补充。
- [MCP 架构](https://modelcontextprotocol.io/docs/learn/architecture)：工具、资源与协议边界。

# 训练与推理框架

这一层把底层模型算法组织成可执行的训练任务或在线推理服务，重点解决数据流转、步骤调度、状态保存，以及大规模批量或分布式执行的问题。

```text
预训练框架 ──→ Base Checkpoint ──→ 后训练框架 ──→ 对话模型
                                                       ↓
                                                 推理框架加载
                                                       ↓
                                                 服务应用请求
```

预训练和后训练共用设备初始化、训练循环、梯度同步、优化器调度、评测及 Checkpoint 等基础组件。具体计算公式在模型结构与算法层展开。

## 预训练

预训练将大规模无标注文本整理为输入和预测目标，通过反复迭代更新权重，产出基础模型。

```text
文本分片 → Tokenizer 编码 → 打包与 Batch → 输入、目标
                                             ↓
                               Forward → Loss → Backward
                                             ↓
                              梯度同步、参数更新与状态保存
```

| 框架职责 | 需要组织的内容 |
|---|---|
| 数据流水线 | 数据读取、编码、打包、划分及读取位置记录 |
| 训练执行 | Batch 分配、精度配置、梯度累积、学习率调度 |
| 分布式训练 | 数据和模型的分配、梯度同步、参数与优化器状态分片 |
| 验证与保存 | 评测触发、模型与训练状态保存、恢复时的加载顺序 |

训练框架只负责调度模型计算 Loss 和 Gradient；Loss 的数学定义、梯度推导与优化规则均属于下一层。

**深入入口**：

- [大模型工作流程](/zh/docs/ai/llm-workflow-with-nanochat/)：预训练的数据准备、训练循环与 Checkpoint。
- [LLM System（二）](/zh/docs/ai/llm-system-2/)：训练目标、梯度计算与参数更新。
- [FineWeb](https://arxiv.org/abs/2406.17557)、[DataTrove](https://github.com/huggingface/datatrove)：预训练数据清洗、去重与处理流水线。
- [DeepSpeed](https://github.com/deepspeedai/DeepSpeed)：训练执行与分布式优化的实现入口。

## 后训练

后训练在已有模型基础上组织示范学习、偏好优化或强化学习，对齐模型行为以适应具体任务需求。不同方法的数据格式和执行流各有差异。

| 方向 | 框架组织的流程 | 输入与产物 |
|---|---|---|
| SFT | 对话编码、监督位置选择、训练与保存 | 指令与标准回答 → 更新后的模型 |
| 偏好优化 | 组织同题偏好样本，计算目标并更新 | 偏好与非偏好回答 → 更新后的模型 |
| RL | Rollout、Reward、训练目标构造、策略更新 | 题目与评分依据 → 更新后的策略模型 |

RL 将生成与训练串联成闭环：推理引擎负责采样生成回答，评分模块提供 Reward 反馈，训练框架据此更新权重，再用新权重生成下一批样本。

```text
当前模型 → 生成回答 → 计算 Reward → 构造训练数据 → 参数更新
    ↑                                                  │
    └──────────────────────────────────────────────────┘
```

SFT、DPO、GRPO 等目标的计算原理归属模型与算法层；Full Fine-tuning、LoRA 则描述参与更新的参数范围与形式。具体框架支持哪些范式，需对照其实现版本。

**深入入口**：

- [大模型工作流程](/zh/docs/ai/llm-workflow-with-nanochat/)：SFT、LoRA、RL 的执行流程。
- [LLM System（二）](/zh/docs/ai/llm-system-2/)：SFT 监督、GRPO 目标与 LoRA 参数更新。
- [HF Smol Course](https://huggingface.co/learn/smol-course/unit0/1)：示范与偏好数据、后训练方法的学习入口。
- [TRL](https://github.com/huggingface/trl)、[verl](https://github.com/verl-project/verl)：后训练执行框架的实现入口。

## 推理

推理框架加载模型权重，接收外部请求，组织 Prefill、Decode 与采样过程，并统筹管理请求队列、显存缓存和流式输出。

```text
请求接入 → 组 Batch → Prefill → token 选择 → Decode 循环 → 输出
               ↑                  │              │
               └── 请求调度 ──────┴── 缓存管理 ──┘
```

| 模块 | 负责内容 |
|---|---|
| 模型服务 | 接口、模型版本、请求路由、限流与服务扩缩容 |
| 推理执行 | 模型加载、Prefill / Decode 调用、采样与停止控制 |
| 缓存管理 | KV 存储分配、分块、复用、回收及容量控制 |
| 请求调度 | 组批、请求加入退出、执行资源与延迟吞吐权衡 |

单次离线生成与高并发在线服务在工程复杂度上差异很大。nanochat 适合用来理解核心模型执行与生成循环；生产级推理引擎还需重点解决高并发调度、显存碎片、连续批处理（Continuous Batching）和分布式张量并行等问题。

**深入入口**：

- [大模型工作流程](/zh/docs/ai/llm-workflow-with-nanochat/)：输入准备、Prefill、Decode 与输出处理。
- [nanochat 核心架构与实现](/zh/docs/ai/llm-system-nanochat/)：Engine、KV Cache、采样与回答状态管理。
- [vLLM](https://github.com/vllm-project/vllm)、[SGLang](https://github.com/sgl-project/sglang)：推理执行、缓存和调度的实现入口。
- [PagedAttention](https://arxiv.org/abs/2309.06180)、[vLLM 设计说明](https://docs.vllm.ai/en/stable/design/paged_attention/)：KV Cache 分页与显存管理。

# 模型结构与算法

这一层聚焦于数学与算法本身：输入怎样变成预测分数、训练怎样改变参数，以及生成时怎样选择下一个 token。上层的预训练、后训练和推理框架均复用这一层的核心实现。

```text
文本 → Tokenizer → token IDs
                       ↓
                  Embedding
                       ↓
             Transformer Blocks
                       ↓
               Final Norm、LM Head
                       ↓
                     Logits
                    /      \
                   /        \
        Target → Loss       token 选择 → 下次 Forward
                   ↓              推理路径
                Backward
                   ↓
                Optimizer
                   ↓
                参数更新
                训练路径
```

## 文本表示与模型结构

Tokenizer 确定文本与 token IDs 的映射关系；Embedding 将离散 ID 映射为连续向量。Transformer 通过 Attention、MLP、Norm 和 Residual 逐层提取特征，最后由 LM Head 将隐藏状态映射为词表分数（Logits）。

| 模块 | 主要问题 |
|---|---|
| Tokenizer、Embedding | 文本怎样成为模型输入表示？ |
| Attention、位置编码 | 当前位置怎样读取可见上下文及其位置信息？ |
| MLP、Norm、Residual | 每层怎样加工、传递和稳定隐藏表示？ |
| LM Head | 隐藏表示怎样变成下一 token 的候选分数？ |

模型架构决定计算形式，模型权重决定当前具体行为；框架负责实例化、加载并调用模型。

**深入入口**：

- [LLM System（一）](/zh/docs/ai/llm-system-1/)：Embedding、Transformer、Final Norm 与 LM Head 的计算。
- [nanochat 核心架构与实现](/zh/docs/ai/llm-system-nanochat/)：Tokenizer、GPT、Attention 与 MLP 的源码对应。

## 学习目标与参数更新

不同训练阶段可以复用相同的 Forward 过程，但使用不同的数据集、监督位置或优化目标。

| 机制 | 负责解释的内容 |
|---|---|
| 下一 token 预测、Cross-Entropy | 预测分数与正确目标怎样构成误差 |
| SFT 监督与 Mask | 哪些回答目标参与损失计算 |
| 偏好与策略优化目标 | 偏好、Reward 和生成概率怎样构成更新目标 |
| Backward、Optimizer | 梯度怎样计算，参数怎样更新 |
| LoRA 等参数化方式 | 哪些参数参与训练，更新怎样表示 |

框架层的梯度累积、同步和更新调度必须严格对齐所需优化目标；在切分 Batch 或改变有效目标数量时，还需核对 Loss 的归约（Reduction）与加权方式。

**深入入口**：

- [LLM System（二）](/zh/docs/ai/llm-system-2/)：Loss、Backward、Optimizer、梯度累积与 LoRA。
- [nanochat 核心架构与实现](/zh/docs/ai/llm-system-nanochat/)：Loss、Backward 与 Optimizer 的训练实现。
- [HELM](https://arxiv.org/abs/2211.09110)、[lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness)：评测设计、任务定义与模型评测实现。

## 生成算法与缓存机制

生成算法基于已有参数，根据上下文计算下一 token 的分数，再通过 Greedy、Sampling 等解码策略选择输出，循环执行直至触发停止条件。

KV Cache 保存历史位置的 K/V 向量，供新增位置的 Attention 读取。其数学与计算含义在此处定义；至于缓存如何分页、分配和跨请求复用，则由上层推理框架组织。

| 模型与算法层 | 训练与推理框架层 |
|---|---|
| Loss、梯度与参数更新规则 | 组织 Batch、Backward、同步、更新与保存 |
| SFT、偏好与策略优化的目标 | 组织数据、Rollout、评分及训练任务 |
| Attention 怎样使用历史 K/V | 分配缓存存储、管理容量与生命周期 |
| Logits 怎样转为下一 token | 调度请求、执行生成循环、返回输出 |

**深入入口**：

- [LLM System（二）](/zh/docs/ai/llm-system-2/)：增量 Attention、KV Cache、概率分布与 token 采样。
- [nanochat 核心架构与实现](/zh/docs/ai/llm-system-nanochat/)：缓存读写、采样与生成循环的源码实现。

# 计算与基础设施

这一层承接底层的模型运算与任务执行，将张量操作映射至具体硬件设备，并提供存储、通信和集群资源管理。训练与推理虽然共享部分基础组件，但计算负载特性与性能优化目标截然不同。

```text
模型中的张量运算
    ↓
计算框架、自动求导与编译
    ↓
算子实现、计算库与通信库
    ↓
CPU / GPU、设备内存与互连

容器、集群、存储和网络支撑任务部署、数据访问与设备协作。
```

## 计算框架、算子与加速软件

| 组件 | 主要职责 |
|---|---|
| PyTorch、JAX 等计算框架 | 张量表示、运算执行、自动求导与设备调度 |
| 计算库与 Kernel | 实现矩阵运算、Attention 等设备计算 |
| 编译与融合 | 将计算图或算子转换为执行程序，减少部分调度和访存开销 |
| 通信库 | 支撑多设备之间的数据传输与集合通信 |

训练算法在数学层定义梯度与更新规则，而自动求导与设备算子则提供底层的执行能力。训练循环、分布式并行方案与底层通信库各司其职、分层协作。

**深入入口**：

- [Triton](https://github.com/triton-lang/triton)：算子编写与编译实现。
- [FlashAttention](https://github.com/Dao-AILab/flash-attention)：Attention 的计算与访存优化。
- [NCCL](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/index.html)：GPU 集合通信。

## 硬件、集群与性能

系统整体性能受计算吞吐、显存容量、访存带宽、跨卡通信以及请求调度策略的共同制约。

| 关注点 | 典型问题 |
|---|---|
| GPU 执行 | 怎样组织线程、线程块与并行计算？ |
| 存储与访存 | 数据放在哪里，怎样分块、复用或重计算？ |
| 多设备通信 | 参数、梯度或中间结果怎样跨设备交换？ |
| 集群与资源 | 任务怎样分配设备、加载数据、部署和恢复？ |
| 性能验证 | 在什么硬件、精度、Batch 和输入长度下测量？ |

推理请求调度决定哪些请求被编入同一次前向执行；集群资源调度则决定任务分配到哪些物理节点与加速卡上。两者在生产环境中相互影响，但管理的资源粒度不同。

**深入入口**：

- [CUDA Programming Guide](https://docs.nvidia.com/cuda/cuda-programming-guide/)：GPU 执行与存储模型。