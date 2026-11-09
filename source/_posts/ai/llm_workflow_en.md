---
title: 大模型工作流程
categories: [AI]
date: 2026-02-13
---

# Goal

以 GPT 类 decoder-only Transformer 为对象，介绍大模型从训练到生成回答的工作流程。

- 预训练：准备文本、Tokenizer 和 Batch，通过下一 token 预测训练基础模型。
- 后训练：通过 SFT 提供回答示范，通过 RL 利用奖励改进模型，并介绍 LoRA 的使用方式。
- 推理：准备输入，串联 Prefill、token 选择、Decode、KV Cache 与输出处理。
- 评测：贯穿训练与使用过程，检查预测表现、任务能力、回答质量和运行性能。

<!-- more -->

```text
LLM 知识框架
│
├── 1. Data Pipeline
│   ├── 数据清洗 → 转换 → 划分
│   ├── Tokenizer：文本 ↔ Token ID
│   └── Batch Preparation：Packing、Padding、Attention Mask、Tensor 转换
│
├── GPT Model
│   ├── Token Embedding
│   ├── Transformer Blocks × N
│   │   ├── Self-Attention
│   │   ├── MLP / FFN
│   │   └── Norm / Residual
│   └── Final Norm → LM Head → Logits
│
├── Training
│   ├── 共用机制：Loss、Backward、Optimizer
│   ├── Pretraining
│   ├── Post-training：SFT、LoRA、RL
│   └── Evaluation、Checkpoint
│
└── Inference
    ├── 输入准备
    ├── Prefill、Decode、Token 选择
    ├── KV Cache
    └── 输出处理
```

模型结构与 Forward 计算见 [LLM System（一）](llm_system_1.md)，训练目标、参数更新与生成计算见 [LLM System（二）](llm_system_2.md)。

# 模型怎样从大量文本中学习？→ 预训练

预训练让模型根据已有文本预测下一个 token，再根据预测误差调整参数。整个过程先准备数据，再反复执行训练更新：

```text
收集文本 → 清洗、去重、划分训练集与验证集
    ↓
准备 Tokenizer → 文本编码为 token IDs
    ↓
Packing → Batch → Attention Mask
    ↓
构造输入、下一 token 目标与 Loss Mask
    ↓
Forward → Loss → Backward → Optimizer 更新参数
    ↑                                  │
    └────────── 读取下一批数据 ──────────┘

训练期间：定期验证、保存 Checkpoint
训练结束：保存基础模型，供后训练或文本生成使用
```

下面沿用 System 的主线 `Cats sit on mats`，辅以“Hi!”和“Go!”说明打包与补齐。词表大小为 `V=256`；所有 token 切分和 ID 均为教学示意，不代表实际 Tokenizer 的结果。

## 没有人工标注，学习依据从哪里来？→ 自监督

文本自身就包含预测目标。例如，将“Cats sit on mats”切分为：

```text
[Cats, sit, on, mats]
```

模型看到“Cats”时预测“sit”，看到“Cats sit”时预测“on”。正确答案来自原文，不需要人工逐条填写。这种从数据自身构造监督信号的方式称为自监督。

虽然训练时整段序列可以一起送入模型，但每个位置只能读取自身及之前的内容，不能提前读取要预测的答案。这个限制由 Causal Mask 实现。

## 文本怎样成为模型输入？→ Tokenizer

模型内部处理的是数值向量，不能直接处理文字字符。因此，先通过 Tokenizer 将文字转换为 token IDs，再由模型内部的 Embedding 将这些 ID 转换为向量：

```text
文本 → Tokenizer → token IDs → Embedding → 向量 → 后续模型计算
```

例如：

```text
文本 A：Cats sit on mats
Token： [Cats, sit, on, mats]
IDs：   [12, 45, 78, 90]

文本 B：Hi!
Token： [Hi, !]
IDs：   [103, 9]

文本 C：Go!
Token： [Go, !]
IDs：   [104, 9]
```

一个 token 可以是词、词的一部分、标点或字节片段，具体切分取决于 Tokenizer。常见的子词分词算法有 **BPE、WordPiece、Unigram**，算法详解见 [Hugging Face: Normalization and pre-tokenization](https://huggingface.co/learn/llm-course/chapter6/4)及后续章节。

Tokenizer 在模型训练前准备好，训练与推理使用与模型匹配的编码规则，基本概念见 [Hugging Face: Tokenizers](https://huggingface.co/learn/llm-course/chapter2/4)，具体工程实现参见 [nanochat：LLM 核心架构与实现](llm_system_nanochat.md)。

## 多条短文本怎样组织成训练序列？→ Packing

训练时，为了批量并行计算，通常将多条序列组织为形状 `[B, T]` 的张量，其中 `B` 是序列条数，`T` 是每条序列对齐后的长度。

原始文本长短不一。如果每条短文本单独成行，不足的位置需要填充，产生大量补齐位置，浪费计算资源。

Packing 将多条短文本拼接起来，再按设定长度组织成训练序列，减少补齐浪费。补齐过程称为 Padding，使用的填充 token ID 记为 `padding_id`。

例如，设 `eos_id=242`、`padding_id=0`：

```python
# 每行容量：8 个 token
# Packing 前：每条文本单独成行，剩余位置补齐
sequences = [
    [12, 45, 78, 90, eos_id, padding_id, padding_id, padding_id],
    [103, 9, eos_id, padding_id, padding_id, padding_id, padding_id, padding_id],
]

# Packing 后：两条文本合并到同一行
packed_sequences = [
    [12, 45, 78, 90, eos_id, 103, 9, eos_id],
]
```

本例设定每条训练序列长度为 8，`eos_id` 表示文本结束标记的 token ID。同样的 8 个有效 token，Packing 前占两行、产生 8 个补齐位置；Packing 后只占一行。

Padding 的详细介绍参见 [Hugging Face: Padding the inputs](https://huggingface.co/learn/llm-course/chapter2/5#padding-the-inputs)。

## 多行序列怎样一起计算？→ Batch

Packing 已将文本组织成训练序列。训练数据很多，逐条送入模型不能充分利用硬件的并行计算能力，因此将多条序列组合起来，一次处理，这一组序列称为一个 Batch。

序列补齐后，可组成形状为 `[B, T]` 的二维整数张量，`B` 是序列条数，`T` 是序列长度。

沿用上面的序列，对比逐条计算和 Batch 计算：

```python
# 逐条：两个 [1, 8] → GPU 先处理第一条，再处理第二条
ids_1 = [12, 45, 78, 90, eos_id, 103, 9, eos_id]
ids_2 = [104, 9, eos_id, padding_id, padding_id, padding_id, padding_id, padding_id]

model(torch.tensor([ids_1], dtype=torch.long, device=device))
model(torch.tensor([ids_2], dtype=torch.long, device=device))

# Batch：一个 [2, 8] → GPU 在一次批量计算中并行处理两条
batched_ids = [
    [12, 45, 78, 90, eos_id, 103, 9, eos_id],
    [104, 9, eos_id, padding_id, padding_id, padding_id, padding_id, padding_id],
]

input_ids = torch.tensor(batched_ids, dtype=torch.long, device=device)
model(input_ids)
```

Tensor 可以理解为用于数值计算的多维数组。这里将 Python list 转为整数 Tensor，形状为 `[2, 8]`，再交给模型计算。转换后 token IDs 的数值不变，模型内部的 Embedding 才将其转换为向量。

基本介绍参见 [PyTorch: Tensors](https://docs.pytorch.org/tutorials/beginner/basics/tensorqs_tutorial.html)。

## 怎样避免把补齐位置当作有效上下文？→ Attention Mask

Batch 中的短序列使用了 `padding_id` 补齐，但这些位置不属于原始文本，需要在注意力计算中排除。

Attention Mask 用来标记哪些位置可以被关注：真实 token 标记为 1，补齐位置标记为 0。以下是例子：

```python
batched_ids = [
    [12, 45, 78, 90, eos_id, 103, 9, eos_id],
    [104, 9, eos_id, padding_id, padding_id, padding_id, padding_id, padding_id],
]

attention_mask = [
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 0, 0, 0, 0, 0],
]
```

Attention Mask 还有其他用途，后训练中的不同策略也涉及不同的 Mask，见下文。

基础用法参见 [Hugging Face: Attention masks](https://huggingface.co/learn/llm-course/chapter2/5#attention-masks)。

## 每个位置应该预测什么？→ 目标移位

输入准备好后，还需要为每个位置提供正确的预测目标。下一 token 预测要求模型根据当前位置及之前的内容，预测紧接着的 token。

因此，将同一条序列错开一位，分别构造输入 `x` 和目标 `y`，这个过程称为目标移位。沿用上面的第一行训练序列：

```python
sequence = [12, 45, 78, 90, eos_id, 103, 9, eos_id]
x = sequence[:-1]  # [12, 45, 78, 90, eos_id, 103, 9]
y = sequence[1:]   # [45, 78, 90, eos_id, 103, 9, eos_id]
```

对应原文：`Cats sit on mats <EOS> Hi! <EOS>`。

这行序列有 8 个 token，移位后得到 7 个输入位置与对应目标。例如，输入 12（Cats）对应目标 45（sit），输入到 45（sit）时对应目标 78（on）。

## 哪些位置应该参与预测误差计算？→ Loss Mask

目标移位后，部分位置的目标仍是 `padding_id`。如果将这些位置也用于计算预测误差，模型就会被要求学习补齐内容。

Loss Mask 指定哪些目标参与损失计算：真实目标标记为 1，补齐目标标记为 0。例如，对上面第二行训练序列构造输入、目标与 Loss Mask：

```python
sequence = [104, 9, eos_id, padding_id, padding_id, padding_id, padding_id, padding_id]
x = sequence[:-1]
y = sequence[1:]  # [9, eos_id, padding_id, padding_id, padding_id, padding_id, padding_id]
loss_mask = [1, 1, 0, 0, 0, 0, 0]
```

这里只有预测 9 和 `eos_id` 的两个位置计入 Loss，其余目标为补齐内容。Loss Mask 与目标侧对齐；输入侧的 Attention Mask 则随输入切片，取原来对应行的前 7 个位置。

三类 Mask 的用途如下：

| Mask | 控制什么 | 示例 |
|---|---|---|
| Padding Mask | 哪些补齐位置不能作为有效上下文被读取 | 排除 padding_id |
| Causal Mask | 哪些未来位置不能被读取 | 预测“on”时不能读取“on”及之后的输入位置 |
| Loss Mask | 哪些目标位置计入损失 | 忽略补齐目标；后训练时还可只监督回答部分 |

## 模型怎样通过反复训练改进预测？→ 训练循环

输入与目标准备好后，模型可以产生预测，但预测结果通常不准确。怎样利用正确答案，让模型逐步改进？

训练通过四个步骤完成一次参数更新：

```python
for epoch in range(num_epochs):
    for batch in train_dataloader:
        batch = {k: v.to(device) for k, v in batch.items()}
        outputs = model(**batch)  # Forward
        loss = outputs.loss      # Loss
        loss.backward()          # Backward

        optimizer.step()         # Optimizer：更新参数
        optimizer.zero_grad()    # 清空 Gradient
```

训练步骤示例参见 [Hugging Face: The training loop](https://huggingface.co/learn/llm-course/chapter3/4#the-training-loop)。

- **Forward：产生预测。** 根据输入计算词表中各候选 token 的 Logits（未归一化的预测分数）。
- **Loss：衡量误差。** 将 Logits 与正确目标交给 Loss Function，得到 Loss。下一 token 预测通常使用 Cross-Entropy Loss。
- **Backward：计算 Gradient。** 计算各参数的变化会怎样影响 Loss，此时参数尚未改变。
- **Optimizer：更新参数。** 根据 Gradient、Learning Rate 和更新规则修改参数，供下一次预测使用。

例如，原文是 `Cats sit on mats`。输入 IDs 为 `[12,45,78]`，对应 Target IDs 为 `[45,78,90]`。下面跟踪最后一个位置：模型根据 `Cats sit on` 预测 `mats`（ID=90），与 System 的计算示例对应：

```text
Forward：
模型输出词表 Logits，例如：
mats：0.9073，chairs：-0.0911，其他候选各有对应分数。

Loss：
将 Logits 与正确目标 mats 交给 Cross-Entropy Loss 计算。
其中包含 Log-Softmax 运算，无需先单独转换成概率。

Backward：
从这个 Loss 反向计算模型参数的 Gradient。

Optimizer：
根据 Gradient 和 Learning Rate 更新参数，朝降低训练 Loss 的方向调整模型。
下一次预测使用更新后的参数。
```

这个例子只展示一个预测位置。实际训练会汇总 batch 中所有有效目标位置的 Loss，再执行 Gradient 计算与参数更新。详细计算原理见 [LLM System（二）](llm_system_2.md)。

## 一次更新的数据放不进显存怎么办？→ 梯度累积

假设一次参数更新使用 8 条序列，同时执行 Forward、Backward 会导致 GPU 显存不足。

可以将其拆成两个 micro-batch，每批 4 条，依次计算并累积 Gradient，最后统一更新一次参数。这种方式称为 Gradient Accumulation。

```python
gradient_accumulation_steps = 2
optimizer.zero_grad()

for index, batch in enumerate(train_dataloader):
    batch = {k: v.to(device) for k, v in batch.items()}
    outputs = model(**batch)  # Forward
    loss = outputs.loss / gradient_accumulation_steps  # 按累积步数缩放 Loss
    loss.backward()  # Gradient 自动累加，不立即清空

    if (index + 1) % gradient_accumulation_steps == 0:  # 累积两批后再更新
        optimizer.step()       # Optimizer
        optimizer.zero_grad()  # 清空 Gradient
```

示例参见 [Hugging Face: Performing gradient accumulation with Accelerate](https://huggingface.co/docs/accelerate/usage_guides/gradient_accumulation)。

Loss 缩放与加权的计算原理见 [LLM System（二）](llm_system_2.md)。

## 怎样保存并恢复进度？→ Checkpoint

训练可能持续很久。如果中途停止，怎样保留已经学到的参数，并在下次启动时继续训练？

Checkpoint 将模型参数和训练状态保存到文件，恢复时加载这些状态，从保存位置继续。

假设训练在第 3000 步保存了一次 Checkpoint，第 3200 步意外中断。重新启动后，加载最近的 Checkpoint，恢复到第 3000 步，再从第 3001 步继续训练。

Checkpoint 通常包含：

| 内容 | 作用 |
|---|---|
| Model Weights | 保留已经学到的参数 |
| Optimizer State | 保留历史 Gradient 的统计信息，供后续参数更新使用 |
| Training Step | 记录训练进度 |
| Learning Rate Scheduler State | 恢复 Learning Rate 调度进度 |
| DataLoader State | 恢复数据读取位置 |
| RNG State | 恢复随机过程的状态 |

详细介绍参见 [Hugging Face: Checkpointing](https://huggingface.co/docs/accelerate/usage_guides/checkpoint)。

# 怎样让模型按照要求回答？→ 后训练

Pre-trained Model 已有基础能力，但还需要学习如何遵循指令、进行对话，以及满足任务和回答质量要求。

SFT 使用标准回答提供示范；RL 根据生成结果的 Reward 继续改进模型。LoRA 用于减少训练时需要更新的参数。

```text
Pre-trained Model
    ↓
指令与标准回答 → SFT
    ↓
生成回答 → Reward → RL 更新
    ↑                  │
    └──────────────────┘

训练期间：评测、保存 Checkpoint
训练结果：用于推理

参数更新方式：Full Fine-tuning / LoRA
```

## 怎样让模型遵循指令、进行对话并按指定格式回答？→ SFT

模型可以生成文本，但不一定按用户要求回答。例如，用户要求写一句描述猫坐在垫子上的英文，模型却继续补写用户的问题。需要通过“指令与期望回答”展示应该怎样完成任务。

SFT 在 Pre-trained Model 的基础上，使用这些示范继续训练：

```text
加载模型
    ↓
准备指令与标准回答
    ↓
Chat Template → token IDs 与 Loss Mask
    ↓
Packing → Batch → Attention Mask
    ↓
Forward → Loss → Backward → Optimizer
    ↓
评测与 Checkpoint
```

### 对话怎样成为 SFT 训练数据？→ Chat Template

一条对话训练数据包含不同角色的消息，需要转换为模型使用的对话格式，同时标明哪些回答位置参与监督。

沿用 System 二的句子生成任务，标准回答为 `Cats sit on mats`：

```python
messages = [
    {"role": "user", "content": "Write a sentence about cats sitting on mats."},
    {"role": "assistant", "content": "Cats sit on mats"},
]
```

Chat Template 添加角色与消息边界，格式化后的文本可示意为：

```text
<USER>Write a sentence about cats sitting on mats.<END>
<ASSISTANT>Cats sit on mats<END>
```

上面的标记仅用于展示结构，实际标记由模型的 Chat Template 决定。随后将对话转为 token IDs，并按 Assistant 回答位置生成 Loss Mask（参考预训练章节，标记为 0 的目标位置不参与 Loss 计算）：

| 对话部分 | 转换结果 | Loss Mask |
|---|---|---|
| User 角色、问题与消息结束标记 | 对应的 token IDs | 0 |
| Assistant 角色起始标记 | 对应的 token IDs | 0 |
| Assistant 回答及回答结束标记 | 对应的 token IDs | 1 |

对话格式详见 [Hugging Face: Chat Templates](https://huggingface.co/learn/llm-course/chapter11/2)。

### 标准回答怎样用于模型更新？→ SFT Training

对话格式与监督位置准备好后，需要让模型学习标准回答。SFT 仍然使用 Next Token Prediction：根据前文预测下一个 token，但只使用指定回答位置的 Cross-Entropy Loss 更新参数。

**训练流程**

```python
model = load_pretrained_model()
tokenizer = load_tokenizer()

# 应用 Chat Template，编码并构造 Next Token Target
# 非监督位置的 Target 设为 ignore_index，再整理成 Batch
train_dataloader = prepare_sft_data(tokenizer, dataset)

for epoch in range(num_epochs):
    for inputs, targets in train_dataloader:
        logits = model(inputs)  # Forward
        loss = cross_entropy(
            logits, targets, ignore_index=ignore_index
        )  # Loss
        loss.backward()        # Backward
        optimizer.step()       # 更新参数
        optimizer.zero_grad()  # 清空 Gradient
```

`prepare_sft_data` 合并表示对话格式化、编码、Target 与 Loss Mask 构造以及 Batch 整理。

**例子**

沿用前面的句子生成任务，标准回答是 `Cats sit on mats`。跟踪回答中预测 `mats` 的位置：

```text
输入上下文：
User：Write a sentence about cats sitting on mats.
Assistant：Cats sit on

正确 Target：mats，ID=90
```

User 问题仍作为上下文被读取，但其目标位置设为 `ignore_index`，不计入 Loss。

与预训练相比，主要变化是数据和监督位置：

| 内容 | 预训练 | SFT |
|---|---|---|
| 数据 | 原始文本 | 指令、对话与标准回答 |
| 监督位置 | 有效文本目标位置 | 本例中的 Assistant 回答位置 |
| 更新流程 | Forward → Loss → Backward → Optimizer | 沿用相同流程 |

Gradient Accumulation 与 Checkpoint 沿用前文介绍的流程。

详细示例参见 [Hugging Face: Supervised Fine-Tuning](https://huggingface.co/learn/llm-course/chapter11/3)。

## 更新整个模型成本太高怎么办？→ LoRA

SFT 需要继续更新模型参数。对于大型模型，Full Fine-tuning 要为全部可训练参数保存 Gradient 和 Optimizer State，显存与存储开销较大。怎样减少需要训练的参数？

LoRA 冻结基础参数，在部分层中添加少量可训练参数，训练时只更新这些新增参数。

模型的许多层通过矩阵参数完成计算。Full Fine-tuning 直接修改原矩阵；LoRA 保持原矩阵不变，用两个较小矩阵表示参数更新，只训练这两个小矩阵。

例如，原矩阵形状为 `[4096, 4096]`，有约 1678 万个参数。LoRA 设置 Rank 为 8，新增矩阵形状为 `[4096, 8]` 和 `[8, 4096]`，合计约 6.6 万个可训练参数。两个矩阵的乘积与原矩阵形状相同，可以作为更新量加到原矩阵上。

**训练流程**

```python
model = load_pretrained_model()

# 冻结基础参数，添加可训练的 LoRA Adapter
model = add_lora_adapter(model)

# 数据准备与 SFT 训练循环沿用前文
train(model, train_dataloader)

# 保存训练后的 Adapter
save_adapter(model)
```

**例子**

沿用前面的句子生成任务，输入与标准回答保持不变，改变的是参与更新的参数：

| 内容 | Full Fine-tuning | LoRA |
|---|---|---|
| 基础参数 | 更新 | 冻结 |
| LoRA Adapter | 无 | 更新 |
| 训练数据与 Target | 指令与标准回答 | 相同 |
| 更新流程 | Forward → Loss → Backward → Optimizer | 沿用相同流程 |
| 保存结果 | 完整模型参数 | Adapter 参数 |

推理时，将 Adapter 与匹配的基础模型一起加载，或将其更新合并到基础参数中。

详细介绍参见 [Hugging Face: LoRA (Low-Rank Adaptation)](https://huggingface.co/learn/llm-course/chapter11/4)。

## 怎样让回答更有用、更符合任务要求和人类偏好？→ RL

SFT 使用标准回答提供示范，但模型实际生成的回答仍可能答错，或不符合质量要求。怎样根据回答的实际效果继续改进模型？

RL 先让模型生成回答，再根据回答获得 Reward，利用 Reward 更新模型。

```text
Prompt → 生成回答 → Reward → 更新模型
             ↑                   │
             └───────────────────┘
```

### 回答的效果怎样变成评分？→ Reward

RL 需要将任务完成情况或回答质量转换为 Reward。评分方法有多种，这里介绍两种。

**1. 按明确规则评分**

有明确判定依据的任务，可以通过答案校验或代码测试直接评分。例如：

```text
Prompt：Write a Python function that returns the larger of two numbers.

回答 A：return max(a, b)
回答 B：return a

测试输入与期望结果：
(3, 1)   → 3
(1, 3)   → 3
(-1, -3) → -1
(-3, -1) → -1

回答 A：通过 4/4，Reward = 1.0
回答 B：通过 2/4，Reward = 0.5
```

本例只展示函数的返回语句，Reward 按测试通过比例计算。

**2. 从人类偏好中学习评分**

有用性、表达质量等要求难以直接写成规则，可以收集人类偏好，训练 Reward Model，再用它给新回答评分。

### 怎样利用人类偏好继续训练？→ RLHF

例如，请人比较同一问题的两个回答：

```text
Prompt：Explain what a tokenizer does in one sentence.

回答 A：A tokenizer converts text into token IDs for a model.
回答 B：It is something used in computers.

人类选择：A 优于 B
```

收集大量这样的比较数据后，训练 Reward Model，使其学习人类的评价倾向。随后，让模型生成新回答，由 Reward Model 评分，再通过 RL 更新模型。这一流程称为 RLHF。

```text
人类比较回答 → 偏好数据 → 训练 Reward Model
                                  ↓
模型生成回答 ───────────────→ Reward → 策略更新
```

详细介绍参见 [Hugging Face: Introduction to Reinforcement Learning and its Role in LLMs](https://huggingface.co/learn/llm-course/chapter12/2)。

<a id="grpo"></a>

### 得到 Reward 后，怎样更新模型？→ GRPO

RLHF 说明人类反馈怎样参与训练；GRPO 是利用 Reward 更新模型的策略优化算法。GRPO 的 Reward 可以来自人类偏好训练出的 Reward Model，也可以来自答案校验等规则。

GRPO 为同一个 Prompt 生成多个回答，通过组内 Reward 比较得到 Advantage，再构造训练目标。下面沿用前文的 Reward Model 评分示例。

**训练流程**

```python
for prompts in train_dataloader:
    responses = generate(model, prompts, num_samples=4)
    rewards = reward_model(prompts, responses)  # Reward Model 评分
    advantages = group_advantage(rewards)      # 组内比较
    loss = grpo_loss(model, prompts, responses, advantages)

    loss.backward()        # Backward
    optimizer.step()       # 更新参数
    optimizer.zero_grad()  # 清空 Gradient
```

**例子**

针对同一个 Prompt 生成四个新回答：

```text
Prompt：Explain what a tokenizer does in one sentence.
```

以下 Reward 为示意值：

| 回答 | Reward Model 评分 | Advantage |
|---|---:|---|
| A：A tokenizer converts text into token IDs for a model. | 0.9 | 正 |
| B：It is something used in computers. | 0.3 | 负 |
| C：A tokenizer splits text into tokens and maps them to IDs. | 0.8 | 正 |
| D：A tokenizer generates the model’s final answer. | 0.2 | 负 |

组内平均 Reward 为 0.55。A、C 高于平均值，B、D 低于平均值。GRPO 根据这些相对表现构造 Loss，更新模型，再用更新后的模型继续生成和评分。

详细介绍参见 [Hugging Face: Understanding the DeepSeek R1 Paper](https://huggingface.co/learn/llm-course/chapter12/3)。

# 用户提出问题后，回答怎样产生？→ 推理

训练完成后，模型使用已有参数，根据用户输入逐步生成回答。推理不执行 Backward 和 Optimizer 更新。

```text
加载模型 → 准备输入 → Prefill → Token 选择
                                  ↓
                            输出与停止判断
                                  ↓
                                Decode
                                  ↓
                              Token 选择
                                  └──→ 返回输出与停止判断

生成过程中：解码并输出
满足停止条件：结束生成，更新对话历史
```

## 用户问题怎样交给模型？→ 输入准备

用户输入包含文字，也可能包含历史消息。需要先按模型的对话格式组织，再转换为模型输入。

```python
model = load_trained_model()
tokenizer = load_tokenizer()
model.eval()

messages = [
    {"role": "user", "content": "Write a sentence about cats sitting on mats."},
]

# 应用 Chat Template，并添加 Assistant 回答起始标记
input_ids = prepare_prompt(tokenizer, messages)
```

`prepare_prompt` 合并表示 Chat Template、编码、Tensor 转换与设备传输，具体概念见前文。推理计算在关闭 Gradient 记录的模式下执行。

下面的生成计算沿用 System 的纯文本续写例子，直接输入 `Cats sit on`，IDs 为 `[[12,45,78]]`，不添加对话标记。对话模型使用上面的输入准备方式，后续生成步骤相同。

```python
input_ids = torch.tensor([[12, 45, 78]], dtype=torch.long, device=device)
```

## 完整输入怎样产生首次预测？→ Prefill

开始生成回答前，模型需要先处理完整 Prompt，计算下一 token 的预测分数。这个阶段称为 Prefill，同时建立 KV Cache，供后续生成复用。

```python
def prefill(model, input_ids):
    # 完整 Prompt 执行 Forward，同时建立 KV Cache
    logits, kv_cache = model.forward(input_ids, use_cache=True)

    # 最后一个位置的 Logits，用于预测下一个 token
    return logits[:, -1, :], kv_cache


next_token_logits, kv_cache = prefill(model, input_ids)
```

输入 `Cats sit on` 后，Prefill 得到最后一个位置 `on` 的 Logits，用于预测 `mats` 等下一 token，此时尚未选择具体输出。

## 有了预测分数，怎样选择输出？→ Token 选择

Logits 给出了词表中各候选 token 的分数，还需要根据选择规则确定实际输出。Prefill 和后续 Decode 得到的 Logits 都经过这一步。

```python
def select_token(logits):
    if temperature == 0:
        return argmax(logits)  # Greedy：选择最高分
    else:
        scores = logits / temperature       # Temperature：调整分布集中程度
        scores = filter_top_k_top_p(scores)  # Top-k / Top-p：限制候选范围
        probabilities = softmax(scores)     # Softmax：转换为概率
        return sample(probabilities)        # Sampling：按概率选择


next_token = select_token(next_token_logits)
```

Greedy、Sampling、Beam Search 等具体算法，参见 [Hugging Face: Basic decoding methods](https://huggingface.co/docs/transformers/main/en/generation_strategies#basic-decoding-methods)。

**例子**

输入 `Cats sit on`。System 一的两层模型在最后一个位置给出 `mats` 的 Logit 约为 `0.9073`，高于其他候选，Greedy 返回 `ID=90`。

Sampling 需要将分数转换为概率。沿用 System 二的独立采样示例，设 `mats`、`chairs` 的 Logits 分别为 `0.9073`、`0.6`，其余 254 项为 0；这些是假设值。设置 `Temperature=1、Top-k=2、Top-p=0.8` 后，最终候选分布为：

| 候选 token | ID | 筛选并归一化后的概率 |
|---|---:|---:|
| mats | 90 | 57.62% |
| chairs | 91 | 42.38% |

Greedy 选择 `mats`；Sampling 按上表概率选择。选中的 token 随后进入下一轮生成。

## 新增 token 怎样用于下一次预测？→ Decode

选择一个 token 只完成了一步预测。要继续生成，模型需要结合新增 token 和已有上下文，计算下一次预测分数。

Decode 把刚生成的 token 作为新增输入，结合历史 KV Cache 得到下一次预测，再重复选择。将 Prefill、Token 选择和 Decode 串起来，就形成自回归生成循环：

```python
while not finished:
    next_token = select_token(logits)          # 选择 token
    generated_ids.append(next_token)           # 追加结果
    logits, kv_cache = model.forward(
        next_token, kv_cache=kv_cache          # Decode：计算下一次预测，复用 KV Cache
    )
    finished = check_stop(next_token)          # 检查停止条件
```

**例子**

沿用 `Cats sit on`，假设 Greedy 先选中 `mats`，再选中结束标记 `EOS`。第二步的结束结果为流程示意：

```text
Cats sit on → mats（90）→ EOS（242）
```

| 模型计算阶段 | 本次输入 | 随后由 Token 选择得到的结果 |
|---|---|---|
| Prefill | Cats sit on，IDs=[12,45,78] | mats，ID=90 |
| Decode | mats，ID=90 | EOS，ID=242；结束生成 |

Prefill 一次处理完整 Prompt；Decode 每次接收新增 token。两者输出的 Logits 都交给 Token 选择。

自回归生成机制参见 [Hugging Face: Text generation with an LLM](https://huggingface.co/docs/transformers/llm_tutorial)。

## 怎样避免重复计算历史 token 的 K/V？→ KV Cache

自回归生成的 Decode 过程中，每次预测都需要历史 token 的 K/V。KV Cache 保存各层已经计算好的 K/V，后续直接复用，只计算新增 token 的 Q/K/V。

```python
# Decode 入口：只输入新增 token，复用历史缓存
logits, cache = model.forward(next_token, kv_cache=cache)

# 内部核心机制：追加当前 K/V，再执行 Attention
new_K, new_V = cache.update(k_t, v_t, layer_idx)
attn_output = attn_layer_idx_fn(q_t, new_K, new_V)
```

**例子**

```text
输入 Cats sit on，随后生成 mats，再预测 EOS：

不使用缓存：
输入 Cats sit on      → 计算三个位置的 K/V                  → 预测 mats
输入 Cats sit on mats → 重算前三个位置的 K/V，计算 mats 的 K/V → 预测 EOS

使用缓存：
输入 Cats sit on → 计算并缓存三个位置的 K/V                 → 预测 mats
输入 mats        → 复用前三个位置的 K/V，追加 mats 的 K/V     → 预测 EOS
```

详细介绍参见 [Hugging Face: How caching works](https://huggingface.co/docs/transformers/en/cache_explanation)。

## 怎样显示回答并结束本轮生成？→ 输出

生成结果是 token IDs，需要通过 Tokenizer 解码为文本。为了让用户尽早看到回答，可以在生成过程中增量解码并显示新增文本，这称为 Streaming。

**例子**

```text
输入前缀：Cats sit on
新增 token：mats（90）→ 解码并显示 mats
结束 token：EOS（242）→ 停止，不作为正文显示
拼接后的完整文本：Cats sit on mats
```

遇到结束标记或达到 `max_new_tokens` 等停止条件时，结束本轮生成。对话模式下，回答可在生成过程中逐步显示；例如前面的句子生成任务，将完整回答加入历史：

```python
messages.append({
    "role": "assistant",
    "content": "Cats sit on mats",
})
```

下一轮用户追问 `Where do they sit?` 时，将新问题追加到 `messages`，再准备输入。模型通过历史知道 `they` 指向前面提到的猫。

# 怎样知道模型是否达到了要求？→ 评测

训练完成，并不代表模型已经达到使用要求。需要用未参与训练的数据检查预测表现，再通过具体任务、回答评价和性能测试，判断模型的实际效果。

```text
预训练：检查预测表现与基础能力
后训练：检查任务完成、指令遵循与回答质量
推理：检查回答效果、速度与资源开销
```

## 模型在未见文本上预测得怎样？→ Validation Loss

Training Loss 反映模型对训练数据的拟合情况。要检查它能否处理新文本，需要准备独立的 Validation Set，例如从预训练语料中留出一部分文本，不用于参数更新。

将这些文本输入模型，计算 Loss，不执行 Backward 和 Optimizer 更新。

**例子**

假设在相同 Validation Set 和计算设置下得到：

| Checkpoint | Training Loss | Validation Loss |
|---|---:|---:|
| 第 1000 步 | 2.1 | 2.3 |
| 第 2000 步 | 1.5 | 1.9 |
| 第 3000 步 | 1.0 | 2.2 |

第 3000 步的 Training Loss 继续下降，但 Validation Loss 上升，说明模型在训练数据上的改善没有延续到验证数据。

## 模型能否正确完成任务？→ Task Evaluation

预测 Loss 不能直接说明模型能否答对问题或写出正确代码。需要让模型完成具体任务，再按照答案或测试结果判分。

常见 Benchmark 包括：

| 数据集 | 评测内容 | 判分方式 |
|---|---|---|
| [MMLU](https://huggingface.co/datasets/cais/mmlu) | 多学科选择题 | 对照正确选项，统计 Accuracy |
| [GSM8K](https://huggingface.co/datasets/openai/gsm8k) | 数学应用题 | 提取最终答案，统计 Accuracy |
| [HumanEval](https://huggingface.co/datasets/openai/openai_humaneval) | 代码补全 | 执行配套测试，统计 Pass@1 等指标 |

**例子**

使用 GSM8K 的 Test Set：

例如，抽取 100 道题，每题生成一次回答，其中 80 道最终答案正确，则这次评测的 Accuracy 为 80%。

## 回答是否符合使用要求？→ Response Evaluation

回答事实正确，也可能没有遵循用户要求。可以通过规则检查指令约束，通过人类比较评价有用性与表达质量。

[IFEval](https://huggingface.co/datasets/google/IFEval) 提供可自动验证的指令要求，例如关键词、字数和段落数量。

**例子**

沿用前面的句子生成任务，并增加只返回英文句子的要求：

```text
要求：Write a sentence about cats sitting on mats. Return only the sentence.

回答 A：Cats sit on mats
回答 B：Here is a sentence: Cats sit on mats
```

两个回答都包含所需句子，但只有 A 满足只返回句子的要求。额外说明可通过规则检查；描述是否贴切、表达是否清楚，可以请人比较评价。

评测题目应与训练数据隔离，避免模型因见过试题而获得虚高结果。

## 回答速度与资源开销怎样？→ Performance Evaluation

模型能够完成任务，还需要检查用户等待时间、生成速度和硬件开销。

| 指标 | 含义 |
|---|---|
| TTFT | 从请求开始到首个 token 输出的时间 |
| Generation Speed | 持续生成时每秒输出的 token 数 |
| Throughput | 单位时间内完成的请求数或处理的 token 数 |
| GPU Memory | 推理使用的显存 |

**例子**

固定同一模型、GPU 和生成设置，输入长度为 `512 tokens`，生成长度为 `128 tokens`，`Batch=1`，记录 TTFT、Generation Speed 和峰值 GPU Memory。

随后改变 Batch 或输入长度，观察性能变化。比较结果时同时记录测试条件。
