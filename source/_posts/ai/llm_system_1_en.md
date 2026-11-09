---
title: LLM System（一）：GPT 结构与 Forward 计算
categories: [AI]
date: 2026-04-07
---

# Goal

展开 GPT Model 的结构与 Forward 计算，跟踪 token IDs 怎样转换为下一 token 的词表分数。

- 模型结构：Token Embedding、Transformer、Final Norm 与 LM Head 的连接和数据流。
- Transformer 逐层计算：Norm 与 Residual 怎样组织 Attention 和 MLP。
- Attention 与 MLP：展开 Q/K/V、Head、RoPE、注意力权重和前馈变换。

<!-- more -->

训练目标、参数更新与生成计算见 [LLM System（二）](llm_system_2.md)。阶段流程见 [大模型工作流程](llm_workflow.md)，具体工程实现见 [nanochat：LLM 核心架构与实现](llm_system_nanochat.md)。

```text
                         LLM System
                             │
              ┌──────────────┴──────────────┐
              │                             │
         Training Flow                Inference Flow
              │                             │
       Dataset / Tokenizer          Prompt / Tokenizer
              │                             │
              ▼                             ▼
     ┌──────────────────────────────────────────────┐
     │                  GPT Model                   │
     │           Input IDs → Forward → Logits       │
     └──────────────────────────────────────────────┘
              │                             │
              ▼                             ▼
       Loss (Targets)                 Token Selection
              │                             │
          Backward                      Next Token
              │                             │
          Optimizer                Decode + KV Cache
              │                             │
       Update Parameters              Repeat Forward
              │                             │
       Repeat Training                  Output Text
```

GPT Model 负责计算 Logits；Training Flow 根据训练目标更新参数；Inference Flow 根据 Logits 选择 token，并通过循环 Forward 生成回答。

# Forward：GPT Model 的结构与数据流

## 整体结构

```text
                Input IDs [B,T]
                       │
                       ▼
               Token Embedding
                       │
                       ▼
           Hidden States [B,T,C]
                       │
                       ▼
     ┌─────────────────────────────────┐
     │     Transformer Layers × N      │
     │                                 │
     │  ┌───────────────────────────┐  │
     │  │ Layer 1 / Block 1         │  │
     │  │ Attention、MLP、          │  │
     │  │ Norm、Residual            │  │
     │  └───────────────────────────┘  │
     │                │                │
     │               ...               │
     │                │                │
     │                ▼                │
     │  ┌───────────────────────────┐  │
     │  │ Layer N / Block N         │  │
     │  │ Attention、MLP、          │  │
     │  │ Norm、Residual            │  │
     │  └───────────────────────────┘  │
     └─────────────────────────────────┘
                       │
                       ▼
           Hidden States [B,T,C]
                       │
                       ▼
                  Final Norm
                       │
                       ▼
                  LM Head
                       │
                       ▼
               Logits [B,T,V]
```

| 模块 | 功能 |
|---|---|
| Token Embedding | 输入 token IDs，查表转换为每个 token 对应的向量。 |
| Transformer Layers × N | 输入 token 向量，通过多层计算，输出融合前文信息的向量。 |
| Final Norm | 输入最后一层的向量，调整数值尺度，输出 Shape 相同的向量。 |
| LM Head | 输入处理后的向量，输出词表中每个候选 token 的预测分数。 |

`B` 是 Batch Size，`T` 是输入序列长度，`C` 是 Hidden Dimension，`V` 是 Vocabulary Size。C 个数共同编码模型学到的特征，每个维度没有预先指定的独立含义。

全文以 `Cats sit on mats` 为主线：输入 `Cats sit on`，跟踪三个位置的向量，最后用 `on` 位置的输出预测 `mats`。示例配置为 `V=256`、`C=4`、`N=2`，token IDs 分别为 `12、45、78、90`。

## 核心模块

### Token Embedding

**问题**

Tokenizer 将 `Cats` 转成整数 ID `12`，但这个数只说明它在词表中的位置。ID 90 不表示它比 ID 45 的含义大一倍，模型也无法仅凭编号知道两个 token 有什么关系。

后续计算需要一组可以在训练中调整的特征数值，使不同 token 具有可供模型加工的表示，而不只是一个编号。

**方案**

Embedding 用 ID 读取参数矩阵的一行，把每个 token 变成可训练的向量。输出保留输入的 token 顺序，交给第一层 Transformer。

**结构与核心逻辑**

```text
embedding.weight [V,C]

                   每行包含 C 个数值
              ┌──────────────────────────┐
token ID 0    │ c0   c1   c2   …   c(C-1) │
token ID 1    │ c0   c1   c2   …   c(C-1) │
token ID 2    │ c0   c1   c2   …   c(C-1) │
    ⋮         │             ⋮            │
token ID V-1  │ c0   c1   c2   …   c(C-1) │
              └──────────────────────────┘

V：Vocabulary Size，矩阵行数
C：Hidden Dimension，每个 token 的向量包含 C 个数
```

`c0`、`c1` 等标记向量中的维度位置，各行保存各自的可训练参数值。

模型参数在初始化时建立，训练时由 Backward 和 Optimizer 更新，推理时从 Checkpoint 加载。

```python
# input_ids 是 Batch 准备阶段得到的整数 Tensor，Shape：[B,T]
hidden_states = embedding(input_ids)  # 输出 [B,T,C]，交给 Transformer
```

**例子**

设词表有 256 个 token，每个 token 用 4 个数表示，即 `V=256`、`C=4`。下面只展示部分行，文字是辅助标签：

```text
embedding.weight [256,4]

行号          c0     c1     c2     c3
           ┌──────────────────────────┐
  0        │ 0.1    0.3    0.2    0.5 │
  ⋮        │  ⋮      ⋮      ⋮      ⋮  │
 12  Cats  │ 0.2   -0.1    0.4    0.3 │
  ⋮        │  ⋮      ⋮      ⋮      ⋮  │
 45  sit   │-0.3    0.5    0.1    0.2 │
  ⋮        │  ⋮      ⋮      ⋮      ⋮  │
 78  on    │ 0.1    0.2   -0.2    0.6 │
  ⋮        │  ⋮      ⋮      ⋮      ⋮  │
255        │ 0.4    0.1    0.3    0.2 │
           └──────────────────────────┘
```

输入 `Cats sit on` 的 IDs 为 `[[12,45,78]]`。调用内部按 ID 查表，取出第 12、45、78 行：

```python
input_ids = tensor([[12, 45, 78]])  # 整数 Tensor，Shape：[1,3]
hidden_states = embedding.weight[input_ids]
```

```text
hidden_states = [
    [
        [ 0.2, -0.1,  0.4, 0.3],       # Cats，第 12 行
        [-0.3,  0.5,  0.1, 0.2],       # sit，第 45 行
        [ 0.1,  0.2, -0.2, 0.6],       # on，第 78 行
    ]
]                                      # Shape：[1,3,4]
```

输出包含三个 token 的四维向量，进入第一层 Transformer。此时三行表示仍由各自的 ID 查表得到，尚未通过 Attention 读取其他位置。

### Transformer

**问题**

输入 `Cats sit on` 时，Embedding 为三个 token 分别查出初始向量。但 `on` 的初始向量只由自己的 ID 决定，还没有结合前面的 `Cats sit`。

要预测后面的 `mats`，模型需要利用“谁坐着、正在发生什么、后面需要接什么”这些上下文关系。仅凭 `on` 自己的初始向量，无法利用当前句子提供的信息。

**方案**

Transformer 让 `on` 通过 Attention 读取 `Cats`、`sit` 及自身的信息，再用 MLP 加工汇集的特征，得到该位置融合上下文后的 Hidden State。Norm 和 Residual 连接这些计算，多层逐步更新表示。

三个位置都执行相同的计算，但只读取自身及前文。输出交给 Final Norm 和 LM Head；最后一个位置的向量用于为 `mats`、`chairs` 等下一 token 候选打分。

**结构与核心逻辑**

```text
Hidden States [B,T,C]
          │
          ▼
     Layer 1 / Block 1
          │
         ...
          │
          ▼
     Layer N / Block N
          │
          ▼
Hidden States [B,T,C]

每个 Layer：Attention、MLP、Norm、Residual
```

Transformer Layer 与 Block 在本文中指同一层结构。各层持有各自的参数，依次更新 Hidden States。

```python
x = transformer(hidden_states)  # [B,T,C] → [B,T,C]，交给 Final Norm
```

**例子**

输入一条包含三个 token 的序列，设每个位置用四个数值表示，即 `B=1`、`T=3`、`C=4`。经过两层 Transformer 后，输出是一个三维浮点数 Tensor：

```text
输入 token       Cats             sit              on
输入 IDs         12               45               78

Transformer 输出 hidden_states，Shape：[1,3,4]

[
    [
        [ 3.1458, -0.1000,  6.2916, 4.7187],   # Cats 的特征向量
        [-0.2929,  6.6708,  3.4566, 3.6111],   # sit 融合前文 Cats 后的特征向量
        [-0.0134,  4.1119, -0.1371, 7.4768],   # on 融合前文 Cats sit 后的特征向量
    ]
]
```

这些行分别是 **Cats、sit、on 三个输入位置的 Hidden State（特征向量）**，每行包含 `C` 个特征数值。后续经过 Final Norm 和 LM Head，才会变成该位置预测下一个 token 的词表分数。

内部计算见 [Transformer：Forward 的逐层计算](#transformer-computation)。

<a id="final-norm"></a>

### Final Norm

**问题**

Transformer 已为各位置输出特征向量，但不同位置可能有数值尺度差异。直接交给 LM Head 时，向量的整体尺度会影响 Logits 的尺度，进而影响 Softmax 后候选概率的集中程度。

**方案**

Final Norm 对每个位置单独执行 Normalization，再用可训练的 Weight 调整各维度。它保留向量长度和 token 位置，结果交给 LM Head。

前面的 Pre-Norm 作用于各子模块的输入，Residual 相加后的主干尺度仍会继续变化。Final Norm 在整个 Layer stack 结束后再次调整尺度，再将表示交给 LM Head。

**结构与核心逻辑**

本例采用 RMSNorm，对每个 token 的向量分别执行计算：`weight` 是逐维缩放参数，每个维度对应一个可训练数值；本例设为 1。`epsilon` 是防止分母为零的小常数，本例为 `1e-6`（`0.000001`），不参与参数学习。

```text
Final Norm：RMSNorm
│
├── weight：可训练参数，共 C 个数
│
│           c0    c1    c2    c3
│         ┌───────────────────────┐
│         │ 1.0   1.0   1.0   1.0 │
│         └───────────────────────┘
│
└── epsilon：配置值 0.000001
```

```python
x = final_norm(x)  # [B,T,C] → [B,T,C]，交给 LM Head
```

**例子**

承接前节 `Cats sit on` 的 Transformer 输出。设 `weight = [1,1,1,1]`、`epsilon = 1e-6`：

```text
输入 hidden_states，Shape：[1,3,4]
[
    [
        [3.1458, -0.1000, 6.2916, 4.7187],   # Cats 的特征向量
        [-0.2929, 6.6708, 3.4566, 3.6111],   # sit 的特征向量
        [-0.0134, 4.1119, -0.1371, 7.4768],   # on 的特征向量
    ]
]

每行分别计算：output = x / sqrt(mean(x²) + epsilon) * weight

以 on 这一行为例：
    mean(x²) ≈ 18.2073
    每个数除以 sqrt(18.2073 + epsilon)，除数 ≈ 4.2670
    输出 ≈ [-0.0031, 0.9637, -0.0321, 1.7522]

Final Norm 输出，Shape 仍为 [1,3,4]
[
    [
        [0.7427, -0.0236, 1.4855, 1.1141],   # Cats
        [-0.0702, 1.5995, 0.8288, 0.8659],   # sit
        [-0.0031, 0.9637, -0.0321, 1.7522],   # on
    ]
]
```

三行分别调整数值尺度，各维的特征差异仍然保留。输出继续交给 LM Head；最后一行用于计算 `on` 后面各候选 token 的分数。

<a id="lm-head"></a>

### LM Head

**问题**

模型读到 `Cats sit on` 后，已经得到各位置的上下文特征向量，还需要将它们转换为整张词表的候选分数。例如，`on` 位置要为 `mats`、`chairs` 等候选打分，使每项分数对应明确的 token ID，供训练计算 Loss 或生成选择下一个 token。

**方案**

LM Head 将向量与各候选对应的 Weight 做 Dot Product，得到整张词表的 Logits。每项 Logit 对应一个 token ID，随后交给 Loss 或 Token 选择。

**结构与核心逻辑**

```text
LM Head
│
└── weight：V 行 × C 列，每行对应一个候选 token

                   c0   c1   c2   …   c(C-1)
              ┌──────────────────────────────┐
token ID 0    │ c0   c1   c2   …   c(C-1)    │
token ID 1    │ c0   c1   c2   …   c(C-1)    │
    ⋮         │              ⋮               │
token ID V-1  │ c0   c1   c2   …   c(C-1)    │
              └──────────────────────────────┘
```

LM Head 保存一张参数表，每个候选 token 对应一行。每行参数决定上下文向量的各个特征怎样影响这个候选的分数。

输入是各位置经过 Final Norm 的上下文特征向量。对每个位置，使用同一个向量与参数表的每一行做 Dot Product：对应维度相乘，再将乘积相加，得到这一候选的 Logit。

本例不带 Bias，程序通过一次矩阵乘法完成所有位置、所有候选的打分：

```python
logits = x @ lm_head.weight.T
# [B,T,C] × [C,V] → [B,T,V]
```

输出的每个数对应“某个输入位置对某个候选 token 的分数”。训练时交给 Loss；生成时，最后一个位置的 Logits 交给 Token 选择。

本例中 LM Head 与 Embedding 各自持有 Weight；采用 Weight Tying 的模型会让两者共享 Weight。

```python
logits = lm_head(x)  # [B,T,C] → [B,T,V]
```

**例子**

LM Head 要计算：已经读到 `Cats sit on`，词表中的每个 token 有多适合作为下一个 token？计算使用两组数据。

**① 当前句子提供的特征**

接上节 Final Norm 的输出，最后一个位置 `on` 的向量约为：

```text
h_on = [-0.0031, 0.9637, -0.0321, 1.7522]
```

这是用于预测下一 token 的上下文特征。虽然存储在 `on` 位置，但它已经融合可见前文 `Cats sit on` 的信息。

**② 每个候选对应的打分参数**

下面取出参数表中三个候选对应的行：

```text
lm_head.weight [256,4]
候选 token              c0     c1     c2     c3
                   ┌────────────────────────────┐
 90  mats          │  0.2    0.4    0.1    0.3  │
 91  chairs        │ -0.2    0.1    0.4   -0.1  │
 92  volcano       │  0.0    0.0    0.0    0.0  │
       …           │             …              │
                   └────────────────────────────┘
```

`volcano`（火山）是与当前语境无关的候选，仍然与其他候选一样参与打分。本教学模型只为四行设置了非零参数，其余行均为零；这里选第 92 行表示 `volcano`。

**③ 同一个上下文向量，分别与每行计算分数**

以 `mats` 为例，对应数值相乘，再相加，即 Dot Product：

```text
上下文特征       mats 的参数       分数贡献
 -0.0031     ×      0.2        =   -0.00062
  0.9637     ×      0.4        =    0.38548
 -0.0321     ×      0.1        =   -0.00321
  1.7522     ×      0.3        =    0.52566
                                  ────────
mats 的 Logit                 ≈    0.9073
```

其他候选使用同一个 `h_on`，与各自的参数计算：

```text
h_on · Weight_mats    →  0.9073
h_on · Weight_chairs  → -0.0911
h_on · Weight_volcano →  0.0000
             …
             ↓
      共 256 个 Logits
```

示例中 `mats` 得分最高；无关候选也参与计算，由参数与上下文共同决定分数。真实模型通过训练学得这些参数，让符合上下文的正确 token 获得更高的预测概率。

三个输入位置各得到 256 个 Logits，输出 Shape 为 `[1,3,256]`。

<a id="transformer-computation"></a>

# Transformer：Forward 的逐层计算

## 多层结构与计算流程

**问题**

前面已经说明，`on` 的初始向量尚未包含 `Cats sit` 的上下文信息。下面展开 Transformer 怎样通过多层计算，将这三个独立的初始向量加工成各位置的上下文特征向量。

多层计算还需要保留已有信息，并让训练信号传回前面的层。Attention 和 MLP 会不断改变表示的数值尺度，需要在进入这些子模块前调整尺度，使深层计算更容易训练。

**方案**

Transformer 将 Attention、MLP、Norm 和 Residual 组织成一个 Layer / Block，再堆叠多层。每层先通过 Attention 读取上下文，再通过 MLP 加工特征；Residual 将各次计算结果加入原有表示，Norm 调整进入子模块的数值尺度。

Residual 保留当前表示，将 Attention 或 MLP 的输出作为增量加回主干。各子模块因此可以逐步修正已有表示；反向传播时，梯度也能沿相加中的直接路径传回前面的层。

Pre-Norm 在 Attention 和 MLP 之前调整输入尺度，再将子模块输出加回未经过这次 Norm 的主干。Norm 为子模块提供尺度受控的输入，Residual 保留已有表示和直接的梯度路径，两者共同支持多层堆叠。

第一层从 Embedding 输出开始计算，后续层接收上一层已经融合上下文的表示，继续读取和加工。各位置的向量因此逐层更新，最终交给 Final Norm 和 LM Head，用于预测下一 token。

```text
Cats sit on 的 Embedding 输出 [B,T,C]
    ↓
Layer 1：读取上下文 → 加工特征 → 更新各位置的表示
    ↓
Layer 2：基于上一层的表示，再次读取和加工
    ↓
……
    ↓
Layer N 输出 [B,T,C]
    ↓
Final Norm → LM Head
```

**结构与核心逻辑**

Transformer 保存一个 Layer 列表。以两层为例：

```text
Transformer
└── layers
    ├── [0] TransformerLayer
    │   ├── norm1：weight [C]
    │   ├── attention：Wq、Wk、Wv、Wo
    │   ├── norm2：weight [C]
    │   └── mlp：W_up、W_down
    └── [1] TransformerLayer
        ├── norm1：weight [C]
        ├── attention：Wq、Wk、Wv、Wo
        ├── norm2：weight [C]
        └── mlp：W_up、W_down
```

各层结构相同、参数独立；前一层输出作为后一层输入，各层输入输出的 Shape 都是 `[B,T,C]`。本例两层参数取相同的数值，但分别存储。

各模块的职责：

| 模块 | 功能职责 |
|---|---|
| Layer / Block | Transformer 中重复堆叠的计算单元。输入各位置的特征向量，经过上下文读取和特征加工，输出更新后的向量，交给下一层。 |
| Norm 1 | 分别调整各位置向量的数值尺度，为 Attention 准备输入。对应 `norm1(x)`。 |
| Self-Attention | 让各位置读取自身及前文的信息。例如 `on` 读取 `Cats`、`sit`，得到融合上下文的信息。 |
| Norm 2 | 调整第一次相加后的向量尺度，为 MLP 准备输入。对应 `norm2(r)`。 |
| MLP | 对每个位置独立加工特征。例如进一步组合 `on` 已经读到的主体、动作等信息。 |

本例 `norm1`、`norm2` 都是 RMSNorm 模块，算法与前面的 Final Norm 相同，但各自保存独立的可训练 `weight [C]`。数值示例中两组 Weight 均为 `[1,1,1,1]`，`epsilon` 均为 `1e-6`。

每个 Layer 采用 Pre-Norm，即在 Attention 和 MLP 之前分别执行 Norm，对应下面的 `norm1` 和 `norm2`。对应代码如下：

```python
def layer_forward(x):
    r = x + attention(norm1(x))
    y = r + mlp(norm2(r))
    return y


def transformer_forward(x):
    for layer in layers:
        x = layer(x)
    return x
```

代码中的两次加法构成 Residual Connection，分别将子模块输出与该阶段的输入相加：

- 第一次：`r = x + attention_output`，保留输入 `x`，加入 Attention 读取的上下文信息。
- 第二次：`y = r + mlp_output`，保留 `r`，加入 MLP 加工的特征，得到这一层的输出。

**例子**

沿用 `Cats sit on`，跟踪最后一个位置 `on` 的向量。简化模型使用两层、每个位置四个数，即 `C=4`：

```text
Embedding 输出
on：[0.1000, 0.2000, -0.2000, 0.6000]
    ↓ Layer 1：结合 Cats、sit 和自身的信息，更新特征
on：[-0.0551, 2.0614, -0.1897, 4.0226]
    ↓ Layer 2：读取上一层各位置的表示，继续加工
on：[-0.0134, 4.1119, -0.1371, 7.4768]
    ↓
交给 Final Norm 和 LM Head，计算下一 token 的候选分数
```

图中只列出 `on`，实际每层同时更新三个位置的向量，且各位置只能读取自身及前文。Layer 2 接收的是三个位置经过 Layer 1 后的表示。

下面分别展开层内各模块。

## Self-Attention

每个 token 位置都有自己的特征向量，但预测下一个 token 需要结合上下文。Self-Attention 让当前位置根据内容相关性读取同一序列的信息，形成融合上下文的表示。GPT 使用 Causal Self-Attention，通过 Causal Mask 将读取范围限制为自身及前文。

例如，输入 `Cats sit on`，第一层中 `on` 的初始向量尚未结合 `Cats` 和 `sit`。下面跟踪它怎样读取前文，再得到新的上下文特征。

**输入与输出**

在本文 Pre-Norm 结构中，输入来自 `norm1`。Self-Attention 对每个位置输出一个向量，Shape 保持不变：

```text
输入 x [B,T,C]                        输出 attention_output [B,T,C]
┌──────────────────────┐              ┌──────────────────────────┐
│ Cats 的特征向量      │              │ Cats 的 Attention 输出   │
│ sit  的特征向量      │ → Attention →│ sit  的 Attention 输出   │
│ on   的特征向量      │              │ on   的 Attention 输出   │
└──────────────────────┘              └──────────────────────────┘
```

**核心概念**

Q、K、V 是由 token 特征向量生成的三种表示：Q 发起匹配，K 提供匹配特征，V 提供实际汇总的内容。Attention Weights 表示各位置的 V 以多大比例参与汇总。

一个 Self-Attention 模块包含多个 Head。每个 Head 都有整条序列各位置对应的 Q/K/V；不同 Head 可以学习关注不同的关系与特征，各自独立计算读取权重并汇总内容，结果最后合并。

**完整流程**

```text
各位置的特征向量
    ↓ 生成 Q/K/V
    ↓ 拆分 Head
每个 Head：
    Q/K 引入位置信息
    → Q/K 匹配、Scaling
    → Causal Mask、Softmax
    → 按权重汇总 V
    ↓ 合并 Head、Wo 投影
各位置的 Attention 输出
```

下面各步都沿用 `Cats sit on`。结构图先以 `C=768` 说明一般组织方式；具体数值统一使用 `C=4、H=2、D=2` 的简化模型，跟踪 Layer 1 的 `on`。数值显示到四位小数，连续计算使用未舍入值。

### 1. Q/K/V：职责、生成与 Head 组织

**问题**

当前位置需要确定从各位置读取多少信息，并取得这些位置提供的内容。同时，模型需要学习不同的关系与特征组合，因此要组织多组独立的上下文读取。

**方案**

Q、K、V 是**同一个 token 特征向量生成的三种表示**，分别承担：

- **Q（Query）：我现在需要查找什么信息？**
- **K（Key）：我有哪些特征，可以与这个需求匹配？**
- **V（Value）：如果读取我，我实际提供什么信息？**

结合 `Cats sit on`，处理 `on` 时：

```text
Q_on：发起一次查询
    ↓ 分别与各位置的 K 匹配
K_Cats     K_sit     K_on
    ↓ 得到读取比例
   16%       54%       30%       # 示意
    ↓ 按比例取各位置提供的内容
V_Cats     V_sit     V_on
    ↓ 加权相加
on 融合上下文后的读取结果
```

**Q/K 共同决定“读多少”，V 提供“读什么”。**

将这些表示组织成多个 Head，让各 Head 独立匹配和汇总，学习不同的关系与特征组合。

**结构与核心逻辑**

**① 输入：从前文接收各位置的特征向量**

`x` 来自前文“多层结构与计算流程”中的 `norm1(x)`。以一条 `Cats sit on` 为例，`B=1`、`T=3`；设 `C=768`，即每个位置有 768 个特征数值，输入 Shape 为 `[1,3,768]`：

```text
输入 x [1,3,768]

           c0       c1       c2              c767
        ┌──────────────────────────────────────────┐
Cats    │ x0_0     x0_1     x0_2      …     x0_767  │
sit     │ x1_0     x1_1     x1_2      …     x1_767  │
on      │ x2_0     x2_1     x2_2      …     x2_767  │
        └──────────────────────────────────────────┘
```

**② 参数：将输入分别变换为三种表示**

```text
                     三组可训练参数
                  ┌─ × Wq [768,768] → Q [1,3,768]
x [1,3,768] ──────┼─ × Wk [768,768] → K [1,3,768]
                  └─ × Wv [768,768] → V [1,3,768]
```

`W` 表示 Weight Matrix。**`Wq、Wk、Wv` 是所有 token 共用的特征变换参数**，让同一个输入形成三种用途的表示：

- **Wq**：生成查询特征，用于决定当前位置要读取哪些信息。
- **Wk**：生成匹配特征，让各位置能够与当前查询计算相关程度。
- **Wv**：生成内容特征，供读取权重确定后加权汇总。

将三种变换分开，模型就能分别学习**怎样匹配信息、怎样提供内容**。例如处理 `on` 时，`Q_on` 与各可见位置的 K 匹配，决定读取比例，再按比例汇总对应的 V。

**每个 Layer 的参数独立，同一 Layer 内所有 token 位置共用。**

本例输入和输出均为 768 维，因此矩阵 Shape 为 `[768,768]`；生成的 Q/K/V 随后再分给各 Head。

**③ 结果：每个位置分别得到 Q/K/V**

上一阶段的三次变换，得到三组与 token 位置一一对应的数据：

```text
          Q [1,3,768]      K [1,3,768]      V [1,3,768]
Cats    Q_Cats [768]     K_Cats [768]     V_Cats [768]
sit     Q_sit  [768]     K_sit  [768]     V_sit  [768]
on      Q_on   [768]     K_on   [768]     V_on   [768]
```

计算某个位置的 Attention 输出时，使用该位置的 Q，与自身及前文位置的 K/V 进行计算。

**④ 组织：将生成的表示分给多个 Head**

```text
一个 token 的 Hidden State，C=768
[x0, x1, x2, …, x767]
          ↓ 分别通过 Wq、Wk、Wv 投影，再拆分 Head

          Head 0               Head 1                        Head 11
          D=64                 D=64                          D=64
   ┌───────────────────┬─────────────────────┬─────┬───────────────────────┐
Q  │ q0, q1, …, q63    │ q64, q65, …, q127   │  …  │ q704, q705, …, q767    │
   ├───────────────────┼─────────────────────┼─────┼───────────────────────┤
K  │ k0, k1, …, k63    │ k64, k65, …, k127   │  …  │ k704, k705, …, k767    │
   ├───────────────────┼─────────────────────┼─────┼───────────────────────┤
V  │ v0, v1, …, v63    │ v64, v65, …, v127   │  …  │ v704, v705, …, v767    │
   └───────────────────┴─────────────────────┴─────┴───────────────────────┘
```

**Head 是一组独立的 Attention 计算。** 每个 Head 使用分配给自己的 Q/K/V，独立计算读取权重并汇总内容，使模型能够学习不同的关系与特征组合。

图中每一列是一个 Head。对于当前 token，每个 Head 分别获得一个 64 维的 Q、K、V 向量。`Cats`、`sit`、`on` 都这样拆分，因此每个 Head 都有全部位置对应的 Q/K/V。

- **C=768**：拆分前，每个 token 的 Q、K、V 各包含 768 个数。
- **H=12**：这些数分别组织成 12 个 Head。
- **D=64**：每个 Head 的 Q、K、V 各包含 64 个数。

程序将投影与拆分连续执行：

```python
# 输入 x：[B,T,C]
q = x @ Wq  # [B,T,C]
k = x @ Wk  # [B,T,C]
v = x @ Wv  # [B,T,C]

# 将特征维度分为 H 组，再按 Head 组织全部 token
q = split_heads(q)  # [B,T,C] → [B,H,T,D]
k = split_heads(k)
v = split_heads(v)
```

**例子**

沿用 `Cats sit on`，使用 `C=4、H=2、D=2` 的简化模型，跟踪 `on` 的数据变化：

```python
# 输入来自 Layer 1 的 norm1，整体 Shape：[1,3,4]
# 其中 on 的向量：[0.2981, 0.5963, -0.5963, 1.7888]
x = norm1_output

# 本例 Wq、Wk、Wv 都是四阶单位矩阵
q = x @ Wq  # Q_on：[0.2981, 0.5963, -0.5963, 1.7888]
k = x @ Wk  # K_on：[0.2981, 0.5963, -0.5963, 1.7888]
v = x @ Wv  # V_on：[0.2981, 0.5963, -0.5963, 1.7888]

# H=2、D=2，整体 Shape：[1,3,4] → [1,2,3,2]
q = split_heads(q)  # Q_on：Head 0 [0.2981, 0.5963]；Head 1 [-0.5963, 1.7888]
k = split_heads(k)  # K_on：Head 0 [0.2981, 0.5963]；Head 1 [-0.5963, 1.7888]
v = split_heads(v)  # V_on：Head 0 [0.2981, 0.5963]；Head 1 [-0.5963, 1.7888]
```

<a id="rope"></a>

### 2. RoPE：让匹配包含位置信息

**问题**

Q/K 投影提供了内容特征，但匹配还需要反映 token 的位置关系，例如 `Cats`、`sit` 都在 `on` 之前，并且与它的距离不同。

**方案**

使用 RoPE，根据 Position Index 旋转各位置的 Q/K，使它们的匹配能够体现相对位置。V 不参与旋转，继续提供被汇总的内容。

**结构与核心逻辑**

`positions` 与序列中的 token 一一对应：

```text
token       Cats    sit     on
positions     0      1      2
```

每个 Head 内，将 Q/K 的特征维度两两分组，各组按自己的频率旋转。下面展示一对数值的变换：

```python
angle = position * frequency

a_new = a * cos(angle) - b * sin(angle)
b_new = a * sin(angle) + b * cos(angle)

# 对所有 Head、所有位置的 Q/K 执行变换
q, k = apply_rope(q, k, positions)
```

Position Index 标记 token 在序列中的位置，与向量内部的维度编号不同。旋转改变 Q/K 的数值，Shape 仍为 `[B,H,T,D]`。

**例子**

本例 `D=2`，每个 Head 只有一对数值，频率为 1，所以旋转角度就是 position。按照上述公式计算，Head 0 中 `on` 位于位置 2，Q 的变化为：

```text
Q_on：[0.2981, 0.5963] → [-0.6663, 0.0230]
```

同样处理三个位置的 K：

```text
             RoPE 前                 RoPE 后
K_Cats   [ 0.7303, -0.3651]      [ 0.7303, -0.3651]
K_sit    [-0.9608,  1.6013]      [-1.8665,  0.0567]
K_on     [ 0.2981,  0.5963]      [-0.6663,  0.0230]
```

结合 `Cats sit on`：

```text
Cats（0）    sit（1）    on（2）
    └──── 相隔 2 ────────┘
                └─ 相隔 1 ─┘

Q_on 与 K_Cats 匹配：包含相隔 2 个位置的影响
Q_on 与 K_sit  匹配：包含相隔 1 个位置的影响
```

Q/K 分别按各自位置旋转后，匹配时的角度差反映两者的相对位置，因此匹配分数同时受到内容和相对位置的影响。

下一步使用这些变换后的 Q/K 计算分数；第一步中的 V 保持不变。

### 3. 从匹配分数得到读取权重

**问题**

1. **匹配分数的尺度**：Q/K 的维度越大，Dot Product 的数值通常越容易出现较大幅度，导致 Softmax 过度集中在少数位置，进入 Gradient 很小的区域，影响训练。例如：

   ```text
   分数 [1, 2, 3]    → Softmax ≈ [9%, 24%, 67%]
   分数 [10,20,30]   → Softmax ≈ [0%,  0%, 100%]
   ```

2. **读取范围**：当前位置只能读取自身及前文，需要排除未来位置。

**方案**

1. **Scaling：调整分数尺度**。将 Q/K 的匹配分数除以 `sqrt(D)`，抵消维度增加带来的分数波动，避免 Softmax 因分数幅度过大而过度集中。
2. **Causal Mask：排除未来位置**。将未来位置的分数设为负无穷，使这些位置在 Softmax 后的权重为零。

完成 Scaling 和 Mask 后，再通过 Softmax 将分数转换为总和为 1 的 Attention Weights，用于下一步汇总 V。

**结构与核心逻辑**

```python
# 每个位置的 Q 与同一 Head 中各位置的 K 匹配
scores = (q @ k.transpose(-2, -1)) / sqrt(D)  # [B,H,T,T]

# 屏蔽未来位置，再将分数转为读取权重
weights = softmax(scores + causal_mask, dim=-1)  # [B,H,T,T]
```

`scores` 和 `weights` 的最后两个维度分别是发起读取的位置与被读取的位置。某个 Head 中 `on` 对应的一行，保存它读取各位置的分数或权重。

Causal Mask 的结构如下；未来位置加上负无穷后，Softmax 权重为零：

```text
行是 Query 位置，列是 Key 位置
           Cats   sit    on
Cats        0     -∞     -∞
sit         0      0     -∞
on          0      0      0
```

**例子**

继续跟踪 Layer 1、Head 0 的 `on`。使用第二步得到的 `Q_on=[-0.6663,0.0230]` 与各 K 匹配：

| 读取位置 | 当前 Q | 被匹配的 K | Dot Product / √2 |
|---|---|---|---:|
| on → Cats | `[-0.6663,0.0230]` | `[0.7303,-0.3651]` | -0.3500 |
| on → sit | 同一个 Q | `[-1.8665,0.0567]` | 0.8803 |
| on → on | 同一个 Q | `[-0.6663,0.0230]` | 0.3143 |

`on` 可读取这三个位置，因此这一行没有位置需要屏蔽。Softmax 将分数转成读取权重：

```text
Scores： [-0.3500,0.8803,0.3143]
Weights：[ 0.1571,0.5376,0.3053]
            Cats    sit     on
```

这三个权重决定下一步各位置的 V 占多少比例；其中 `sit` 约占 53.76%。

### 4. 汇总内容并输出

**问题**

前一步得到 `on` 读取 `Cats、sit、on` 的权重，但这些权重只是三个比例，还不是融合上下文的特征向量。

各位置提供的信息存储在 V 向量中，需要按权重将它们融合。同时，各 Head 独立计算，还需要将各自的结果组合成 `on` 位置的一个 Attention 输出。

**方案**

每个 Head 内，将权重分别乘以 `V_Cats、V_sit、V_on`，再相加，得到融合三个位置特征的向量。

随后拼接各 Head 的结果，通过 Output Projection 的可训练参数 `Wo`，进一步组合各 Head 提取的特征，得到 `attention_output_on`。

**结构与核心逻辑**

每个 Head 先完成加权汇总：

```text
读取权重 [T] × 各位置的 V [T,D]
    ↓
当前 token 在这个 Head 中的上下文向量 [D]
```

再合并各 Head：

```text
Head 0 的结果 [D] ─┐
Head 1 的结果 [D] ─┼→ 拼接 [C] → × Wo [C,C] → Attention 输出 [C]
        …        ─┘
```

`Wo` 是 Output Projection 的 Weight Matrix。拼接只是将各 Head 的数值排列在一起，`Wo` 则学习如何组合、调整这些特征，供后续计算使用。

本例 `C=768`，拼接后的向量和输出均为 768 维，所以 `Wo` 的 Shape 为 `[768,768]`。

整批数据的对应计算：

```python
head_output = weights @ v               # [B,H,T,D]
output = merge_heads(head_output) @ Wo  # [B,T,C]
```

**例子**

沿用 `C=4、H=2、D=2`，跟踪 `on`：

```python
# Head 0：前一步得到的读取权重
weights_on = [0.1571, 0.5376, 0.3053]  # Cats、sit、on

# Head 0：各位置提供的 V
values = [
    [ 0.7303, -0.3651],  # V_Cats
    [-0.9608,  1.6013],  # V_sit
    [ 0.2981,  0.5963],  # V_on
]

# 按比例融合三个位置的特征
head0_on = weights_on @ values
# ≈ [-0.3108, 0.9856]

# Head 1 独立计算得到另一组特征
head1_on = [-0.5261, 1.7135]

# 拼接两个 Head 的结果
merged_on = concat(head0_on, head1_on)
# [-0.3108, 0.9856, -0.5261, 1.7135]

# 本例 Wo 为四阶单位矩阵，投影后数值不变
attention_output_on = merged_on @ Wo
# [-0.3108, 0.9856, -0.5261, 1.7135]
```

得到的四维向量交给当前 Layer 的 Residual，与 `on` 在该层的输入向量相加。

计算定义参见 [PyTorch: scaled_dot_product_attention](https://docs.pytorch.org/docs/stable/generated/torch.nn.functional.scaled_dot_product_attention.html)。

## MLP(Position-wise FFN)

**问题**

当前位置已经获得上下文信息，还需要将其中的多个特征组合起来，形成支持判断和预测的新特征。MLP 对每个位置的向量独立执行这种加工。

下面用语义场景作功能示意：

```text
The cat sits on the mat. It looks ...
```

处理到 `looks` 时：

```text
Attention：读取 cat、sits、mat 等上下文信息
MLP：组合当前位置已有的特征，为 sleepy、comfortable 等后续预测提供依据
```

MLP 输出仍是特征向量，交给后续层和 LM Head。

**方案**

Up Projection 将输入投影到中间特征，Activation 引入非线性，Down Projection 将结果组合回主干维度。MLP 不读取其他位置；它的输出作为本次特征加工的结果，进入第二次 Residual。

结构定义见 [Attention Is All You Need — Position-wise Feed-Forward Networks](https://arxiv.org/html/1706.03762v7#S3.SS3)。关于 FFN 如何匹配输入模式并影响后续预测，可参阅 [Transformer Feed-Forward Layers Are Key-Value Memories](https://aclanthology.org/2021.emnlp-main.446/)。

**结构与核心逻辑**

这里的 `x` 来自 Block 的 `norm2`。

`F` 是 MLP 中间特征向量的维度。本例 `C=4`、`F=8`：Up Projection 将每个位置的四个数转换成八个中间特征，经过 Activation 后，Down Projection 再转回四个数，才能与 Residual 主干相加。

因此，按本例右乘矩阵的表示方式，`W_up` 的 Shape 为 `[C,F]=[4,8]`，`W_down` 为 `[F,C]=[8,4]`。下面给出本例计算使用的具体参数：

```text
MLP
├── W_up：4 行 × 8 列
│        f0 f1 f2 f3 f4 f5 f6 f7
│   c0  [1, 0, 0, 0,-1, 0, 0, 0]
│   c1  [0, 1, 0, 0, 0,-1, 0, 0]
│   c2  [0, 0, 1, 0, 0, 0,-1, 0]
│   c3  [0, 0, 0, 1, 0, 0, 0,-1]
├── Activation：ReLU
└── W_down：8 行 × 4 列
         c0 c1 c2 c3
    f0  [1, 0, 0, 0]
    f1  [0, 1, 0, 0]
    f2  [0, 0, 1, 0]
    f3  [0, 0, 0, 1]
    f4  [1, 0, 0, 0]
    f5  [0, 1, 0, 0]
    f6  [0, 0, 1, 0]
    f7  [0, 0, 0, 1]
```

上图按右乘方向表示矩阵，本例省略 Bias。

```python
mlp_output = mlp(x)
```

**例子**

继续跟踪 Layer 1 的 `on`，此时 Attention 和第一次 Residual 已经完成。`norm2` 给 MLP 的输入为下面的四维向量：

```python
x = [-0.1557, 0.8758, -0.5364, 1.7091]

h = x @ W_up
# [-0.1557, 0.8758, -0.5364, 1.7091, 0.1557, -0.8758, 0.5364, -1.7091]

h = relu(h)
# [0, 0.8758, 0, 1.7091, 0.1557, 0, 0.5364, 0]

mlp_output = h @ W_down
# [0.1557, 0.8758, 0.5364, 1.7091]
```

Up Projection 的八个数是中间特征，ReLU 去掉其中的负值，Down Projection 再将它们组合成四个数。这组结果加入 Residual 主干；其他位置使用相同矩阵各自计算。

后续见 [LLM System（二）：训练目标、参数更新与生成计算](llm_system_2.md)。
