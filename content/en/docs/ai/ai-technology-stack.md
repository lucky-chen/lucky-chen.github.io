---
title: "AI Technology Stack: Applications, Training and Inference, Models, and Computing Infrastructure"
date: '2026-07-17'
categories:
  - AI
weight: 1
---

# AI Technology Stack Overview

## Layers and Responsibilities

This map centers on large language models and organizes the technology stack into four layers: application and orchestration, training and inference frameworks, model architecture and algorithms, and computing and infrastructure. Each layer explains its responsibilities, its connections to other layers, and where to read further.

| Layer | Main Question | Responsibilities |
|---|---|---|
| Application and orchestration | How do models help complete user tasks? | Agents, workflows, context, knowledge retrieval, tools, and external systems |
| Training and inference frameworks | How are training processes organized and models served? | Data pipelines, training execution, model deployment, generation execution, and request scheduling |
| Model architecture and algorithms | How do models represent text, learn parameters, and generate tokens? | Tokenizers, Transformers, training objectives, parameter updates, and generation algorithms |
| Computing and infrastructure | How does model computation run on devices and clusters? | Tensor frameworks, operators and acceleration libraries, GPUs, storage, communication, and resource management |

<!--more-->

## Technology Map and Layer Relationships

```text
Application and orchestration
├── Agents and workflows
├── Context, memory, and skills
└── RAG, tools, and external systems
              ↓
Training and inference frameworks
├── Pretraining: data pipelines, training loops, distributed training, checkpoints
├── Post-training: execution of SFT, preference optimization, and RL
└── Inference: model serving, generation loops, cache management, batching, and scheduling
              ↓
Model architecture and algorithms
├── Text representation: tokenizers and embeddings
├── Model architecture: Transformers, attention, MLPs, normalization, and the LM head
├── Learning algorithms: training objectives, loss, backpropagation, and optimizers
└── Generation algorithms: autoregressive computation, KV caches, and token selection
              ↓
Computing and infrastructure
├── Computing frameworks: PyTorch and JAX
├── Operators and acceleration: CUDA, compute libraries, communication libraries, and compilers
└── Hardware and runtime environment: GPUs, storage, networks, containers, and clusters
```

The arrows indicate that upper layers depend on capabilities provided by lower layers. They do not mean that each request runs through pretraining, post-training, and inference in sequence. Applications typically call inference services; separate training jobs produce model weights that inference systems then load.

```text
Training data → Pretraining / post-training frameworks → Model weights
                                                              │ load
                                                              ↓
User task → Application and orchestration ───────────→ Inference framework
                                                              │
                                                              ├──→ Answer or tool-call request
                                                              ↓
                                               Model architecture and generation algorithms
                                                              ↓
                                               Computing frameworks and device execution
```

The four layers are divided by responsibility, and a project may span several layers. An inference engine, for example, can organize request execution while also implementing model integration, operator calls, and caching. When reading source code, classify modules by their responsibilities.

## Related Articles

| Question | Reading Entry |
|---|---|
| How does execution move from training to inference, and how do the inputs and outputs connect? | [The LLM Workflow: From Training to Inference with nanochat](/en/docs/ai/llm-workflow-with-nanochat/) |
| How does GPT turn inputs into logits? | [LLM Systems (1)](/en/docs/ai/llm-system-1/) |
| How are loss, parameter updates, caching, and sampling computed? | [LLM Systems (2)](/en/docs/ai/llm-system-2/) |
| How are general model mechanisms implemented in nanochat? | [nanochat: Core Architecture and Implementation](/en/docs/ai/llm-system-nanochat/) |
| How do you design an Agent runtime at the application layer? | [Agent SDK Design](/en/docs/ai/agent-sdk-design/) |

# Application and Orchestration

This layer combines user goals, business rules, model capabilities, knowledge, and external operations into a task execution process. Its inputs are user requests and business context; its outputs can be answers, structured results, or the results of operations in external systems.

```text
User task → Context assembly → Agent / Workflow → Model call
                                     ↑                 │
                                     └─────────────────┘
                           Tool execution, state updates,
                              and result assessment

Knowledge retrieval, conversation history, memory, and skills
contribute to context assembly as needed.
```

## Agents, Workflows, and Capability Reuse

Workflows define execution paths and step relationships; Agents allow models to choose subsequent actions during execution. The two can be combined. The runtime manages sessions, execution state, tool dispatch, and stopping conditions.

| Module | Responsibilities | Relationship to Other Modules |
|---|---|---|
| Context management | Select and organize instructions, history, memory, and retrieval results | Determines what the model actually sees in the current call |
| Execution orchestration | Control steps, model calls, tool execution, and state transitions | Connects model outputs to subsequent operations |
| Skills | Reuse task instructions, reference material, scripts, and templates | Discovered and loaded by the runtime according to task needs |
| Execution records | Record calls, state, errors, and resource use | Support failure diagnosis, evaluation, and process improvement |

Application runtimes manage history and memory, while inference engines manage KV caches. These are different forms of state: history and memory determine input content; KV caches reuse keys and values the model has already computed.

**Further reading**:

- [Agent SDK Design](/en/docs/ai/agent-sdk-design/): Requirements, runtime layers, context, and tool capabilities.
- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents): Organizing Agent and workflow execution.
- [Context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): Context selection, compaction, and memory.
- [Agent Skills](https://agentskills.io/home): Packaging, discovering, and loading task instructions and resources.

## Knowledge Retrieval and External Systems

RAG addresses how external knowledge enters model context; tool calling addresses how external operations are executed and their results returned.

```text
Knowledge sources → Cleaning and chunking → Indexing → Retrieval and reranking → Context

Model requests a tool call → Application validates and executes → Tool result → Next-round context
```

Applications need to maintain source attribution, permissions, and data update rules. MCP provides protocol interfaces for tools and resources; the application and its runtime environment still control whether operations are permitted, how they run, and how their results are used.

**Further reading**:

- [Agent SDK Design](/en/docs/ai/agent-sdk-design/): Context management and MCP / tool integration and execution.
- [Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval): Retrieval and context enrichment.
- [MCP Architecture](https://modelcontextprotocol.io/docs/learn/architecture): Tools, resources, and protocol boundaries.

# Training and Inference Frameworks

This layer organizes model algorithms into executable training jobs or inference services. It focuses on data flow, execution scheduling, state persistence, and support for batch or distributed execution.

```text
Pretraining framework → Base checkpoint → Post-training framework → Conversational model
                                                                            ↓
                                                                Inference framework loads model
                                                                            ↓
                                                                  Serves application requests
```

Pretraining and post-training share components such as device initialization, training execution, gradient synchronization, optimizer scheduling, evaluation, and checkpointing. The following sections explain how each stage uses these components; the model and algorithms layer covers the calculations.

## Pretraining

Pretraining organizes large-scale text into model inputs and prediction targets, runs repeated parameter updates, and produces a base model.

```text
Text shards → Tokenizer encoding → Packing and batching → Inputs and targets
                                                                ↓
                                                    Forward → Loss → Backward
                                                                ↓
                                           Gradient synchronization, parameter updates,
                                                      and state persistence
```

| Framework Responsibility | What It Organizes |
|---|---|
| Data pipeline | Reading, encoding, packing, dataset splitting, and tracking read positions |
| Training execution | Batch assignment, precision settings, gradient accumulation, and learning rate scheduling |
| Distributed training | Distributing data and model computation, synchronizing gradients, and sharding parameters and optimizer state |
| Validation and checkpointing | Triggering evaluation, saving model and training state, and controlling the loading order during recovery |

Training frameworks call models to compute loss and gradients. The meaning of loss, gradient computation, and optimization rules belong to the next layer.

**Further reading**:

- [The LLM Workflow](/en/docs/ai/llm-workflow-with-nanochat/): Pretraining data preparation, training loops, and checkpoints.
- [LLM Systems (2)](/en/docs/ai/llm-system-2/): Training objectives, gradient computation, and parameter updates.
- [FineWeb](https://arxiv.org/abs/2406.17557), [DataTrove](https://github.com/huggingface/datatrove): Pretraining data cleaning, deduplication, and processing pipelines.
- [DeepSpeed](https://github.com/deepspeedai/DeepSpeed): Training execution and distributed optimization implementations.

## Post-Training

Post-training organizes learning from demonstrations, preference optimization, or reinforcement learning on top of an existing model to adapt its behavior to task requirements. Different methods use different data and execution processes.

| Direction | Framework Execution Flow | Inputs and Outputs |
|---|---|---|
| SFT | Encode conversations, select supervised positions, train, and save | Instructions and reference answers → Updated model |
| Preference optimization | Organize preference pairs for the same prompt, compute the objective, and update parameters | Preferred and dispreferred answers → Updated model |
| RL | Run rollouts, compute rewards, construct the training objective, and update the policy | Questions and scoring criteria → Updated policy model |

RL connects generation and training: inference generates answers, scoring modules provide feedback, training execution uses that feedback to update parameters, and the updated parameters generate the next batch of answers.

```text
Current model → Generate answers → Compute rewards → Build training data → Update parameters
      ↑                                                                          │
      └──────────────────────────────────────────────────────────────────────────┘
```

The calculations behind SFT, DPO, GRPO, and similar objectives belong to the model and algorithms layer. Full fine-tuning and LoRA describe how parameters participate in updates. The methods a framework supports must be checked against its implementation version.

**Further reading**:

- [The LLM Workflow](/en/docs/ai/llm-workflow-with-nanochat/): Execution flows for SFT, LoRA, and RL.
- [LLM Systems (2)](/en/docs/ai/llm-system-2/): SFT supervision, GRPO objectives, and LoRA parameter updates.
- [HF Smol Course](https://huggingface.co/learn/smol-course/unit0/1): Demonstration and preference data, and post-training methods.
- [TRL](https://github.com/huggingface/trl), [verl](https://github.com/verl-project/verl): Post-training execution framework implementations.

## Inference

Inference frameworks load models, receive requests, organize prefill, decode, and sampling, and manage requests, caches, and outputs.

```text
Request intake → Batch assembly → Prefill → Token selection → Decode loop → Output
                       ↑                         │                │
                       └── Request scheduling ───┴── Cache management
```

| Module | Responsibilities |
|---|---|
| Model serving | Interfaces, model versions, request routing, rate limiting, and service scaling |
| Inference execution | Model loading, prefill / decode calls, sampling, and stopping control |
| Cache management | KV storage allocation, block management, reuse, reclamation, and capacity control |
| Request scheduling | Batching, request admission and completion, execution resources, and latency-throughput tradeoffs |

Single-generation execution and serving multiple requests have different scopes. nanochat helps explain model execution and generation loops; production inference engines also handle concurrency, cache capacity, batching, and distributed execution.

**Further reading**:

- [The LLM Workflow](/en/docs/ai/llm-workflow-with-nanochat/): Input preparation, prefill, decode, and output handling.
- [nanochat: Core Architecture and Implementation](/en/docs/ai/llm-system-nanochat/): The engine, KV cache, sampling, and answer state management.
- [vLLM](https://github.com/vllm-project/vllm), [SGLang](https://github.com/sgl-project/sglang): Inference execution, cache management, and scheduling implementations.
- [PagedAttention](https://arxiv.org/abs/2309.06180), [vLLM Design Documentation](https://docs.vllm.ai/en/stable/design/paged_attention/): KV cache paging and GPU memory management.

# Model Architecture and Algorithms

This layer explains how inputs become prediction scores, how training changes parameters, and how generation selects subsequent tokens. Pretraining, post-training, and inference frameworks reuse these structures and algorithms.

```text
Text → Tokenizer → Token IDs
                       ↓
                   Embedding
                       ↓
              Transformer blocks
                       ↓
                Final norm, LM head
                       ↓
                     Logits
                    /      \
                   /        \
       Target → Loss        Token selection → Next forward pass
                   ↓             Inference path
                Backward
                   ↓
                Optimizer
                   ↓
            Parameter update
              Training path
```

## Text Representation and Model Architecture

Tokenizers define the mapping between text and token IDs; embeddings map IDs to vectors. Transformers compute layer by layer through attention, MLPs, normalization, and residual connections, and the LM head maps hidden representations to vocabulary scores.

| Module | Main Question |
|---|---|
| Tokenizer, embedding | How does text become a model input representation? |
| Attention, positional encoding | How does the current position read visible context and its positional information? |
| MLP, normalization, residual connections | How does each layer transform, propagate, and stabilize hidden representations? |
| LM head | How do hidden representations become candidate scores for the next token? |

Model architecture defines the form of computation, model weights determine the current behavior, and frameworks instantiate, load, and call the model.

**Further reading**:

- [LLM Systems (1)](/en/docs/ai/llm-system-1/): Computation in embeddings, Transformers, final normalization, and the LM head.
- [nanochat: Core Architecture and Implementation](/en/docs/ai/llm-system-nanochat/): Source implementations of the tokenizer, GPT, attention, and MLPs.

## Learning Objectives and Parameter Updates

Different training stages can reuse the same forward computation while using different data, supervised positions, or optimization objectives.

| Mechanism | What It Explains |
|---|---|
| Next-token prediction, cross-entropy | How prediction scores and correct targets form an error signal |
| SFT supervision and masks | Which answer targets contribute to the loss |
| Preference and policy optimization objectives | How preferences, rewards, and generation probabilities form an update objective |
| Backward, optimizer | How gradients are computed and parameters updated |
| Parameterizations such as LoRA | Which parameters are trained and how updates are represented |

Gradient accumulation, synchronization, and update scheduling at the framework layer must preserve the intended optimization objective. Splitting batches or changing the number of effective targets also requires checking how loss is reduced and weighted.

**Further reading**:

- [LLM Systems (2)](/en/docs/ai/llm-system-2/): Loss, backward computation, optimizers, gradient accumulation, and LoRA.
- [nanochat: Core Architecture and Implementation](/en/docs/ai/llm-system-nanochat/): Training implementations of loss, backward computation, and optimizers.
- [HELM](https://arxiv.org/abs/2211.09110), [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness): Evaluation design, task definitions, and model evaluation implementations.

## Generation Algorithms and Caching

Generation algorithms use existing parameters to compute scores for the next token from the current context, select an output through greedy decoding, sampling, or another search strategy, and repeat until a stopping condition is met.

A KV cache stores keys and values from previous positions for attention at new positions to read. This layer explains its computational meaning; inference frameworks organize paging, allocation, and reuse across requests.

| Model and Algorithms Layer | Training and Inference Frameworks Layer |
|---|---|
| Loss, gradients, and parameter update rules | Organizing batches, backward computation, synchronization, updates, and checkpointing |
| Objectives for SFT, preference optimization, and policy optimization | Organizing data, rollouts, scoring, and training jobs |
| How attention uses historical keys and values | Allocating cache storage and managing capacity and lifecycle |
| How logits become the next token | Scheduling requests, executing generation loops, and returning outputs |

**Further reading**:

- [LLM Systems (2)](/en/docs/ai/llm-system-2/): Incremental attention, KV caches, probability distributions, and token sampling.
- [nanochat: Core Architecture and Implementation](/en/docs/ai/llm-system-nanochat/): Source implementations of cache reads and writes, sampling, and generation loops.

# Computing and Infrastructure

This layer executes model operations and tasks on physical devices and provides storage, communication, and resource management. Training and inference can share underlying components, but their execution workloads and optimization goals differ.

```text
Tensor operations in the model
    ↓
Computing frameworks, automatic differentiation, and compilation
    ↓
Operator implementations, compute libraries, and communication libraries
    ↓
CPU / GPU, device memory, and interconnects

Containers, clusters, storage, and networks support task deployment,
data access, and device coordination.
```

## Computing Frameworks, Operators, and Acceleration Software

| Component | Main Responsibilities |
|---|---|
| Computing frameworks such as PyTorch and JAX | Tensor representation, operation execution, automatic differentiation, and device scheduling |
| Compute libraries and kernels | Implementing matrix operations, attention, and other device computations |
| Compilation and fusion | Turning computation graphs or operators into executable programs, reducing some scheduling and memory access overhead |
| Communication libraries | Supporting data transfer and collective communication across devices |

Training algorithms use gradients and update rules; automatic differentiation and device operations provide the capabilities to execute those rules. Training loops, distributed execution strategies, and underlying communication libraries have distinct responsibilities.

**Further reading**:

- [Triton](https://github.com/triton-lang/triton): Operator programming and compiler implementations.
- [FlashAttention](https://github.com/Dao-AILab/flash-attention): Optimizing attention computation and memory access.
- [NCCL](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/index.html): GPU collective communication.

## Hardware, Clusters, and Performance

Performance depends jointly on computation volume, memory capacity, memory access, communication, and request organization.

| Focus | Typical Questions |
|---|---|
| GPU execution | How are threads, thread blocks, and parallel computation organized? |
| Storage and memory access | Where is data stored, and how is it tiled, reused, or recomputed? |
| Multi-device communication | How are parameters, gradients, or intermediate results exchanged across devices? |
| Clusters and resources | How are devices assigned to tasks, data loaded, and workloads deployed and recovered? |
| Performance validation | What hardware, precision, batch size, and input length are used for measurement? |

Inference request scheduling determines which requests enter an execution step; cluster resource scheduling determines which machines and devices a task uses. The two influence each other, but manage different objects.

**Further reading**:

- [CUDA Programming Guide](https://docs.nvidia.com/cuda/cuda-programming-guide/): GPU execution and memory models.
