---
title: 大模型入门总览：四层技术框架
categories: [AI]
date: 2025-12-07
---

# Goal

**English version: [Getting Started with AI: A Four-Layer Technology Map](/2025/12/07/ai/ai_overview_en/)**

面向初学者，以大模型为中心建立应用与产品、模型、推理与基础设施、CUDA 与 GPU 四层概要知识框架。突出核心概念及其关系，按从模型应用到训练原理、推理运行、底层计算的视角组织，并提供原理、源码与项目资料入口，便于按需查阅和深入。

| Layer | 主要问题 | 核心模块 |
| --- | --- | --- |
| Application and Product | 如何用模型完成业务任务？ | Agents and Workflows；Data and Knowledge Integration；Tools and External Systems |
| Model | 模型如何工作、能力如何形成？ | Transformer Architecture and Tokenizers、Pretraining、Post-Training、Model Evaluation |
| Inference and Infrastructure | 如何支撑模型训练与推理？ | Training Systems、Runtime Infrastructure、Inference Systems（本文重点） |
| CUDA and GPU | 模型计算如何落到设备？ | GPU Execution、Memory and Performance |

<!-- more -->

# 领域知识框架

图中按从应用到模型、推理和底层计算的学习顺序排列。下方通过回答生成与模型训练两条流程串联各层关系，再按岗位方向说明学习重点与掌握程度；各模块的资料入口见后续章节。

```text
应用与产品 / Application and Product
├─ Agents and Workflows：组织上下文与执行过程，复用任务能力
├─ Data and Knowledge Integration：建设信息资产，为模型提供相关知识
└─ Tools and External Systems：连接外部能力，执行操作并回传结果

模型 / Model
├─ Transformer Architecture and Tokenizers：将文本表示为向量，计算下一 token 的预测分布
├─ Pretraining：通过大规模数据和预测目标学习通用能力
├─ Post-Training：通过示范、偏好与奖励反馈调整模型行为
└─ Model Evaluation：衡量模型能力、训练效果与适用边界

推理与基础设施 / Inference and Infrastructure
├─ Training Systems：训练框架与分布式训练，本文略述
├─ Runtime Infrastructure：资源调度、通信、存储与容错，本文略述
└─ Inference Systems：Inference Pipeline、Cache Management、Scheduling and Compute Optimization，本文重点

底层计算 / CUDA and GPU
├─ GPU Execution：通过 GPU kernel 执行 tensor 运算
└─ Memory and Performance：通过存储组织和数据复用提高计算效率
```

## 一个 Prompt 如何生成回答？

```text
用户输入 Prompt
    ↓
应用层 / Agents and Workflows：组织 Prompt、会话历史与记忆，按需加载 Skills、加入检索或工具结果
    ↓
模型层 / Tokenizer：将模型输入编码为 token IDs
    ↓
推理层 / Prefill：执行 Transformer，建立 KV cache，计算下一 token 的概率分布
    ↓
推理层 / token 选择与 Decode：选择 token，再计算下一 token 的概率分布；复用并更新 KV cache，循环直到停止
    │
    └─ 每轮模型计算由 GPU kernel 执行 tensor 运算
    ↓
模型层 / Tokenizer：将生成的 token IDs 解码为文本
    ↓
应用层：返回回答；涉及工具调用时，执行工具并将结果加入上下文，继续调用模型
```

## 模型如何训练出来？

```text
模型层 / Transformer 与 Tokenizer：确定模型结构和文本编码方式
    ↓
模型层 / 预训练数据：采集、清洗去重、质量过滤、划分数据集，记录配比与版本并进行 Tokenization
    ↓
模型层 / Pretraining：按预测目标计算损失，通过 Backpropagation 与 Optimizer 反复更新参数
    │
    └─ 训练框架调度 GPU kernel，对 tensor 执行运算
    ↓
得到预训练模型
    ↓
模型层 / Post-Training：采集、标注和维护示范、偏好与奖励数据，开展 SFT、偏好优化或强化学习
    │
    └─ 继续由训练框架与底层计算完成参数更新
    ↓
模型层 / Model Evaluation：验证能力与边界，反馈到数据和训练方法的调整
    ↓
推理层 / Inference Pipeline：加载模型，供应用层调用
```

## 岗位能力与学习重点

参考 [DeepSeek](https://talent.deepseek.com/)、[字节 Seed](https://seed.bytedance.com/zh/career) 与 [Anthropic](https://www.anthropic.com/careers/jobs) 的招聘岗位，按职责归纳为以下四个大方向，并对应四层知识框架列出学习顺序与掌握程度。厂商的岗位名称与职责边界不同，实际岗位可能覆盖多个方向；AI 底层计算与性能优化也可能归入 AI 系统与基础设施团队。

掌握程度：了解＝知道用途与边界；理解＝能解释机制与权衡；掌握＝能独立实现和排障。

| 岗位方向 | 相关岗位 | 工作内容 | 学习顺序和程度 |
| --- | --- | --- | --- |
| AI 应用研发 | AI 产品开发工程师<br>Agent 工程师 | 围绕业务任务<br>组织模型、知识与工具<br>开发和交付 AI 应用 | → 应用（掌握）<br>→ 模型（理解）<br>→ 推理与基础设施（理解）<br>→ 底层计算（了解） |
| 模型算法研发 | 预训练算法工程师<br>后训练算法工程师<br>多模态算法工程师 | 研究模型结构、数据与训练方法<br>通过实验和评测提升模型能力 | → 模型（掌握）<br>→ 推理与基础设施（理解）<br>→ 底层计算（理解）<br>→ 应用（了解） |
| AI 系统与基础设施 | 训练框架工程师<br>推理系统工程师 | 建设训练、推理与数据平台<br>保障模型运行的效率、规模与稳定性 | → 模型（理解）<br>→ 底层计算（理解）<br>→ 推理与基础设施（掌握）<br>→ 应用（了解） |
| AI 底层计算与性能优化 | GPU Kernel 工程师<br>AI 编译器工程师 | 开发和优化算子、通信与编译组件<br>提升模型在硬件上的计算效率 | → 模型（理解）<br>→ 底层计算（掌握）<br>→ 推理与基础设施（理解）<br>→ 应用（了解） |

# Application and Product Layer

通过任务方法复用、执行编排和外部能力接入完成业务任务。

```text
Data and Knowledge Integration → Agents and Workflows ↔ Tools and External Systems
```

## Agents and Workflows

**解决的问题**：如何把用户任务组织成能维持上下文、调用工具、更新状态并判断何时结束的执行过程。

```text
Agent：由模型动态决定步骤和工具使用，以完成任务
├─ Context management：Prompt、历史、记忆与 Context compaction
├─ 执行控制：模型调用、工具执行、状态更新与终止
├─ 能力复用：Skills、工具与 Subagents
└─ 相关形态：Workflow 通过预定义路径组织执行，可与 Agent 组合
```

| 主题 | 概念与原理 | 代码与示例 | 工程案例 |
| --- | --- | --- | --- |
| 上下文组织与更新 | [Context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)：信息选择、压缩与记忆 | [现有 SDK 架构](/i18n/zh/ai/agent-sdk-design.html)：Context、Memory、Transcript | [Anthropic Research](https://www.anthropic.com/engineering/multi-agent-research-system)：上下文隔离与信息汇总（生产经验） |
| 执行控制 | [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)：执行模式与工具循环 | [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)：运行时与插件；`sdlc`：业务 Workflow | [Anthropic Research](https://www.anthropic.com/engineering/multi-agent-research-system)：任务分解与执行可靠性（生产经验） |

### Skills

**解决的问题**：如何把任务方法和领域经验保存为可复用的能力，并在任务需要时交给通用 Agent 使用。

```text
Skills：将任务方法、指令与资源封装为可复用能力
├─ 任务封装：指令、参考资料、脚本与模板
├─ 发现与加载：元数据匹配、按需读取与渐进加载
└─ 执行与维护：使用资源完成任务，根据反馈更新 Skill
```

| 主题 | 概念与原理 | 代码与示例 | 工程案例 |
| --- | --- | --- | --- |
| 任务封装 | [官方说明](https://agentskills.io/home)：目录、元数据与资源结构 | [anthropics/skills](https://github.com/anthropics/skills)：指令、脚本与模板 | [Claude 文档 Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)：PDF 能力的资源拆分（产品实现经验） |
| 按需加载与执行 | [官方说明](https://agentskills.io/home)：发现与加载机制 | [文档 Skill 实现](https://github.com/anthropics/skills)：查看资源引用和脚本调用 | [渐进加载设计](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)：按任务装配所需内容（产品实现经验） |

## Data and Knowledge Integration

**解决的问题**：如何建设可持续更新的信息资产，让模型或 Agent 获得任务所需的相关知识。

```text
Data and Knowledge Integration：建设信息资产，为模型提供相关知识
├─ 数据接入与维护：采集、清洗、组织与更新
├─ 来源与权限：来源追溯、版本、访问权限与适用范围
└─ Retrieval-augmented generation（RAG）：分块、索引、检索与重排，将相关内容加入上下文
```

| 主题 | 概念与原理 | 代码与示例 | 工程案例 |
| --- | --- | --- | --- |
| 数据接入与检索 | [Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval)：分块、索引、上下文补充与重排 | [RAG Cookbook](https://platform.claude.com/cookbook/capabilities-contextual-embeddings-guide)：资料处理、检索与对比实验 | — |

## Tools and External Systems

**解决的问题**：如何让模型或 Agent 调用外部系统的能力，并将执行结果用于后续任务。

```text
Tools and External Systems：连接外部能力，执行操作并回传结果
├─ 工具定义：能力描述、输入输出与权限
├─ Tool Calling：模型表达调用意图，应用执行并回传结果
└─ Model Context Protocol（MCP）：标准化接入外部工具与资源
```

| 主题 | 概念与原理 | 代码与示例 | 工程案例 |
| --- | --- | --- | --- |
| 工具接入与执行 | [MCP 架构](https://modelcontextprotocol.io/docs/learn/architecture)：工具、资源与协议边界 | [MCP Servers](https://github.com/modelcontextprotocol/servers)：参考工具与资源实现 | [Anthropic MCP 代码执行](https://www.anthropic.com/engineering/code-execution-with-mcp)：按需加载工具、过滤中间数据（工程方案与实验） |

# Model Layer

理解文本如何进入模型、模型能力如何通过数据与训练形成，以及如何验证能力边界。

```text
Transformer Architecture and Tokenizers → Pretraining → Post-Training → Model Evaluation
```

## Transformer Architecture and Tokenizers

**解决的问题**：模型如何将文本表示为数值，并预测下一 token。

```text
Transformer Architecture and Tokenizers：将文本表示为向量，计算下一 token 的预测分布
├─ 文本表示：Tokenization、token IDs 与 embedding
├─ Transformer 计算：Positional encoding、Attention 与 Feed-forward network
└─ Next-token prediction：概率分布、token 选择与自回归生成
```

| 主题 | 概念与原理 | 代码与示例 | 工程案例 |
| --- | --- | --- | --- |
| 文本表示 | [HF LLM Course](https://huggingface.co/learn/llm-course/en/chapter1/1)：Tokenizer、token 与模型输入 | [nanochat](https://github.com/karpathy/nanochat)：Tokenizer 与 embedding | — |
| Transformer 计算 | [Transformer 原始论文](https://arxiv.org/abs/1706.03762)：Attention、Positional encoding 与网络结构 | [nanochat](https://github.com/karpathy/nanochat)：Transformer 模型实现 | [DeepSeek-V3 §2](https://arxiv.org/html/2412.19437v2)：MLA、MoE、MTP；[MiniMax-01](https://arxiv.org/abs/2501.08313)：混合注意力（进阶模型报告） |
| Next-token prediction | [HF LLM Course](https://huggingface.co/learn/llm-course/en/chapter1/1)：自回归模型与生成 | [nanochat](https://github.com/karpathy/nanochat)：预测分布、采样与生成循环 | — |

多模态扩展：[Qwen2.5-VL](https://arxiv.org/abs/2502.13923)介绍视觉与语言模型设计；[Qwen2.5-Omni](https://qwenlm.github.io/blog/qwen2.5-omni/)介绍音频、视频与流式语音生成。

## Pretraining

**解决的问题**：如何从大规模数据中学习通用能力，并让训练结果可以比较和追溯。

```text
Pretraining：通过 Next-token prediction 从大规模数据学习通用能力
├─ 数据准备：来源选择、清洗去重、质量过滤与 Tokenization
├─ 数据管理：数据集划分、配比与版本记录
└─ 训练目标与优化：Next-token prediction、Loss、Backpropagation 与参数更新
```

| 主题 | 概念与原理 | 代码与示例 | 工程案例 |
| --- | --- | --- | --- |
| 数据准备与管理 | [FineWeb](https://arxiv.org/abs/2406.17557)：清洗、去重与质量实验 | [DataTrove](https://github.com/huggingface/datatrove)：处理流水线；[SmolLM](https://github.com/huggingface/smollm/blob/main/text/pretraining/README.md)：数据依赖与阶段配置 | [Llama 3](https://arxiv.org/abs/2407.21783)：数据构造；[Qwen3](https://qwenlm.github.io/blog/qwen3/)：数据扩展与训练阶段（模型项目报告） |
| 训练目标与优化 | [HF 从零训练语言模型](https://huggingface.co/learn/llm-course/en/chapter7/6)：目标、损失与训练过程 | [PyTorch Examples](https://github.com/pytorch/examples)：训练循环；[SmolLM](https://github.com/huggingface/smollm/blob/main/text/pretraining/README.md)：训练配方与检查点 | [Llama 3](https://arxiv.org/abs/2407.21783)：训练设计与规模化经验（模型项目报告） |

训练框架负责数据加载、批次计算与 automatic differentiation；分布式训练作为规模化实现按需深入。

## Post-Training

**解决的问题**：如何让预训练模型更好地遵循指令、满足偏好、进行推理或适配具体业务任务。

```text
Post-Training：通过示范、偏好与奖励反馈调整模型行为
├─ 数据与反馈：示范回答、偏好标注与奖励信号的采集、审核及版本管理
├─ 训练方法
│  ├─ Supervised fine-tuning（SFT）：从示范回答学习
│  ├─ Preference optimization：通过 Direct preference optimization（DPO）等方法学习回答偏好
│  └─ Reinforcement learning（RL）：使用人类偏好、可验证结果等奖励信号
├─ 微调方式：Full fine-tuning 或 Parameter-efficient fine-tuning（PEFT），如 Low-rank adaptation（LoRA）
└─ 迭代反馈：结果验证、失败案例与数据调整
```

| 主题 | 概念与原理 | 代码与示例 | 工程案例 |
| --- | --- | --- | --- |
| 任务数据与反馈建设 | [HF Smol Course](https://huggingface.co/learn/smol-course/unit0/1)：示范与偏好数据 | [TRL](https://github.com/huggingface/trl)：样本格式与数据处理 | [DeepSeek-R1](https://arxiv.org/abs/2501.12948)：冷启动、数据构造与蒸馏（模型研发经验） |
| 训练方法 | [InstructGPT](https://arxiv.org/abs/2203.02155)：SFT、奖励模型与 RLHF；[HF Smol Course](https://huggingface.co/learn/smol-course/unit0/1)：偏好对齐 | [TRL](https://github.com/huggingface/trl)：SFT、DPO 等训练器；[verl](https://github.com/verl-project/verl)：强化学习训练配方 | [DeepSeek-R1](https://arxiv.org/abs/2501.12948)：通过 Reinforcement learning 提升推理能力；[DAPO](https://arxiv.org/abs/2503.14476)：训练稳定性（模型训练实验） |
| 参数更新与迭代 | [HF Smol Course](https://huggingface.co/learn/smol-course/unit0/1)：任务微调入口 | [TRL](https://github.com/huggingface/trl)：参数高效微调集成 | [MiniMax-M1 技术分享](https://www.minimax.io/news/minimax-m1-technical-seminar-2)：数值精度、奖励与数据质量的调整经验 |

## Model Evaluation

**解决的问题**：如何判断模型具备哪些能力、训练是否有效，以及评测结论能用于哪些场景。

```text
Model Evaluation：衡量模型能力、训练效果与适用边界
├─ 评测设计：能力目标、任务、指标与统一条件
├─ 评测执行：模型运行与结果评分
└─ 结果分析：能力比较、错误分析与结论适用范围
```

| 主题 | 概念与原理 | 代码与示例 | 工程案例 |
| --- | --- | --- | --- |
| 评测设计 | [HELM](https://arxiv.org/abs/2211.09110)：场景、指标与覆盖范围 | [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness)：任务定义 | [OpenAI SimpleQA](https://openai.com/index/introducing-simpleqa/)：事实性问题构建与评分（评测项目经验） |
| 评测执行与结果分析 | [HELM](https://arxiv.org/abs/2211.09110)：多维比较与结论限制 | [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness)：模型接入与运行；[simple-evals](https://github.com/openai/simple-evals)：评分实现 | [OpenAI SimpleQA](https://openai.com/index/introducing-simpleqa/)：拒答与校准；结论限定于短答案事实性 |

# Inference and Infrastructure Layer

包含 Training Systems、Runtime Infrastructure 与 Inference Systems。Runtime Infrastructure 为训练和推理提供资源与运行支撑。

```text
Training Systems（训练框架、分布式训练）
    ↑
Runtime Infrastructure（资源调度、通信、存储与容错）
    ↓
Inference Systems
├─ Inference Pipeline
├─ Cache Management
└─ Scheduling and Compute Optimization
```

本文只关注推理，介绍生成流程、Cache Management 及 Scheduling and Compute Optimization 如何影响延迟、吞吐和显存占用。

[DeepInfer](https://github.com/deepseek-ai/DeepInfer) 是支撑 DeepSeek 生产推理的框架，整合模型运行时、采样、异步调度与优化 kernel。

## Inference Pipeline

**解决的问题**：一次模型调用如何处理完整输入，再逐步生成输出并结束。

```text
Inference Pipeline：处理输入并逐 token 生成输出
├─ Prefill：处理输入，建立 KV cache，计算下一 token 的概率分布
├─ Decode：处理新增 token，复用并更新 KV cache，计算下一 token 的概率分布
└─ 生成控制：token 选择、停止条件与输出返回
```

| 主题 | 概念与原理 | 代码与示例 | 工程案例 |
| --- | --- | --- | --- |
| Prefill | [TVM LLM 教程](https://tvm.apache.org/docs/how_to/tutorials/optimize_llm.html)：输入处理与首个预测 | [vLLM](https://github.com/vllm-project/vllm)、[SGLang](https://github.com/sgl-project/sglang)：通用执行路径；[DeepInfer](https://github.com/deepseek-ai/DeepInfer)：模型运行时与离线推理 | [DeepSeek inference system](https://github.com/deepseek-ai/open-infra-index/blob/main/202502OpenSourceWeek/day_6_one_more_thing_deepseekV3R1_inference_system_overview.md)：Prefill/decode disaggregation 与并行配置（线上经验） |
| Decode 与生成控制 | [HF 推理教程](https://huggingface.co/docs/transformers/llm_tutorial_optimization)：自回归生成、采样与缓存 | [SGLang](https://github.com/sgl-project/sglang)：生成循环；[DeepInfer](https://github.com/deepseek-ai/DeepInfer)：采样、Speculative decoding 与输出控制 | [DeepSeek inference system](https://github.com/deepseek-ai/open-infra-index/blob/main/202502OpenSourceWeek/day_6_one_more_thing_deepseekV3R1_inference_system_overview.md)：阶段性能与延迟目标（线上经验） |

## Cache Management

**解决的问题**：如何复用已计算的 Key 和 Value，避免每生成一个 token 都重新处理全部输入，同时控制 KV cache 的显存开销。

```text
Cache Management：复用已缓存的 Key 和 Value，管理显存开销
├─ 缓存复用：Prefill 缓存 Key 和 Value，Decode 读取并更新
├─ 显存管理：缓存块分配、分页与碎片控制
└─ 缓存生命周期：按条件共享、跨请求复用、保留与释放
```

| 主题 | 概念与原理 | 代码与示例 | 工程案例 |
| --- | --- | --- | --- |
| 缓存复用 | [Transformers Cache](https://huggingface.co/docs/transformers/kv_cache)：缓存建立、更新与复用 | [Cache 代码示例](https://huggingface.co/docs/transformers/kv_cache)：观察不同策略下的生成 | [DeepInfer 部署 Q&A](https://github.com/deepseek-ai/DeepInfer/blob/main/doc/inference_deployment_qa.md#kv-cache-storage)：跨请求缓存复用、存储与保留周期（线上设计经验，完整缓存系统未开源） |
| 显存管理 | [PagedAttention](https://arxiv.org/abs/2309.06180)：分页、共享与碎片问题 | [vLLM 设计说明](https://docs.vllm.ai/en/stable/design/paged_attention/)与[代码](https://github.com/vllm-project/vllm)：缓存块与读取实现 | [DeepSeek inference system](https://github.com/deepseek-ai/open-infra-index/blob/main/202502OpenSourceWeek/day_6_one_more_thing_deepseekV3R1_inference_system_overview.md)：Decode Load Balancer、KV cache 占用与线上缓存命中（线上经验） |

## Scheduling and Compute Optimization

**解决的问题**：如何在显存和计算资源约束下提高吞吐、控制延迟，并验证优化对输出效果的影响。

```text
Scheduling and Compute Optimization：在资源约束下平衡吞吐、延迟与输出效果
├─ Continuous batching：生成过程中动态加入与移除请求
├─ 低精度计算：权重与 KV cache 的 Quantization、硬件支持与效果权衡
└─ 效果验证：吞吐、延迟、显存占用与输出效果
```

| 主题 | 概念与原理 | 代码与示例 | 工程案例 |
| --- | --- | --- | --- |
| Continuous batching | [HF Continuous Batching](https://huggingface.co/docs/transformers/continuous_batching)：动态加入与退出 | [SGLang](https://github.com/sgl-project/sglang)：批次组织；[DeepInfer](https://github.com/deepseek-ai/DeepInfer)：CPU 批调度与设备执行重叠的异步调度 | [DeepSeek inference system](https://github.com/deepseek-ai/open-infra-index/blob/main/202502OpenSourceWeek/day_6_one_more_thing_deepseekV3R1_inference_system_overview.md)：批次拆分与计算通信重叠（线上经验）；[DeepInfer 部署 Q&A](https://github.com/deepseek-ai/DeepInfer/blob/main/doc/inference_deployment_qa.md#data-parallel-load-balancing)：按负载分配请求与计算预算；[SGLang MTP](https://www.lmsys.org/blog/2025-07-17-mtp/)：解码优化实验 |
| 低精度计算 | [vLLM Quantization](https://docs.vllm.ai/en/stable/features/quantization/)：格式、精度与硬件支持 | [vLLM](https://github.com/vllm-project/vllm)：量化配置与推理对比 | — |

# CUDA and GPU Layer

上层训练框架与推理运行时以 tensor 运算组织模型计算；本层关注其 GPU 执行与内存性能。

```text
GPU Execution ↔ Memory and Performance
```

## GPU Execution

**解决的问题**：训练框架或推理运行时组织的 tensor 运算，如何通过 GPU kernel 并行执行。

```text
GPU Execution：通过 GPU kernel 执行 tensor 运算
├─ 计算表示：tensor 与算子
├─ 算子实现：计算库调用、编译器与 kernel
└─ 设备执行：thread、thread block、warp 与 streaming multiprocessor（SM）
```

| 主题 | 概念与原理 | 代码与示例 | 工程案例 |
| --- | --- | --- | --- |
| 算子实现 | [cuBLAS](https://docs.nvidia.com/cuda/cublas/)：矩阵计算库与 CUDA 的关系 | [Triton](https://github.com/triton-lang/triton)：基础 kernel；[FlashMLA](https://github.com/deepseek-ai/FlashMLA)：Attention kernel | [DeepInfer](https://github.com/deepseek-ai/DeepInfer/blob/main/README.md)：将 FlashMLA、DeepGEMM 等 kernel 组件整合到模型运行时（生产框架说明） |
| 设备执行 | [CUDA Programming Guide](https://docs.nvidia.com/cuda/cuda-programming-guide/)：kernel、线程组织与执行模型 | [CUDA Samples](https://github.com/NVIDIA/cuda-samples)：线程、同步与异步执行 | [DeepSeek-V3 §3.2.2](https://arxiv.org/html/2412.19437v2)：Warp 分工、PTX 与通信计算重叠（进阶实现经验） |

## Memory and Performance

**解决的问题**：数据放在哪里、如何搬运和复用，才能减少模型计算中的内存开销与等待。

```text
Memory and Performance：通过存储组织和数据复用提高计算效率
├─ Memory hierarchy：寄存器、共享内存、显存的容量与带宽
├─ 数据搬运与复用：分块、中间数据复用与按需重计算
└─ 性能验证：计算耗时、显存占用与数值效果
```

| 主题 | 概念与原理 | 代码与示例 | 工程案例 |
| --- | --- | --- | --- |
| Memory hierarchy | [CUDA Programming Guide](https://docs.nvidia.com/cuda/cuda-programming-guide/)：内存层次与访问方式 | [DeepGEMM](https://github.com/deepseek-ai/DeepGEMM)：低精度矩阵计算及性能测试 | [DeepSeek-V3 §3.3](https://arxiv.org/html/2412.19437v2)：低精度存储与累加精度（进阶实现经验） |
| 数据搬运与复用 | [FlashAttention](https://arxiv.org/abs/2205.14135)：分块与减少内存访问 | [FlashAttention 代码](https://github.com/Dao-AILab/flash-attention)：Attention 数据复用 | [DeepSeek-V3 §3.2.3](https://arxiv.org/html/2412.19437v2)：激活重计算与内存开销权衡（进阶实现经验） |

