---
title: "Getting Started with AI: A Four-Layer Technology Map"
categories: [AI]
date: 2025-10-07
---

# Goal

**Chinese version: [大模型入门总览：四层技术框架](/i18n/zh/ai/ai-overview.html)**

This guide maps the large language model (LLM) stack across four layers: applications, models, inference infrastructure, and GPU computing. Each section outlines the main concepts and links to explanations, implementations, and engineering case studies.

| Layer | Main Question | Core Modules |
| --- | --- | --- |
| Application and Product | How do you build applications with models? | Agents and Workflows; Data and Knowledge Integration; Tools and External Systems |
| Model | How do models work and learn? | Transformer Architecture and Tokenizers; Pretraining; Post-Training; Model Evaluation |
| Inference and Infrastructure | What systems support training and inference? | Training Systems; Runtime Infrastructure; Inference Systems (the focus here) |
| CUDA and GPU | How do model operations run on GPUs? | GPU Execution; Memory and Performance |

<!-- more -->

# Knowledge Map

Read from applications down to GPU computing, or follow the learning path for your role. The two flows below show how the layers work together during generation and training.

```text
Application and Product
├─ Agents and Workflows: Manage context, control execution, and reuse skills and tools
├─ Data and Knowledge Integration: Ingest data and retrieve relevant context
└─ Tools and External Systems: Call external tools and return their results

Model
├─ Transformer Architecture and Tokenizers: Represent text as vectors and compute next-token distributions
├─ Pretraining: Learn from large datasets through next-token prediction
├─ Post-Training: Train on demonstrations, preferences, and rewards
└─ Model Evaluation: Measure capabilities, training progress, and limitations

Inference and Infrastructure
├─ Training Systems: Training frameworks and distributed training (overview only)
├─ Runtime Infrastructure: Resource scheduling, communication, storage, and fault tolerance (overview only)
└─ Inference Systems: Inference Pipeline, Cache Management, and Scheduling and Compute Optimization (covered here)

CUDA and GPU
├─ GPU Execution: Execute tensor operations on the GPU
└─ Memory and Performance: Reduce data movement and reuse data efficiently
```

## How Does a Prompt Become a Response?

```text
User prompt
    ↓
Application / Agents and Workflows: Assemble the prompt, history, and memory;
    load skills and include retrieved context or tool results as needed
    ↓
Model / Tokenizer: Encode the input as token IDs
    ↓
Inference / Prefill: Run the Transformer, build the KV cache, and compute the next-token distribution
    ↓
Inference / Token selection and decoding: Select a token, then process it to compute
    the next distribution; reuse and update the KV cache until generation stops
    │
    └─ GPU kernels perform the tensor operations at each step
    ↓
Model / Tokenizer: Decode generated token IDs into text
    ↓
Application: Return the answer, or execute a requested tool call,
    add its result to the context, and call the model again
```

## How Is a Model Trained?

```text
Model / Architecture and tokenizer: Define the model and text encoding
    ↓
Model / Pretraining data: Collect, clean, deduplicate, filter, split, and tokenize data;
    track dataset versions and mixture ratios
    ↓
Model / Pretraining: Compute the loss, backpropagate gradients, and update parameters
    │
    └─ The training framework dispatches GPU kernels that operate on tensors
    ↓
Pretrained model
    ↓
Model / Post-training: Prepare demonstrations, preference data, and reward signals;
    train with SFT, preference optimization, or reinforcement learning
    │
    └─ The training framework updates parameters using the same GPU execution stack
    ↓
Model / Evaluation: Measure capabilities and limitations; revise the data and training methods
    ↓
Inference / Inference Pipeline: Load the model and serve application requests
```

## Roles and Learning Paths

The four role categories below group responsibilities found in job listings from [DeepSeek](https://talent.deepseek.com/), [ByteDance Seed](https://seed.bytedance.com/zh/career), and [Anthropic](https://www.anthropic.com/careers/jobs). Role names are representative; titles and responsibilities vary by company. GPU computing and performance roles may sit within infrastructure teams.

Depth: **Familiar** — know what it does and its limitations; **Working knowledge** — explain how it works and its tradeoffs; **Proficient** — implement and troubleshoot independently.

| Role Category | Typical Roles | Responsibilities | Learning Path and Depth |
| --- | --- | --- | --- |
| AI Application Development | AI Product Engineer<br>Agent Engineer | Build AI products<br>Combine models, retrieval, and tools<br>Implement business workflows | → Applications (Proficient)<br>→ Models (Working knowledge)<br>→ Inference and Infrastructure (Working knowledge)<br>→ GPU Computing (Familiar) |
| Model Research and Development | Research Engineer, Pretraining<br>Research Engineer, Post-Training<br>Multimodal Research Engineer | Develop model architectures, datasets, and training methods<br>Run experiments and evaluate model capabilities | → Models (Proficient)<br>→ Inference and Infrastructure (Working knowledge)<br>→ GPU Computing (Working knowledge)<br>→ Applications (Familiar) |
| AI Systems and Infrastructure | Training Framework Engineer<br>Inference Systems Engineer | Build training, inference, and data platforms<br>Improve reliability, scalability, and resource utilization | → Models (Working knowledge)<br>→ GPU Computing (Working knowledge)<br>→ Inference and Infrastructure (Proficient)<br>→ Applications (Familiar) |
| GPU Computing and Performance | GPU Kernel Engineer<br>AI Compiler Engineer | Build kernels, communication libraries, and compilers<br>Optimize model workloads for the hardware | → Models (Working knowledge)<br>→ GPU Computing (Proficient)<br>→ Inference and Infrastructure (Working knowledge)<br>→ Applications (Familiar) |

# Application and Product Layer

Build applications that use models, retrieve knowledge, and call external tools.

```text
Data and Knowledge Integration → Agents and Workflows ↔ Tools and External Systems
```

## Agents and Workflows

**Question:** How does an agent maintain context, call tools, track progress, and decide when to stop?

```text
Agent: An execution loop in which a model chooses actions and tools to complete a task
├─ Context management: Prompts, history, memory, and context compaction
├─ Execution control: Model calls, tool execution, state updates, and stopping conditions
├─ Reuse: Skills, tools, and subagents
└─ Workflows: Predefined execution paths that can include agents
```

| Topic | Concepts | Code and Examples | Case Studies |
| --- | --- | --- | --- |
| Context assembly and updates | [Context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): Information selection, compression, and memory | [Agent SDK architecture](/2025/12/07/ai/agent_sdk_design_en/): Context, memory, and transcripts | [Anthropic Research](https://www.anthropic.com/engineering/multi-agent-research-system): Context isolation and information aggregation (production case study) |
| Execution control | [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents): Execution patterns and tool loops | [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness): Runtime and plugins; `sdlc`: Business workflow | [Anthropic Research](https://www.anthropic.com/engineering/multi-agent-research-system): Task decomposition and execution reliability (production case study) |

### Skills

**Question:** How can an agent reuse procedures and domain knowledge across tasks?

```text
Skills: Reusable procedures, instructions, and supporting resources
├─ Packaging: Instructions, references, scripts, and templates
├─ Discovery and loading: Select skills by their descriptions; load instructions and resources on demand
└─ Execution and maintenance: Follow instructions, run scripts, and update the skill based on feedback
```

| Topic | Concepts | Code and Examples | Case Studies |
| --- | --- | --- | --- |
| Skill packaging | [Official documentation](https://agentskills.io/home): Directory layout, metadata, and supporting files | [anthropics/skills](https://github.com/anthropics/skills): Instructions, scripts, and templates | [Document skills in Claude](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills): How a PDF skill separates instructions, scripts, and references (implementation case study) |
| On-demand loading and execution | [Official documentation](https://agentskills.io/home): Discovery and loading mechanisms | [Document skill implementations](https://github.com/anthropics/skills): Resource references and script calls | [Progressive disclosure design](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills): Load only the resources a task needs (implementation case study) |

## Data and Knowledge Integration

**Question:** How do you keep source data up to date and retrieve the context a task needs?

```text
Data and Knowledge Integration: Ingest data and retrieve relevant context
├─ Data ingestion and maintenance: Collect, clean, organize, and update source data
├─ Provenance and permissions: Track sources, versions, access rights, and intended use
└─ Retrieval-augmented generation (RAG): Chunk, index, retrieve, and rerank source material for the context
```

| Topic | Concepts | Code and Examples | Case Studies |
| --- | --- | --- | --- |
| Data ingestion and retrieval | [Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval): Chunking, indexing, contextual enrichment, and reranking | [RAG Cookbook](https://platform.claude.com/cookbook/capabilities-contextual-embeddings-guide): Document processing, retrieval, and comparative experiments | — |

## Tools and External Systems

**Question:** How does a model request a tool call, and how does the application execute it and return the result?

```text
Tools and External Systems: Call external tools and return their results
├─ Tool definitions: Descriptions, input and output schemas, and permissions
├─ Tool calling: The model requests a call; the application executes it and returns the result
└─ Model Context Protocol (MCP): A standard interface for external tools and resources
```

| Topic | Concepts | Code and Examples | Case Studies |
| --- | --- | --- | --- |
| Tool integration and execution | [MCP architecture](https://modelcontextprotocol.io/docs/learn/architecture): Tools, resources, and protocol boundaries | [MCP Servers](https://github.com/modelcontextprotocol/servers): Reference tool and resource implementations | [Anthropic MCP code execution](https://www.anthropic.com/engineering/code-execution-with-mcp): On-demand tool loading and intermediate-data filtering (design and experiments) |

# Model Layer

This layer covers how models represent text, learn from data, and are evaluated.

```text
Transformer Architecture and Tokenizers → Pretraining → Post-Training → Model Evaluation
```

## Transformer Architecture and Tokenizers

**Question:** How does a model represent text and predict the next token?

```text
Transformer Architecture and Tokenizers: Represent text as vectors and compute next-token distributions
├─ Text representation: Tokenization, token IDs, and embeddings
├─ Transformer computation: Positional encodings, attention, and feed-forward networks
└─ Next-token prediction: Probability distributions, token selection, and autoregressive generation
```

| Topic | Concepts | Code and Examples | Case Studies |
| --- | --- | --- | --- |
| Text representation | [HF LLM Course](https://huggingface.co/learn/llm-course/en/chapter1/1): Tokenizers, tokens, and model inputs | [nanochat](https://github.com/karpathy/nanochat): Tokenizer and embeddings | — |
| Transformer computation | [Original Transformer paper](https://arxiv.org/abs/1706.03762): Attention, positional encodings, and model architecture | [nanochat](https://github.com/karpathy/nanochat): Transformer implementation | [DeepSeek-V3 §2](https://arxiv.org/html/2412.19437v2): MLA, MoE, and MTP; [MiniMax-01](https://arxiv.org/abs/2501.08313): Hybrid attention (advanced reading) |
| Next-token prediction | [HF LLM Course](https://huggingface.co/learn/llm-course/en/chapter1/1): Autoregressive models and generation | [nanochat](https://github.com/karpathy/nanochat): Next-token probabilities, sampling, and generation loops | — |

Multimodal extensions: [Qwen2.5-VL](https://arxiv.org/abs/2502.13923) introduces vision-language model design; [Qwen2.5-Omni](https://qwenlm.github.io/blog/qwen2.5-omni/) covers audio, video, and streaming speech generation.

## Pretraining

**Question:** How does a model learn general capabilities from large datasets, and how are the data and training runs tracked?

```text
Pretraining: Learn from large datasets through next-token prediction
├─ Data preparation: Source selection, cleaning, deduplication, filtering, and tokenization
├─ Data management: Dataset splits, mixture ratios, and version tracking
└─ Training objective and optimization: Next-token prediction, loss, backpropagation, and parameter updates
```

| Topic | Concepts | Code and Examples | Case Studies |
| --- | --- | --- | --- |
| Data preparation and management | [FineWeb](https://arxiv.org/abs/2406.17557): Cleaning, deduplication, and quality experiments | [DataTrove](https://github.com/huggingface/datatrove): Processing pipelines; [SmolLM](https://github.com/huggingface/smollm/blob/main/text/pretraining/README.md): Data dependencies and stage configuration | [Llama 3](https://arxiv.org/abs/2407.21783): Dataset preparation; [Qwen3](https://qwenlm.github.io/blog/qwen3/): Data scaling and training stages (model reports) |
| Training objective and optimization | [HF: Training a language model from scratch](https://huggingface.co/learn/llm-course/en/chapter7/6): Objectives, loss, and training | [PyTorch Examples](https://github.com/pytorch/examples): Training loops; [SmolLM](https://github.com/huggingface/smollm/blob/main/text/pretraining/README.md): Training recipes and checkpoints | [Llama 3](https://arxiv.org/abs/2407.21783): Training design and scaling experience (model report) |

Training frameworks handle data loading, batching, and automatic differentiation. Distributed training extends this to multiple devices.

## Post-Training

**Question:** How do you train a model to follow instructions, align with user preferences, reason, or perform a specific task?

```text
Post-Training: Train on demonstrations, preferences, and rewards
├─ Data and feedback: Collect demonstrations, preference labels, and reward signals; review and version the datasets
├─ Training methods
│  ├─ Supervised fine-tuning (SFT): Train on example responses
│  ├─ Preference optimization: Train on preferred and rejected responses with methods such as direct preference optimization (DPO)
│  └─ Reinforcement learning (RL): Optimize rewards from human preferences, verifiable outcomes, or other feedback
├─ Fine-tuning methods: Full fine-tuning or parameter-efficient fine-tuning (PEFT), such as low-rank adaptation (LoRA)
└─ Iteration: Evaluate results, analyze failures, and revise the training data
```

| Topic | Concepts | Code and Examples | Case Studies |
| --- | --- | --- | --- |
| Training data and feedback | [HF Smol Course](https://huggingface.co/learn/smol-course/unit0/1): Demonstration and preference data | [TRL](https://github.com/huggingface/trl): Sample formats and data processing | [DeepSeek-R1](https://arxiv.org/abs/2501.12948): Cold-start training, dataset preparation, and distillation (model report) |
| Training methods | [InstructGPT](https://arxiv.org/abs/2203.02155): SFT, reward models, and RLHF; [HF Smol Course](https://huggingface.co/learn/smol-course/unit0/1): Preference alignment | [TRL](https://github.com/huggingface/trl): SFT, DPO, and other trainers; [verl](https://github.com/verl-project/verl): Reinforcement learning recipes | [DeepSeek-R1](https://arxiv.org/abs/2501.12948): Reinforcement learning for reasoning; [DAPO](https://arxiv.org/abs/2503.14476): Training stability (training experiments) |
| Parameter updates and iteration | [HF Smol Course](https://huggingface.co/learn/smol-course/unit0/1): Task-specific fine-tuning | [TRL](https://github.com/huggingface/trl): Parameter-efficient fine-tuning integration | [MiniMax-M1 technical seminar](https://www.minimax.io/news/minimax-m1-technical-seminar-2): Adjustments to numerical precision, rewards, and data quality |

## Model Evaluation

**Question:** How do you measure model capabilities, track training improvements, and identify limitations?

```text
Model Evaluation: Measure capabilities, training progress, and limitations
├─ Evaluation design: Target capabilities, tasks, metrics, and controlled conditions
├─ Execution: Run models and score their outputs
└─ Analysis: Compare results, examine errors, and state what the evaluation does and does not measure
```

| Topic | Concepts | Code and Examples | Case Studies |
| --- | --- | --- | --- |
| Evaluation design | [HELM](https://arxiv.org/abs/2211.09110): Scenarios, metrics, and coverage | [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness): Task definitions | [OpenAI SimpleQA](https://openai.com/index/introducing-simpleqa/): Factual question design and scoring (evaluation case study) |
| Evaluation execution and result analysis | [HELM](https://arxiv.org/abs/2211.09110): Comparisons across metrics and the limits of each evaluation | [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness): Model adapters and evaluation runs; [simple-evals](https://github.com/openai/simple-evals): Scoring implementation | [OpenAI SimpleQA](https://openai.com/index/introducing-simpleqa/): Abstention and calibration; findings are limited to short-answer factuality |

# Inference and Infrastructure Layer

Training and inference systems share infrastructure for resource scheduling, communication, storage, and fault tolerance.

```text
Training Systems (training frameworks and distributed training)
    ↑
Runtime Infrastructure (resource scheduling, communication, storage, and fault tolerance)
    ↓
Inference Systems
├─ Inference Pipeline
├─ Cache Management
└─ Scheduling and Compute Optimization
```

This section focuses on inference: generation, KV caching, and the scheduling and compute optimizations that affect latency, throughput, and GPU memory use.

[DeepInfer](https://github.com/deepseek-ai/DeepInfer) powers DeepSeek's production inference. It combines the model runtime, sampling, asynchronous scheduling, and optimized kernels.

## Inference Pipeline

**Question:** How is a prompt processed, and how are tokens generated until a stopping condition is met?

```text
Inference Pipeline: Process the prompt and generate tokens
├─ Prefill: Process the prompt, build the KV cache, and compute the next-token distribution
├─ Decode: Process each new token using the KV cache, update the cache, and compute the next-token distribution
└─ Generation control: Token selection, stopping conditions, and output handling
```

| Topic | Concepts | Code and Examples | Case Studies |
| --- | --- | --- | --- |
| Prefill | [TVM LLM tutorial](https://tvm.apache.org/docs/how_to/tutorials/optimize_llm.html): Prompt processing and next-token prediction | [vLLM](https://github.com/vllm-project/vllm), [SGLang](https://github.com/sgl-project/sglang): Model execution paths; [DeepInfer](https://github.com/deepseek-ai/DeepInfer): Model runtimes and offline inference | [DeepSeek inference system](https://github.com/deepseek-ai/open-infra-index/blob/main/202502OpenSourceWeek/day_6_one_more_thing_deepseekV3R1_inference_system_overview.md): Prefill/decode disaggregation and parallelism configurations (production case study) |
| Decode and generation control | [HF inference tutorial](https://huggingface.co/docs/transformers/llm_tutorial_optimization): Autoregressive generation, sampling, and caching | [SGLang](https://github.com/sgl-project/sglang): Generation loops; [DeepInfer](https://github.com/deepseek-ai/DeepInfer): Sampling, speculative decoding, and output control | [DeepSeek inference system](https://github.com/deepseek-ai/open-infra-index/blob/main/202502OpenSourceWeek/day_6_one_more_thing_deepseekV3R1_inference_system_overview.md): Prefill and decode performance and latency targets (production case study) |

## Cache Management

**Question:** How does a KV cache reuse previously computed keys and values, and how is its memory managed?

```text
Cache Management: Reuse cached keys and values while managing GPU memory
├─ Cache reuse: Prefill stores keys and values; decoding reads and extends the cache
├─ Memory management: Cache block allocation, paging, and fragmentation
└─ Cache lifecycle: Sharing, reuse across requests, retention, and eviction
```

| Topic | Concepts | Code and Examples | Case Studies |
| --- | --- | --- | --- |
| Cache reuse | [Transformers Cache](https://huggingface.co/docs/transformers/kv_cache): Cache creation, updates, and reuse | [Cache code examples](https://huggingface.co/docs/transformers/kv_cache): Observe generation under different strategies | [DeepInfer deployment Q&A](https://github.com/deepseek-ai/DeepInfer/blob/main/doc/inference_deployment_qa.md#kv-cache-storage): Cross-request cache reuse, storage, and retention (production design; the full cache system is not open source) |
| Memory management | [PagedAttention](https://arxiv.org/abs/2309.06180): Paging, sharing, and fragmentation | [vLLM design documentation](https://docs.vllm.ai/en/stable/design/paged_attention/) and [code](https://github.com/vllm-project/vllm): Cache block management and attention kernels | [DeepSeek inference system](https://github.com/deepseek-ai/open-infra-index/blob/main/202502OpenSourceWeek/day_6_one_more_thing_deepseekV3R1_inference_system_overview.md): Decode Load Balancer, KV cache use, and cache hit rates in production (production case study) |

## Scheduling and Compute Optimization

**Question:** How do batching and lower precision affect throughput, latency, memory use, and output quality?

```text
Scheduling and Compute Optimization: Balance throughput, latency, memory use, and output quality
├─ Continuous batching: Add and remove requests as generation progresses
├─ Low-precision computation: Weight and KV cache quantization, hardware support, and accuracy tradeoffs
└─ Measurement: Throughput, latency, GPU memory use, and output quality
```

| Topic | Concepts | Code and Examples | Case Studies |
| --- | --- | --- | --- |
| Continuous batching | [HF Continuous Batching](https://huggingface.co/docs/transformers/continuous_batching): Adding and removing requests during generation | [SGLang](https://github.com/sgl-project/sglang): Batch formation; [DeepInfer](https://github.com/deepseek-ai/DeepInfer): Asynchronous scheduling that overlaps CPU batch scheduling with device execution | [DeepSeek inference system](https://github.com/deepseek-ai/open-infra-index/blob/main/202502OpenSourceWeek/day_6_one_more_thing_deepseekV3R1_inference_system_overview.md): Batch splitting and compute-communication overlap (production case study); [DeepInfer deployment Q&A](https://github.com/deepseek-ai/DeepInfer/blob/main/doc/inference_deployment_qa.md#data-parallel-load-balancing): Load balancing and compute-budget allocation; [SGLang MTP](https://www.lmsys.org/blog/2025-07-17-mtp/): Decoding optimization experiments |
| Low-precision computation | [vLLM Quantization](https://docs.vllm.ai/en/stable/features/quantization/): Formats, precision, and hardware support | [vLLM](https://github.com/vllm-project/vllm): Quantization configuration and inference comparisons | — |

# CUDA and GPU Layer

Training frameworks and inference runtimes express model computation as operations on tensors. This layer covers how those operations run on GPUs and how memory access affects performance.

```text
GPU Execution ↔ Memory and Performance
```

## GPU Execution

**Question:** How do frameworks execute tensor operations as GPU kernels?

```text
GPU Execution: Execute tensor operations on the GPU
├─ Data and operations: Tensors and operators
├─ Operator implementation: Compute libraries, compilers, and kernels
└─ Device execution: Threads, thread blocks, warps, and streaming multiprocessors (SMs)
```

| Topic | Concepts | Code and Examples | Case Studies |
| --- | --- | --- | --- |
| Operator implementation | [cuBLAS](https://docs.nvidia.com/cuda/cublas/): GPU matrix operations through cuBLAS | [Triton](https://github.com/triton-lang/triton): Basic kernels; [FlashMLA](https://github.com/deepseek-ai/FlashMLA): Attention kernels | [DeepInfer](https://github.com/deepseek-ai/DeepInfer/blob/main/README.md): Integrating FlashMLA, DeepGEMM, and other kernel components into model runtimes (framework overview) |
| Device execution | [CUDA Programming Guide](https://docs.nvidia.com/cuda/cuda-programming-guide/): Kernels, thread organization, and execution models | [CUDA Samples](https://github.com/NVIDIA/cuda-samples): Thread organization, synchronization, and asynchronous execution | [DeepSeek-V3 §3.2.2](https://arxiv.org/html/2412.19437v2): Warp specialization, PTX, and compute-communication overlap (advanced reading) |

## Memory and Performance

**Question:** How do memory layout, data movement, and reuse affect GPU performance?

```text
Memory and Performance: Reduce data movement and reuse data efficiently
├─ Memory hierarchy: Registers, shared memory, and GPU memory; capacity and bandwidth
├─ Data movement and reuse: Tiling, data reuse, and recomputation
└─ Validation: Execution time, GPU memory use, and numerical accuracy
```

| Topic | Concepts | Code and Examples | Case Studies |
| --- | --- | --- | --- |
| Memory hierarchy | [CUDA Programming Guide](https://docs.nvidia.com/cuda/cuda-programming-guide/): Memory hierarchy and access patterns | [DeepGEMM](https://github.com/deepseek-ai/DeepGEMM): Low-precision matrix computation and performance tests | [DeepSeek-V3 §3.3](https://arxiv.org/html/2412.19437v2): Low-precision storage and accumulator precision (advanced reading) |
| Data movement and reuse | [FlashAttention](https://arxiv.org/abs/2205.14135): Tiling and reduced memory access | [FlashAttention code](https://github.com/Dao-AILab/flash-attention): Attention data reuse | [DeepSeek-V3 §3.2.3](https://arxiv.org/html/2412.19437v2): Activation recomputation and memory tradeoffs (advanced reading) |
