---
title: LLM System（二）：训练目标、参数更新与生成计算
date: '2026-05-15'
categories:
  - AI
weight: 16
---

# Goal

承接 [LLM System（一）：GPT 结构与 Forward 计算](/zh/docs/ai/llm-system-1/)，从 GPT Forward 输出的 Logits 开始，介绍训练目标、参数更新和生成计算的内部机制。

- 训练目标：Cross-Entropy 怎样衡量预测误差，SFT 怎样选择监督位置，GRPO 怎样利用回答评价构造 Loss。
- 参数更新：Backward 怎样计算梯度，Optimizer 怎样更新参数，以及梯度累积与 LoRA 怎样接入训练。
- 生成计算：KV Cache 怎样支持增量 Attention，Greedy、Sampling 与 Beam Search 怎样选择生成结果。

<!--more-->

[LLM System（一）：GPT 结构与 Forward 计算](/zh/docs/ai/llm-system-1/) 已说明 Input IDs 怎样转换为 Logits。阶段流程见 [大模型工作流程：从训练到推理，以 nanochat 为例](/zh/docs/ai/llm-workflow-with-nanochat/)，具体工程实现见 [nanochat：LLM 核心架构与实现](/zh/docs/ai/llm-system-nanochat/)。

示例沿用 `Cats sit on mats`：输入 `Cats sit on`，Target IDs 为 `45、78、90`；词表大小 `V=256`，两层简化模型使用 `C=4、H=2、D=2`。模型结构与参数见第一篇，以下承接其计算结果。

# 训练目标：从 Logits 到 Loss

承接[第一篇 GPT Model](/zh/docs/ai/llm-system-1/) 的 Logits，本章说明 Cross-Entropy 如何得到预测 Loss、SFT 如何选择监督位置，以及 GRPO 如何把回答评价转换为策略 Loss。阶段流程与数据准备见 [LLM Workflow](/zh/docs/ai/llm-workflow-with-nanochat/)。

## Cross-Entropy Loss

**问题**

[第一篇 LM Head](/zh/docs/ai/llm-system-1/#lm-head) 已输出各位置的词表 Logits。例如，`on` 位置给 `mats` 的分数为 `0.9073`。训练文本提供的正确答案是 `mats`，ID 为 `90`。

现在有了预测分数和正确答案，需要计算一个 Loss，表示模型给正确答案分配的概率有多低，再用于后续参数更新。

**方案**

Cross-Entropy 使用两组数据：

- 模型分布 `p`：LM Head 输出的全部 Logits 经过 Softmax，得到各候选 token 的预测 Probability。
- 目标分布 `y`：由训练数据的 Target ID 定义，正确 token 为 `1`，其余为 `0`，即 One-hot 分布。

Cross-Entropy 根据这两个分布计算 Loss：模型给正确答案的 Probability 越高，Loss 越小。

**结构与核心逻辑**

```text
LM Head 输出 Logits [B,T,V]       训练数据提供 Targets [B,T]
             │                              │
             ▼                              ▼
          Softmax                   正确 ID 为 1，其余为 0
             │                              │
             ▼                              ▼
       模型分布 p [B,T,V]              目标分布 y [B,T,V]
             │                              │
             └──────── Cross-Entropy ────────┘
                              │
                              ▼
                         各位置 Loss
                              │
                              ▼
                       按有效位置取平均
                              │
                              ▼
                     标量 Loss → Backward
```

对每个输入位置，用 Target ID 取出正确 token 的预测 Probability，计算它的自然对数，再取负，得到该位置的 Loss。

实际实现无需创建完整的 One-hot 数组 `y`，直接使用 Target ID 取出对应项。下面展开按有效位置取平均的内部逻辑：

```python
def cross_entropy(logits, targets, ignore_index=-100):
    # 1. 排除 Target 为 ignore_index 的位置
    logits, targets = select_valid_positions(logits, targets, ignore_index)

    # 2. 将词表 Logits 转为各候选的 Log Probability
    log_probs = log_softmax(logits)
    # 3. 按 Target ID 取出正确 token 对应的一项
    target_log_probs = select_by_target_id(log_probs, targets)
    # on 位置：取出 Target ID=90 的值，约为 -4.6455

    # 4. 取负得到各位置 Loss，再按有效位置平均
    position_losses = -target_log_probs
    return mean(position_losses)  # 本例约为 4.7943


# logits：LM Head 输出的原始分数 [B,T,V]
# targets：训练数据提供的正确 token ID [B,T]
loss = cross_entropy(
    logits.reshape(-1, 256), targets.reshape(-1), ignore_index=-100
)
```

**例子**

先跟踪 `on` 位置：

```text
训练文本：Cats sit on mats
输入：    Cats sit on
Target：  mats，ID=90
```

承接 LM Head 的输出，下面按候选 ID 对照三组数据。仅列出四个候选，其余 252 项合并标注；Softmax 的分母仍包含全部 256 项：

| 数据 | sit（45） | on（78） | mats（90） | chairs（91） | 其余 252 项 |
|---|---:|---:|---:|---:|---|
| LM Head 输出的 Logits | -0.0275 | 0.4582 | 0.9073 | -0.0911 | 每项为 0 |
| Softmax 得到的模型分布 p | 0.003772 | 0.006130 | 0.009605 | 0.003539 | 合计约 0.976954 |
| Target ID 定义的目标分布 y | 0 | 0 | 1 | 0 | 每项为 0 |

计算 `mats` 的 Probability：

```text
Z = 252×exp(0) + exp(-0.0275) + exp(0.4582)
    + exp(0.9073) + exp(-0.0911)
  ≈ 257.9447

p[90] = exp(0.9073) / Z ≈ 0.009605
```

代入 Cross-Entropy：

```text
Loss_on = -(0 × ln(0.003772) + 0 × ln(0.006130)
            + 1 × ln(0.009605) + 0 × ln(0.003539) + 其余零项)
        = -ln(0.009605)
        ≈ 4.6455
```

正确答案获得的概率越接近 `1`，Loss 越接近 `0`；概率趋近 `0` 时，Loss 趋近正无穷。

对三个输入位置使用相同规则，得到：

| 输入位置 | Target | 该位置 Loss |
|---|---|---:|
| Cats | sit（45） | 4.9190 |
| sit | on（78） | 4.8186 |
| on | mats（90） | 4.6455 |

三个位置均有效时：

```text
Batch Loss = (Loss_Cats + Loss_sit + Loss_on) / 3
           ≈ (4.9190 + 4.8186 + 4.6455) / 3
           ≈ 4.7943
```

这个平均 Loss 交给后文 Backward，计算各参数的 Gradient。

## SFT：监督位置怎样影响 Loss

**问题**

一条 SFT 训练数据同时包含 User 问题和标准 Assistant 回答。怎样利用模型对这段对话的预测，计算它与标准回答之间的 Loss，同时排除 User 等非监督目标？

**方案**

SFT 沿用前节 Cross-Entropy，需要两组数据：

- 模型预测：完整训练对话经过一次 Forward，得到各输入位置的词表 Logits；每行经 Softmax 得到该位置对下一个 token 的预测 Probability。
- 标准答案：训练数据中的 Assistant 回答及其结束标记，提供各监督位置的 Target token ID；正确候选在目标分布中的值为 `1`，其余为 `0`。

Target Mask 选择参与监督的位置。每个保留位置用标准答案的 Target ID，从该位置的预测分布中取出正确候选的 Probability，按前节规则计算位置 Loss；最后对保留位置的 Loss 求平均，得到这条训练数据的标量 Loss。

**结构与核心逻辑**

每个位置使用两级索引：输入位置决定取哪一行 Logits，Target ID 决定从该行概率分布中取哪个候选。Mask 标记的是这个位置的预测目标是否参与监督；Target 的准备与对齐见 [Workflow：SFT](/zh/docs/ai/llm-workflow-with-nanochat/#sft通过标准回答学习)。

```python
def sft_loss(input_ids, targets, target_mask):
    # 1. 完整对话参与 Forward，每个输入位置输出一行词表 Logits
    logits = model(input_ids)

    # 2. 保留 Assistant 目标的 ID，其他目标替换为 -100
    masked_targets = targets.copy()
    for position in positions:
        if target_mask[position] == 0:
            masked_targets[position] = -100

    # 3. 对保留位置应用前节 Cross-Entropy 的计算规则
    position_losses = []
    for position, target_id in enumerate(masked_targets):
        if target_id == -100:
            continue
        probabilities = softmax(logits[position])
        target_probability = probabilities[target_id]
        position_losses.append(-ln(target_probability))

    # 4. 只对监督位置平均，输出这条数据的标量 Loss
    return mean(position_losses)
```

这里展开单条数据的计算，省略 Batch 维度。实际可将 `masked_targets` 直接交给前节 `cross_entropy`，通过 `ignore_index=-100` 实现同样的筛选和计算。User 内容仍作为上下文参与 Forward。

**例子**

沿用标准回答 `Cats sit on mats`：

```text
User：Write a sentence about cats sitting on mats.
Assistant：Cats sit on mats
```

User 内容简化为两个 token，特殊 token ID 仅作示意；`242` 表示 `<END>`。下面按输入位置对齐预测目标，Target ID 对应目标 token：

```text
输入位置       <USER>    问题前半  问题后半  <ASSISTANT>  Cats  sit  on  mats
预测目标       问题前半  问题后半  <ASSISTANT>  Cats     sit   on  mats <END>
Token ID          200       201       241        12       45   78   90   242
Target Mask         0         0         0         1        1    1    1     1
masked_targets   -100      -100      -100        12       45   78   90   242
```

以下 Probability 为本节演算假设值。每个值来自对应输入位置的整行 Logits 经 Softmax 后，再按标准答案 Target ID 选出的那一项：

| 输入位置 | 标准答案 token | Target ID | Mask | 取出的 Probability | 位置 Loss |
|---|---|---:|---:|---|---|
| &lt;USER&gt; | 问题前半 | 200 | 0 | — | 不计入 |
| 问题前半 | 问题后半 | 201 | 0 | — | 不计入 |
| 问题后半 | &lt;ASSISTANT&gt; | 241 | 0 | — | 不计入 |
| &lt;ASSISTANT&gt; | Cats | 12 | 1 | p[12]=0.5 | -ln(0.5) ≈ 0.6931 |
| Cats | sit | 45 | 1 | p[45]=0.25 | -ln(0.25) ≈ 1.3863 |
| sit | on | 78 | 1 | p[78]=0.5 | -ln(0.5) ≈ 0.6931 |
| on | mats | 90 | 1 | p[90]=0.25 | -ln(0.25) ≈ 1.3863 |
| mats | &lt;END&gt; | 242 | 1 | p[242]=0.5 | -ln(0.5) ≈ 0.6931 |

```text
这条数据的 Loss ≈ (0.6931 + 1.3863 + 0.6931 + 1.3863 + 0.6931) / 5
               ≈ 0.9704
```

输出 `0.9704` 是五个监督位置的平均 Loss，交给 Backward 计算参数 Gradient。

## GRPO：回答评价怎样构成优化目标

**问题**

[Workflow：GRPO](/zh/docs/ai/llm-workflow-with-nanochat/#grpo) 已得到同一个 Prompt 的多个回答及其 Reward。现在需要把评价连接到模型的预测，构造可供 Backward 使用的 Loss。

评价针对整段回答，但模型逐 token 生成内容。怎样将回答的好坏作用到各个生成位置，并控制训练中的调整幅度？

**方案**

GRPO 先根据回答评价确定学习方向，再按 **token 位置 → 单个回答 → 同题回答组** 三个层级计算 Loss：

1. **确定每个回答的学习方向**：通过组内 Reward 比较得到 Advantage。正值鼓励提高该回答中已生成 token 的概率，负值鼓励降低概率；同一回答的所有有效生成位置共用这个值。
2. **计算每个 token 位置的 Loss**：对同一位置、同一已生成 token，比较旧概率和当前概率，得到 Ratio。结合该回答的 Advantage 和 Clipping，计算位置 Loss。Advantage 决定方向，Ratio 表示概率变化，Clipping 限制继续奖励过大变化。
3. **计算单个回答的 Loss**：对回答内所有有效生成位置的 Loss 求平均，分别得到回答 A、B、C 等各自的 Loss。
4. **计算同题回答组的 Loss**：对同一个 Prompt 的多个回答 Loss 求平均，得到该组的标量 Loss，交给 Backward。

**结构与核心逻辑**

下面重点展开 Loss 计算。回答生成、评分及训练循环见 [Workflow：GRPO](/zh/docs/ai/llm-workflow-with-nanochat/#grpo)；概率的计算方式沿用前文。

输入是同一 Prompt 对应的一组回答及其 Reward、旧概率、当前概率和有效生成位置标记：

| 数据 | 在 Loss 计算中的作用 |
|---|---|
| Reward → Advantage | 通过组内比较，确定每个回答的鼓励或抑制方向；同一回答的有效位置共用这个值 |
| 旧概率 | 生成这批回答时记录的 token 概率，作为本批固定的比较基准 |
| 当前概率 | 每次训练 Forward 重新计算同一批回答中已生成 token 的概率，参与求导 |
| 有效位置标记 | 只让实际生成的回答 token 参与计算，排除 Prompt 和 Padding |

```text
        Reward                        旧概率、当前概率
           │                                  │
           ▼                                  ▼
┌────────────────────┐            ┌──────────────────────┐
│     组内标准化     │            │  当前概率 / 旧概率   │
└──────────┬─────────┘            └───────────┬──────────┘
           │                                  │
      Advantage                            Ratio
           │                                  │
           └─────────────────┬────────────────┘
                             ▼
          ┌────────────────────────────────────┐
          │     每个有效 token 的位置 Loss     │
          │  结合 Advantage、Ratio、Clipping   │
          │         比较两个目标并取负         │
          └──────────────────┬─────────────────┘
                             │
                         位置 Loss
                             │
                             ▼
          ┌────────────────────────────────────┐
          │             Loss 汇总              │
          │   回答内有效位置平均 → 回答 Loss   │
          │       同题回答平均 → 组 Loss       │
          └──────────────────┬─────────────────┘
                             │
                          组 Loss
                             │
                             ▼
                         Backward
```

Clipping 限制的是 Loss 的奖励机制，本例范围取 `[0.8,1.2]`：

```python
def grpo_loss(rewards, old_probs, current_probs, generated_mask):
    # 1. 确定回答的学习方向，各有效生成位置共用该回答的 Advantage
    advantages = (rewards - mean(rewards)) / (std(rewards) + 1e-8)

    answer_losses = []
    for answer in range(len(rewards)):
        position_losses = []

        for position in valid_positions(generated_mask[answer]):
            # 2. 计算这个 token 位置的 Loss：先比较当前概率与旧概率
            ratio = current_probs[answer, position] / old_probs[answer, position]

            # 结合该回答的 Advantage 和 Clipping，构造位置目标并取负
            advantage = advantages[answer]
            clipped_ratio = clip(ratio, 0.8, 1.2)
            objective = min(ratio * advantage, clipped_ratio * advantage)
            position_losses.append(-objective)

        # 3. 对当前回答的有效位置 Loss 求平均，得到单个回答的 Loss
        answer_losses.append(mean(position_losses))

    # 4. 对同题回答的 Loss 求平均，得到该组的标量 Loss
    return mean(answer_losses)
```

**例子**

承接 [Workflow：GRPO](/zh/docs/ai/llm-workflow-with-nanochat/#grpo) 四个回答的 Reward。以下展示同一批回答已经执行过一次 GRPO 更新后，再次计算 Loss 的情况。数值演算将每个回答简化为两个有效生成位置，概率为演示假设值。计算使用未舍入值，结果保留四位小数。

先确定每个回答的学习方向：按组内 Reward 计算 Advantage，同一回答的两个有效生成位置共用这个值。Standard Deviation 按四项的平均平方差计算：

```text
Reward：[0.9,0.3,0.8,0.2]
mean = (0.9+0.3+0.8+0.2)/4 = 0.55
std = sqrt(((0.9-0.55)² + (0.3-0.55)²
            + (0.8-0.55)² + (0.2-0.55)²) / 4)
    ≈ 0.3041

Advantage_A = (0.9-0.55)/std ≈  1.1508
Advantage_B = (0.3-0.55)/std ≈ -0.8220
Advantage_C = (0.8-0.55)/std ≈  0.8220
Advantage_D = (0.2-0.55)/std ≈ -1.1508
```

| 回答 | Reward | 位置 1 的 Advantage | 位置 2 的 Advantage | 目标方向 |
|---|---:|---:|---:|---|
| A | 0.9 | 1.1508 | 1.1508 | 鼓励 |
| B | 0.3 | -0.8220 | -0.8220 | 抑制 |
| C | 0.8 | 0.8220 | 0.8220 | 鼓励 |
| D | 0.2 | -1.1508 | -1.1508 | 抑制 |

再计算各 token 位置的 Loss。先求每个位置的 Ratio；每行的旧概率与当前概率都对应该位置实际生成的同一个 token：

| 回答 | 生成位置 | 旧概率 | 当前概率 | Ratio=当前/旧 |
|---|---:|---:|---:|---|
| A | 1 | 0.20 | 0.26 | 0.26/0.20 = 1.3 |
| A | 2 | 0.10 | 0.11 | 0.11/0.10 = 1.1 |
| B | 1 | 0.20 | 0.14 | 0.14/0.20 = 0.7 |
| B | 2 | 0.10 | 0.09 | 0.09/0.10 = 0.9 |
| C | 1 | 0.20 | 0.22 | 0.22/0.20 = 1.1 |
| C | 2 | 0.10 | 0.12 | 0.12/0.10 = 1.2 |
| D | 1 | 0.20 | 0.18 | 0.18/0.20 = 0.9 |
| D | 2 | 0.10 | 0.08 | 0.08/0.10 = 0.8 |

接着结合 Advantage、Ratio 和 Clipping 计算位置 Loss。范围取 `[0.8,1.2]`。

A 的两个位置都使用正 Advantage `1.1508`。位置 1 的概率已变为旧概率的 `1.3` 倍，目标使用受限的 `1.2`；位置 2 的 `1.1` 仍在范围内：

```text
A 位置 1：
Loss = -min(1.3×1.1508, 1.2×1.1508) ≈ -1.3810

A 位置 2：
Loss = -min(1.1×1.1508, 1.1×1.1508) ≈ -1.2659
```

B 的两个位置都使用负 Advantage `-0.8220`。位置 1 的概率已降至旧概率的 `0.7` 倍，目标使用受限的 `0.8`；位置 2 的 `0.9` 仍在范围内：

```text
B 位置 1：
Loss = -min(0.7×(-0.8220), 0.8×(-0.8220)) ≈ 0.6576

B 位置 2：
Loss = -min(0.9×(-0.8220), 0.9×(-0.8220)) ≈ 0.7398
```

按相同规则计算 C、D，得到全部位置 Loss：

| 回答 | 位置 1 Loss | 位置 2 Loss |
|---|---:|---:|
| A | -1.3810 | -1.2659 |
| B | 0.6576 | 0.7398 |
| C | -0.9042 | -0.9864 |
| D | 1.0357 | 0.9206 |

接着计算单个回答的 Loss：分别对 A、B、C、D 内部两个有效位置的 Loss 求平均：

```text
回答 A：(-1.3810 - 1.2659)/2 ≈ -1.3234
回答 B：( 0.6576 + 0.7398)/2 ≈  0.6987
回答 C：(-0.9042 - 0.9864)/2 ≈ -0.9453
回答 D：( 1.0357 + 0.9206)/2 ≈  0.9782
```

最后计算同题回答组的 Loss：对四个回答各自的 Loss 求平均：

```text
组 Loss ≈ (-1.3234 + 0.6987 - 0.9453 + 0.9782)/4
        ≈ -0.1480
```

这个标量交给 Backward。其求导路径连接到当前概率；Advantage 和旧概率在本次计算中固定。

算法与实现说明参见 [Hugging Face: GRPO Trainer](https://huggingface.co/docs/trl/grpo_trainer)。

# 通用学习机制：从 Loss 到参数更新

前章已经得到标量 Loss。Backward 沿计算依赖求出参数 Gradient，Optimizer 使用这些 Gradient 更新参数；Gradient Accumulation 改变多批 Gradient 的聚合方式，LoRA 改变可训练参数的表示。

```text
Loss → Backward → Parameters.grad → Optimizer → 更新后的 Parameters
                                                    ↓
                                              下一次 Forward 使用
```

## Backward

**问题**

前文 Cross-Entropy 已得到 Batch Loss `≈4.7943`。怎样沿模型计算依赖，得到 LM Head、Final Norm、各 Transformer Layer 和 Embedding 参数各自的 Gradient，供 Optimizer 使用？

**方案**

Backward 计算各参数的 Gradient，即参数微小变化时 Loss 的局部变化率：

1. **保留求导依据**：Forward 保存运算依赖和求导所需的中间值。
2. **逆序传递影响**：从 Loss 开始，按 Forward 的逆序计算各模块的输入与参数 Gradient。
3. **汇总各路径贡献**：遇到共享参数、Attention 信息读取和 Residual 分支时，累加各路径贡献。
4. **保存参数 Gradient**：将贡献写入参数 `.grad`，交给 Optimizer；参数值在本次 Backward 中保持不变。

**结构与核心逻辑**

完整反向路径展开到 Embedding，各模块分别累加自己的参数 Gradient，并把输入 Gradient 继续传向前面的模块：

```text
                      Loss
                        │
                        ▼
        ┌──────────────────────────────┐
        │       Loss 的反向计算        │
        └───────────────┬──────────────┘
                        │
                 Logits Gradient
                        │
                        ▼
        ┌──────────────────────────────┐
        │           LM Head            │──→ Weight.grad
        └───────────────┬──────────────┘
                        │
                        ▼
        ┌──────────────────────────────┐
        │          Final Norm          │──→ Weight.grad
        └───────────────┬──────────────┘
                        │
                        ▼
        ┌──────────────────────────────┐
        │     Transformer Layer 2      │──→ 本层参数 .grad
        └───────────────┬──────────────┘
                        │
                        ▼
        ┌──────────────────────────────┐
        │     Transformer Layer 1      │──→ 本层参数 .grad
        └───────────────┬──────────────┘
                        │
                        ▼
        ┌──────────────────────────────┐
        │       Token Embedding        │──→ 对应参数行 .grad
        └──────────────────────────────┘
```

Forward 保存的数据在下面代码中记为 `cache`。它包括各模块的输入、求导需要的中间值和输入 token IDs；这里用于 Backward，区别于生成时保存历史 K/V 的 KV Cache。

各模块的反向函数接收输出 Gradient，结合本模块参数和保存的数据，累加参数 Gradient，并返回输入 Gradient。模型级代码连接整条路径：

```python
def model_backward(grad_logits, model, cache):
    # 1. LM Head：保存 Weight Gradient，返回输入特征的 Gradient
    grad = lm_head_backward(grad_logits, model.lm_head, cache.lm_head)

    # 2. Final Norm：保存缩放参数 Gradient，传回最后一层输出
    grad = norm_backward(grad, model.final_norm, cache.final_norm)

    # 3. Transformer：从最后一层向第一层反传
    for index in reversed(range(len(model.layers))):
        grad = layer_backward(grad, model.layers[index], cache.layers[index])

    # 4. Embedding：按输入 token ID 累加到对应参数行
    for position, token_id in enumerate(cache.input_ids):
        model.embedding.weight.grad[token_id] += grad[position]
```

每层 Forward 已定义为：

```python
r = x + attention(norm1(x))
y = r + mlp(norm2(r))
```

Backward 先处理 MLP，再处理 Attention。两次 Residual 都保留直接路径，并与子模块路径的贡献相加：

```python
def layer_backward(grad_y, layer, cache):
    # 1. 第二次 Residual：直接路径保留收到的 Gradient
    grad_r = grad_y.copy()

    # 2. MLP 路径：经过 MLP、Norm 2，与直接路径相加
    grad_norm2 = mlp_backward(grad_y, layer.mlp, cache.mlp)
    grad_r += norm_backward(grad_norm2, layer.norm2, cache.norm2)

    # 3. 第一次 Residual：同样保留直接路径
    grad_x = grad_r.copy()

    # 4. Attention 路径：经过 Attention、Norm 1，汇总到输入
    grad_norm1 = attention_backward(grad_r, layer.attention, cache.attention)
    grad_x += norm_backward(grad_norm1, layer.norm1, cache.norm1)

    return grad_x
```

子模块按[第一篇 Transformer](/zh/docs/ai/llm-system-1/#transformer-computation) 定义的计算依赖执行反向规则：

| 模块 | 反向计算内容 |
|---|---|
| LM Head | 使用 Hidden States 计算 Weight Gradient，使用 Weight 计算输入 Gradient |
| MLP | 逆向经过 Down Projection、Activation、Up Projection，计算参数与输入 Gradient |
| Attention | 逆向处理 Output Projection、各 Head、读取权重与 Q/K/V，汇总不同位置对输入的贡献 |
| Norm | 计算缩放参数 Gradient，以及归一化前输入的 Gradient |
| Embedding | 按输入 token ID 累加到对应参数行；重复 ID 的贡献继续累加 |

下面沿用前文 Cross-Entropy，为模型反向入口提供 Logits Gradient。示例三个位置均有效，省略 Batch 维度；参数 `.grad` 已在本次累积开始前清零：

```python
def cross_entropy_backward(logits, targets):
    # 根据预测分布和正确 Target，计算各位置的 Logit Gradient
    grad_logits = softmax(logits)
    for position, target_id in enumerate(targets):
        grad_logits[position, target_id] -= 1

    # 前文 Loss 按有效位置平均，Gradient 同样按位置数缩放
    return grad_logits / len(targets)


grad_logits = cross_entropy_backward(logits, targets)
model_backward(grad_logits, model, cache)
```

最终各参数的 `.grad` 包含相关路径的贡献。输入 token IDs 只用于定位 Embedding 行，本身不求 Gradient。

**例子**

继续使用 `Cats sit on` 的三个有效位置，跟踪 `mats` 候选及 LM Head 参数 `w=W[mats,c3]=0.3`。计算使用前文显示精度，结果取近似值。

先计算 `on` 位置的 Logit Gradient。Target 为 `mats`，所以该候选的预测概率减 1；Batch Loss 对三个位置取平均，再除以 3：

```text
预测 Probability：0.009605
正确 Target：mats

Loss_on 对 mats Logit 的 Gradient：
0.009605 - 1 = -0.990395

Batch Loss 对该 Logit 的 Gradient：
-0.990395 / 3 ≈ -0.330132
```

再将这一贡献传向参数。[第一篇 Final Norm](/zh/docs/ai/llm-system-1/#final-norm) 输出在 `on` 位置的 `c3` 特征为 `1.7522`：

```text
该位置对 w.grad 的贡献：
-0.330132 × 1.7522 ≈ -0.578457
```

同一个 `w` 也参与了 `Cats`、`sit` 两个位置的打分。它们的 Target 都不是 `mats`，该候选的 Logit Gradient 为其预测概率除以 3：

| 输入位置 | p(mats) | Target | mats 的 Logit Gradient | h_c3 | 对 w.grad 的贡献 |
|---|---:|---|---:|---:|---:|
| Cats | 0.007204 | sit | 0.007204/3 ≈ 0.002401 | 1.1141 | 0.002675 |
| sit | 0.010159 | on | 0.010159/3 ≈ 0.003386 | 0.8659 | 0.002932 |
| on | 0.009605 | mats | (0.009605-1)/3 ≈ -0.330132 | 1.7522 | -0.578457 |

最后汇总三个位置对共享参数的贡献：

```text
w.grad ≈ 0.002675 + 0.002932 - 0.578457
       ≈ -0.57285

Backward 后：
w      = 0.3
w.grad ≈ -0.57285
```

这个负 Gradient 表示，保持其他参数不变，微小增大 `w`，Loss 在当前参数附近会下降。

下面使用同一两层模型未舍入的 Forward 结果，继续反向计算到 Embedding。计算保留三个位置，下表只摘录 `on` 位置的向量 Gradient：

| 反向到达的位置 | on 位置的 Gradient |
|---|---|
| Final Norm 输出 | `[-0.066341,-0.131573,-0.031755,-0.098827]` |
| Final Norm 输入，即 Layer 2 输出 | `[-0.015602,-0.013969,-0.008004,0.007508]` |
| Layer 2 输入，即 Layer 1 输出 | `[-0.014462,-0.023547,-0.008080,0.012506]` |
| Layer 1 输入，即 Embedding 输出 | `[-0.040909,-0.131007,-0.003027,0.059970]` |

Backward 完成后，各组参数分别保存自己的 `.grad`，其 Shape 与对应参数相同。下面统一展示五类参数的最终 Gradient，矩阵只摘取部分行：

```python
# LM Head：mats（ID=90）对应的打分参数 Gradient
lm_head.weight.grad[90]
# tensor([0.002580, -0.312774, 0.016978, -0.572860])

# Final Norm：四个逐维缩放参数的 Gradient
final_norm.weight.grad
# tensor([-0.026763, -0.284987, -0.198043, -0.237038])

# 第二层 Attention：Output Projection 参数第 3 行的 Gradient
layers[1].attention.Wo.grad[3]
# tensor([-0.012041, -0.019549, -0.021298, 0.031453])

# 第二层 MLP：Down Projection 参数第 3 行的 Gradient
layers[1].mlp.W_down.grad[3]
# tensor([-0.019836, -0.007320, -0.022560, 0.023984])

# Token Embedding：输入 token IDs 对应参数行的 Gradient
embedding.weight.grad[12]  # Cats
# tensor([-0.008727, -0.008054, -0.097432, 0.128552])
embedding.weight.grad[45]  # sit
# tensor([-0.025421, -0.047753, -0.005087, 0.077225])
embedding.weight.grad[78]  # on
# tensor([-0.040909, -0.131007, -0.003027, 0.059970])
```

各参数值保持不变，Optimizer 随后使用这些 `.grad` 更新对应参数。

## Optimizer

**问题**

Backward 已将 Gradient 写入各参数的 `.grad`。怎样据此确定本次更新量、写回参数，并保存下一次更新需要的历史信息？

**方案**

Optimizer 读取当前参数、Gradient 和历史 State，计算本次更新量，再将新参数与新 State 写回。下面以 AdamW 为主展开：

1. **汇总历史方向与尺度**：分别更新 Gradient 和 Gradient 平方的移动统计，避免只依赖当前一步的数值。
2. **确定本次更新量**：修正统计从零开始造成的偏差，再结合 Learning Rate、历史方向与尺度计算更新量。
3. **写回参数和状态**：独立施加 Weight Decay，减去更新量；保存历史统计，供下一次更新使用。

Gradient Descent 直接使用当前 Gradient，Momentum 加入历史方向；它们作为更新规则的对照放在例子末尾。

原理介绍见 [Optimizer: What Does It Do and Why We Need It](https://huggingface.co/blog/onekq/adam-optimizer)（HF 社区文章），配置与使用见 [Optimizers and schedulers](https://huggingface.co/docs/transformers/optimizers)，算法定义见 [PyTorch: AdamW](https://docs.pytorch.org/docs/stable/generated/torch.optim.AdamW.html)。

**结构与核心逻辑**

```text
┌────────────────────────────────────────┐
│ 输入：Parameter、Gradient、历史 State  │
└────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────┐
│       更新历史统计并修正初始偏差       │
│      得到方向 m_hat 与尺度 v_hat       │
└────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────┐
│               确定更新量               │
│   Learning Rate 缩放、按历史尺度调整   │
└────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────┐
│        写回 Parameter 和 State         │
│  参数施加 Weight Decay，再减去更新量   │
└────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────┐
│         输出：新参数、新 State         │
│    下一次 Forward / 下一次更新使用     │
└────────────────────────────────────────┘
```

Optimizer 在训练开始前建立，持有模型参数的引用。每个参数分别保存自己的历史统计：

| 数据 | 职责 |
|---|---|
| Parameter、Parameter.grad | 当前参数与本次 Backward 的结果 |
| State：step、m、v | 更新次数、Gradient 移动平均、Gradient 平方移动平均 |
| lr、beta1、beta2 | 更新幅度、两份历史统计的保留比例 |
| epsilon、weight_decay | 防止分母为零、控制参数的独立收缩 |

```python
def adamw_step(parameter, state, lr, beta1, beta2, epsilon, weight_decay):
    # 1. 读取 Gradient，更新每个参数自己的历史统计
    g = parameter.grad
    state.step += 1
    state.m = beta1 * state.m + (1 - beta1) * g
    state.v = beta2 * state.v + (1 - beta2) * g**2

    # 2. 修正初始偏差，结合方向和尺度确定更新量
    m_hat = state.m / (1 - beta1**state.step)
    v_hat = state.v / (1 - beta2**state.step)
    update = lr * m_hat / (sqrt(v_hat) + epsilon)

    # 3. 写回参数；新的 m、v、step 保留在 State 中
    parameter.value *= 1 - lr * weight_decay
    parameter.value -= update
```

`optimizer.step()` 为所管理的参数执行更新；`optimizer.zero_grad()` 清空 Gradient，保留 State。下一次 Forward 读取更新后的参数。

**例子**

承接 Backward 的同一参数：`w=0.3、w.grad≈-0.57285`。本次使用 AdamW，设置 `lr=0.1、beta1=0.9、beta2=0.999、weight_decay=0.01、epsilon=1e-8`，首次更新前 `step=m=v=0`。

先更新方向和尺度统计：

```text
step = 1
m = 0.9×0 + 0.1×(-0.57285) = -0.057285
v = 0.999×0 + 0.001×(-0.57285)² ≈ 0.000328157
```

再修正初始偏差，计算本次更新量：

```text
m_hat = -0.057285 / (1-0.9) = -0.57285
v_hat ≈ 0.000328157 / (1-0.999) ≈ 0.328157
update = 0.1×m_hat / (sqrt(v_hat)+1e-8) ≈ -0.1
```

最后写回参数，并保留 State：

```text
Weight Decay 后：w = 0.3×(1-0.1×0.01) = 0.2997
减去更新量后：  w = 0.2997 - (-0.1) ≈ 0.3997
```

| 数据 | 更新前 | 更新后 |
|---|---:|---:|
| w | 0.3 | 0.3997 |
| step | 0 | 1 |
| m | 0 | -0.057285 |
| v | 0 | 0.000328157 |

下次 Forward 使用 `w≈0.3997`，下次 AdamW 继续使用表中保存的 `m、v、step`。以上近似值由未舍入的中间结果计算。

同一初始参数、Gradient 和 Learning Rate 使用不同算法时，首步对照如下；各行是独立更新：

| 算法 | 首步计算 | 更新后 w |
|---|---|---:|
| Gradient Descent | 0.3 - 0.1×(-0.57285) | 0.357285 |
| Momentum，初始 velocity=0 | velocity=0.9×0-0.57285，再执行 w-lr×velocity | 0.357285 |
| AdamW，初始 m=v=0 | 本节完整演算 | 0.3997 |

## Gradient Accumulation

**问题**

一次参数更新需要使用一组训练数据，但显存无法同时容纳其 Forward 和 Backward 所需的中间数据。拆成多个 micro-batch 后，怎样将各批贡献合成为同一个整体训练目标的 Gradient，并只更新一次参数？

**方案**

Gradient Accumulation 分批完成计算，累积期间保持参数不变，最后统一更新：

1. **确定整体目标的权重**：统计各批有效目标数及总数，让每个有效目标在整体平均 Loss 中具有相同权重。
2. **分批计算并累加**：每批平均 Loss 乘以本批目标数占比，再执行 Backward，将贡献累加到同一份 `.grad`。
3. **完成一次更新**：全部批次完成后，Optimizer 使用累积 Gradient 更新一次，再清空 Gradient。

有效目标数相等时，两批的权重各为 `1/2`；数量不等时按数量加权。拆批与执行流程见 [Workflow：Gradient Accumulation](/zh/docs/ai/llm-workflow-with-nanochat/#梯度累积一次更新的数据怎样分批计算)。

**结构与核心逻辑**

```text
                                本次更新的同一组参数
                                          │
                   ┌──────────────────────┴──────────────────────┐
                   ▼                                             ▼
┌────────────────────────────────────┐        ┌────────────────────────────────────┐
│           micro-batch 1            │        │           micro-batch 2            │
│       平均 Loss × 目标数占比       │        │       平均 Loss × 目标数占比       │
└────────────────────────────────────┘        └────────────────────────────────────┘
                   │                                             │
                   ▼                                             ▼
┌────────────────────────────────────┐        ┌────────────────────────────────────┐
│              Backward              │        │              Backward              │
└────────────────────────────────────┘        └────────────────────────────────────┘
                   │                                             │
                   │                                             │
                   └──────────────────────┬──────────────────────┘
                                          │
                                          ▼
                     ┌────────────────────────────────────────┐
                     │         同一份 Parameter.grad          │
                     │           累加所有批次的贡献           │
                     └────────────────────────────────────────┘
                                          │
                                          ▼
                     ┌────────────────────────────────────────┐
                     │           Optimizer 更新一次           │
                     └────────────────────────────────────────┘
```

| 数据或状态 | 在本次累积中的职责 |
|---|---|
| 各批有效目标数、总有效目标数 | 确定各批平均 Loss 的权重 |
| Parameter | 所有 micro-batch 读取相同参数，累积结束才更新 |
| Parameter.grad | 每次 Backward 累加本批加权后的贡献 |

```python
def accumulation_step(micro_batches, optimizer):
    # 1. 按本次更新的全部有效目标，确定各批权重
    counts = [count_valid_targets(batch) for batch in micro_batches]
    total_count = sum(counts)
    optimizer.zero_grad()

    # 2. 保持参数不变，分批计算并累加 Gradient
    for batch, count in zip(micro_batches, counts):
        if count == 0:
            continue
        batch_loss = mean_loss(batch)
        weighted_loss = batch_loss * (count / total_count)
        weighted_loss.backward()

    # 3. 全部批次完成后更新一次，清空本次 Gradient
    optimizer.step()
    optimizer.zero_grad()
```

这里的 `mean_loss` 使用本批有效目标计算平均 Loss，监督位置的识别沿用前文。

**例子**

下面使用独立的 Gradient 数值验证整体目标。假设四个有效目标对同一个参数的 Gradient 分别为 `[1,3,-1,5]`，参数初始值为 `0.3`。

完整批的平均 Gradient 为：

```text
(1+3-1+5)/4 = 2
```

拆成两批，各批读取的参数仍为 `0.3`：

| micro-batch | 目标的 Gradient | 有效目标数 | 本批平均 Gradient | 权重 | 对 .grad 的贡献 |
|---|---|---:|---:|---:|---:|
| 1 | [1,3] | 2 | 2 | 2/4 | 1 |
| 2 | [-1,5] | 2 | 2 | 2/4 | 1 |

```text
累计 parameter.grad = 1+1 = 2
```

累积结果与完整批一致。使用 `lr=0.1` 的普通 Gradient Descent，只更新一次：

```text
parameter_new = 0.3 - 0.1×2 = 0.1
```

再用目标数不等的情况验证同一加权规则。取三个有效目标的 Gradient 为 `[1,3,5]`，分成两批：

| micro-batch | 目标的 Gradient | 本批平均 Gradient | 权重 | 对 .grad 的贡献 |
|---|---|---:|---:|---:|
| 1 | [1,3] | 2 | 2/3 | 4/3 |
| 2 | [5] | 5 | 1/3 | 5/3 |

```text
累计 Gradient = 4/3 + 5/3 = 3
完整批平均 Gradient = (1+3+5)/3 = 3
```

上述对应关系要求累积期间参数不变，且各目标的 Forward 计算不因拆批而改变。

## LoRA：改变可训练参数的表示

**问题**

全量 SFT 对全部模型参数进行训练，需要保存相应的 Gradient 和 Optimizer State，显存开销较大。怎样减少这些训练开销，同时保留调整模型输出的能力？

**方案**

LoRA 将训练对象从完整 Weight 改为少量新增的低秩参数，基础参数继续提供原有计算：

1. **减少需要训练的参数**：冻结基础 Weight W，新增两个较小的矩阵 A/B，Gradient 和 Optimizer State 只为 A/B 保存。
2. **保留输出调整能力**：输入同时经过基础路径和 Adapter 路径，将 A/B 产生的调整量加到原输出上，输出维度保持不变。
3. **接入原有学习机制**：Loss 经 Backward 为 A/B 计算 Gradient，Optimizer 只更新 A/B，随后同一输入就能得到调整后的输出。

基础 Weight 本身仍需保存，训练仍有 Activations 开销。使用场景与训练流程见 [Workflow：LoRA](/zh/docs/ai/llm-workflow-with-nanochat/#lora减少可训练参数)。

**结构与核心逻辑**

```text
                                       输入 x
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                               ▼
┌──────────────────────────────────┐            ┌──────────────────────────────────┐
│           基础路径：W            │            │        Adapter 路径：A/B         │
│             冻结参数             │            │           低秩、可训练           │
└──────────────────────────────────┘            └──────────────────────────────────┘
                  │                                               │
             base_output                                     adjustment
                  │                                               │
                  └───────────────────────┬───────────────────────┘
                                          ▼
                     ┌────────────────────────────────────────┐
                     │                两路相加                │
                     │             保留原输出维度             │
                     └────────────────────────────────────────┘
                                          │
                                          ▼
                     ┌────────────────────────────────────────┐
                     │            后续模块与 Loss             │
                     └────────────────────────────────────────┘
                                          │
                                          ▼
                     ┌────────────────────────────────────────┐
                     │                Backward                │
                     │            A/B 的 Gradient             │
                     └────────────────────────────────────────┘
                                          │
                                          ▼
                     ┌────────────────────────────────────────┐
                     │           Optimizer 更新 A/B           │
                     │            基础 W 保持不变             │
                     └────────────────────────────────────────┘
```

| 参数或配置 | 职责 |
|---|---|
| W [out,in] | 原模块基础 Weight，冻结，继续参与 Forward |
| A [rank,in]、B [out,rank] | 可训练 Adapter，将调整量表示为两个低秩矩阵的组合 |
| rank | Adapter 中间维度，可训练参数量为 rank×(in+out) |
| scale=alpha/rank | 控制 Adapter 调整量的缩放 |

```python
def lora_forward(x, frozen_weight, A, B, scale):
    # 1. 基础路径使用冻结的 Weight，保留原有变换
    base_output = x @ frozen_weight.T

    # 2. Adapter 用 A/B 计算可训练的输出调整
    adapter_hidden = x @ A.T
    adjustment = (adapter_hidden @ B.T) * scale

    # 3. 合并两路结果，交给原有后续模块
    return base_output + adjustment


# 参数配置：W 冻结，Optimizer 只管理 A/B
freeze(W)
optimizer = Optimizer([A, B])
```

需要向可训练前序模块传递 Gradient 时，基础路径和 Adapter 路径仍参与反传。Loss、Backward 与参数更新规则沿用前文。

**例子**

先验证训练存储怎样减少。对同一个 `[4096,4096]` Weight，全量训练需要更新 `16777216` 个参数；LoRA 取 `rank=8`，只训练 A `[8,4096]` 和 B `[4096,8]`，共 `65536` 个参数。

Gradient 与 AdamW 两份移动统计均按 FP32 的每元素 4 Bytes 计算：

| 统计项 | Full Fine-tuning | LoRA |
|---|---:|---:|
| 可训练参数量 | 4096×4096 = 16777216 | 8×4096 + 4096×8 = 65536 |
| Gradient | 64 MiB | 256 KiB |
| AdamW 的 m、v | 128 MiB | 512 KiB |
| Gradient 与 m、v 合计 | 192 MiB | 768 KiB |

仅统计该模块的 Gradient 与两份移动统计，不含基础 Weight、Adapter 参数本身、Activations 和其他运行状态。

再用小矩阵验证输出调整与学习。取一组演示参数：`W` 为四阶单位矩阵，`rank=1、scale=1`：

```text
A = [[1,0,0,0]]
B = [[0.1],[0.2],[0.3],[0.4]]
x = [1,-2,3,-4]
```

两条路径的 Forward 结果为：

```python
base = x @ W.T             # [1,-2,3,-4]
adapter_hidden = x @ A.T   # [1]
adjustment = adapter_hidden @ B.T  # [0.1,0.2,0.3,0.4]
output = base + adjustment # [1.1,-1.8,3.3,-3.6]
```

假设后续计算传回输出 Gradient `[1,1,1,1]`，本次 Backward 得到：

```text
A.grad = [[1,-2,3,-4]]
B.grad = [[1],[1],[1],[1]]
W.grad 不保存
```

使用 `lr=0.01` 的普通 Gradient Descent，根据本次 Gradient 同时更新 A/B：

```text
A_new = [[0.99,0.02,-0.03,0.04]]
B_new = [[0.09],[0.19],[0.29],[0.39]]
W 仍为四阶单位矩阵
```

同一个输入重新计算，基础路径保持原值，Adapter 给出新的调整量：

```text
x @ A_newᵀ = [0.70]
adjustment_new = [0.063,0.133,0.203,0.273]
output_new = [1.063,-1.867,3.203,-3.727]
```

这次只更新 A/B，模块输出已发生变化。

# 生成计算：从 Logits 到下一个 Token

生成计算复用[第一篇](/zh/docs/ai/llm-system-1/)的模型参数与 Forward。下面分别展开历史 K/V 的存储与增量读取，以及最后位置的 Logits 怎样转为 token ID；输入准备、生成循环和输出流程见 [LLM Workflow](/zh/docs/ai/llm-workflow-with-nanochat/)。

## KV Cache：缓存结构与增量 Attention

**问题**

模型读完 `Cats sit on` 后，已经计算出各层、各位置的 K/V。新增 `mats` 时，Attention 仍需读取这些历史信息。

如果再次输入完整序列，历史位置会重复执行 Forward。怎样保存已有结果，让模型只计算新增位置，同时继续读取完整上下文？

保存历史结果又会增加显存占用：每层、每个样本、每个 KV Head 都需要保存 K/V，序列越长，缓存越大。怎样减少需要保存的 K/V 份数？

**方案**

KV Cache 按 Layer 保存历史 K/V：

- Prefill 处理完整输入，建立各层缓存。
- Decode 只处理新增 token。每层计算新增 Q/K/V，追加 K/V，再用当前 Q 读取历史及当前 K/V。

缓存容量还取决于 KV Head 数。MHA 为各 Query Head 使用独立 K/V；GQA 按组共享；MQA 让全部 Query Head 共享，从而减少缓存份数。

**结构与核心逻辑**

缓存保存当前模型各层已经处理的位置：

```text
KV Cache
├── Layer 1
│   ├── K：[Batch, KV Head, Cached Token, Head Dimension]
│   └── V：[Batch, KV Head, Cached Token, Head Dimension]
└── Layer 2
    ├── K：同上
    └── V：同上
```

每层的新增 Q/K/V 来自该层当前输入。沿用[第一篇 RoPE](/zh/docs/ai/llm-system-1/#rope)，Q/K 已包含对应位置的信息；V 保留内容特征。

```python
def cached_attention(q, new_k, new_v, layer_cache, query_positions):
    # 1. 读取本层已经保存的历史 K/V
    history_k = layer_cache.K
    history_v = layer_cache.V

    # 2. 将新增位置追加到历史之后
    all_k = concat(history_k, new_k, axis="token")
    all_v = concat(history_v, new_v, axis="token")

    # 3. 当前 Q 读取可见的历史及新增 K/V
    output = causal_attention(q, all_k, all_v, query_positions)

    # 4. 保存更新后的缓存，供下一次 Decode 使用
    layer_cache.K = all_k
    layer_cache.V = all_v
    return output
```

Prefill 从空缓存开始；后续 Decode 在已有缓存上追加。Attention 输出继续经过本层后续计算，进入下一层，最终得到新增位置的 Logits。Q 只服务当前读取，不保存到历史缓存。

多个 Query Head 可以共用同一组 K/V。以下每行表示一种组织方式，方框内是实际保存的一组历史 K/V：

```text
       ┌────────────────┬────────────────┬────────────────┬────────────────┐
MHA    │  Q0→[K0/V0]    │  Q1→[K1/V1]    │  Q2→[K2/V2]    │  Q3→[K3/V3]    │  4 组
       ├────────────────┴────────────────┼────────────────┴────────────────┤
GQA    │          Q0,Q1→[K0/V0]           │          Q2,Q3→[K1/V1]           │  2 组
       ├─────────────────────────────────┴─────────────────────────────────┤
MQA    │                        Q0,Q1,Q2,Q3→[K0/V0]                        │  1 组
       └───────────────────────────────────────────────────────────────────┘
```

共用 K/V 的 Head 仍有各自的 Q，可以算出不同的读取权重和输出。共享 K/V 减少了需要保存的历史缓存份数；采用哪种共享方式，由模型结构及对应参数决定。

GPT-3 Small（125M）每层有 12 个 Query Head、12 个 KV Head，一一对应，属于 MHA。配置见 [Language Models are Few-Shot Learners](https://arxiv.org/html/2005.14165v4#S2.SS1)。

GQA/MQA 节省缓存显存的代价是独立的 K/V 表示变少。例如，原来四个 Head 分别学习四组 K/V，分成两组后只能学习两组，不同关系与内容特征的表达可能受到限制。参见 [GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints](https://arxiv.org/abs/2305.13245)。

**例子**

沿用两层简化模型。Prefill 输入 `Cats sit on` 后，Layer 1、Head 0 已保存：

| 位置 | Token | 缓存 K | 缓存 V |
|---:|---|---|---|
| 0 | Cats | `[0.7303,-0.3651]` | `[0.7303,-0.3651]` |
| 1 | sit | `[-1.8665,0.0567]` | `[-0.9608,1.6013]` |
| 2 | on | `[-0.6663,0.0230]` | `[0.2981,0.5963]` |

新增 `mats`，位置为 `3`。取 `embedding.weight[90]=[0.3,0.1,0.2,0.4]`，按[第一篇 Transformer](/zh/docs/ai/llm-system-1/#transformer-computation) 中的 Norm、Projection、RoPE 计算，得到：

```text
Q_mats = [-1.1360,-0.2069]
K_mats = [-1.1360,-0.2069]
V_mats = [1.0954,0.3651]
```

缓存前三行保持不变，追加第四行：

| 位置 | Token | 缓存 K | 缓存 V |
|---:|---|---|---|
| 3 | mats | `[-1.1360,-0.2069]` | `[1.0954,0.3651]` |

`mats` 的 Q 读取缓存中的四行 K/V，得到它在 Head 0 的 Attention 输出：

```text
读取位置：  Cats      sit       on       mats
Scores：  [-0.5332,  1.4910,   0.5319,  0.9428]
Weights： [ 0.0631,  0.4777,   0.1831,  0.2761]

Head 0 输出 ≈ [-0.0559,0.9519]
缓存长度：3 → 4
```

各 Head 和 Layer 按相同方式处理新增位置，最终得到 `mats` 位置的 Logits，与完整输入 `Cats sit on mats` 重新计算的最后位置结果一致。

不同策略的缓存占用对照如下。配置为 `N=32、B=1、长度=4096、Query Head 数=32、D=128`，每元素 2 Bytes，仅统计 K/V Tensor：

| 组织方式 | KV Head 数 | K/V 缓存 |
|---|---:|---:|
| MHA | 32 | 2 GiB |
| GQA | 8 | 512 MiB |
| MQA | 1 | 64 MiB |

缓存机制参见 [Hugging Face: How caching works](https://huggingface.co/docs/transformers/en/cache_explanation)。

## Token 选择：概率分布与采样

**问题**

模型已经输出下一 token 的词表 Logits。怎样根据这些分数选择生成结果，控制候选范围和结果变化，并在需要时比较多条候选序列的得分？

**方案**

常见的基础生成策略包括 Greedy Search、Sampling 和 Beam Search，见 [Hugging Face: Generation strategies](https://huggingface.co/docs/transformers/v5.22.2/en/generation_strategies)：

1. **Greedy Search**：每步选最高分 token，只保留一条生成路径，返回该步的 token ID。
2. **Sampling**：用 Temperature 调整分数差距，按需执行 Top-k / Top-p 筛选，再按保留候选的概率分布选择一个 token ID。
3. **Beam Search**：同时保留多条候选序列。每轮扩展各序列，累加新 token 的 Log Probability，再在全部扩展结果中保留得分最高的若干条；完成后返回最高分的保留序列。

生成循环及输出衔接见 [LLM Workflow](/zh/docs/ai/llm-workflow-with-nanochat/)。

**结构与核心逻辑**

```text
                                 各候选序列最后位置的 Logits
                                              │
              ┌───────────────────────────────┼───────────────────────────────┐
              ▼                               ▼                               ▼
┌──────────────────────────┐    ┌──────────────────────────┐    ┌──────────────────────────┐
│      Greedy Search       │    │         Sampling         │    │       Beam Search        │
│    取最高分 token ID     │    │     Temperature 调整     │    │  扩展候选、累计序列得分  │
└──────────────────────────┘    │    Top-k / Top-p 筛选    │    │   保留前 num_beams 条    │
              │                 │        按概率采样        │    └──────────────────────────┘
              │                 └──────────────────────────┘                  │
              │                               │                               │
              │                               │                               ▼
              │                               │                 ┌──────────────────────────┐
              │                               │                 │      下一轮候选序列      │
              └───────────────┬───────────────┘                 │      继续扩展与筛选      │
                              │                                 └──────────────────────────┘
                              ▼                                               │
        ┌──────────────────────────────────────────┐                          │
        │              Next Token ID               │                          ▼
        │            交给下一次 Decode             │            ┌──────────────────────────┐
        └──────────────────────────────────────────┘            │          完成后          │
                                                                │    返回最高分保留序列    │
                                                                └──────────────────────────┘
```

Greedy、Sampling 每步完成一次 token 选择。核心代码沿用前文概率计算方式，Sampling 保留 Temperature、Top-k、Top-p 的处理位置：

```python
def select_token(logits, mode, temperature=1, k=None, p=None):
    # 1. Greedy 直接返回最高分候选 ID
    if mode == "greedy":
        return argmax(logits)

    # 2. Sampling 用 Temperature 调整分数，按需保留 Top-k
    scores = logits / temperature
    candidates = all_token_ids()
    if k is not None:
        candidates = top_k_ids(scores, k)
    probabilities = softmax(scores[candidates])

    # 3. Top-p 保留累计概率首次达到阈值的候选集合
    if p is not None:
        order = sort_by_probability_descending(probabilities)
        keep = prefix_until_cumulative_reaches(order, probabilities, p)
        candidates = candidates[keep]
        probabilities = normalize(probabilities[keep])

    # 4. 按最终分布采样，返回原词表中的 ID
    return sample(candidates, probabilities)
```

Top-p 包含使累计概率达到或超过阈值的那个候选。Top-k 与 Top-p 都是可选项；本例组合时先 Top-k，再对当前候选分布应用 Top-p。

Beam Search 在多个生成步骤间保留候选序列。`num_beams` 指每轮保留几条；本例序列得分为新增 token 的 Log Probability 之和：

```python
def beam_search(prompt, num_beams, max_new_tokens, eos_id):
    beams = [(prompt, 0)]

    for step in range(max_new_tokens):
        candidates = []
        for sequence, score in beams:
            # 1. 已结束的序列保留得分，其他序列继续预测
            if sequence[-1] == eos_id:
                candidates.append((sequence, score))
                continue
            log_probs = log_softmax(model(sequence).last_logits)

            # 2. 扩展各候选，累加新 token 的 Log Probability
            for token_id in top_ids(log_probs, num_beams):
                candidates.append(
                    (sequence + [token_id], score + log_probs[token_id])
                )

        # 3. 在所有扩展结果中统一保留前 num_beams 条
        beams = top_sequences(candidates, num_beams)
        if all_ended(beams, eos_id):
            break

    # 4. 返回最高分的保留序列
    return best_sequence(beams)
```

**例子**

输入仍为 `Cats sit on`，词表大小为 256。下面另设一组 Logits，比较 `mats` 与 `chairs` 两个候选：

| 候选 | mats（90） | chairs（91） | 其余 254 项 |
|---|---:|---:|---|
| Logit | 0.9073 | 0.6000 | 每项为 0 |
| 完整词表 Probability | 0.009592 | 0.007054 | 合计约 0.983354 |

计算使用未舍入值，结果取近似值。

Greedy 取最高分 `0.9073`，直接返回 `ID=90`，即 `mats`。

Sampling 设置 `Temperature=1、Top-k=2、Top-p=0.8`。Temperature 为 1，分数不变；Top-k 保留 `mats`、`chairs`，在这两个候选上计算 Probability：

```text
mats：  exp(0.9073)/(exp(0.9073)+exp(0.6)) ≈ 0.5762
chairs：exp(0.6)/(exp(0.9073)+exp(0.6))    ≈ 0.4238
```

| 按概率排序的候选 | Probability | 累计 Probability | Top-p=0.8 是否保留 |
|---|---:|---:|---|
| mats（90） | 0.5762 | 0.5762 | 是 |
| chairs（91） | 0.4238 | 1.0000 | 是 |

两项都保留，归一化后概率不变。假设均匀随机数为 `u=0.7`：

```text
mats：  u ∈ [0,0.5762)
chairs：u ∈ [0.5762,1)

u=0.7
next_token_id=91，即 chairs
```

本次选择结果 `91` 交给 Decode。

再执行 Beam Search，设置 `num_beams=2、max_new_tokens=2`，结束标记为 `<END>`，ID 为 `242`。第一步使用上表的完整词表 Probability，保留两条候选：

| 新增序列 | Probability | 累计 Log Probability |
|---|---:|---:|
| mats | 0.009592 | -4.6468 |
| chairs | 0.007054 | -4.9541 |

第二步分别预测 `Cats sit on mats`、`Cats sit on chairs` 后的 token。本节为这两个上下文另设以下完整词表分布，用于演示后续预测怎样影响序列排名：

| 已新增内容 | 下一 token 候选及 Probability | 其余 254 项 |
|---|---|---|
| mats | &lt;END&gt;：0.40；chairs：0.30 | 均分剩余 0.30 |
| chairs | &lt;END&gt;：0.80；mats：0.10 | 均分剩余 0.10 |

各取前两个扩展结果，按累计得分统一排名：

| 新增序列 | 累计 Log Probability | 本轮是否保留 |
|---|---:|---|
| chairs &lt;END&gt; | -4.9541 + ln(0.80) ≈ -5.1773 | 是 |
| mats &lt;END&gt; | -4.6468 + ln(0.40) ≈ -5.5631 | 是 |
| mats chairs | -4.6468 + ln(0.30) ≈ -5.8508 | 否 |
| chairs mats | -4.9541 + ln(0.10) ≈ -7.2567 | 否 |

两条保留序列均已结束，返回得分最高的一条：

```text
新增 token IDs：[91,242]
新增内容：chairs <END>
```

`chairs` 第一步概率较低，但它后接 `<END>` 的概率较高，最终序列得分超过 `mats <END>`。

最后单独对照 Sampling 参数，沿用本例初始 Logits：Top-k=2 后，若 Top-p 改为 `0.5`，仅保留 `mats`，其 Probability 归一化为 1，返回 `90`。

只调整 Temperature、不执行 Top-k 和 Top-p 时，完整词表分布对比如下：

| 候选 | Temperature=1 | Temperature=0.5 |
|---|---:|---:|
| mats | 0.9592% | 2.3300% |
| chairs | 0.7054% | 1.2602% |
