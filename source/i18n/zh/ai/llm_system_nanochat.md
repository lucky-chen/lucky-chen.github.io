---
title: nanochat：LLM 核心架构与实现
categories: [AI]
date: 2025-12-07
---

# Goal

结合 nanochat 官方源码，介绍数据、模型、训练与生成模块的组织及内部实现。

- 数据处理：字节级 BPE、词表、对话编码、token 打包与监督目标构造。
- 模型计算：GPTConfig、GPT.forward、Transformer Block、Attention 与 MLP。
- 训练实现：交叉熵、Backward、梯度累积，以及 AdamW / Muon 参数更新。
- 生成实现：Engine、KV Cache、token 采样与回答状态管理。

<!-- more -->

源码依据：[karpathy/nanochat 官方仓库](https://github.com/karpathy/nanochat)的固定提交 [92d63d4](https://github.com/karpathy/nanochat/commit/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd)。文中源码链接均指向该提交；代码片段为节选或简化伪代码。

阶段执行顺序与调用场景见配套文章 [nanochat：LLM 训练与推理流程](llm_workflow_nanochat.md)。

# 核心架构

跨阶段共用 [common.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/common.py) 管理设备、精度、分布式和缓存路径。[flash_attention.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/flash_attention.py) 提供 FA3/SDPA 后端；[fp8.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/fp8.py) 提供可选 FP8 线性层转换。

```text
nanochat 核心架构（按职责划分，由流程编排组合调用）
│
├── Data Pipeline — 数据处理
│   ├── 数据加载与适配             下载、缓存、读取、统一格式与任务混合
│   ├── Tokenizer                  字节级 BPE、词表、token IDs、特殊标记与对话编码
│   └── 模型输入与监督目标          张量形状、下一 token 移位、监督 mask 与 ignore_index
│
├── GPT Model — 模型整体结构与 Forward 调用链
│   ├── GPTConfig                  模型维度、层数、词表与窗口配置
│   ├── GPT                        组合嵌入、Transformer Blocks 与输出层
│   │   ├── Token / Value Embedding   token 表示与 Value 残差
│   │   ├── Smear                  相邻 token embedding 混合
│   │   ├── Block                详见 Transformer Block
│   │   ├── norm / 残差混合        RMSNorm、逐层缩放与中间残差回退
│   │   └── lm_head               词表投影，随后计算 Softcap 与可选交叉熵
│   ├── Flash Attention 适配模块   FA3 / SDPA，支持带缓存注意力
│   └── Float8Linear              可选 FP8 线性层，由预训练流程转换
│
├── Transformer Block — Attention、MLP、Norm、Residual
│   ├── CausalSelfAttention       QKV 投影、RoPE、QK Norm 与窗口注意力
│   ├── MLP                       ReLU² 前馈网络
│   └── norm / residual           RMSNorm 与残差连接
│
├── Training Implementation — Loss、Backward、Optimizer
│   ├── Loss                      GPT.forward() 中计算交叉熵
│   ├── Backward                  训练脚本调用，累积参数梯度
│   └── MuonAdamW                  统一持有参数引用并执行更新
│       ├── param_groups           按参数用途与矩阵形状分组
│       ├── AdamW 更新             嵌入、输出层与标量参数更新
│       ├── Muon 更新              Transformer 矩阵参数更新
│       ├── state                  动量、一阶与二阶矩状态
│       └── 分布式通信             梯度规约、分片更新与参数收集
│
└── Inference Implementation — KV Cache、Token Generation
    ├── Engine                     Prefill、Decode、采样与工具结果注入
    ├── KVCache                    各层 K/V、缓存位置与前一 embedding
    └── RowState                   单样本序列、工具队列与结束状态
```

<a id="data-pipeline"></a>

# Data Pipeline

数据处理分为数据加载与适配、Tokenizer、模型输入与监督目标三部分。本文重点解释文本如何转换为 token IDs，以及这些 ID 如何成为模型输入；各阶段的数据读取、打包、补齐和采样过程见 [执行流程篇](llm_workflow_nanochat.md)。

```text
数据加载与适配                Tokenizer                    模型输入与监督目标
原始文本 / 任务记录     →     文本 / 对话 → token IDs   →    inputs / targets
下载、缓存、读取、统一格式     BPE、词表、特殊 token          张量形状、目标移位、监督屏蔽
```

<a id="data-loading"></a>

## 数据加载与适配

**核心逻辑代码**：

```python
# 1. 拉取数据并创建任务，内部调用 load_hub_dataset()；本地有缓存时直接读取。
smoltalk = SmolTalk(split="train")
gsm8k = GSM8K(subset="main", split="train")

# 2. 建立并打乱混合索引。
dataset = TaskMixture([smoltalk, gsm8k])

# 3. 按混合索引定位任务，内部调用对应的 get_example()。
conversation = dataset[0]

# 以下摘录 SmolTalk.get_example() 的核心实现，省略消息校验。
def get_example(self, index):
    row = self.ds[index]
    return {"messages": row["messages"]}

# 4. 取得统一格式的消息，供后续编码。
messages = conversation["messages"]
```

**输入与输出示例**：

```python
# 输入：SmolTalk 格式的教学记录，以及用于说明数学任务适配的 GSM8K 格式记录。
smoltalk_row = {
    "messages": [
        {"role": "user", "content": "Write a sentence about cats sitting on mats."},
        {"role": "assistant", "content": "Cats sit on mats"},
    ],
}
gsm8k_row = {
    "question": "2+3=?",
    "answer": "2+3=5\n#### 5",
}

# 输出：每次取出一条对话，得到对应的 messages。
# SmolTalk 样本对应的 messages。
messages = [
    {"role": "user", "content": "Write a sentence about cats sitting on mats."},
    {"role": "assistant", "content": "Cats sit on mats"},
]

# GSM8K 样本对应的 messages。
messages = [
    {"role": "user", "content": "2+3=?"},
    {"role": "assistant", "content": [
        {"type": "text", "text": "2+3=5\n#### 5"},
    ]},
]
```

<a id="tokenizer"></a>

## Tokenizer

Tokenizer 将文本编码为整数 token IDs，并支持解码。`RustBPETokenizer` 使用 `rustbpe` 训练字节级 BPE，再通过 `tiktoken` 执行编码与解码；对话编码还会添加角色、工具等特殊标记。

### 分词算法：字节级 BPE

字节级 BPE 从单字节出发学习相邻片段的合并规则。本项目使用 `rustbpe` 训练，通过 `SPLIT_PATTERN` 预切分文本，再导出普通词表及合并优先级，供 `tiktoken` 编码使用。

**核心逻辑代码**：

以下为 `RustBPETokenizer.train_from_iterator()` 的训练部分：

```python
# RustBPETokenizer.train_from_iterator()：BPE 训练部分；nanochat/tokenizer.py。
@classmethod
def train_from_iterator(cls, text_iterator, vocab_size):
    # ① 为特殊 token 预留词表位置。实现：nanochat/tokenizer.py。
    vocab_size_no_special = vocab_size - len(SPECIAL_TOKENS)
    assert vocab_size_no_special >= 256

    # ② 使用 rustbpe 训练普通 token 的字节片段及合并优先级。
    tokenizer = rustbpe.Tokenizer()
    tokenizer.train_from_iterator(text_iterator, vocab_size_no_special, pattern=SPLIT_PATTERN)

    # ③ 导出规则，供 tiktoken 编码使用。
    pattern = tokenizer.get_pattern()
    mergeable_ranks = {bytes(k): v for k, v in tokenizer.get_mergeable_ranks()}

    ...  # Encoding 构造见下一小节。
```

训练入口为 [tok_train.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/tok_train.py)，分词规则和封装见 [tokenizer.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/tokenizer.py)。Tokenizer 在准备阶段训练；后续模型训练和推理加载同一份分词器，编码每条样本时不重新学习合并规则。

**输入与输出示例**：

```python
# 输入：训练文本与目标词表大小（含特殊 token）。
text_iterator = iter(["abab", "abab"])
vocab_size = 267

# 输出：预切分规则，以及普通 token 的字节片段 → 合并优先级 / ID。
pattern = SPLIT_PATTERN
# 以下仅展示部分词表，具体 ID 和合并结果为示意。
mergeable_ranks = {
    b"a": 97,
    b"b": 98,
    b"ab": 256,
    b"abab": 257,
}
```

### 词表：token、字节片段与 ID

词表规定哪些片段可以作为 token，以及每个 token 对应哪个整数 ID。

| 组成 | 存储形式 | 用途 |
|---|---|---|
| 普通 token | `mergeable_ranks: dict[bytes, int]` | 将字节片段映射为合并优先级，同时作为普通 token ID |
| 特殊 token | `special_tokens: dict[str, int]` | 表示 BOS、角色边界、工具调用及工具结果边界 |
| 预切分规则 | `pat_str` | 决定文本先如何划分，再执行 BPE |

`--vocab-size` 默认是 32768，包含普通 token 和特殊 token。特殊 token 的 ID 接在普通 token 后面，它们由代码指定，不参与普通 BPE 合并训练。

**核心逻辑代码**：

以下为同一方法的 Encoding 构造部分，省略前面的训练代码：

```python
# RustBPETokenizer.train_from_iterator()：Encoding 构造部分；nanochat/tokenizer.py。
@classmethod
def train_from_iterator(cls, text_iterator, vocab_size):
    ...  # 前面的 BPE 训练生成 pattern 和 mergeable_ranks。

    # ① 给特殊 token 分配独立 ID。实现：nanochat/tokenizer.py。
    tokens_offset = len(mergeable_ranks)
    special_tokens = {name: tokens_offset + i for i, name in enumerate(SPECIAL_TOKENS)}

    # ② 组合预切分规则、普通词表与特殊词表，创建编码器。
    enc = tiktoken.Encoding(
        name="rustbpe",
        pat_str=pattern,
        mergeable_ranks=mergeable_ranks,
        special_tokens=special_tokens,
    )

    return cls(enc, "<|bos|>")
```

训练结果保存为 `tokenizer/tokenizer.pkl`。`tokenizer/token_bytes.pt` 另行记录各 ID 对应的字节数，供 BPB 评测使用，不存储模型向量。模型中的 Embedding 则为每个 token ID 保存一个可训练向量。

**输入与输出示例**：

```python
# 输出：普通 token 的 ID 保持不变，特殊 token 从 258 开始分配。
special_tokens = {
    "<|bos|>": 258,
    "<|user_start|>": 259,
    "<|user_end|>": 260,
    "<|assistant_start|>": 261,
    "<|assistant_end|>": 262,
    "<|python_start|>": 263,
    "<|python_end|>": 264,
    "<|output_start|>": 265,
    "<|output_end|>": 266,
}
```

### 编码与解码：文本和 token IDs

`encode()` 将正文转换为 ID 列表，`decode()` 将 ID 序列还原为文本。一个中文字符的 UTF-8 字节可能分属多个 token，解码完整 token 序列可还原文本；读取单个 token 的原始字节使用 `decode_single_token_bytes()`。

**核心逻辑代码**：

```python
# ① 加载已训练的分词器。实现：nanochat/tokenizer.py → get_tokenizer()。
tokenizer = get_tokenizer()

# ② 编码正文，返回 list[int]；具体 ID 由已训练词表决定。
ids = tokenizer.encode("Cats sit on mats")

# ③ 解码整段 token IDs，还原正文。
text = tokenizer.decode(ids)  # "Cats sit on mats"

# ④ 查询特殊 token 的 ID，不通过正文编码推断。
bos_id = tokenizer.get_bos_token_id()
assistant_start_id = tokenizer.encode_special("<|assistant_start|>")
```

<a id="conversation-encoding"></a>

### 对话编码：特殊 token 与监督 mask

`render_conversation()` 在正文编码外添加对话结构，并返回与 IDs 等长的监督 mask。沿用 System 二的句子生成任务，标准回答为 `Cats sit on mats`。

下面的教学示例统一设 `Cats=12、sit=45、on=78、mats=90`；问题正文简化为两个 token，ID 为 `200、201`。特殊标记设为 `BOS=243、user_start=240、user_end=244、assistant_start=241、assistant_end=242`。这些编号仅用于说明数据关系，实际 nanochat 的切分与 ID 由训练后的 Tokenizer 决定。

**核心逻辑代码**：

```python
# ① 用 Q0 展示上文 conversation 的统一格式；nanochat/tokenizer.py。
Q0 = {"messages": [
    {"role": "user", "content": "Write a sentence about cats sitting on mats."},
    {"role": "assistant", "content": "Cats sit on mats"},
]}

# ② 添加 BOS、角色和结束标记，生成监督 mask。
ids, mask = tokenizer.render_conversation(Q0)

# ids =  [243, 240, 200, 201, 244, 241, 12, 45, 78, 90, 242]
# mask = [  0,   0,   0,   0,   0,   0,  1,  1,  1,  1,   1]
```

可读序列为：

```text
<|bos|><|user_start|>Write a sentence about cats sitting on mats.<|user_end|>
<|assistant_start|>Cats sit on mats<|assistant_end|>
```

| 内容 | 监督 mask |
|---|---|
| BOS、用户消息、角色起始标记 | 0 |
| assistant 答案及 assistant 结束标记 | 1 |
| assistant 生成的工具表达式及其调用边界 | 1 |
| 工具返回及其输出边界 | 0 |

<a id="model-inputs"></a>

## 模型输入与监督目标

<a id="token-packing"></a>

### token 打包和补齐

以 SFT dataloader 为例，选中的完整对话拼成一行，剩余位置用 BOS 补齐，mask 同步拼接并补 0。每行容量为 `max_seq_len + 1`。以下展示两条对话能放入同一行的情况，省略 best-fit 候选选择。

**核心逻辑代码**：

```python
# ① 沿用上面的 Q0，再编码一条问候对话。
conversation_a = Q0
conversation_b = {"messages": [
    {"role": "user", "content": "Hi"},
    {"role": "assistant", "content": "Hello"},
]}
ids_a, mask_a = tokenizer.render_conversation(conversation_a)
ids_b, mask_b = tokenizer.render_conversation(conversation_b)

# ② 将选中的完整对话及 mask 拼入一行。
row_capacity = args.max_seq_len + 1
row = ids_a + ids_b
mask_row = mask_a + mask_b
assert len(row) <= row_capacity

# ③ 补齐剩余位置。
remaining = row_capacity - len(row)
bos_id = tokenizer.get_bos_token_id()
row.extend([bos_id] * remaining)
mask_row.extend([0] * remaining)

# ④ 收集为 batch；此处只展示一行，B=1。
rows = [row]
mask_rows = [mask_row]
```

实际 dataloader 收集 `device_batch_size` 行。预训练的文档裁切和 RL 的回答补齐见各自的 [执行流程](llm_workflow_nanochat.md)。

**输入与输出示例**：

```python
# 输入：ids_a / mask_a 承接 Q0；问候正文 Hi、Hello 的教学 ID 为 103、105。
ids_a = [243, 240, 200, 201, 244, 241, 12, 45, 78, 90, 242]
mask_a = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1]
ids_b = [243, 240, 103, 244, 241, 105, 242]
mask_b = [0, 0, 0, 0, 0, 1, 1]
row_capacity = 19
bos_id = 243

# 输出：两条对话拼接后补一个 BOS；本例 B=1，移位前共有 19 个位置。
rows = [[243, 240, 200, 201, 244, 241, 12, 45, 78, 90, 242,
         243, 240, 103, 244, 241, 105, 242, 243]]
mask_rows = [[0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
              0, 0, 0, 0, 0, 1, 1, 0]]
```

<a id="token-to-tensor"></a>

### token 转换为 Tensor

**核心逻辑代码**：

```python
# ① 将 dataloader 打包或补齐后的 ID 列表 rows 转换为整数 Tensor。
# B 为 batch 中的序列数，T 为模型输入长度；省略设备传输。
batch_tensor = torch.tensor(rows, dtype=torch.long)  # [B, T+1]
```

**输入与输出示例**：

```python
# 输入：沿用上面的 rows，B=1、T=18。
# 输出：相同 ID 数值组成的整数 Tensor，形状为 [1, 19]。
batch_tensor = torch.tensor(rows, dtype=torch.long)
# batch_tensor.shape → torch.Size([1, 19])
# batch_tensor.dtype → torch.int64
```

<a id="next-token-targets"></a>

### 下一 token 目标与张量形状

模型在位置 t 根据当前及之前的输入预测位置 t+1。若每行准备 T+1 个 token，则切片后 inputs 和 targets 均为 T 个位置：

以下接续上面的 `batch_tensor`；`mask_rows` 为对应的监督 mask，预训练在此示意中设为 `None`。

**核心逻辑代码**：

```python
# ② 当前 token 作为输入，下一个 token 作为目标。
inputs = batch_tensor[:, :-1]           # [B, T]
targets = batch_tensor[:, 1:].clone()   # [B, T]

# ③ 存在监督 mask 时，按目标侧对齐并屏蔽；预训练跳过此步。
if mask_rows is not None:
    mask_tensor = torch.tensor(mask_rows, dtype=torch.int8)
    targets[mask_tensor[:, 1:] == 0] = -1

# ④ GPT 接收 token IDs 的整数 Tensor，内部通过 Embedding 转为浮点向量。
loss = model(inputs, targets)
```

沿用上面的 SFT 行，移位与屏蔽后的结果为：

```python
# inputs / targets 均为 [1,18]；只保留两个回答及其结束标记对应的目标。
inputs = [[243, 240, 200, 201, 244, 241, 12, 45, 78, 90, 242,
           243, 240, 103, 244, 241, 105, 242]]
targets = [[-1, -1, -1, -1, -1, 12, 45, 78, 90, 242, -1,
            -1, -1, -1, -1, 105, 242, -1]]
```

第一条对话中，`Cats、sit、on` 三个位置的目标仍为 `sit、on、mats`，IDs 为 `[45,78,90]`；对话前文作为上下文参与计算。

上述移位关系适用于各阶段；mask 的来源和序列如何形成由阶段决定：

- [预训练流程](llm_workflow_nanochat.md#pretrain-flow)：读取文档、编码、打包与裁切，构造下一 token 目标，并记录近似恢复位置。
- [SFT 流程](llm_workflow_nanochat.md#sft-flow)：读取标准对话、打包与补齐，使用对话监督 mask 屏蔽目标。
- [RL 流程](llm_workflow_nanochat.md#rl-targets)：模型采样回答，计算 reward、advantage，按同题最长序列补齐，排除 prompt、工具注入与 padding。

# GPT Model：模型整体结构与 Forward 调用链

GPT 采用 decoder-only Transformer，将 token 序列映射为下一 token 的预测分数。

源码：[gpt.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py)。

## GPT：完整模型

### 概要结构

模型主干由 Embedding、Transformer Blocks 和输出投影组成：

```text
GPT(nn.Module)                              # Decoder-only Transformer
├── transformer.wte: Embedding              # Token embedding
├── transformer.h: ModuleList[Block × L]     # Transformer layer stack，L 为层数
│   └── Block                              # Transformer layer
│       ├── attn: CausalSelfAttention       # Multi-head self-attention，包含 Q/K/V、RoPE、causal mask、softmax 和 V 加权汇总
│       └── mlp: MLP                       # Feed-forward network，包含 Linear → ReLU² → Linear
└── lm_head: Linear                         # Language modeling head，输出 logits
```

<a id="gpt-init"></a>

## GPTConfig：模型配置与初始化

`GPTConfig` 集中配置模型层数、维度、词表和注意力窗口。

### 参数与模型概念

| 参数 | 对应模型概念 | 关系 |
|---|---|---|
| `n_layer` | Transformer layer stack | 决定 `transformer.h` 中有多少个 `Block` |
| `n_embd` | Hidden dimension | 决定 embedding、Block 输入输出的宽度 `C`，以及 MLP 的维度 `C → 4C → C` |
| `n_head` | Attention heads | 决定每层的 Query head 数 `H`；`head_dim = n_embd / n_head` |
| `n_kv_head` | K/V 与 GQA | 决定 KV head 数 `Hkv`；小于 Query head 数时，多个 Query head 共享 K/V |
| `vocab_size` | Token embedding、lm_head | 决定可表示的 token 数 `V` 和最终 logits 的词表维度 |
| `sequence_len` | Context window、RoPE | 用于计算 attention 窗口大小和 RoPE 缓存容量 |
| `window_pattern` | Causal self-attention | 决定各层使用长窗口还是短窗口，末层固定为长窗口 |

### 默认参数与模型结构

以该提交中 `GPTConfig` 的默认参数为例：

```python
config = GPTConfig(
    n_layer=12,
    n_embd=768,
    n_head=6,
    n_kv_head=6,
    vocab_size=32768,
    sequence_len=2048,
    window_pattern="SSSL",
)
```

对应的模型主干结构为：

```text
GPT
├── config: GPTConfig                          # Attention 窗口配置：sequence_len=2048，按 SSSL 排列长短窗口
├── transformer.wte: Embedding(32768, 768)      # vocab_size=32768，n_embd=768
├── transformer.h: ModuleList[Block × 12]       # n_layer=12
│   └── Block
│       ├── attn: CausalSelfAttention          # n_head=6：6 个 Query head；n_kv_head=6：6 组 K/V head
│       │   ├── c_q / c_k / c_v: Linear(768, 768)
│       │   │                                 # 每个 head 为 768 / 6 = 128 维
│       │   └── c_proj: Linear(768, 768)        # Attention output projection：(6 × 128) → 768
│       └── mlp: MLP
│           ├── c_fc: Linear(768, 3072)        # MLP 代码固定扩展 4 倍：768 → 4 × 768 = 3072
│           └── c_proj: Linear(3072, 768)      # MLP 投影回 hidden dimension：3072 → 768
└── lm_head: Linear(768, 32768)                 # 将 768 维 hidden states 映射为词表中 32768 个 token 的 logits
```

该默认配置共 `286,261,730` 个参数（约 286M），包含 6 组 Value Embedding。训练脚本会按运行参数覆盖默认配置。

### 训练脚本中的构造与初始化

完整初始化顺序及学习率配置见 [预训练流程](llm_workflow_nanochat.md#pretrain-flow)，源码见 [base_train.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py)。

```python
# 训练参数覆盖 GPTConfig 默认配置：n_layer 由 depth 指定。
# hidden dimension 根据 depth × aspect_ratio 计算，并对齐到 head_dim 的整数倍。
# Query head 和 KV head 数均为 model_dim / head_dim；词表大小从 tokenizer 读取。
model = build_model_meta(args.depth)  # 按训练参数在 meta device 上构造模型
model.to_empty(device=device)        # 分配实际存储
model.init_weights()                 # 初始化参数和 RoPE 缓存
```

## Token Embedding：transformer.wte

Token Embedding 使用可训练的向量表，每个 token ID 对应一个向量。输入 token IDs 通过查表转换为向量序列，作为 Transformer 的初始输入表示。

```python
# transformer.wte 是 nn.Embedding 的实例。
# 默认配置下，transformer.wte.weight 为 [32768,768]，每行保存一个 token 的 768 维向量。
# GPT.forward() 中按输入 token IDs 查表，将 [B,T] 转换为初始 hidden states [B,T,768]。
x = self.transformer.wte(idx)  # [B,T] → [B,T,768]

# 上述调用执行 nn.Embedding.forward()，默认调用参数下的核心逻辑如下。
def forward(self, input):
    # 按 token ID 从 weight 取出对应行，将 [B,T] 的 IDs 转为 [B,T,768] 的 hidden states。
    return F.embedding(input, self.weight)
```

<a id="gpt-forward"></a>

## GPT.forward()：输入 → Blocks → lm_head → logits / loss

`GPT.forward()` 返回各位置的下一 token logits；传入 `targets` 时返回 loss。以下为前向计算伪代码。

```python
# idx：输入 token IDs。
# targets：可选的目标 token IDs；传入时返回 loss，未传入时返回 logits。
# kv_cache：推理时可选的缓存，用于复用历史 K/V。
# GPT.forward()：前向计算伪代码；nanochat/gpt.py。
def forward(self, idx, targets=None, kv_cache=None, loss_reduction="mean"):
    x = TokenEmbedding(idx)                # token IDs → hidden states，Token Embedding 小节
    x = Smear(RMSNorm(x))                   # 归一化后混入前一 token 的 embedding，本项目的结构扩展
    x0 = x                                 # 保留初始表示，供各层 Residual mixing 使用

    for block in Blocks:                   # 依次经过各个 Transformer layer，Block.forward() 小节
        x = ResidualMixing(x, x0)          # 混合当前表示与初始表示，本项目的结构扩展
        x = block(x, kv_cache)             # 调用当前 Block 实例，内部执行 forward，见 Transformer Block
        ...                               # 保存中间层输出供 Backout 使用

    x = Backout(x)                         # 减去加权的中间层输出，本项目的结构扩展
    logits = lm_head(RMSNorm(x))            # hidden states → 词表 logits，lm_head 小节
    logits = Softcap(FP32(logits[..., :self.config.vocab_size]))  # 裁回实际词表并限制数值幅度，lm_head 小节

    if targets is not None:
        # 返回给 Training Loop 的 loss = model(idx=x, targets=y)，随后执行 loss.backward() 和 optimizer.step()，见 Training Implementation。
        return CrossEntropy(logits, targets)
    # 推理链路：返回 logits → Engine 采样下一个 token → 将新 token 输入模型，继续 Decode，见 Inference Implementation。
    return logits
```

Block 与 Loss 的内部实现分别见 Transformer Block、Training Implementation。

## Language Modeling Head：lm_head

`lm_head` 将每个位置的 hidden states 线性投影为词表 logits，用于计算 loss 或采样。

沿用 `Cats sit on`，模型得到最后一个位置 `on` 的 hidden states 后，lm_head 为 `mats`、`chairs` 等词表候选输出 logit，供后续计算 loss 或选择下一 token。

数据结构（默认配置）：

```text
lm_head: Linear(768, 32768)          # GPT : lm_head = 1:1
└── weight [32768,768]              # 每个候选 token 对应一行投影权重
```

核心代码：

```python
# lm_head 使用项目自定义的 Linear。
# GPT.forward() 中调用 lm_head。
logits = self.lm_head(x)  # [B,T,768] → [B,T,32768]

# 上述调用执行 Linear.forward()。
def forward(self, x):
    # 为词表中的每个候选 token 计算预测分数，使用可训练权重做线性投影。
    return F.linear(x, self.weight.to(dtype=x.dtype))
```

```python
# GPT.forward()：词表裁切与 Softcap，省略 loss 分支；nanochat/gpt.py。
def forward(self, idx, targets=None, kv_cache=None, loss_reduction="mean"):
    ...  # 前面的计算得到 hidden states x。
    logits = self.lm_head(x)
    # GPT.forward() 随后处理 logits。
    # 去掉词表对齐产生的额外输出。
    logits = logits[..., :self.config.vocab_size]
    # 控制分数的数值范围，使用 FP32 softcap。
    logits = 15 * torch.tanh(logits.float() / 15)
    return logits
```

## 本项目的结构扩展

| 扩展 | 对应属性 | 作用位置与功能 |
|---|---|---|
| Value Embedding | `value_embeds`、`attn.ve_gate` | 在交替的 attention 层中，根据 token IDs 查表，经 gate 加入 V；末层始终启用 |
| Smear | `smear_gate`、`smear_lambda` | 在进入 Layer stack 前，将前一 token 的归一化 embedding 经 gate 混入当前位置；decode 时通过 KV Cache 保存前一 embedding |
| Residual mixing | `resid_lambdas`、`x0_lambdas` | 在每个 Block 前，将当前 hidden states 与进入 Layer stack 前的初始表示 `x0` 加权组合 |
| Backout | `backout_lambda` | 在 Layer stack 结束后、final RMSNorm 前，减去加权的中间层输出 `x_backout` |

# Transformer Block：Attention、MLP、Norm、Residual

每个 Block 通过 Attention 汇集上下文，再由 MLP 加工 token 特征。

源码：[gpt.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py)。

## Block.forward()：Layer stack、Norm 与 Residual

Attention 和 MLP 前均执行 RMSNorm，输出通过残差连接加回输入。

```text
输入：Token embedding → RMSNorm → Smear → x [B,T,768]

transformer.h: ModuleList                      # 每个 Block 前先执行 Residual mixing
├── [0]: Block                                # 第 1 层，接收输入 x
│   ├── attn: CausalSelfAttention              # x ← x + attn(RMSNorm(x))
│   └── mlp: MLP                              # x ← x + mlp(RMSNorm(x))，输出传给 [1]
├── [1]: Block                                # 第 2 层，接收 [0] 的输出
│   ├── attn: CausalSelfAttention              # x ← x + attn(RMSNorm(x))
│   └── mlp: MLP                              # x ← x + mlp(RMSNorm(x))，输出传给 [2]
├── ...
└── [11]: Block                               # 第 12 层，接收 [10] 的输出
    ├── attn: CausalSelfAttention              # x ← x + attn(RMSNorm(x))
    └── mlp: MLP                              # x ← x + mlp(RMSNorm(x))，输出离开 Layer stack

输出：x [B,T,768] → Backout → Final RMSNorm → lm_head
```

核心调用逻辑（伪代码，省略辅助参数）：

```text
# Layer stack：逐层调用 Block。
for block in Blocks:
    x = ResidualMixing(x, x0)
    x = block(x, kv_cache)             # 内部执行当前 Block 的 forward()
    保存中间层输出供 Backout 使用

# Block.forward()：串联 Attention 和 MLP。
forward(x, kv_cache):
    x = x + attn(norm(x), kv_cache)    # 上下文信息关联，Attention 小节
    x = x + mlp(norm(x))               # 特征加工，MLP 小节
    return x
```

## Transformer layer：Attention（CausalSelfAttention）

因果自注意力让当前位置访问自身及前文。每个 head 独立计算注意力权重并汇总信息，随后合并各 head 的输出。

沿用 `Cats sit on`，处理 `on` 时，各 head 分别用自己的 Q 与 `Cats`、`sit`、`on` 的 K 匹配，再按各自的权重汇总 V。合并后的结果用于更新 `on` 位置的表示，供后续预测 `mats`；各 head 的关注模式由训练学得。

Attention 的数据结构（默认配置）：

```text
# GPTConfig.n_head=6：每层有 6 个 Query head，分别计算关注权重，汇集信息后合并。
attn: CausalSelfAttention                 # Block : attn = 1:1
    ├── layer_idx: i                     # 关联所属 Block 和该层 KV Cache
    ├── c_q: Linear                      # attn : c_q = 1:1
    │   └── weight [768,768]
    │       └── 6 份 [128,768]           # 一次 projection → 6 个 Query head
    ├── c_k: Linear
    │   └── weight [768,768]
    │       └── 6 份 [128,768]           # 一次 projection → 6 个 Key head
    ├── c_v: Linear
    │   └── weight [768,768]
    │       └── 6 份 [128,768]           # 一次 projection → 6 个 Value head
    └── c_proj: Linear
        └── weight [768,768]             # 合并 6 个 head 后做 output projection
```

核心代码：

```python
# CausalSelfAttention.forward() 包含有、无 KV Cache 两条路径。
# Block.forward() 中的调用：attention 输出加回输入。
x = x + self.attn(norm(x), ve, cos_sin, window_size, kv_cache)

# self.attn 是 CausalSelfAttention 实例，上述调用执行该实例的 forward()。
def forward(self, x, ve, cos_sin, window_size, kv_cache):
    B, T, C = x.size()
    # 通过三个可训练的 Linear 对输入做线性投影，生成 Q/K/V，再用 view(...) 按 head 组织。
    # Q：[B,T,H,D]；K/V：[B,T,Hkv,D]；D = C / H。
    q = self.c_q(x).view(B, T, self.n_head, self.head_dim)
    k = self.c_k(x).view(B, T, self.n_kv_head, self.head_dim)
    v = self.c_v(x).view(B, T, self.n_kv_head, self.head_dim)

    # 启用 Value Embedding 的层，将传入的 ve 经 gate 加入 V。
    if ve is not None:
        ve = ve.view(B, T, self.n_kv_head, self.head_dim)
        gate = 3 * torch.sigmoid(self.ve_gate(x[..., :self.ve_gate_channels]))
        v = v + gate.unsqueeze(-1) * ve

    # 对 Q/K 应用 RoPE，引入位置信息。
    cos, sin = cos_sin
    q, k = apply_rotary_emb(q, cos, sin), apply_rotary_emb(k, cos, sin)
    # 对每个 head 的 Q/K 做 RMSNorm，再缩放以提高 attention scores 的区分度。
    q, k = norm(q), norm(k)
    q = q * 1.2
    k = k * 1.2

    # flash_attn 内部：scaled QK scores → causal/window mask → softmax → V 加权汇总。
    if kv_cache is None:
        # 无缓存：使用本次输入的 Q/K/V 计算 attention。
        y = flash_attn.flash_attn_func(q, k, v, causal=True, window_size=window_size)
    else:
        k_cache, v_cache = kv_cache.get_layer_cache(self.layer_idx)
        # 有缓存：追加当前 K/V，用当前 Q 与缓存中全部可见 K/V 计算 attention。
        y = flash_attn.flash_attn_with_kvcache(
            q, k_cache, v_cache,
            k=k, v=v,
            cache_seqlens=kv_cache.cache_seqlens,
            causal=True,
            window_size=window_size,
        )
        # 所有层处理完当前输入后，统一推进缓存位置。
        if self.layer_idx == kv_cache.n_layers - 1:
            kv_cache.advance(T)

    # 合并各 head：[B,T,6,128] → [B,T,768]。
    y = y.contiguous().view(B, T, -1)
    # Output projection，将合并后的表示映射回 hidden dimension。
    y = self.c_proj(y)
    return y
```

推理时的缓存读写与注意力计算展开见 [KV Cache：缓存读写](#kv-cache)。

## Transformer layer：MLP

MLP 通过两层线性投影与 ReLU² 激活，进一步组合、转换 Attention 已汇集的上下文信息，供后续理解与预测使用。它对每个 token 独立执行变换，各位置共用同一组参数。

沿用原理篇的语义示例 `The cat sits on the mat. It looks ...`：处理 `looks` 时，MLP 加工 Attention 已汇集的上下文特征，为 `sleepy`、`comfortable` 等后续预测提供依据。

```python
# MLP 对每个 token 的 hidden states 独立执行非线性变换。
# 输入输出均为 [B,T,C]，默认 C=768。
# Block.forward() 调用 self.mlp 加工已汇集的上下文信息，并将结果加回原表示。
x = x + self.mlp(norm(x))

# self.mlp 是 MLP 实例，调用时执行下面的 forward()。
def forward(self, x):
    # 提取特征，使用可训练的 Linear 做线性投影。
    x = self.c_fc(x)
    # 筛选和强化特征，使用 ReLU² activation。
    x = F.relu(x).square()
    # 整合为 token 的更新信息，使用 Linear 投影回 hidden dimension。
    x = self.c_proj(x)
    return x
```

# Training Implementation：Loss、Backward、Optimizer

一次参数更新依次执行 loss 计算、梯度累积、optimizer 更新和梯度清空。各阶段的调用见 [预训练](llm_workflow_nanochat.md#pretrain-flow)、[SFT](llm_workflow_nanochat.md#sft-flow) 和 [RL](llm_workflow_nanochat.md#rl-flow) 流程。

```python
# Training Loop：摘自 scripts/base_train.py 的单步训练代码。
for micro_step in range(grad_accum_steps):
    # 1. Forward + Loss：调用 GPT.forward()，执行交叉熵计算并返回 loss，详见下方 Loss 小节。
    loss = model(idx=x, targets=y)

    # 2. Backward：根据返回的 loss，计算并累积参数梯度，详见下方 Backward 小节。
    loss = loss / grad_accum_steps
    loss.backward()

    x, y, dataloader_state_dict = next(train_loader)

# 3. Optimizer：读取累积的梯度，更新模型参数，详见下方 Optimizer 小节。
optimizer.step()
model.zero_grad(set_to_none=True)  # 清空梯度，开始下一步。
```

```text
# 一次参数更新使用的 token 总数：
# 每卡每小批的序列数 × 每条序列的 token 数 × 训练进程数 × 累积的小批次数。
total_batch_size = device_batch_size × T × world_size × grad_accum_steps
```

## Loss：交叉熵与目标屏蔽

交叉熵衡量目标 token 的负对数概率：目标概率越高，loss 越小。`targets=-1` 的位置不计入 loss。

```python
# GPT.forward()：Loss 分支；nanochat/gpt.py。
def forward(self, idx, targets=None, kv_cache=None, loss_reduction="mean"):
    ...  # 前面的计算得到 logits。
    # 对应 GPT.forward() 调用链中的 return CrossEntropy(logits, targets)，将 loss 返回给 Training Loop。
    if targets is not None:
        loss = F.cross_entropy(
            logits.view(-1, logits.size(-1)),  # 每个位置对词表中各 token 的预测分数
            targets.view(-1),                 # 每个位置对应的目标 token ID
            ignore_index=-1,                  # 跳过不参与训练的目标位置
            reduction=loss_reduction,         # 默认 mean，汇总为平均 loss
        )
        return loss
    return logits

# 交叉熵原理伪代码，仅展示 reduction="mean"。
def cross_entropy(logits, targets):
    # 将预测分数转为对数概率；用 log-softmax 避免先算概率再取对数带来的数值问题。
    log_probs = log_softmax(logits, dim=-1)

    # targets=-1 的位置不参与 loss 计算。
    valid = targets != -1

    # 每个位置只取正确 token 对应的对数概率。
    target_log_probs = log_probs[valid, targets[valid]]

    # 目标 token 的概率越低，loss 越大；默认取有效位置的平均值。
    return -target_log_probs.mean()
```

梯度计算与参数更新见 [Backward](#optimizer-update)。

<a id="optimizer-update"></a>

## Backward：计算图与梯度累积

**反向计算**：Forward 时，PyTorch 记录各运算之间的依赖，形成计算图。调用 `loss.backward()` 后，从 loss 开始沿计算图反向计算各参数的梯度，累加到 `.grad` 中。

```python
# scripts/base_train.py 中的调用入口；backward() 由 PyTorch 实现。
loss.backward()

# 以下为内部逻辑伪代码，针对标量 loss。
def backward(loss):
    grads = zeros_for_graph(loss)  # 本次反向计算中，各张量收到的梯度初始为 0。
    grads[loss] = 1                # loss 对自身的导数为 1，作为反向传播起点。

    # 按前向计算的相反依赖顺序，从 loss 逐步传回 lm_head、Blocks、Embedding。
    for op in reverse_topological_order(loss):
        # 链式法则：用输出的梯度和当前运算的局部导数，计算输入的梯度。
        input_grads = op.backward(grads[op.output])
        for tensor, grad in zip(op.inputs, input_grads):
            grads[tensor] += grad  # 同一张量经多条路径影响 loss 时，将各路径的梯度相加。

    for parameter in trainable_leaf_parameters(loss):
        if parameter.grad is None:
            parameter.grad = grads[parameter]
        else:
            parameter.grad += grads[parameter]  # 与之前 backward() 留下的梯度累加。
```

**梯度累积**：连续处理几个小批，每批计算一次 loss 并调用 `backward()`，期间不清空 `.grad`。累积完成后，调用 `optimizer.step()` 更新一次参数，再清空梯度。

```python
# Training Loop 中与梯度累积相关的核心代码。
for micro_step in range(grad_accum_steps):
    ...  # 计算当前小批的 loss，并除以 grad_accum_steps。
    loss.backward()  # 循环内：向 .grad 累加梯度。

optimizer.step()                      # 循环外：更新一次参数。
model.zero_grad(set_to_none=True)     # 循环外：清空梯度。
```

## Optimizer：参数分组、AdamW 与 Muon

`MuonAdamW` 读取参数的 `.grad`，结合历史状态更新权重；不同参数分别采用 AdamW 或 Muon。

源码：[optim.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/optim.py)、[GPT.setup_optimizer](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py)。

<a id="optimizer-setup"></a>

**参数分组与初始化**：训练前指定各组算法、学习率及衰减配置；Muon 按矩阵形状分组以批量处理。

| 参数组 | 更新算法 | 状态组织 |
|---|---|---|
| Transformer Block 中的矩阵参数 | Muon | 同形状矩阵堆叠处理；整组的更新记录存放在组内首个参数对应的状态中 |
| token embedding、Value Embedding、lm_head | AdamW | 每个参数记录梯度及梯度平方的移动平均，分别称为一阶矩和二阶矩 |
| resid/x0、smear、backout 参数 | AdamW | 单独参数组及学习率/衰减配置 |

```python
# 训练开始前创建一次优化器，直接引用模型参数；更新记录在首次使用时初始化。
optimizer = model.setup_optimizer(...)
# 各组保存 kind、lr、initial_lr、weight_decay 和动量配置等。
# setup_optimizer(weight_decay=...) 的入参用于 Muon 组，AdamW 各组在方法内配置自己的衰减值。
```

优化器的数据结构：

```text
训练脚本
├── model: GPT
│   └── Parameter → .grad（由多次 backward 累积）
└── optimizer: MuonAdamW
    ├── param_groups: list[dict]
    │   ├── params: 模型 Parameter 的引用
    │   ├── kind: adamw / muon
    │   └── lr / initial_lr / weight_decay / betas / momentum 等
    └── state
        ├── AdamW：step / exp_avg / exp_avg_sq
        └── Muon：momentum_buffer / second_momentum_buffer
```

**一次参数更新**：`optimizer.step()` 按参数组读取梯度、执行算法并写回参数。多卡时额外合并梯度、同步参数；以下展示单卡路径。

```python
# Training Loop 中的调用入口。
optimizer.step()

# MuonAdamW.step() 的单卡路径。
def step(self):
    rank, world_size = 0, 1

    # 1. 读取各参数组的 .grad。
    reduce_infos = []
    for group in self.param_groups:
        if group["kind"] == "adamw":
            info = self._reduce_adamw(group, world_size)  # 读取 .grad。
        elif group["kind"] == "muon":
            info = self._reduce_muon(group, world_size)   # 读取 .grad。
        else:
            raise ValueError(f"Unknown optimizer kind: {group['kind']}")
        reduce_infos.append(info)

    # 2. 按各组算法更新参数。
    gather_list = []
    for group, info in zip(self.param_groups, reduce_infos):
        if group["kind"] == "adamw":
            self._compute_adamw(group, info, gather_list, rank, world_size)
        elif group["kind"] == "muon":
            self._compute_muon(group, info, gather_list, rank)

    # 3. 将更新结果写回模型参数。
    self._finish_gathers(gather_list)
```

**AdamW 更新**：用梯度及梯度平方的移动平均调整更新幅度，独立施加权重衰减。

```python
# adamw_step_fused()：简化计算伪代码，省略状态回写；nanochat/optim.py。
def adamw_step_fused(p, grad, m, v, t, lr, beta1, beta2, eps, weight_decay):
    # _compute_adamw() → adamw_step_fused() 的核心计算，省略精度转换和状态写回。
    # p：参数；grad：本次更新使用的梯度；m/v：跨训练步保留的历史记录；t：更新次数。
    p = p * (1 - lr * weight_decay)             # 独立应用权重衰减。
    m = beta1 * m + (1 - beta1) * grad           # 梯度的移动平均：平滑更新方向。
    v = beta2 * v + (1 - beta2) * grad.square()  # 梯度平方的移动平均：估计梯度大小。
    m_hat = m / (1 - beta1 ** t)                # 修正初始记录为 0 带来的偏差。
    v_hat = v / (1 - beta2 ** t)
    p = p - lr * m_hat / (sqrt(v_hat) + eps)     # 按历史梯度大小调整更新幅度。

    return p, m, v
```

**Muon 更新**：针对矩阵参数，先结合当前梯度与历史梯度形成更新方向，再用近似正交化处理，减少更新过度集中在少数矩阵方向上的情况。本项目还加入行尺度调整、更新幅度调整和条件权重衰减。

```python
# muon_step_fused()：简化计算伪代码；nanochat/optim.py。
def muon_step_fused(p, grad, m, second_momentum_buffer, lr, momentum,
                    beta2, weight_decay, ns_steps):
    # _compute_muon() → muon_step_fused() 的内部逻辑伪代码。
    # 同形状矩阵堆叠处理；以下辅助函数名仅用于概括源码中的计算步骤。
    m = momentum * m + (1 - momentum) * grad
    update = (1 - momentum) * grad + momentum * m  # 结合当前梯度与历史记录。
    update = EqualizeRowNorms(update)              # 调整各行的尺度。
    update = PolarExpress(update, ns_steps)        # 迭代近似正交化。
    update = Renormalize(update)                   # 调整整个更新矩阵的大小。
    update = VarianceRescale(update, second_momentum_buffer, beta2)
    # 上一步更新二阶历史记录，并据此调整更新幅度。
    mask = (update * p) >= 0                       # 更新方向与参数同号时应用衰减。
    p = p - lr * update - lr * weight_decay * p * mask
    # 此处 lr 已按矩阵形状调整；更新后的参数和历史记录保留到后续训练步。

    return p, m
```

<a id="inference-implementation"></a>

# Inference Implementation：生成与状态管理

`Engine.generate()` 完成流式生成。调用顺序见 [推理流程](llm_workflow_nanochat.md#inference-flow)，源码见 [engine.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/engine.py)。

## Engine.generate()：生成主线

```text
Engine.generate()
├── 创建 KV Cache
├── Prefill：处理完整 prompt，取得首次 logits
└── Decode 循环
    ├── 检查长度与完成状态
    ├── Sampling：选择候选 token
    ├── RowState：记录各回答的完成状态
    ├── yield：输出 token 与 mask
    └── 模型前向：输入新 token，复用缓存计算下一轮 logits
```

`tokens` 为 prompt ID 列表；`num_samples` 为回答数 B。以下主线省略工具注入，每次 yield 的 `token_column / token_masks` 均为长度 B 的列表，模型采样位置的 mask 为 1。

<a id="prefill"></a>
<a id="decode"></a>

**核心逻辑代码**：

```python
@torch.inference_mode()
def generate(self, tokens, num_samples=1, max_tokens=None,
             temperature=1.0, top_k=None, seed=42):
    # ① 创建 prompt 和生成所需的 KV Cache 配置；nanochat/engine.py。
    device, dtype = self.model.get_device(), COMPUTE_DTYPE
    rng = torch.Generator(device=device)
    rng.manual_seed(seed)
    m = self.model.config
    kv_model_kwargs = dict(num_heads=m.n_kv_head, head_dim=m.n_embd // m.n_head,
                           num_layers=m.n_layer)

    # ② Prefill：处理完整 prompt，写入缓存并取最后位置的 logits。
    kv_cache_prefill = KVCache(batch_size=1, seq_len=len(tokens), device=device,
                              dtype=dtype, **kv_model_kwargs)
    ids = torch.tensor([tokens], dtype=torch.long, device=device)
    logits = self.model.forward(ids, kv_cache=kv_cache_prefill)  # [1,T_prompt,V]
    logits = logits[:, -1, :].expand(num_samples, -1)           # [B,V]

    # 将提示缓存复制到各回答的生成缓存。
    capacity = len(tokens) + max_tokens if max_tokens is not None else m.sequence_len
    kv_cache_decode = KVCache(batch_size=num_samples, seq_len=capacity, device=device,
                             dtype=dtype, **kv_model_kwargs)
    kv_cache_decode.prefill(kv_cache_prefill)
    del kv_cache_prefill

    # ③ RowState 记录每个回答的完成状态。
    row_states = [RowState(tokens.copy()) for _ in range(num_samples)]
    assistant_end = self.tokenizer.encode_special("<|assistant_end|>")
    bos = self.tokenizer.get_bos_token_id()
    num_generated = 0
    while True:
        # 检查长度与整批完成状态。
        if max_tokens is not None and num_generated >= max_tokens:
            break
        if all(state.completed for state in row_states):
            break

        # Sampling：按 temperature / top-k 选择候选 token。
        token_column = sample_next_token(logits, rng, temperature, top_k)[:, 0].tolist()
        token_masks = [1] * num_samples
        for state, token in zip(row_states, token_column):
            state.completed |= token in (assistant_end, bos)

        # yield：输出当前 token 与 mask，下一次迭代时继续。
        yield token_column, token_masks
        num_generated += 1

        # 模型前向：输入新 token，复用缓存计算下一轮 logits。
        ids = torch.tensor(token_column, dtype=torch.long, device=device).unsqueeze(1)
        logits = self.model.forward(ids, kv_cache=kv_cache_decode)[:, -1, :]
```

Prefill 得到首次 logits，Decode 循环消费它并持续产生下一轮 logits。每次前向复用历史 K/V，避免重复计算历史 token 的 K/V。`max_tokens` 按输出列计数，包含工具注入位置。

<a id="kv-cache"></a>

## KV Cache：缓存读写

KV Cache 保存每层历史 K/V。新位置仅计算自己的 Q/K/V，通过当前 Q 访问缓存，避免重复计算历史 token 的 K/V。

| 字段 | 形状或类型 | 作用 |
|---|---|---|
| `k_cache / v_cache` | 各 `[L,B,S,Hkv,D]` | 各层、各回答的预分配 K/V 存储 |
| `cache_seqlens` | `[B]`，int32 | 当前已写入的 token 数 |
| `prev_embedding` | `None` 或 `[B,1,C]` | 跨 Decode 步保存 Smear 所需的前一 embedding |

L 为层数，S 为缓存容量，Hkv 为 KV head 数，D 为 head dimension，C 为 hidden dimension。当前 `get_pos()` 使用批内同步位置。

**核心逻辑代码**：

```python
# ① KVCache.__init__()：预分配缓存；nanochat/engine.py。
def __init__(self, batch_size, num_heads, seq_len, head_dim, num_layers, device, dtype):
    self.batch_size = batch_size
    self.n_layers = num_layers
    self.k_cache = torch.zeros(num_layers, batch_size, seq_len, num_heads, head_dim,
                               device=device, dtype=dtype)
    self.v_cache = torch.zeros(num_layers, batch_size, seq_len, num_heads, head_dim,
                               device=device, dtype=dtype)
    self.cache_seqlens = torch.zeros(batch_size, dtype=torch.int32, device=device)
    self.prev_embedding = None

# ② KVCache.get_layer_cache()：取得本层缓存视图；nanochat/engine.py。
def get_layer_cache(self, layer_idx):
    return self.k_cache[layer_idx], self.v_cache[layer_idx]

# ③ KVCache.get_pos()：取得当前已缓存长度；nanochat/engine.py。
def get_pos(self):
    return self.cache_seqlens[0].item()

# ④ KVCache.advance()：所有层写完后推进位置；nanochat/engine.py。
def advance(self, num_tokens):
    self.cache_seqlens += num_tokens
```

```python
# ⑤ KVCache.prefill()：复制提示 K/V、长度和前一 embedding；nanochat/engine.py。
def prefill(self, other):
    pos = other.get_pos()
    self.k_cache[:, :, :pos] = other.k_cache[:, :, :pos]
    self.v_cache[:, :, :pos] = other.v_cache[:, :, :pos]
    self.cache_seqlens.fill_(pos)
    if other.prev_embedding is not None:
        self.prev_embedding = other.prev_embedding.expand(self.batch_size, -1, -1).clone()
```

```python
# ⑥ CausalSelfAttention.forward()：缓存路径，省略 QKV 计算及输出投影；nanochat/gpt.py。
def forward(self, x, ve, cos_sin, window_size, kv_cache):
    B, T, C = x.size()
    ...  # 计算 q、k、v。

    if kv_cache is not None:
        k_cache, v_cache = kv_cache.get_layer_cache(self.layer_idx)
        y = flash_attn.flash_attn_with_kvcache(
            q, k_cache, v_cache, k=k, v=v,
            cache_seqlens=kv_cache.cache_seqlens,
            causal=True, window_size=window_size,
        )
        if self.layer_idx == kv_cache.n_layers - 1:
            kv_cache.advance(T)

    ...  # 合并 heads、输出投影并返回。
```

Smear 同时更新 `prev_embedding`。QKV 计算见 [gpt.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py)，缓存后端见 [flash_attention.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/flash_attention.py)。

<a id="token-sampling"></a>

## Token Sampling：选择下一个 token

输入 logits `[B,V]`，输出候选 token IDs `[B,1]`。temperature=0 采用 Greedy；其余分支按温度缩放分数，再执行概率采样。

**核心逻辑代码**：

```python
# nanochat/engine.py → sample_next_token()。
def sample_next_token(logits, rng, temperature=1.0, top_k=None):
    assert temperature >= 0.0
    # ① Greedy：取最高分 token。
    if temperature == 0.0:
        return torch.argmax(logits, dim=-1, keepdim=True)

    # ② Top-k：筛选候选，缩放并采样。
    if top_k is not None and top_k > 0:
        k = min(top_k, logits.size(-1))
        vals, idx = torch.topk(logits, k, dim=-1)
        probs = F.softmax(vals / temperature, dim=-1)
        choice = torch.multinomial(probs, num_samples=1, generator=rng)
        return idx.gather(1, choice)

    # ③ 全词表：缩放并采样。
    probs = F.softmax(logits / temperature, dim=-1)
    return torch.multinomial(probs, num_samples=1, generator=rng)
```

<a id="row-state"></a>

## RowState：回答状态

每个回答各有一份 `RowState`：

| 字段 | 作用 |
|---|---|
| `current_tokens` | prompt 及本轮已输出的 token |
| `forced_tokens` | 等待注入的工具返回 token 队列 |
| `in_python_block / python_expr_tokens` | 工具表达式的收集状态与内容 |
| `completed` | 是否遇到 assistant 结束标记或 BOS |
