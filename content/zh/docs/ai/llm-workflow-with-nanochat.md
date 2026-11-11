---
title: 大模型工作流程：从训练到推理，以 nanochat 为例
date: '2026-05-10'
categories:
    - AI
weight: 10
---

以 GPT 类 decoder-only Transformer 为对象，介绍大模型从训练到生成回答的工作流程，并结合 nanochat 的代码说明各阶段的执行细节。

- 预训练：准备文本、Tokenizer 与 Batch，通过下一 token 预测训练基础模型。
- 后训练：通过 SFT 提供回答示范，通过 RL 利用奖励改进模型，并介绍 LoRA 的应用方式。
- 推理：准备输入，串联 Prefill、token 选择、Decode、KV Cache 与输出处理。
- 评测：贯穿训练与使用过程，检查预测表现、任务能力、回答质量和运行性能。

<!--more-->

```text
文本 → Tokenizer → 训练序列与 Batch
                         ↓
                      预训练 → Base 模型
                                  ↓
                     指令与标准回答 → SFT → SFT 模型
                                            ├──→ 对话推理
                                            └──→ 可选 RL → RL 模型 → 对话推理

训练期间：验证预测表现、评测任务能力、保存 Checkpoint
使用期间：检查回答质量、延迟、吞吐与资源开销
```

源码依据：nanochat 固定提交 [92d63d4](https://github.com/karpathy/nanochat/commit/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd)。

模型结构与 Forward 计算见 [LLM System（一）](/zh/docs/ai/llm-system-1/)，训练目标、参数更新与生成计算见 [LLM System（二）](/zh/docs/ai/llm-system-2/)。

# 预训练：模型怎样从文本中学习

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

## 自监督：学习目标从哪里来

文本自身就包含预测目标。例如，假设“Cats sit on mats”切分为：

```text
[Cats, sit, on, mats]
```

模型看到“Cats”时预测“sit”，看到“Cats sit”时预测“on”。正确答案来自原文，不需要人工逐条填写。这种从数据自身构造监督信号的方式称为自监督。

虽然训练时整段序列可以一起送入模型，但每个位置只能读取自身及之前的内容，不能提前读取要预测的答案。这个限制由 Causal Mask 实现。

## Tokenizer：文本怎样变成 IDs

模型内部处理的是数值向量，不能直接处理文字字符。因此，先通过 Tokenizer 将文字转换为 token IDs，再由模型内部的 Embedding 将这些 ID 转换为向量：

```text
文本 → Tokenizer → token IDs → Embedding → 向量 → 后续模型计算
```

例如，设教学词表大小为 $V=256$。以下切分和 ID 均为教学设定，实际结果由所用 Tokenizer 决定：

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

一个 token 可以是词、词的一部分、标点或字节片段，具体切分取决于 Tokenizer。常见的子词分词算法有 **BPE、WordPiece、Unigram**，算法详解见 [Hugging Face: Normalization and pre-tokenization](https://huggingface.co/learn/llm-course/chapter6/4) 及后续章节。

Tokenizer 在模型训练前准备好，训练与推理使用与模型匹配的编码规则，基本概念见 [Hugging Face: Tokenizers](https://huggingface.co/learn/llm-course/chapter2/4)，具体工程实现参见 [nanochat：LLM 核心架构与实现](/zh/docs/ai/llm-system-nanochat/)。

[nanochat/dataset.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataset.py) 下载预训练文本分片，[scripts/tok_train.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/tok_train.py) 训练并保存 Tokenizer：

```bash
# 下载 8 个文本分片。
python -m nanochat.dataset -n 8
# 训练并保存 Tokenizer。
python -m scripts.tok_train
# 评测编码效果。
python -m scripts.tok_eval
```

Tokenizer 保存到 `tokenizer/tokenizer.pkl`，各 token 的字节数保存到 `tokenizer/token_bytes.pt`，供 BPB 评测使用。后续训练与推理复用同一份 Tokenizer。

## Packing：短文档怎样拼接

训练时，为了批量并行计算，通常将多条序列组织为形状 $[B, T]$ 的张量，其中 $B$ 是序列条数，$T$ 是每条序列对齐后的长度。

原始文本长短不一。如果每条短文本单独成行，不足的位置需要填充，产生大量补齐位置，浪费计算资源。

Packing 将多条短文本拼接起来，再按设定长度组织成训练序列，减少补齐浪费。补齐过程称为 Padding，使用的填充 token ID 记为 `padding_id`。

例如，设 `eos_id=242`、`padding_id=0`：

```python
eos_id = 242
padding_id = 0

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

## Batch：多条序列怎样并行计算

Packing 已将文本组织成训练序列。训练数据很多，逐条送入模型不能充分利用硬件的并行计算能力，因此将多条序列组合起来一次处理，这一组序列称为一个 Batch。

序列补齐后，可组成形状为 $[B, T]$ 的二维整数张量，$B$ 是序列条数，$T$ 是序列长度。

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

Tensor 可以理解为用于数值计算的多维数组。这里将 Python list 转为整数 Tensor，形状为 $[2, 8]$，再交给模型计算。转换后 token IDs 的数值不变，模型内部的 Embedding 才会将其转换为向量。

基本介绍参见 [PyTorch: Tensors](https://docs.pytorch.org/tutorials/beginner/basics/tensorqs_tutorial.html)。

## Attention Mask：哪些输入可以读取

Batch 中的短序列使用了 `padding_id` 补齐，但这些位置不属于原始文本，需要在注意力计算中排除。

Attention Mask 控制注意力可读取的位置。这里先构造其中的 Padding Mask：真实 token 标记为 1，补齐位置标记为 0；计算时还要结合 Causal Mask 排除未来位置。

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

这份标记只控制输入位置能否被读取；哪些目标参与训练误差计算，则由后面的 Loss Mask 控制。

基础用法参见 [Hugging Face: Attention masks](https://huggingface.co/learn/llm-course/chapter2/5#attention-masks)。

## 目标移位：每个位置预测什么

输入准备好后，还需要为每个位置提供正确的预测目标。下一 token 预测要求模型根据当前位置及之前的内容，预测紧接着的 token。

因此，将同一条序列错开一位，分别构造输入 `x` 和目标 `y`，这个过程称为目标移位。沿用上面的第一行训练序列：

```python
sequence = [12, 45, 78, 90, eos_id, 103, 9, eos_id]
x = sequence[:-1]  # [12, 45, 78, 90, eos_id, 103, 9]
y = sequence[1:]   # [45, 78, 90, eos_id, 103, 9, eos_id]
```

对应原文：`Cats sit on mats <EOS> Hi! <EOS>`。

这行序列有 8 个 token，移位后得到 7 个输入位置与对应目标。例如，输入 12（Cats）对应目标 45（sit），输入到 45（sit）时对应目标 78（on）。最后一个输入位置是 `!=9`，对应目标 `EOS=242`。

## Loss Mask：哪些目标参与训练

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

[nanochat/dataloader.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py) 将文档编码、打包和目标移位封装在 DataLoader 中：

```python
# 创建迭代器，按 Batch 取得输入、目标及数据读取状态。
train_loader = tokenizing_distributed_data_loader_with_state_bos_bestfit(
    tokenizer, args.device_batch_size, args.max_seq_len,
    split="train", device=device,
)
x, y, dataloader_state_dict = next(train_loader)
```

## 训练循环：预测误差怎样更新参数

**问题**：输入与目标准备好后，怎样利用预测误差，让模型逐步改进？

**方案**：

1. **怎样衡量预测是否准确**：执行 Forward，用下一 token 目标计算 Cross-Entropy Loss。
2. **怎样找到参数的调整方向**：通过 Backward 计算 Gradient。
3. **怎样让下一次预测使用新参数**：由 Optimizer 更新参数，再清空 Gradient，处理下一批数据。

**结构与核心逻辑**：

```text
DataLoader → x、y → Forward → Logits
                 │              │
                 └── y ────────→ Loss
                                  ↓
                               Backward
                                  ↓
                           Optimizer 更新参数
                                  ↓
                            清空梯度 → 下一批
```

[scripts/base_train.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py) 先创建并初始化 GPT、Tokenizer 和 Optimizer，再从前节的 DataLoader 读取 `x、y`。[GPT.forward()](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py) 接收 `y` 时合并执行 Forward 与 Cross-Entropy，返回有效目标的平均 Loss；目标为 `-1` 的位置被忽略。

下面以一次更新只处理一个 Batch 的情况连接这些操作；一次更新分多批计算见下一节：

```python
x, y, dataloader_state_dict = next(train_loader)  # 取得输入与下一 token 目标。
loss = model(x, y)                              # Forward + Cross-Entropy。
loss.backward()                                # 求梯度，参数尚未改变。
optimizer.step()                               # 根据梯度更新参数。
model.zero_grad(set_to_none=True)               # 清空梯度，准备下一次更新。
```

**例子**：沿用 `Cats sit on mats`，取输入 `[12,45,78]`、目标 `[45,78,90]`。假设三个目标的负对数概率分别为 `[1.2,0.8,1.0]`：

```text
读取 Cats        → 目标 sit（45） → NLL = 1.2
读取 Cats sit    → 目标 on（78）  → NLL = 0.8
读取 Cats sit on → 目标 mats（90）→ NLL = 1.0
                                      ↓
                       Loss = (1.2 + 0.8 + 1.0) / 3 = 1.0
                                      ↓
                              Backward → 参数更新
```

再假设某个参数为 `0.5`、本次梯度为 `0.3`，用教学 SGD、学习率 `0.01` 演示，则更新为 $0.5 - 0.01 \times 0.3 = 0.497$。这些数值为教学假设；nanochat 使用 AdamW / Muon，具体更新还取决于各自的状态与规则，计算见 [LLM System（二）](/zh/docs/ai/llm-system-2/)。

## 梯度累积：一次更新的数据怎样分批计算

**问题**：一次参数更新需要处理较多序列，无法同时放进显存，怎样完成这次更新？

**方案**：

1. **怎样控制单次计算的显存**：把本次更新的数据拆成多个 micro-batch，依次执行 Forward 和 Backward。
2. **怎样合并这些计算的贡献**：在同一组参数上累积 Gradient，完成全部 micro-batch 后统一更新一次。
3. **怎样保持平均误差的统计口径**：按各 micro-batch 的有效目标数量加权；数量相同时，可以除以累积步数。

**结构与核心逻辑**：

```text
本次更新的数据 → micro-batch 1 → Loss 加权 → Backward ──┐
               micro-batch 2 → Loss 加权 → Backward ──┤ 累积 Gradient
                                                      ↓
                                         Optimizer 更新一次 → 清空梯度
```

[scripts/base_train.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py) 根据目标 token 总数确定累积步数。预训练的行被填满，各 micro-batch 有效目标数量相同，因此采用等权平均。以下为 BF16 / FP32 路径的核心更新过程：

```python
# 计算一次 micro-batch 在所有 rank 上处理的 token 数。
world_tokens = args.device_batch_size * args.max_seq_len * ddp_world_size
assert total_batch_size % world_tokens == 0
grad_accum_steps = total_batch_size // world_tokens

# x、y 已取出；每次 Backward 自动把梯度累加到参数上。
for micro_step in range(grad_accum_steps):
    loss = model(x, y)
    (loss / grad_accum_steps).backward()
    x, y, dataloader_state_dict = next(train_loader)

optimizer.step()                     # 完成本次累积后更新一次。
model.zero_grad(set_to_none=True)     # 更新后才清空梯度。
```

学习率调度发生在更新前；FP16 路径使用 GradScaler。Loss 加权原理见 [LLM System（二）](/zh/docs/ai/llm-system-2/)。

**例子**：假设一次更新使用 8 条等长序列，各序列有效目标数相同。显存一次只能处理 4 条，因此拆成两个 micro-batch：

```text
前 4 条：平均 Loss = 1.2 → 1.2 / 2 → Backward ──┐
后 4 条：平均 Loss = 0.8 → 0.8 / 2 → Backward ──┤
                                               ↓
                       本次平均 Loss = 1.0 → 更新参数一次
```

两批 Forward 使用同一组尚未更新的参数。如果改用前文含 Padding 的两行数据，其有效目标数分别为 7 和 2，应使用 `7/9`、`2/9` 加权。

## Checkpoint：怎样保存与恢复进度

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

[scripts/base_train.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py) 将 Checkpoint 保存到 `base_checkpoints/<tag>/`。产物根目录由 `NANOCHAT_BASE_DIR` 指定，默认为 `~/.cache/nanochat`：

| 文件 | 内容 |
|---|---|
| `model_<step:06d>.pt` | 模型权重 |
| `optim_<step:06d>_rank<rank>.pt` | 各 rank 的 Optimizer 状态 |
| `meta_<step:06d>.json` | 模型配置、步数、验证 BPB、数据位置和训练循环状态 |

例如，第 3000 步的权重文件为 `model_003000.pt`。数据读取位置按分片、行组和 epoch 近似恢复，未保存全部缓冲文档，因此不保证恢复后逐 token 重现原轨迹。加载实现见 [nanochat/checkpoint_manager.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/checkpoint_manager.py)。

# 后训练：模型怎样学习按要求回答

Pre-trained Model 已有基础能力，但还需要学习如何遵循指令、进行对话，以及满足任务和回答质量要求。

SFT 使用标准回答提供示范；RL 根据生成结果的 Reward 继续改进模型。LoRA 用于减少训练时需要更新的参数。

```text
Pre-trained Model
    ↓
指令与标准回答 → SFT
    ↓
生成回答 → Reward → RL 更新（可选）
    ↑                  │
    └──────────────────┘

训练期间：评测、保存 Checkpoint
训练结果：用于推理

参数更新方式：Full Fine-tuning / LoRA
```

## SFT：通过标准回答学习

**问题**：基础模型已经能续写文本，怎样让它根据用户指令生成期望回答？

**方案**：

1. **怎样示范期望行为**：准备指令与标准回答，组成对话样本。
2. **怎样区分上下文与学习目标**：通过 Chat Template 编码角色和边界，用监督 Mask 指定 Assistant 回答目标。
3. **怎样利用示范更新模型**：加载基础模型，只根据有效回答目标的 Cross-Entropy 更新参数。
4. **怎样检查并交付结果**：分别检查标准回答的预测表现与实际生成效果，保存对话模型。

```text
指令与标准回答 → 对话编码 → IDs 与监督 Mask
                                  ↓
                   Packing / Padding → Batch → 移位输入与目标
                                  ↓
                         非监督目标设为 -1
                                  ↓
Base 模型 ──────────→ 回答 Loss → Backward → 参数更新
                                  ↓
                    验证预测表现、评测生成回答 → 保存 SFT 模型
```

### 准备对话与监督目标

**问题**：用户消息要供模型读取，标准回答要供模型学习，怎样把两者组织成训练输入与目标？

**方案**：

1. **怎样表示消息角色与边界**：用 Chat Template 编码对话，生成 token IDs。
2. **怎样指定学习哪些内容**：同步生成监督 Mask，用户消息与 Assistant 起始标记为 0，回答正文及结束标记为 1。
3. **怎样交给训练循环**：打包对话、补齐并组成 Batch，移位后将非监督目标设为 `-1`。

**结构与核心逻辑**：

```text
User 请求 + Assistant 标准回答
    ↓
角色、边界与正文编码 → IDs + 监督 Mask
    ↓
完整对话 Packing，必要时 Padding → 等长 token 行 + Mask 行
    ↓
x = 前 T 个 token，y = 后 T 个 token，目标 Mask = 后 T 个标记
    ↓
目标 Mask 为 0 → y 设为 -1 → 交给训练循环
```

[scripts/chat_sft.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_sft.py) 用 `TaskMixture` 组合 SmolTalk、MMLU、GSM8K 等任务的对话数据。每条样本包含 `messages`；[render_conversation()](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/tokenizer.py) 把它转换为 IDs 与监督 Mask：

```python
# conversation 来自训练数据集，包含 User 与 Assistant 消息。
ids, mask = tokenizer.render_conversation(conversation)
```

`sft_data_generator_bos_bestfit()` 将完整对话打包到行中，空位用 BOS 补齐，并将对应 Mask 补 0。其目标构造的核心处理为：

```python
# rows、mask_rows 是打包后的等长 token 行和监督标记行。
batch_tensor = torch.tensor(rows, dtype=torch.long)
inputs = batch_tensor[:, :-1].to(device)
targets = batch_tensor[:, 1:].to(device).clone()
mask_targets = torch.tensor(mask_rows, dtype=torch.int8)[:, 1:].to(device)
targets[mask_targets == 0] = -1  # 只保留回答正文与回答结束目标。
```

这里改变的是 Loss 的监督范围。用户消息仍在 `inputs` 中，可以被后面的回答位置读取。Chat Template 的基本介绍见 [Hugging Face: Chat Templates](https://huggingface.co/learn/llm-course/chapter11/2)。

**例子**：沿用句子生成任务：

```python
conversation = {"messages": [
    {"role": "user", "content": "Write a sentence about cats sitting on mats."},
    {"role": "assistant", "content": "Cats sit on mats"},
]}
```

设教学 ID：`243=BOS`、`240=User 起始`、`244=User 结束`、`241=Assistant 起始`、`242=Assistant 结束`，`[200,201]` 简化表示整条请求。正文仍为 `[12,45,78,90]`。这些 ID 不代表实际 Tokenizer 的结果。本例单条对话恰好填满一行：

```text
1. 编码角色、边界与正文
IDs： [243,240,200,201,244,241,12,45,78,90,242]

2. 标记监督范围
Mask：[  0,  0,  0,  0,  0,  0, 1, 1, 1, 1,  1]

3. 移位，屏蔽非监督目标
x：   [243,240,200,201,244,241,12,45,78, 90]
y：   [ -1, -1, -1, -1, -1, 12,45,78,90,242]
```

得到 `[1,10]` 的 `x、y`，共 5 个有效目标。`Assistant 起始=241` 所在位置预测 `Cats=12`，`on=78` 所在位置预测 `mats=90`。这组输入与目标交给下一节。

### 加载基础模型并执行训练

**问题**：怎样利用前节的对话输入与目标，让基础模型学习标准回答？

**方案**：

1. **怎样接续已有能力**：加载 Base 模型权重与配置，准备本次 Optimizer。
2. **怎样衡量回答误差**：对对话输入执行 Forward，只计算有效回答目标的 Cross-Entropy。
3. **怎样更新模型**：执行 Backward 与 Optimizer 更新；梯度累积沿用预训练流程。

**结构与核心逻辑**：

```text
Base 权重与配置 → 模型 + Optimizer
                      ↓
对话 x、y → Forward → 有效回答目标的平均 Loss
                      ↓
                  Backward → 参数更新 → 下一批对话
```

[scripts/chat_sft.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_sft.py) 通过以下调用加载模型、创建 Optimizer 和前节的数据迭代器：

```python
model, tokenizer, meta = load_model(
    "base", device, phase="train", model_tag=args.model_tag, step=args.model_step,
)
optimizer = model.setup_optimizer(
    unembedding_lr=args.unembedding_lr, embedding_lr=args.embedding_lr,
    matrix_lr=args.matrix_lr, weight_decay=0.0,
)
train_loader = sft_data_generator_bos_bestfit("train")
x, y = next(train_loader)
```

脚本默认加载预训练 Optimizer 状态并重设学习率，可通过 `--load-optimizer=0` 关闭。完成这些准备后，一次更新的 BF16 / FP32 核心流程为：

```python
for micro_step in range(grad_accum_steps):
    loss = model(x, y)                  # Forward 与 Cross-Entropy，忽略 y=-1。
    (loss / grad_accum_steps).backward() # 累积回答目标产生的梯度。
    x, y = next(train_loader)           # 读取下一批对话。
optimizer.step()                       # 完成本次累积后更新参数。
model.zero_grad(set_to_none=True)
```

相比预训练，这里更换了数据来源和监督范围，参数更新机制相同。脚本对各 micro-batch 的平均 Loss 等权累积；有效回答长度不同时，与全部有效 token 的统一平均存在差异。

**例子**：使用前节 `[1,10]` 的 `x、y`，假设五个有效目标的负对数概率如下：

```text
目标： Cats  sit   on  mats  Assistant 结束
NLL：   1.2  0.8  0.6   1.0       0.4
                         ↓
Loss = (1.2 + 0.8 + 0.6 + 1.0 + 0.4) / 5 = 0.8
                         ↓
             Backward → Optimizer 更新一次
```

本例设 `grad_accum_steps=1`。其余五个目标为 `-1`，不计入平均值；用户上下文仍参与回答预测，相关参数能够通过回答 Loss 获得梯度。

### 评测与保存对话模型

**问题**：怎样确认模型能生成符合请求的回答，并把训练结果交给推理或 RL？

**方案**：

1. **标准回答是否更容易被预测**：在独立验证对话上计算回答目标的预测指标。
2. **模型能否实际完成任务**：只提供请求，让模型生成回答，再按任务规则评分。
3. **怎样交付训练结果**：保存权重与配置；继续训练还需要相应的训练状态。

**结构与核心逻辑**：

```text
验证对话 + 标准回答 → 有效回答目标的预测表现
独立任务请求 ──────→ 生成回答 → 任务评分
                              ↓
                     保存选定 SFT Checkpoint
                         ├── 对话推理
                         └── RL 起点
```

`chat_sft.py` 在训练期间评测回答 BPB 与 ChatCORE；指标含义见末章。训练结果保存到 `chatsft_checkpoints/<tag>/`，包括模型权重、各 rank 的 Optimizer 状态，以及记录模型配置、步数和验证 BPB 的元数据。Tokenizer 从共享目录加载。

独立任务评测使用 [scripts/chat_eval.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_eval.py)：

```bash
python -m scripts.chat_eval -i sft
```

**例子**：另行保留请求 `Describe cats sitting on mats in one sentence.`，标准回答仍为 `Cats sit on mats`，分别执行：

| 检查 | 给模型的内容 | 得到的结果 |
|---|---|---|
| 回答预测 | 验证请求与标准回答 `Cats sit on mats` | 五个有效回答目标的预测误差 |
| 实际生成 | 验证请求与 Assistant 起始标记 | 模型自行生成的回答 |

假设生成结果为 `Cats sit on mats`，它完成了该请求。保存此时模型后，推理加载其权重生成回答，RL 加载其权重并引入新的评分过程。

## LoRA：减少可训练参数

SFT 需要继续更新模型参数。对于大型模型，Full Fine-tuning 要为全部可训练参数保存 Gradient 和 Optimizer State，显存与存储开销较大。怎样减少需要训练的参数？

LoRA 冻结基础参数，在部分层中添加少量可训练参数，训练时只更新这些新增参数。

当前固定版本的 [scripts/chat_sft.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_sft.py) 使用全参数更新，未实现 LoRA。Adapter 的内部计算见 [LLM System（二）](/zh/docs/ai/llm-system-2/)。

模型的许多层通过矩阵参数完成计算。Full Fine-tuning 直接修改原矩阵；LoRA 保持原矩阵不变，用两个较小矩阵表示参数更新，只训练这两个小矩阵。

例如，原矩阵形状为 $[4096, 4096]$，有约 1678 万个参数。LoRA 设置 Rank 为 8，新增矩阵形状为 $[4096, 8]$ 和 $[8, 4096]$，合计约 6.6 万个可训练参数。两个矩阵的乘积与原矩阵形状相同，可以作为更新量加到原矩阵上。

**结构与核心逻辑**

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

## RL：根据生成结果改进模型

SFT 使用标准回答提供示范，但模型实际生成的回答仍可能答错，或不符合质量要求。怎样根据回答的实际效果继续改进模型？

RL 先让模型生成回答，再根据回答获得 Reward，利用 Reward 更新模型。

```text
Prompt → 生成回答 → Reward → 更新模型
             ↑                   │
             └───────────────────┘
```

### Reward：怎样评价生成结果

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

### RLHF：怎样利用人类偏好

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

### GRPO：怎样通过组内比较优化策略

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

### nanochat 的 RL：采样、评分与 REINFORCE 更新

**问题**：怎样把当前模型实际生成的回答及其评分，转为一次可执行的参数更新？

**方案**：

1. **怎样取得训练信号**：同一题目采样多个回答，用 GSM8K 的标准答案判分。
2. **怎样比较同题回答**：各回答的 Reward 减去组内均值，得到 Advantage。
3. **怎样把评分作用到模型**：重新计算生成目标的对数概率，用 Advantage 加权形成 Loss，再反向传播和更新。

**结构与核心逻辑**：

[scripts/chat_rl.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_rl.py) 使用简化 REINFORCE。它与前节 GRPO 都有组内比较，但这里不除以 Reward 标准差，没有参考模型 KL 约束和 PPO ratio clipping。

```text
SFT 模型 + 题目 → 关闭梯度记录，多次采样 → 回答与生成 Mask
      ↑                                    ↓
      │                       标准答案 → Reward → Advantage
      │                                    ↓
      │              回答序列补齐、移位，只保留有效生成目标
      │                                    ↓
      └── 参数更新 ← Backward ← Advantage 加权的 log probability
```

脚本加载 SFT 模型，并为它创建 Engine 与新的 Optimizer。Engine 引用同一个模型，更新后的参数用于下一轮采样。训练题来自 `GSM8K(subset="main", split="train")`。

**1. 采样与评分**。`get_batch()` 在 `@torch.no_grad()` 下执行。`render_for_completion()` 删除样本中的标准回答，只保留题目与 Assistant 起始标记；默认每题采样 16 个回答，分两批、每批 8 个收集：

```python
conversation = train_task[example_idx]
tokens = tokenizer.render_for_completion(conversation)
prefix_length = len(tokens)
model.eval()
generated_token_sequences, masks = [], []
for sampling_step in range(args.num_samples // args.device_batch_size):
    seed = hash((step, example_idx, sampling_step)) & 0x7FFFFFFF
    sequences_batch, masks_batch = engine.generate_batch(
        tokens, num_samples=args.device_batch_size,
        max_tokens=args.max_new_tokens,
        temperature=args.temperature, top_k=args.top_k, seed=seed,
    )
    generated_token_sequences.extend(sequences_batch)
    masks.extend(masks_batch)

# 只取 Prompt 之后的生成文本，与任务记录中的标准答案比较。
rewards = [train_task.reward(conversation, tokenizer.decode(seq[prefix_length:]))
           for seq in generated_token_sequences]
```

**2. 构造目标与 Advantage**。各回答长度不同，先补齐 token 行和 Mask 行。`masks` 中 Prompt 与工具返回为 0，模型采样位置为 1；补齐位置也设为 0：

```python
# ids、mask_ids 是补齐后的 token 行与生成 Mask 行。
inputs = ids[:, :-1]
targets = ids[:, 1:].clone()
targets[mask_ids[:, 1:] == 0] = -1  # 只监督模型生成的有效目标。
rewards = torch.tensor(rewards, dtype=torch.float, device=device)
advantages = rewards - rewards.mean()  # 同题的全部回答一起比较。
```

**3. 计算策略 Loss 并更新**。采样阶段没有保留计算图，因此需要在训练模式下重新 Forward。`batch_iterator = get_batch()` 每次提供一道题的全部回答与训练目标；更新循环将它们拆成 micro-batch：

```python
for example_step in range(examples_per_rank):
    _, inputs_all, targets_all, _, advantages_all = next(batch_iterator)
    model.train()
    num_passes = inputs_all.size(0) // args.device_batch_size
    for pass_idx in range(num_passes):
        b0 = pass_idx * args.device_batch_size
        b1 = b0 + args.device_batch_size
        inputs, targets = inputs_all[b0:b1], targets_all[b0:b1]
        advantages = advantages_all[b0:b1]
        # 重新计算生成目标的 log probability；忽略位置返回 0。
        logp = -model(inputs, targets, loss_reduction="none").view_as(inputs)
        pg_obj = (logp * advantages.unsqueeze(-1)).sum()
        num_valid = (targets >= 0).sum().clamp(min=1)
        loss = -pg_obj / (num_valid * num_passes * examples_per_rank)
        loss.backward()  # 本次更新的各题、各 micro-batch 累积梯度。
optimizer.step()
model.zero_grad(set_to_none=True)
```

`num_passes` 为每题的 micro-batch 数，`examples_per_rank` 为当前 rank 每次更新的题目数。每个回答的 Advantage 作用于其有效生成目标。脚本先按各 micro-batch 的有效 token 数归一化，再平均；变长回答下，与整次更新按全部有效 token 统一平均存在差异。

**例子**：教学题为“3 只猫，每只吃 2 块饼干，共多少块？”，标准答案为 `6`。假设采样四个回答，每个回答恰好有两个有效生成目标。答案文字简化为可直接提取数值；实际 GSM8K 使用任务要求的答案格式：

| 回答 | Reward | Advantage | 两个生成目标的 log probability 之和 |
|---|---:|---:|---:|
| A：答案为 6 | 1 | 0.5 | -1.0 |
| B：答案为 5 | 0 | -0.5 | -2.0 |
| C：共计 6 | 1 | 0.5 | -1.5 |
| D：共计 8 | 0 | -0.5 | -3.0 |

以上对数概率为教学假设。同题平均 Reward 为 `0.5`。设本次更新只有这一题、一个 micro-batch，则 `num_passes=1`、`examples_per_rank=1`，有效生成目标共 8 个：

```text
加权和 = 0.5×(-1.0) - 0.5×(-2.0) + 0.5×(-1.5) - 0.5×(-3.0) = 1.25
Loss = -1.25 / 8 = -0.15625
    ↓
Backward → 参数更新 → 下一轮用新参数重新采样
```

正 Advantage 提供提高对应生成概率的信号，负 Advantage 提供相反方向的信号。策略 Loss 可以为负，其绝对值不直接表示正确率。

训练期间用独立题目评测 pass@k。结果保存到 `chatrl_checkpoints/<tag>/`，包含权重和模型配置，不含 Optimizer 状态，不能直接恢复完整 RL 训练过程。

# 推理：用户输入怎样形成回答

训练完成后，模型使用已有参数，根据用户输入逐步生成回答。推理关闭梯度记录，不执行 Backward 或 Optimizer 更新。

```text
加载模型与 Tokenizer → 组织问题及历史 → Prompt IDs
                                            ↓
                         Prefill → Logits + KV Cache
                                     ↓
                                  Token 选择
                                     ↓
                              输出、记录与停止判断
                                │          │
                             未结束      已结束 → 更新历史
                                ↓
                 新 token + KV Cache → Decode → 新 Logits
                                            └──→ 再次选择
```

## 输入准备：组织问题与对话历史

**问题**：怎样将用户文字与历史消息转换为模型能够接续回答的输入？

**方案**：

1. **怎样保证输入格式匹配模型**：加载训练得到的权重和对应 Tokenizer，沿用训练时的对话格式。
2. **怎样表达本轮请求**：保留历史，在末尾追加 User 消息和 Assistant 起始标记。

**结构与核心逻辑**：

```text
模型权重与配置 + Tokenizer → 准备推理
历史 + User 请求 → 角色与边界编码 → Assistant 起始 → Prompt IDs
```

[scripts/chat_cli.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_cli.py) 将对话历史保存在 `conversation_tokens` 中，正文由 Tokenizer 编码，角色和边界使用专用 token：

```python
model, tokenizer, meta = load_model(
    args.source, device, phase="eval", model_tag=args.model_tag, step=args.step,
)
engine = Engine(model, tokenizer)

# 会话开始时只初始化一次历史；角色标记也在此取得。
conversation_tokens = [tokenizer.get_bos_token_id()]
user_start = tokenizer.encode_special("<|user_start|>")
user_end = tokenizer.encode_special("<|user_end|>")
assistant_start = tokenizer.encode_special("<|assistant_start|>")
assistant_end = tokenizer.encode_special("<|assistant_end|>")

# 每轮追加用户输入，开启新的 Assistant 回答。
conversation_tokens.append(user_start)
conversation_tokens.extend(tokenizer.encode(user_input))
conversation_tokens.append(user_end)
conversation_tokens.append(assistant_start)
```

**例子**：继续 SFT 的句子任务，用户输入 `Write a sentence about cats sitting on mats.`。沿用前文全部教学 ID，生成输入为：

```text
BOS → User 起始 → 用户请求 → User 结束 → Assistant 起始
243      240      200,201       244            241

Prompt IDs：[243,240,200,201,244,241]
```

标准回答 `[12,45,78,90,242]` 不在输入中，后续由模型逐步生成。加载 SFT 模型进行交互：

```bash
python -m scripts.chat_cli -i sft
```

## Prefill：处理完整输入

**问题**：生成第一个 token 前，怎样读取全部上下文，并准备后续生成需要的状态？

**方案**：完整 Prompt 执行一次 Forward，保存各层 K/V，取最后一个位置的 Logits 预测第一个回答 token。

**结构与核心逻辑**：

```text
完整 Prompt IDs → Forward
                   ├── 各层历史 K/V → KV Cache → 后续 Decode
                   └── 最后位置的 Logits → Token 选择
```

[Engine.generate()](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/engine.py) 使用独立的 `kv_cache_prefill` 保存首次计算结果：

```python
ids = torch.tensor([tokens], dtype=torch.long, device=device)
logits = self.model.forward(ids, kv_cache=kv_cache_prefill)
logits = logits[:, -1, :].expand(num_samples, -1)
```

缓存对象在 Forward 中原地更新，返回值为 Logits。`expand` 为同一 Prompt 的多个候选回答复用首次预测分数；CLI 的 `num_samples=1`。

**例子**：一次处理前节 6 个 Prompt token，缓存其各层 K/V。最后一个位置为 `Assistant 起始=241`，其 Logits 给出第一个回答 token 的候选分数。假设 `Cats=12` 得分最高；此时尚未选定输出，下一节完成选择。

## Token 选择：从分数确定输出

**问题**：已有词表中各 token 的预测分数，怎样确定本次输出？

**方案**：

1. **怎样确定性地输出最高分候选**：使用 Greedy。
2. **怎样保留生成的多样性**：调整 Temperature、限制候选范围，再按概率 Sampling。

**结构与核心逻辑**：

```text
Logits ── Temperature=0 ──→ argmax → token
   │
   └── Temperature>0 → 可选 Top-k → 缩放分数 → Softmax → Sampling → token
```

Prefill 与 Decode 的 Logits 都交给 [sample_next_token()](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/engine.py)。其候选选择逻辑为：

```python
if temperature == 0.0:
    next_ids = torch.argmax(logits, dim=-1, keepdim=True)  # Greedy。
elif top_k is not None and top_k > 0:
    k = min(top_k, logits.size(-1))
    vals, idx = torch.topk(logits, k, dim=-1)             # 限制候选。
    probs = torch.softmax(vals / temperature, dim=-1)   # 缩放并归一化。
    choice = torch.multinomial(probs, num_samples=1, generator=rng)
    next_ids = idx.gather(1, choice)                     # 映射回词表 ID。
else:
    probs = torch.softmax(logits / temperature, dim=-1)
    next_ids = torch.multinomial(probs, num_samples=1, generator=rng)
```

Top-p 和 Beam Search 是其他候选筛选或搜索方法；当前 nanochat 采样函数未实现两者，介绍见 [Hugging Face: Basic decoding methods](https://huggingface.co/docs/transformers/main/en/generation_strategies#basic-decoding-methods)。

**例子**：前节设置 Greedy 后选中 `Cats=12`。假设随后继续生成 `sit、on`，到预测 `mats` 时，教学 Logits 为 `mats=0.9073`、`chairs=0.6`，其余候选为 0。设置 `Temperature=1、Top-k=2`，得到：

| 候选 token | ID | 候选内归一化概率 |
|---|---:|---:|
| mats | 90 | 57.62% |
| chairs | 91 | 42.38% |

Greedy 选择 `mats`；Sampling 按上表概率选择。进一步采用通用 Top-p、阈值 `0.8` 时，因第一项累计概率不足 `0.8`，仍需保留两项。后文继续跟踪选择 `mats` 的路径。

## Decode：用新增 token 继续预测

**问题**：选中一个 token 后，怎样结合已有上下文继续生成，直到本轮结束？

**方案**：

1. **怎样接续已有计算**：把新增 token 作为输入，结合 KV Cache 执行 Decode，产生下一组 Logits。
2. **怎样形成完整回答**：重复选择、记录与 Decode，遇到结束标记或长度上限时停止。

**结构与核心逻辑**：

```text
Prefill 的 Logits → 选择 token → 记录、输出、停止判断
                         ↑                       │ 未结束
                         └── 新 Logits ← Decode ← 新 token + KV Cache
```

Engine 的 Decode 每次只接收 $[B,1]$ 的新增输入。内部关键调用为：

```python
ids = torch.tensor(token_column, dtype=torch.long, device=device).unsqueeze(1)
logits = self.model.forward(ids, kv_cache=kv_cache_decode)[:, -1, :]
```

CLI 用一次 `engine.generate()` 调用驱动整轮循环，随后迭代它来显示输出：

```python
generator = engine.generate(
    conversation_tokens, num_samples=1, max_tokens=256,
    temperature=args.temperature, top_k=args.top_k,
)
```

**例子**：沿用同一请求，假设各步 Greedy 依次得到以下结果：

| 模型计算阶段 | 本次输入 IDs | 随后选中的 token |
|---|---|---|
| Prefill | `[243,240,200,201,244,241]` | Cats，12 |
| Decode | `[12]` | sit，45 |
| Decode | `[45]` | on，78 |
| Decode | `[78]` | mats，90 |
| Decode | `[90]` | Assistant 结束，242 |

本轮结果为 `[12,45,78,90,242]`。结束标记终止本轮回答，正文为 `Cats sit on mats`。这些生成结果均为教学假设。

## KV Cache：复用历史计算

**问题**：每次 Decode 都要使用历史位置的 K/V，怎样避免重新计算这些历史位置？

**方案**：Prefill 保存各层历史 K/V；Decode 只计算新增 token 的 Q/K/V，将新增 K/V 写入缓存，再让新增 Q 读取历史与当前的 K/V。

**结构与核心逻辑**：

```text
历史 K/V Cache ──────────────┐
                            ↓
新增 token → 当前层 Q/K/V → 追加 K/V → Attention → 当前层输出
                    │                   ↑
                    └────── Q ──────────┘
```

Engine 完成 Prefill 后，将结果复制到可容纳后续生成的 `kv_cache_decode`。每层 Attention 从缓存中取得本层 K/V；[nanochat/gpt.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py) 完成读写。

详细介绍参见 [Hugging Face: KV Caching](https://huggingface.co/docs/transformers/en/llm_tutorial#kv-caching)。

# 评测：检查预测表现、任务能力与运行性能

评测贯穿训练与使用过程，用于检查预测表现、任务能力、回答质量和运行性能。

```text
预训练阶段：验证 BPB
SFT 阶段：回答预测 BPB + ChatCORE 任务评测
RL 阶段：独立题目 pass@k 评测
使用期间：检查延迟、吞吐与资源开销
```

## 预训练评测：BPB

预训练期间主要评估模型对文本的压缩能力，常用 **BPB（Bits Per Byte）**。

BPB 将 Cross-Entropy 损失折算为每个字节需要的比特数。Cross-Entropy 以自然对数（$e$）为底，转为比特数需要除以 $\ln 2$；再除以每个 token 包含的平均字节数，得到每个字节的比特数。

[scripts/base_eval.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_eval.py) 计算验证集 BPB：

```python
# 验证集交叉熵损失除以 ln(2)，再折算为每字节比特数。
bpb = loss.item() / math.log(2) / bytes_per_token
```

BPB 越低，说明模型对文本的预测越准确、压缩效率越高。

## 后训练评测：ChatCORE

SFT 和 RL 阶段除了计算回答目标的预测表现（如 BPB 或损失），还要评测实际任务能力。

nanochat 使用 **ChatCORE** 评测对话与任务能力，包含 MMLU、GSM8K、HumanEval 等任务的子集。[scripts/chat_eval.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_eval.py) 统一执行这些评测。

## 使用评测：生成质量、延迟与吞吐

模型投入使用后，评测重点转向生成质量与运行性能：

- **生成质量**：检查回答是否符合指令、有无幻觉、逻辑是否连贯。
- **延迟（Latency）**：首字延迟（Time to First Token, TTFT）与每个 token 生成时间（Time per Output Token, TPOT）。
- **吞吐（Throughput）**：每秒生成的 token 总数。
- **资源开销**：显存占用与计算资源利用率。

结合 nanochat 源码，大模型从预训练、后训练、推理到评测的全流程就介绍到这里。