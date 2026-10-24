---
title: 大模型入门总览：四层技术框架
categories: [AI]
date: 2025-12-07
tags: [AI]
lang: zh
---

# goal

**English version: [Getting Started with AI: A Four-Layer Technology Map](/2025/12/07/ai/ai_overview_en/)**

面向初学者，以大模型为中心建立应用与产品、模型、推理与基础设施、CUDA 与 GPU 四层概要知识框架。突出核心概念及其关系，按从模型应用到训练原理、推理运行、底层计算的顺序学习，并通过调查、实践和项目复盘逐步深入。

| Layer | 主要问题 | 核心模块 |
| --- | --- | --- |
| Application / Product | 如何用模型完成业务任务？ | Skills；Agent 编排；数据、知识与工具接入 |
| Model | 模型如何工作、能力如何形成？ | Transformer 架构与 Tokenizer、预训练、后训练、模型评测 |
| Inference / Infra | 模型如何高效生成回答？ | 推理流程、缓存管理、调度与计算优化 |
| CUDA / GPU | 模型计算如何落到设备？ | 计算执行、内存与性能 |

<!-- more -->

# 领域知识框架

图中各层模块按学习顺序排列。

```text
应用与产品 / Application & Product
├─ Skills：封装可复用的任务方法、指令与资源
├─ Agent 编排：管理 Prompt、会话历史与记忆，组织执行循环和业务 Workflow
└─ 数据、知识与工具接入：建设和维护信息资产，按需使用 RAG、Tool Calling 与 MCP

模型 / Model
├─ Transformer 架构与 Tokenizer：理解文本表示、Attention 与自回归生成
├─ 预训练：理解训练数据建设与管理、预测目标及参数学习
├─ 后训练：建设示范、偏好与奖励数据，理解 SFT、DPO / RLHF 及任务微调
└─ 模型评测：衡量模型能力，识别效果与边界

推理与基础设施 / Inference & Infra
├─ 推理流程：理解 Prefill、Decode 与逐 Token 生成
├─ 缓存管理：理解 KV Cache 的建立、复用、更新与显存占用
└─ 调度与计算优化：理解 Batching、Quantization 对吞吐、延迟和精度的影响

底层计算 / CUDA & GPU
├─ 计算执行：理解 Tensor、算子如何通过 Kernel、线程组织落到 SM 执行
└─ 内存与性能：理解寄存器、共享内存、显存及数据搬运对性能的影响
```

## 一个 Prompt 如何生成回答？

```text
用户输入 Prompt
    ↓
应用层 / Agent 编排：组织 Prompt、会话历史与记忆，按需加载 Skills、加入检索或工具结果
    ↓
模型层 / Tokenizer：将模型输入编码为 Token
    ↓
推理层 / Prefill：执行 Transformer，建立 KV Cache，预测首个输出 Token
    ↓
推理层 / 采样与 Decode：采样 Token，复用并更新 KV Cache，循环生成直到停止
    │
    └─ 每轮模型计算由底层的算子、Kernel 和 GPU 执行
    ↓
模型层 / Tokenizer：将生成的 Token 解码为文本
    ↓
应用层：返回回答；涉及工具调用时，执行工具并将结果加入上下文，继续调用模型
```

## 模型如何训练出来？

```text
模型层 / Transformer 与 Tokenizer：确定模型结构和文本编码方式
    ↓
模型层 / 预训练数据：采集、清洗去重、质量过滤、划分数据集，记录配比与版本并进行 Token 化
    ↓
模型层 / 预训练：按预测目标计算损失，通过反向传播与优化器反复更新参数
    │
    └─ 训练框架组织计算，底层的 Tensor、Kernel 和 GPU 执行运算
    ↓
得到预训练模型
    ↓
模型层 / 后训练：采集、标注和维护示范、偏好与奖励数据，开展 SFT、偏好优化或强化学习
    │
    └─ 继续由训练框架与底层计算完成参数更新
    ↓
模型层 / 模型评测：验证能力与边界，反馈到数据和训练方法的调整
    ↓
推理层 / 推理流程：加载模型，供应用层调用
```

# Application / Product layer

通过任务方法复用、执行编排和外部能力接入完成业务任务，并用业务样本与验收标准验证效果。

## Skills

**解决的问题**：如何把任务方法和领域经验保存为可复用的能力，并在任务需要时交给通用 Agent 使用。

```text
任务经验
    ↓
任务封装：整理指令、参考资料与脚本
    ↓
按需加载与执行：Agent 识别适用 Skill，读取所需内容并使用资源
    ↓
任务结果与反馈 → 更新 Skill
```

| 核心环节 | 调查：理解原理 | 实践：阅读实现 | 复盘迭代：项目经验 |
| --- | --- | --- | --- |
| 任务封装 | [官方说明](https://agentskills.io/home)：目录、元数据与资源结构 | [anthropics/skills](https://github.com/anthropics/skills)：指令、脚本与模板 | [Claude 文档 Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)：PDF 能力的资源拆分（产品实现经验） |
| 按需加载与执行 | [官方说明](https://agentskills.io/home)：发现与加载机制 | [文档 Skill 实现](https://github.com/anthropics/skills)：查看资源引用和脚本调用 | [渐进加载设计](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)：按任务装配所需内容（产品实现经验） |

## Agent 编排

**解决的问题**：如何把用户任务组织成能维持上下文、调用工具、更新状态并判断何时结束的执行过程。

```text
用户任务
    ↓
上下文组织与更新：装配 Prompt、历史、项目说明、记忆与 Skills；按预算裁剪或摘要
    ↓
执行控制：调用模型，选择继续、调用工具或结束
    ├─ 继续 / 调用工具 → 取得结果 → 更新状态与上下文 → 进入下一轮
    └─ 结束 → 输出结果

通用 Agent 提供可复用的执行能力；业务 Workflow 围绕特定目标组织这些能力。
```

| 核心环节 | 调查：理解原理 | 实践：阅读实现 | 复盘迭代：项目经验 |
| --- | --- | --- | --- |
| 上下文组织与更新 | [Context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)：信息选择、压缩与记忆 | [现有 SDK 架构](/i18n/zh/ai/agent-sdk-design.html)：Context、Memory、Transcript | [Anthropic Research](https://www.anthropic.com/engineering/multi-agent-research-system)：上下文隔离与信息汇总（生产经验） |
| 执行控制 | [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)：执行模式与工具循环 | [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)：运行时与插件；`sdlc`：业务 Workflow | [Anthropic Research](https://www.anthropic.com/engineering/multi-agent-research-system)：任务分解与执行可靠性（生产经验） |

## 数据、知识与工具接入

**解决的问题**：如何建设可持续更新的信息资产，让 Agent 获得相关知识，并能访问和操作外部系统。

```text
代码、文档与业务资料
    ↓
信息资产建设：采集、清洗、组织、索引与更新；维护来源、版本、权限与适用范围
    ↓
知识检索：RAG 选择相关内容 → 加入上下文

外部系统
    ↓
工具接入：注册能力与权限，按需通过 MCP 接入
    ↓
工具执行：Tool Calling → 执行操作 → 结果回传上下文
```

| 核心环节 | 调查：理解原理 | 实践：阅读实现 | 复盘迭代：项目经验 |
| --- | --- | --- | --- |
| 信息资产建设与知识检索 | [Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval)：分块、索引、上下文补充与重排 | [RAG Cookbook](https://platform.claude.com/cookbook/capabilities-contextual-embeddings-guide)：资料处理、检索与对比实验 | — |
| 工具接入与执行 | [MCP 架构](https://modelcontextprotocol.io/docs/learn/architecture)：工具、资源与协议边界 | [MCP Servers](https://github.com/modelcontextprotocol/servers)：参考工具与资源实现 | [Anthropic MCP 代码执行](https://www.anthropic.com/engineering/code-execution-with-mcp)：按需加载工具、过滤中间数据（工程方案与实验） |

# Model layer

理解文本如何进入模型、模型能力如何通过数据与训练形成，以及如何验证能力边界。

## Transformer 架构与 Tokenizer

**解决的问题**：模型如何把文本变成可计算的表示，并根据已有内容预测后续 Token。

```text
文本 → 文本表示：Tokenizer 编码为 Token，Embedding 转为向量
    ↓
Transformer 计算：位置表示、Attention 与前馈网络组织信息处理
    ↓
生成预测：输出下一 Token 的分布 → 采样 → 将 Token 加入后续输入
    └─ 生成的 Token 由 Tokenizer 解码为文本
```

| 核心环节 | 调查：理解原理 | 实践：阅读实现 | 复盘迭代：项目经验 |
| --- | --- | --- | --- |
| 文本表示 | [HF LLM Course](https://huggingface.co/learn/llm-course/en/chapter1/1)：Tokenizer、Token 与模型输入 | [nanochat](https://github.com/karpathy/nanochat)：Tokenizer 与 Embedding | — |
| Transformer 计算 | [Transformer 原始论文](https://arxiv.org/abs/1706.03762)：Attention、位置表示与网络结构 | [nanochat](https://github.com/karpathy/nanochat)：Transformer 模型实现 | [DeepSeek-V3 §2](https://arxiv.org/html/2412.19437v2)：MLA、MoE、MTP；[MiniMax-01](https://arxiv.org/abs/2501.08313)：混合注意力（进阶模型报告） |
| 生成预测 | [HF LLM Course](https://huggingface.co/learn/llm-course/en/chapter1/1)：自回归模型与生成 | [nanochat](https://github.com/karpathy/nanochat)：预测分布、采样与生成循环 | — |

多模态扩展：[Qwen2.5-VL](https://arxiv.org/abs/2502.13923)介绍视觉与语言模型设计；[Qwen2.5-Omni](https://qwenlm.github.io/blog/qwen2.5-omni/)介绍音频、视频与流式语音生成。

## 预训练

**解决的问题**：如何从大规模数据中学习通用能力，并让训练结果可以比较和追溯。

```text
原始数据
    ↓
数据建设与管理：选择来源、清洗去重、质量过滤、划分与配比、版本记录
    ↓
目标与参数学习：Token 化 → 预测下一 Token → 计算损失 → 反向传播与参数更新
    └─ 按数据批次反复训练 → 得到预训练模型
```

| 核心环节 | 调查：理解原理 | 实践：阅读实现 | 复盘迭代：项目经验 |
| --- | --- | --- | --- |
| 数据建设与管理 | [FineWeb](https://arxiv.org/abs/2406.17557)：清洗、去重与质量实验 | [DataTrove](https://github.com/huggingface/datatrove)：处理流水线；[SmolLM](https://github.com/huggingface/smollm/blob/main/text/pretraining/README.md)：数据依赖与阶段配置 | [Llama 3](https://arxiv.org/abs/2407.21783)：数据构造；[Qwen3](https://qwenlm.github.io/blog/qwen3/)：数据扩展与训练阶段（模型项目报告） |
| 目标与参数学习 | [HF 从零训练语言模型](https://huggingface.co/learn/llm-course/en/chapter7/6)：目标、损失与训练过程 | [PyTorch Examples](https://github.com/pytorch/examples)：训练循环；[SmolLM](https://github.com/huggingface/smollm/blob/main/text/pretraining/README.md)：训练配方与检查点 | [Llama 3](https://arxiv.org/abs/2407.21783)：训练设计与规模化经验（模型项目报告） |

训练框架负责数据加载、批次计算与自动微分；分布式训练作为规模化实现按需深入。

## 后训练

**解决的问题**：如何让预训练模型更好地遵循指令、满足偏好、进行推理或适配具体业务任务。

```text
预训练模型 + 任务目标
    ↓
任务数据与反馈建设：采集、标注、审核，管理覆盖、配比、来源与版本
    ↓
行为学习（按目标选择或组合）
    ├─ 示范回答 → SFT 监督微调
    ├─ 回答偏好 → DPO 等偏好优化
    └─ 奖励反馈 → 强化学习：如 RLHF，或使用可验证结果作为奖励
    ↓
参数更新与迭代：全参数更新 / LoRA 等参数高效微调
    ↓
结果验证与失败案例整理 → 更新数据和训练方法
```

| 核心环节 | 调查：理解原理 | 实践：阅读实现 | 复盘迭代：项目经验 |
| --- | --- | --- | --- |
| 任务数据与反馈建设 | [HF Smol Course](https://huggingface.co/learn/smol-course/unit0/1)：示范与偏好数据 | [TRL](https://github.com/huggingface/trl)：样本格式与数据处理 | [DeepSeek-R1](https://arxiv.org/abs/2501.12948)：冷启动、数据构造与蒸馏（模型研发经验） |
| 行为学习 | [InstructGPT](https://arxiv.org/abs/2203.02155)：SFT、奖励模型与 RLHF；[HF Smol Course](https://huggingface.co/learn/smol-course/unit0/1)：偏好对齐 | [TRL](https://github.com/huggingface/trl)：SFT、DPO 等训练器；[verl](https://github.com/verl-project/verl)：强化学习训练配方 | [DeepSeek-R1](https://arxiv.org/abs/2501.12948)：推理强化学习；[DAPO](https://arxiv.org/abs/2503.14476)：训练稳定性（模型训练实验） |
| 参数更新与迭代 | [HF Smol Course](https://huggingface.co/learn/smol-course/unit0/1)：任务微调入口 | [TRL](https://github.com/huggingface/trl)：参数高效微调集成 | [MiniMax-M1 技术分享](https://www.minimax.io/news/minimax-m1-technical-seminar-2)：数值精度、奖励与数据质量的调整经验 |

## 模型评测

**解决的问题**：如何判断模型具备哪些能力、训练是否有效，以及评测结论能用于哪些场景。

```text
能力目标
    ↓
评测设计：选择任务、指标与统一条件
    ↓
评测执行：运行模型并评分
    ↓
结果分析：比较效果、错误与适用边界 → 反馈模型选型或训练迭代
```

| 核心环节 | 调查：理解原理 | 实践：阅读实现 | 复盘迭代：项目经验 |
| --- | --- | --- | --- |
| 评测设计 | [HELM](https://arxiv.org/abs/2211.09110)：场景、指标与覆盖范围 | [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness)：任务定义 | [OpenAI SimpleQA](https://openai.com/index/introducing-simpleqa/)：事实性问题构建与评分（评测项目经验） |
| 评测执行与结果分析 | [HELM](https://arxiv.org/abs/2211.09110)：多维比较与结论限制 | [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness)：模型接入与运行；[simple-evals](https://github.com/openai/simple-evals)：评分实现 | [OpenAI SimpleQA](https://openai.com/index/introducing-simpleqa/)：拒答与校准；结论限定于短答案事实性 |

# Inference / Infra layer

理解生成过程、缓存和调度优化如何共同决定推理延迟、吞吐与显存占用。

[DeepInfer](https://github.com/deepseek-ai/DeepInfer) 是支撑 DeepSeek 生产推理的框架，整合模型运行时、采样、异步调度与优化 Kernel。

## 推理流程

**解决的问题**：一次模型调用如何处理完整输入，再逐步生成输出并结束。

```text
输入 Token
    ↓
Prefill：处理输入、建立 KV Cache，计算首个输出 Token 的预测分布
    ↓
采样与停止判断
    ├─ 未停止 → Decode：处理新增 Token，复用并更新缓存 → 再次采样与判断
    └─ 停止 → 返回生成结果
```

| 核心环节 | 调查：理解原理 | 实践：阅读实现 | 复盘迭代：项目经验 |
| --- | --- | --- | --- |
| Prefill | [TVM LLM 教程](https://tvm.apache.org/docs/how_to/tutorials/optimize_llm.html)：输入处理与首个预测 | [vLLM](https://github.com/vllm-project/vllm)、[SGLang](https://github.com/sgl-project/sglang)：通用执行路径；[DeepInfer](https://github.com/deepseek-ai/DeepInfer)：模型运行时与离线推理 | [DeepSeek 推理系统](https://github.com/deepseek-ai/open-infra-index/blob/main/202502OpenSourceWeek/day_6_one_more_thing_deepseekV3R1_inference_system_overview.md)：两阶段分离与不同并行配置（线上经验） |
| Decode 与生成控制 | [HF 推理教程](https://huggingface.co/docs/transformers/llm_tutorial_optimization)：自回归生成、采样与缓存 | [SGLang](https://github.com/sgl-project/sglang)：生成循环；[DeepInfer](https://github.com/deepseek-ai/DeepInfer)：采样、推测解码与输出控制 | [DeepSeek 推理系统](https://github.com/deepseek-ai/open-infra-index/blob/main/202502OpenSourceWeek/day_6_one_more_thing_deepseekV3R1_inference_system_overview.md)：阶段性能与延迟目标（线上经验） |

## 缓存管理

**解决的问题**：如何复用历史计算，避免每生成一个 Token 都重新处理全部输入，同时控制缓存的显存开销。

```text
状态复用：Prefill 建立历史 Key / Value → Decode 读取并追加 → 结束后释放或保留可复用缓存
                    ↑
显存管理：按需分配缓存块，按条件共享或复用已有缓存
                    ↓
             支撑长上下文与并发请求
```

| 核心环节 | 调查：理解原理 | 实践：阅读实现 | 复盘迭代：项目经验 |
| --- | --- | --- | --- |
| 状态复用 | [Transformers Cache](https://huggingface.co/docs/transformers/kv_cache)：缓存建立、更新与复用 | [Cache 代码示例](https://huggingface.co/docs/transformers/kv_cache)：观察不同策略下的生成 | [DeepInfer 部署 Q&A](https://github.com/deepseek-ai/DeepInfer/blob/main/doc/inference_deployment_qa.md#kv-cache-storage)：跨请求缓存复用、存储与保留周期（线上设计经验，完整缓存系统未开源） |
| 显存管理 | [PagedAttention](https://arxiv.org/abs/2309.06180)：分页、共享与碎片问题 | [vLLM 设计说明](https://docs.vllm.ai/en/stable/design/paged_attention/)与[代码](https://github.com/vllm-project/vllm)：缓存块与读取实现 | [DeepSeek 推理系统](https://github.com/deepseek-ai/open-infra-index/blob/main/202502OpenSourceWeek/day_6_one_more_thing_deepseekV3R1_inference_system_overview.md)：Decode Load Balancer、KV Cache 占用与线上缓存命中（线上经验） |

## 调度与计算优化

**解决的问题**：如何在显存和计算资源约束下提高吞吐、控制延迟，并验证优化对输出效果的影响。

```text
推理执行的两类优化
├─ 批处理调度：组织并发请求，允许请求动态加入或退出
└─ 低精度计算：为模型与缓存选择硬件支持的量化格式与实现
    ↓
联合执行 → 对比吞吐、延迟、显存和输出效果 → 调整调度与精度配置
```

| 核心环节 | 调查：理解原理 | 实践：阅读实现 | 复盘迭代：项目经验 |
| --- | --- | --- | --- |
| 批处理调度 | [HF Continuous Batching](https://huggingface.co/docs/transformers/continuous_batching)：动态加入与退出 | [SGLang](https://github.com/sgl-project/sglang)：批次组织；[DeepInfer](https://github.com/deepseek-ai/DeepInfer)：CPU 批调度与设备执行重叠的异步调度 | [DeepSeek 推理系统](https://github.com/deepseek-ai/open-infra-index/blob/main/202502OpenSourceWeek/day_6_one_more_thing_deepseekV3R1_inference_system_overview.md)：批次拆分与计算通信重叠（线上经验）；[DeepInfer 部署 Q&A](https://github.com/deepseek-ai/DeepInfer/blob/main/doc/inference_deployment_qa.md#data-parallel-load-balancing)：按负载分配请求与计算预算；[SGLang MTP](https://www.lmsys.org/blog/2025-07-17-mtp/)：解码优化实验 |
| 低精度计算 | [vLLM Quantization](https://docs.vllm.ai/en/stable/features/quantization/)：格式、精度与硬件支持 | [vLLM](https://github.com/vllm-project/vllm)：量化配置与推理对比 | — |

# CUDA / GPU layer

理解模型计算如何映射到 GPU 执行，以及内存访问如何影响计算效率。

## 计算执行

**解决的问题**：模型中的 Tensor 和算子如何变成 GPU 上并行执行的设备程序。

```text
Tensor 与算子
    ↓
算子实现：调用计算库，或通过编译器生成 Kernel
    ↓
设备执行：Kernel 按 Thread / Block 组织工作，Warp 在 SM 上调度执行
    ↓
得到算子结果，供后续模型计算使用
```

| 核心环节 | 调查：理解原理 | 实践：阅读实现 | 复盘迭代：项目经验 |
| --- | --- | --- | --- |
| 算子实现 | [cuBLAS](https://docs.nvidia.com/cuda/cublas/)：矩阵计算库与 CUDA 的关系 | [Triton](https://github.com/triton-lang/triton)：基础 Kernel；[FlashMLA](https://github.com/deepseek-ai/FlashMLA)：Attention Kernel | [DeepInfer](https://github.com/deepseek-ai/DeepInfer/blob/main/README.md)：将 FlashMLA、DeepGEMM 等 Kernel 组件整合到模型运行时（生产框架说明） |
| 设备执行 | [CUDA Programming Guide](https://docs.nvidia.com/cuda/cuda-programming-guide/)：Kernel、线程组织与执行模型 | [CUDA Samples](https://github.com/NVIDIA/cuda-samples)：线程、同步与异步执行 | [DeepSeek-V3 §3.2.2](https://arxiv.org/html/2412.19437v2)：Warp 分工、PTX 与通信计算重叠（进阶实现经验） |

## 内存与性能

**解决的问题**：数据放在哪里、如何搬运和复用，才能减少模型计算中的内存开销与等待。

```text
模型数据与计算需求
    ↓
资源分析：寄存器、共享内存、显存的容量与带宽
    ↓
数据搬运与复用：分块、复用中间数据，按需重计算以节省存储
    ↓
验证计算耗时、显存占用与数值效果 → 调整实现
```

| 核心环节 | 调查：理解原理 | 实践：阅读实现 | 复盘迭代：项目经验 |
| --- | --- | --- | --- |
| 资源分析 | [CUDA Programming Guide](https://docs.nvidia.com/cuda/cuda-programming-guide/)：内存层次与访问方式 | [DeepGEMM](https://github.com/deepseek-ai/DeepGEMM)：低精度矩阵计算及性能测试 | [DeepSeek-V3 §3.3](https://arxiv.org/html/2412.19437v2)：低精度存储与累加精度（进阶实现经验） |
| 数据搬运与复用 | [FlashAttention](https://arxiv.org/abs/2205.14135)：分块与减少内存访问 | [FlashAttention 代码](https://github.com/Dao-AILab/flash-attention)：Attention 数据复用 | [DeepSeek-V3 §3.2.3](https://arxiv.org/html/2412.19437v2)：激活重计算与内存开销权衡（进阶实现经验） |

