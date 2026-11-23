---
title: "nanochat: Core LLM Architecture and Implementation"
date: '2026-05-25'
categories:
  - AI
weight: 20
---

# Goal

Using nanochat's source code, we examine how its data, model, training, and generation components are organized and implemented:

- Data processing: Byte-level BPE, vocabulary layout, conversation encoding, token packing, and supervised targets.
- Model computation: `GPTConfig`, `GPT.forward()`, Transformer blocks, attention, and the MLP.
- Training: Cross-entropy loss, backpropagation, gradient accumulation, and parameter updates with AdamW and Muon.
- Generation: The inference engine, KV cache, token sampling, and per-sequence state.

<!--more-->

The examples reference the [official karpathy/nanochat repository](https://github.com/karpathy/nanochat) at commit [92d63d4](https://github.com/karpathy/nanochat/commit/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd). Source links point to that commit, and code snippets are excerpts or simplified pseudocode.

For execution order and stage wiring, see [The LLM Workflow: From Training to Inference with nanochat](/zh/docs/ai/llm-workflow-with-nanochat/).

# Core Architecture

All stages share [common.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/common.py) for device setup, precision, distributed execution, and cache directories. [flash_attention.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/flash_attention.py) provides FA3 and SDPA backends, and [fp8.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/fp8.py) provides optional FP8 conversion for linear layers.

```text
nanochat core architecture (components grouped by role and wired together by the workflow)
│
├── Data Pipeline
│   ├── Loading and adaptation       Download, cache, read, normalize formats, and mix tasks
│   ├── Tokenizer                    Byte-level BPE, vocabulary, token IDs, special tokens, and chat encoding
│   └── Model inputs and targets     Tensor shapes, next-token shifting, supervision masks, and ignore_index
│
├── GPT Model — Overall architecture and forward call chain
│   ├── GPTConfig                    Model dimensions, layers, vocabulary, and attention windows
│   ├── GPT                          Connects embeddings, Transformer blocks, and the output layer
│   │   ├── Token / Value Embedding  Token representations and value residuals
│   │   ├── Smear                    Mixes embeddings of adjacent tokens
│   │   ├── Block                    See Transformer Block below
│   │   ├── norm / residual mixing   RMSNorm, per-layer scaling, and subtraction of a mid-stack residual
│   │   └── lm_head                  Vocabulary projection, followed by softcapping and optional cross-entropy
│   ├── Flash Attention wrapper      FA3 / SDPA, with support for attention over a KV cache
│   └── Float8Linear                 Optional FP8 linear layers converted by the pretraining workflow
│
├── Transformer Block — Attention, MLP, Norm, Residual
│   ├── CausalSelfAttention          QKV projections, RoPE, QK normalization, and windowed attention
│   ├── MLP                          ReLU² feed-forward network
│   └── norm / residual              RMSNorm and residual connections
│
├── Training Implementation — Loss, Backward, Optimizer
│   ├── Loss                         Cross-entropy computed inside GPT.forward()
│   ├── Backward                     Called by the training script to accumulate parameter gradients
│   └── MuonAdamW                    Holds parameter references and performs updates
│       ├── param_groups             Groups parameters by role and matrix shape
│       ├── AdamW update             Updates embeddings, the output layer, and scalar parameters
│       ├── Muon update              Updates Transformer matrix parameters
│       ├── state                    Momentum and first- and second-moment state
│       └── Distributed collectives  Gradient reduction, sharded updates, and parameter gathering
│
└── Inference Implementation — KV Cache, Token Generation
    ├── Engine                       Prefill, decode, sampling, and injection of tool results
    ├── KVCache                      Per-layer keys and values, cache positions, and the previous embedding
    └── RowState                     Sequence, tool queue, and completion flag for one sample
```

<a id="data-pipeline"></a>

# Data Pipeline Overview

The data pipeline covers loading and adaptation, tokenization, and construction of model inputs and supervised targets. Here we trace text into token IDs and then into the model. For reading, packing, padding, and sampling in each stage, see [The LLM Workflow](/zh/docs/ai/llm-workflow-with-nanochat/).

```text
Loading and adaptation        Tokenizer                       Model inputs and supervised targets
Raw text / task records  →    Text / conversation → token IDs  →  inputs / targets
Download, cache, read, adapt  BPE, vocabulary, special tokens     Tensor shapes, shifting, masking
```

<a id="data-loading"></a>

## Loading Data and Adapting Task Records

**Key code:**

```python
# 1. Load the datasets and create tasks via load_hub_dataset(), using local caches when available.
smoltalk = SmolTalk(split="train")
gsm8k = GSM8K(subset="main", split="train")

# 2. Build and shuffle the index for the task mixture.
dataset = TaskMixture([smoltalk, gsm8k])

# 3. Find the task through the mixture index and call its get_example().
conversation = dataset[0]

# Excerpt from SmolTalk.get_example(), with message validation omitted.
def get_example(self, index):
    row = self.ds[index]
    return {"messages": row["messages"]}

# 4. Return messages in a common format for tokenization.
messages = conversation["messages"]
```

**Example inputs and outputs:**

```python
# Input: Sample records in SmolTalk format and a GSM8K record showing how math tasks are adapted.
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

# Output: One conversation's messages per call.
# Messages for the SmolTalk example.
messages = [
    {"role": "user", "content": "Write a sentence about cats sitting on mats."},
    {"role": "assistant", "content": "Cats sit on mats"},
]

# Messages for the GSM8K example.
messages = [
    {"role": "user", "content": "2+3=?"},
    {"role": "assistant", "content": [
        {"type": "text", "text": "2+3=5\n#### 5"},
    ]},
]
```

<a id="tokenizer"></a>

## The Tokenizer

The tokenizer encodes text as integer token IDs and decodes token IDs back into text. `RustBPETokenizer` trains byte-level BPE with `rustbpe` and uses `tiktoken` for encoding and decoding. Conversation encoding also inserts special tokens for roles, tools, and structural boundaries.

### Byte-Level BPE

Byte-level BPE starts from raw bytes and learns merge rules over adjacent byte sequences. This project trains with `rustbpe`, pre-tokenizes text using `SPLIT_PATTERN`, and exports the ordinary vocabulary and merge ranks for `tiktoken` during encoding and decoding.

**Key code:**

This excerpt shows the training portion of `RustBPETokenizer.train_from_iterator()`:

```python
# RustBPETokenizer.train_from_iterator(): BPE training in nanochat/tokenizer.py.
@classmethod
def train_from_iterator(cls, text_iterator, vocab_size):
    # ① Reserve vocabulary slots for special tokens. Implementation: nanochat/tokenizer.py.
    vocab_size_no_special = vocab_size - len(SPECIAL_TOKENS)
    assert vocab_size_no_special >= 256

    # ② Train the ordinary byte pieces and their merge ranks with rustbpe.
    tokenizer = rustbpe.Tokenizer()
    tokenizer.train_from_iterator(text_iterator, vocab_size_no_special, pattern=SPLIT_PATTERN)

    # ③ Export the rules for tiktoken to encode text.
    pattern = tokenizer.get_pattern()
    mergeable_ranks = {bytes(k): v for k, v in tokenizer.get_mergeable_ranks()}

    ...  # The next section builds the Encoding object.
```

[tok_train.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/tok_train.py) invokes tokenizer training, and [tokenizer.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/tokenizer.py) defines the rules and wrapper class. Train the tokenizer once during setup, then load it across training and inference.

**Example inputs and outputs:**

```python
# Input: Training text and the target vocabulary size, including special tokens.
text_iterator = iter(["abab", "abab"])
vocab_size = 267

# Output: The pre-tokenization pattern and a byte piece → merge rank / ID mapping.
pattern = SPLIT_PATTERN
# Only part of the vocabulary is shown. The IDs and merges are illustrative.
mergeable_ranks = {
    b"a": 97,
    b"b": 98,
    b"ab": 256,
    b"abab": 257,
}
```

### The Vocabulary: Tokens, Byte Pieces, and IDs

The vocabulary defines valid token byte pieces and assigns each token an integer ID.

| Component | Representation | Purpose |
|---|---|---|
| Ordinary tokens | `mergeable_ranks: dict[bytes, int]` | Maps byte pieces to merge ranks, which also serve as ordinary token IDs |
| Special tokens | `special_tokens: dict[str, int]` | Marks BOS, role boundaries, tool calls, and tool result boundaries |
| Pre-tokenization pattern | `pat_str` | Splits text before BPE runs |

`--vocab-size` defaults to `32768`, covering both ordinary and special tokens. Special token IDs are assigned after ordinary IDs and do not participate in BPE merge learning.

**Key code:**

The same method constructs the `tiktoken.Encoding` instance here, omitting the earlier training code:

```python
# RustBPETokenizer.train_from_iterator(): Encoding construction in nanochat/tokenizer.py.
@classmethod
def train_from_iterator(cls, text_iterator, vocab_size):
    ...  # The earlier BPE training produces pattern and mergeable_ranks.

    # ① Assign separate IDs to special tokens. Implementation: nanochat/tokenizer.py.
    tokens_offset = len(mergeable_ranks)
    special_tokens = {name: tokens_offset + i for i, name in enumerate(SPECIAL_TOKENS)}

    # ② Combine the pre-tokenization pattern and both vocabularies to build the encoder.
    enc = tiktoken.Encoding(
        name="rustbpe",
        pat_str=pattern,
        mergeable_ranks=mergeable_ranks,
        special_tokens=special_tokens,
    )

    return cls(enc, "<|bos|>")
```

The trained tokenizer is saved to `tokenizer/tokenizer.pkl`, and `tokenizer/token_bytes.pt` records per-ID byte lengths for BPB evaluation. Neither file stores model weights; the embedding layer holds the trainable vectors for each token ID.

**Example inputs and outputs:**

```python
# Output: Ordinary IDs stay the same. Special tokens are assigned IDs starting at 258.
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

### Encoding and Decoding: Text and Token IDs

`encode()` converts text into a list of token IDs, and `decode()` converts token IDs back into text. Multi-byte characters (such as UTF-8 Chinese characters) can span multiple tokens, so decoding the full ID sequence is required to recover the text cleanly. `decode_single_token_bytes()` returns the raw bytes for a single token.

**Key code:**

```python
# ① Load the trained tokenizer via get_tokenizer() in nanochat/tokenizer.py.
tokenizer = get_tokenizer()

# ② Encode the text and return list[int]. The trained vocabulary determines the IDs.
ids = tokenizer.encode("Cats sit on mats")

# ③ Decode the full ID sequence to recover the text.
text = tokenizer.decode(ids)  # "Cats sit on mats"

# ④ Look up the special token ID directly, outside ordinary text encoding.
bos_id = tokenizer.get_bos_token_id()
assistant_start_id = tokenizer.encode_special("<|assistant_start|>")
```

<a id="conversation-encoding"></a>

### Conversation Encoding: Special Tokens and the Supervision Mask

`render_conversation()` wraps a dialogue with structural markers and returns a supervision mask aligned with the token IDs. Reusing the `Cats sit on mats` example from LLM Systems (2):

Here `Cats = 12, sit = 45, on = 78, mats = 90`, the prompt is abbreviated to two tokens (`200, 201`), and special tokens use illustrative IDs `BOS = 243, user_start = 240, user_end = 244, assistant_start = 241, assistant_end = 242`. Actual splits and IDs come from the trained nanochat tokenizer.

**Key code:**

```python
# ① Use Q0 to show the common conversation format in nanochat/tokenizer.py.
Q0 = {"messages": [
    {"role": "user", "content": "Write a sentence about cats sitting on mats."},
    {"role": "assistant", "content": "Cats sit on mats"},
]}

# ② Add BOS, role markers, and end markers, then produce the supervision mask.
ids, mask = tokenizer.render_conversation(Q0)

# ids =  [243, 240, 200, 201, 244, 241, 12, 45, 78, 90, 242]
# mask = [  0,   0,   0,   0,   0,   0,  1,  1,  1,  1,   1]
```

The rendered sequence corresponds to:

```text
<|bos|><|user_start|>Write a sentence about cats sitting on mats.<|user_end|>
<|assistant_start|>Cats sit on mats<|assistant_end|>
```

| Content | Supervision mask |
|---|---|
| BOS, user messages, and role start markers | 0 |
| Assistant response and its end marker | 1 |
| Tool expression generated by the assistant and its call delimiters | 1 |
| Tool result and its output delimiters | 0 |

<a id="model-inputs"></a>

## Model Inputs and Supervised Targets

<a id="token-packing"></a>

### Token Packing and Padding

The SFT data loader packs complete conversations into each row and pads remaining slots with BOS, while concatenating the corresponding masks and padding with `0`. Each row holds `max_seq_len + 1` tokens. Below, two conversations fit in a single row (best-fit bin packing is omitted):

**Key code:**

```python
# ① Reuse Q0 and encode a greeting conversation.
conversation_a = Q0
conversation_b = {"messages": [
    {"role": "user", "content": "Hi"},
    {"role": "assistant", "content": "Hello"},
]}
ids_a, mask_a = tokenizer.render_conversation(conversation_a)
ids_b, mask_b = tokenizer.render_conversation(conversation_b)

# ② Pack the selected complete conversations and masks into one row.
row_capacity = args.max_seq_len + 1
row = ids_a + ids_b
mask_row = mask_a + mask_b
assert len(row) <= row_capacity

# ③ Pad the unused positions.
remaining = row_capacity - len(row)
bos_id = tokenizer.get_bos_token_id()
row.extend([bos_id] * remaining)
mask_row.extend([0] * remaining)

# ④ Collect the rows into a batch. This example has one row, so B = 1.
rows = [row]
mask_rows = [mask_row]
```

In full training, the data loader assembles `device_batch_size` rows per batch. See [The LLM Workflow](/zh/docs/ai/llm-workflow-with-nanochat/) for document cropping in pretraining and response padding in RL.

**Example inputs and outputs:**

```python
# Input: ids_a / mask_a come from Q0. For the greeting, Hi and Hello use illustrative IDs 103 and 105.
ids_a = [243, 240, 200, 201, 244, 241, 12, 45, 78, 90, 242]
mask_a = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1]
ids_b = [243, 240, 103, 244, 241, 105, 242]
mask_b = [0, 0, 0, 0, 0, 1, 1]
row_capacity = 19
bos_id = 243

# Output: Concatenate the two conversations and add one BOS. With B = 1, there are 19 positions before shifting.
rows = [[243, 240, 200, 201, 244, 241, 12, 45, 78, 90, 242,
         243, 240, 103, 244, 241, 105, 242, 243]]
mask_rows = [[0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
              0, 0, 0, 0, 0, 1, 1, 0]]
```

<a id="token-to-tensor"></a>

### Converting Token IDs to a Tensor

**Key code:**

```python
# ① Convert rows, the data loader's packed or padded ID lists, to an integer tensor.
# B is the batch size and T is the model input length. Device transfer is omitted.
batch_tensor = torch.tensor(rows, dtype=torch.long)  # [B, T + 1]
```

**Example inputs and outputs:**

```python
# Input: Reuse rows with B = 1 and T = 18.
# Output: An integer tensor of shape [1, 19] with the same IDs.
batch_tensor = torch.tensor(rows, dtype=torch.long)
# batch_tensor.shape → torch.Size([1, 19])
# batch_tensor.dtype → torch.int64
```

<a id="next-token-targets"></a>

### Next-Token Targets and Tensor Shapes

At position $t$, the model uses tokens up to and including $t$ to predict token $t + 1$. Slicing a row of length $T + 1$ yields `inputs` and `targets` of length $T$.

Using `batch_tensor` above with `mask_rows` as the supervision mask (set to `None` in pretraining):

**Key code:**

```python
# ② Use the current token as input and the next token as its target.
inputs = batch_tensor[:, :-1]           # [B, T]
targets = batch_tensor[:, 1:].clone()   # [B, T]

# ③ Align the supervision mask with the targets and mask them. Pretraining skips this step.
if mask_rows is not None:
    mask_tensor = torch.tensor(mask_rows, dtype=torch.int8)
    targets[mask_tensor[:, 1:] == 0] = -1

# ④ GPT takes an integer tensor of token IDs and embeds them as floating-point vectors.
loss = model(inputs, targets)
```

Shifting and masking the SFT row above gives:

```python
# inputs and targets both have shape [1, 18]. Keep only the two responses and their end markers as targets.
inputs = [[243, 240, 200, 201, 244, 241, 12, 45, 78, 90, 242,
           243, 240, 103, 244, 241, 105, 242]]
targets = [[-1, -1, -1, -1, -1, 12, 45, 78, 90, 242, -1,
            -1, -1, -1, -1, 105, 242, -1]]
```

In the first conversation, the targets at `Cats, sit, on` remain `sit, on, mats` (IDs `[45, 78, 90]`), while the preceding context remains visible.

The same next-token shift applies across stages, with sequence assembly and masking tailored to each stage:

- [Pretraining](/zh/docs/ai/llm-workflow-with-nanochat/#预训练模型怎样从文本中学习): Reads, encodes, packs, and crops documents into next-token targets, tracking an approximate data cursor for checkpoint resumption.
- [SFT](/zh/docs/ai/llm-workflow-with-nanochat/#sft通过标准回答学习): Reads, packs, and pads reference conversations, masking targets with the conversation supervision mask.
- [RL](/zh/docs/ai/llm-workflow-with-nanochat/#nanochat-的-rl采样评分与-reinforce-更新): Samples rollouts, computes rewards and advantages, pads sequences per prompt, and excludes prompt tokens, tool outputs, and padding.

# GPT Model: Architecture and the Forward Call Chain

GPT uses a decoder-only Transformer stack to map token sequences into next-token scores.

Source: [gpt.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py).

## GPT: The Full Model

### Architecture at a Glance

The model wires together token embeddings, Transformer blocks, and the language modeling head:

```text
GPT(nn.Module)                               # Decoder-only Transformer
├── transformer.wte: Embedding               # Token embedding
├── transformer.h: ModuleList[Block × L]     # Transformer layer stack, where L is the number of layers
│   └── Block                                # Transformer layer
│       ├── attn: CausalSelfAttention        # Multi-head self-attention: Q/K/V, RoPE, causal mask, softmax, and weighted V sum
│       └── mlp: MLP                         # Feed-forward network: Linear → ReLU² → Linear
└── lm_head: Linear                          # Language modeling head that outputs logits
```

<a id="gpt-init"></a>

## GPTConfig: Model Configuration and Initialization

`GPTConfig` controls layer count, model dimensions, vocabulary size, context length, and sliding-window patterns.

### How Configuration Fields Map to the Model

| Field | Model component | Effect |
|---|---|---|
| `n_layer` | Transformer layer stack | Sets the number of `Block` instances in `transformer.h` |
| `n_embd` | Hidden dimension | Sets hidden width `C` for embeddings and block I/O, plus MLP width `C → 4C → C` |
| `n_head` | Attention heads | Sets the number of query heads `H` per layer (`head_dim = n_embd / n_head`) |
| `n_kv_head` | Key and value heads (GQA) | Sets the number of KV heads `Hkv`. When `Hkv < H`, query heads share KV projections in groups. |
| `vocab_size` | Token embedding and `lm_head` | Sets vocabulary size `V` and the logit dimension |
| `sequence_len` | Context window and RoPE | Sizes attention windows and rotary embedding precomputation |
| `window_pattern` | Causal self-attention | Specifies short (`S`) vs. long (`L`) windows across layers; the final layer always uses a long window |

### Default Configuration and Model Layout

Default `GPTConfig` fields at the pinned commit:

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

Corresponding module hierarchy:

```text
GPT
├── config: GPTConfig                          # Attention windows: sequence_len = 2048, short and long windows in SSSL pattern
├── transformer.wte: Embedding(32768, 768)      # vocab_size = 32768, n_embd = 768
├── transformer.h: ModuleList[Block × 12]       # n_layer = 12
│   └── Block
│       ├── attn: CausalSelfAttention          # n_head = 6 query heads and n_kv_head = 6 KV heads
│       │   ├── c_q / c_k / c_v: Linear(768, 768)
│       │   │                                  # Each head has 768 / 6 = 128 dimensions
│       │   └── c_proj: Linear(768, 768)         # Attention output projection: (6 × 128) → 768
│       └── mlp: MLP
│           ├── c_fc: Linear(768, 3072)         # MLP expansion factor of 4: 768 → 4 × 768 = 3072
│           └── c_proj: Linear(3072, 768)       # MLP projection back to hidden width: 3072 → 768
└── lm_head: Linear(768, 32768)                  # Projects 768-dimensional hidden states to 32768 vocabulary logits
```

This default configuration contains `286,261,730` parameters (roughly 286M), including six value-embedding tables. Training scripts override defaults from CLI flags.

### Construction and Initialization in the Training Script

For full initialization order and learning-rate setup, see [Pretraining](/zh/docs/ai/llm-workflow-with-nanochat/#预训练模型怎样从文本中学习) and [base_train.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py).

```python
# Training arguments override GPTConfig defaults: depth sets n_layer.
# Compute the hidden dimension from depth × aspect_ratio and align it to a multiple of head_dim.
# Query and KV head counts are both model_dim / head_dim. Read the vocabulary size from the tokenizer.
model = build_model_meta(args.depth)  # Construct the configured model on the meta device.
model.to_empty(device=device)        # Allocate actual storage.
model.init_weights()                 # Initialize weights and the RoPE cache.
```

## Token Embedding: transformer.wte

Token embedding maps each integer token ID to a trainable vector, forming the initial hidden state sequence entering the Transformer stack.

```python
# transformer.wte is an nn.Embedding instance.
# By default, transformer.wte.weight has shape [32768, 768] (768 dimensions per token).
# GPT.forward() embeds input token IDs from [B, T] to initial hidden states [B, T, 768].
x = self.transformer.wte(idx)  # [B, T] → [B, T, 768]

# Equivalent nn.Embedding.forward() call with default arguments:
def forward(self, input):
    # Index weight rows by token ID to map [B, T] IDs to [B, T, 768] hidden states.
    return F.embedding(input, self.weight)
```

<a id="gpt-forward"></a>

## GPT.forward(): From Input Through Blocks to Logits or Loss

`GPT.forward()` returns next-token logits across positions, or returns cross-entropy loss when `targets` are supplied:

```python
# idx: input token IDs.
# targets: optional target token IDs. Return the loss when provided and logits otherwise.
# kv_cache: optional inference cache for past keys and values.
# GPT.forward(): forward-pass pseudocode from nanochat/gpt.py.
def forward(self, idx, targets=None, kv_cache=None, loss_reduction="mean"):
    x = TokenEmbedding(idx)                                         # Token IDs → hidden states. See Token Embedding.
    x = Smear(RMSNorm(x))                                           # Normalize, then mix in the previous token's embedding. See Architecture Extensions.
    x0 = x                                                          # Save the initial representation for residual mixing at each layer.

    for block in Blocks:                                            # Run each Transformer layer in turn. See Block.forward().
        x = ResidualMixing(x, x0)                                   # Mix the current and initial representations. See Architecture Extensions.
        x = block(x, kv_cache)                                      # Invoke the block's forward pass. See Transformer Block.
        ...                                                         # Save an intermediate layer's output for Backout.

    x = Backout(x)                                                  # Subtract a weighted intermediate output. See Architecture Extensions.
    logits = lm_head(RMSNorm(x))                                    # Hidden states → vocabulary logits. See the LM Head section.
    logits = Softcap(FP32(logits[..., :self.config.vocab_size]))    # Trim to vocabulary size and bound logit magnitude. See the LM Head section.

    if targets is not None:
        # In training, loss = model(idx=x, targets=y), followed by loss.backward() and optimizer.step(). See Training Implementation.
        return CrossEntropy(logits, targets)
    # In inference, return logits, sample a token in Engine, and feed it back for decode. See Inference Implementation.
    return logits
```

Subsequent sections detail the Transformer block internals and training loss/update mechanics.

## Language Modeling Head: lm_head

`lm_head` projects per-position hidden states into vocabulary logits for loss evaluation or next-token sampling.

For `Cats sit on`, once the hidden state at the final position `on` is computed, `lm_head` scores vocabulary candidates such as `mats` and `chairs`.

Default module layout:

```text
lm_head: Linear(768, 32768)          # GPT : lm_head = 1:1
└── weight [32768, 768]              # One projection weight row per vocabulary token
```

Key code:

```python
# lm_head uses nanochat's custom Linear class.
# GPT.forward() calls lm_head.
logits = self.lm_head(x)  # [B, T, 768] → [B, T, 32768]

# Equivalent Linear.forward() call:
def forward(self, x):
    # Project hidden states with trainable weights to score every vocabulary token.
    return F.linear(x, self.weight.to(dtype=x.dtype))
```

```python
# GPT.forward(): vocabulary trimming and softcapping in nanochat/gpt.py. The loss branch is omitted.
def forward(self, idx, targets=None, kv_cache=None, loss_reduction="mean"):
    ...  # Earlier computations produce hidden states x.
    logits = self.lm_head(x)
    # Remove extra outputs from vocabulary padding.
    logits = logits[..., :self.config.vocab_size]
    # Bound logit magnitude with FP32 softcapping.
    logits = 15 * torch.tanh(logits.float() / 15)
    return logits
```

## Architecture Extensions

| Extension | Attributes | Where it applies and what it does |
|---|---|---|
| Value Embedding | `value_embeds`, `attn.ve_gate` | On alternating attention layers (and always the final layer), looks up token-indexed embeddings and adds a gated residual to `V` |
| Smear | `smear_gate`, `smear_lambda` | Before the layer stack, gates the previous token's normalized embedding and blends it into the current position; caches the prior embedding across decode steps |
| Residual mixing | `resid_lambdas`, `x0_lambdas` | Before each block, combines the current stream with a weighted copy of the initial post-smear representation `x0` |
| Backout | `backout_lambda` | After the layer stack, subtracts a weighted intermediate layer activation `x_backout` prior to final RMSNorm |

# Transformer Block: Attention, MLP, Norm, and Residual

Each Transformer block aggregates sequence context via causal self-attention and transforms features per position via an MLP.

Source: [gpt.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py).

## Block.forward(): Layer Stack, Normalization, and Residuals

Both attention and the MLP take RMS-normalized inputs and add their outputs back to the running hidden state via residual connections.

```text
Input: Token embedding → RMSNorm → Smear → x [B, T, 768]

transformer.h: ModuleList                       # Apply residual mixing before each block.
├── [0]: Block                                 # First layer, takes input x
│   ├── attn: CausalSelfAttention               # x ← x + attn(RMSNorm(x))
│   └── mlp: MLP                               # x ← x + mlp(RMSNorm(x)), then pass to [1]
├── [1]: Block                                 # Second layer, takes the output of [0]
│   ├── attn: CausalSelfAttention               # x ← x + attn(RMSNorm(x))
│   └── mlp: MLP                               # x ← x + mlp(RMSNorm(x)), then pass to [2]
├── ...
└── [11]: Block                                # Twelfth layer, takes the output of [10]
    ├── attn: CausalSelfAttention               # x ← x + attn(RMSNorm(x))
    └── mlp: MLP                               # x ← x + mlp(RMSNorm(x)), then exit the layer stack

Output: x [B, T, 768] → Backout → Final RMSNorm → lm_head
```

Core call sequence in pseudocode (auxiliary arguments omitted):

```text
# Layer stack: Execute blocks sequentially.
for block in Blocks:
    x = ResidualMixing(x, x0)
    x = block(x, kv_cache)             # Invokes the current block's forward pass.
    Save the intermediate layer output for Backout

# Block.forward(): Execute attention and MLP sequentially.
forward(x, kv_cache):
    x = x + attn(norm(x), kv_cache)    # Aggregate context. See Attention.
    x = x + mlp(norm(x))               # Transform features. See MLP.
    return x
```

## Transformer Layer: Attention (CausalSelfAttention)

Causal self-attention allows each token position to attend to itself and earlier positions, computing per-head attention weights over keys and aggregating values before merging heads.

For `Cats sit on` at position `on`, each head matches `on`'s query against keys at `Cats`, `sit`, and `on` and forms a weighted sum of their values to enrich `on`'s representation for predicting `mats`.

Default attention module layout:

```text
# GPTConfig.n_head = 6: Six query heads compute separate weighted sums that are then merged.
attn: CausalSelfAttention                  # Block : attn = 1:1
    ├── layer_idx: i                     # Identifies the block and its KV cache slice.
    ├── c_q: Linear                      # attn : c_q = 1:1
    │   └── weight [768, 768]
    │       └── 6 matrices [128, 768]    # One projection → 6 query heads
    ├── c_k: Linear
    │   └── weight [768, 768]
    │       └── 6 matrices [128, 768]    # One projection → 6 key heads
    ├── c_v: Linear
    │   └── weight [768, 768]
    │       └── 6 matrices [128, 768]    # One projection → 6 value heads
    └── c_proj: Linear
        └── weight [768, 768]            # Output projection after merging 6 heads
```

Key code:

```python
# CausalSelfAttention.forward() supports both uncached and KV-cached execution.
# Block.forward() adds the attention output back into the residual stream.
x = x + self.attn(norm(x), ve, cos_sin, window_size, kv_cache)

# self.attn is a CausalSelfAttention instance. The call above invokes its forward method.
def forward(self, x, ve, cos_sin, window_size, kv_cache):
    B, T, C = x.size()
    # Project input to Q, K, and V with three Linear layers, then reshape into heads.
    # Q: [B, T, H, D]; K/V: [B, T, Hkv, D]; D = C / H.
    q = self.c_q(x).view(B, T, self.n_head, self.head_dim)
    k = self.c_k(x).view(B, T, self.n_kv_head, self.head_dim)
    v = self.c_v(x).view(B, T, self.n_kv_head, self.head_dim)

    # When value embeddings are active on this layer, add the gated value embedding to V.
    if ve is not None:
        ve = ve.view(B, T, self.n_kv_head, self.head_dim)
        gate = 3 * torch.sigmoid(self.ve_gate(x[..., :self.ve_gate_channels]))
        v = v + gate.unsqueeze(-1) * ve

    # Apply rotary position embeddings (RoPE) to Q and K.
    cos, sin = cos_sin
    q, k = apply_rotary_emb(q, cos, sin), apply_rotary_emb(k, cos, sin)
    # Apply per-head RMSNorm to Q and K and scale by 1.2.
    q, k = norm(q), norm(k)
    q = q * 1.2
    k = k * 1.2

    # Inside flash_attn: scaled QK scores → causal/window mask → softmax → weighted sum of V.
    if kv_cache is None:
        # Uncached: Compute attention directly over current Q, K, and V.
        y = flash_attn.flash_attn_func(q, k, v, causal=True, window_size=window_size)
    else:
        k_cache, v_cache = kv_cache.get_layer_cache(self.layer_idx)
        # Cached: Append current K and V and attend with Q over cached + current entries.
        y = flash_attn.flash_attn_with_kvcache(
            q, k_cache, v_cache,
            k=k, v=v,
            cache_seqlens=kv_cache.cache_seqlens,
            causal=True,
            window_size=window_size,
        )
        # Advance the shared cache sequence length once the final layer finishes.
        if self.layer_idx == kv_cache.n_layers - 1:
            kv_cache.advance(T)

    # Merge heads: [B, T, 6, 128] → [B, T, 768].
    y = y.contiguous().view(B, T, -1)
    # Project merged head outputs back to hidden width C.
    y = self.c_proj(y)
    return y
```

For cache reads, writes, and incremental attention during inference, see [Reading and Writing the KV Cache](#kv-cache).

## Transformer Layer: MLP

The MLP applies two linear projections around a $\text{ReLU}^2$ activation to combine contextual features at each token position independently.

In `The cat sits on the mat. It looks ...`, the MLP at `looks` transforms the context gathered by attention to prepare features for predicting continuations such as `sleepy` or `comfortable`.

```python
# The MLP applies a nonlinear transformation independently to each token's hidden state.
# Input and output both have shape [B, T, C] (C = 768 by default).
# Block.forward() adds self.mlp's output back into the residual stream.
x = x + self.mlp(norm(x))

# self.mlp is an MLP instance. Calling it invokes the forward method below.
def forward(self, x):
    # Expand hidden features with a trainable linear projection.
    x = self.c_fc(x)
    # Apply squared ReLU nonlinearity.
    x = F.relu(x).square()
    # Project back to hidden dimension C.
    x = self.c_proj(x)
    return x
```

# Training Implementation: Loss, Backward, and Optimizer

Each parameter update computes the loss, accumulates gradients across micro-batches, applies the optimizer step, and clears gradients. For stage-level call sites, see [Pretraining](/zh/docs/ai/llm-workflow-with-nanochat/#预训练模型怎样从文本中学习), [SFT](/zh/docs/ai/llm-workflow-with-nanochat/#sft通过标准回答学习), and [RL](/zh/docs/ai/llm-workflow-with-nanochat/#nanochat-的-rl采样评分与-reinforce-更新).

```python
# One training step from scripts/base_train.py.
for micro_step in range(grad_accum_steps):
    # 1. Forward pass and loss: GPT.forward() computes cross-entropy and returns the loss. See Loss.
    loss = model(idx=x, targets=y)

    # 2. Backpropagation: Scale loss by grad_accum_steps and accumulate parameter gradients. See Backward.
    loss = loss / grad_accum_steps
    loss.backward()

    x, y, dataloader_state_dict = next(train_loader)

# 3. Optimizer: Apply updates from accumulated gradients and clear .grad buffers. See Optimizer.
optimizer.step()
model.zero_grad(set_to_none=True)
```

```text
# Total tokens per parameter update:
# Sequences per GPU per micro-batch × tokens per sequence × training ranks × accumulated micro-batches.
total_batch_size = device_batch_size × T × world_size × grad_accum_steps
```

## Loss: Cross-Entropy and Target Masking

Cross-entropy penalizes low predicted probability on the target token and ignores masked positions where `targets == -1`.

```python
# GPT.forward(): The loss branch in nanochat/gpt.py.
def forward(self, idx, targets=None, kv_cache=None, loss_reduction="mean"):
    ...  # Earlier computations produce logits.
    # This is the CrossEntropy(logits, targets) return in GPT.forward(), which supplies the training loop's loss.
    if targets is not None:
        loss = F.cross_entropy(
            logits.view(-1, logits.size(-1)),  # Vocabulary scores at each position
            targets.view(-1),                 # Target token ID at each position
            ignore_index=-1,                  # Skip masked targets outside supervision
            reduction=loss_reduction,         # Default: mean loss across valid positions
        )
        return loss
    return logits

# Cross-entropy pseudocode (reduction = "mean"):
def cross_entropy(logits, targets):
    # Compute log-softmax directly for numerical stability.
    log_probs = log_softmax(logits, dim=-1)

    # Exclude positions marked with targets == -1.
    valid = targets != -1

    # Gather log probability of the ground-truth token at each valid position.
    target_log_probs = log_probs[valid, targets[valid]]

    # Lower target probabilities yield higher loss; average over valid positions.
    return -target_log_probs.mean()
```

See [Backpropagation](#optimizer-update) for reverse-mode gradient computation and parameter updates.

<a id="optimizer-update"></a>

## Backpropagation: Computation Graph and Gradient Accumulation

**Backward pass:** PyTorch records tensor operations during the forward pass to construct an autograd graph. Calling `loss.backward()` traverses the graph in reverse order and accumulates parameter gradients in `.grad`.

```python
# Training calls this in scripts/base_train.py. PyTorch implements backward().
loss.backward()

# Pseudocode for reverse-mode autodiff from a scalar loss:
def backward(loss):
    grads = zeros_for_graph(loss)  # Initialize incoming gradient buffers to zero.
    grads[loss] = 1                # d(loss) / d(loss) = 1.

    # Traverse operations in reverse topological order back to lm_head, Blocks, and Embedding.
    for op in reverse_topological_order(loss):
        # Chain rule: combine upstream output gradients with local VJPs.
        input_grads = op.backward(grads[op.output])
        for tensor, grad in zip(op.inputs, input_grads):
            grads[tensor] += grad  # Sum gradients across branching paths.

    for parameter in trainable_leaf_parameters(loss):
        if parameter.grad is None:
            parameter.grad = grads[parameter]
        else:
            parameter.grad += grads[parameter]  # Accumulate across micro-steps when gradients are retained.
```

**Gradient accumulation:** Run multiple micro-batches, scaling each micro-batch loss before `.backward()` while retaining `.grad` across steps, then call `optimizer.step()` once and zero gradients.

```python
# Gradient accumulation in the training loop.
for micro_step in range(grad_accum_steps):
    ...  # Compute scaled micro-batch loss (divided by grad_accum_steps).
    loss.backward()  # Accumulate gradients into .grad across micro-batches.

optimizer.step()                      # Update parameters once after all micro-batches finish.
model.zero_grad(set_to_none=True)     # Clear .grad buffers for the next step.
```

## Optimizer: Parameter Groups, AdamW, and Muon

`MuonAdamW` reads parameter `.grad` buffers and optimizer state to update model weights, routing different parameter groups to AdamW or Muon.

Source: [optim.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/optim.py) and [GPT.setup_optimizer](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py).

<a id="optimizer-setup"></a>

**Parameter groups and initialization:** Configure optimizer kind, learning rate, and weight decay per group prior to training. Muon stacks matrices of identical shape to batch matrix operations.

| Parameter group | Optimizer | State layout |
|---|---|---|
| Matrices in Transformer blocks | Muon | Stacks same-shape matrices and stores group state under the first parameter in the group |
| Token embedding, value embeddings, and `lm_head` | AdamW | Maintains per-parameter first- and second-moment exponential moving averages |
| `resid` / `x0`, `smear`, and `backout` | AdamW | Dedicated parameter groups with their own learning-rate and decay settings |

```python
# Instantiate the optimizer once before training with references to model parameters; initialize state lazily.
optimizer = model.setup_optimizer(...)
# Each group dictionary stores kind, lr, initial_lr, weight_decay, momentum, and related settings.
# setup_optimizer(weight_decay=...) sets decay for Muon groups, while AdamW groups are configured separately.
```

Optimizer state layout:

```text
Training script
├── model: GPT
│   └── Parameter → .grad (accumulated across backward calls)
└── optimizer: MuonAdamW
    ├── param_groups: list[dict]
    │   ├── params: References to model parameters
    │   ├── kind: adamw / muon
    │   └── lr / initial_lr / weight_decay / betas / momentum, etc.
    └── state
        ├── AdamW: step / exp_avg / exp_avg_sq
        └── Muon: momentum_buffer / second_momentum_buffer
```

**One parameter update:** `optimizer.step()` gathers gradients per group, applies each group's update rule, and writes updated parameters (with distributed reduction/gathering when `world_size > 1`). Single-rank execution flow:

```python
# Called from the training loop:
optimizer.step()

# Single-rank path of MuonAdamW.step():
def step(self):
    rank, world_size = 0, 1

    # 1. Collect .grad buffers for each parameter group.
    reduce_infos = []
    for group in self.param_groups:
        if group["kind"] == "adamw":
            info = self._reduce_adamw(group, world_size)
        elif group["kind"] == "muon":
            info = self._reduce_muon(group, world_size)
        else:
            raise ValueError(f"Unknown optimizer kind: {group['kind']}")
        reduce_infos.append(info)

    # 2. Compute updates for each group.
    gather_list = []
    for group, info in zip(self.param_groups, reduce_infos):
        if group["kind"] == "adamw":
            self._compute_adamw(group, info, gather_list, rank, world_size)
        elif group["kind"] == "muon":
            self._compute_muon(group, info, gather_list, rank)

    # 3. Finalize updated parameter values.
    self._finish_gathers(gather_list)
```

**AdamW update:** Tracks first and second gradient moments with bias correction, applies adaptive step scaling, and applies decoupled weight decay.

```python
# Simplified adamw_step_fused() from nanochat/optim.py (omitting dtype casts and state persistence).
def adamw_step_fused(p, grad, m, v, t, lr, beta1, beta2, eps, weight_decay):
    # p: parameter; grad: gradient; m/v: first/second moment estimates; t: step count.
    p = p * (1 - lr * weight_decay)              # Decoupled weight decay.
    m = beta1 * m + (1 - beta1) * grad           # First moment (momentum).
    v = beta2 * v + (1 - beta2) * grad.square()  # Second moment (squared gradient).
    m_hat = m / (1 - beta1 ** t)                 # Bias-corrected first moment.
    v_hat = v / (1 - beta2 ** t)                 # Bias-corrected second moment.
    p = p - lr * m_hat / (sqrt(v_hat) + eps)      # Adaptive parameter update.

    return p, m, v
```

**Muon update:** Blends current and historical gradients into a momentum direction, applies approximate matrix orthogonalization (via Polar Express iterations) to balance singular/directional components, rescales row norms and variance, and applies sign-aligned weight decay.

```python
# Simplified muon_step_fused() pseudocode from nanochat/optim.py.
def muon_step_fused(p, grad, m, second_momentum_buffer, lr, momentum,
                    beta2, weight_decay, ns_steps):
    # Operates on stacked same-shape matrices; helper names summarize source steps.
    m = momentum * m + (1 - momentum) * grad
    update = (1 - momentum) * grad + momentum * m  # Nesterov-style blend of gradient and momentum.
    update = EqualizeRowNorms(update)              # Normalize row scales.
    update = PolarExpress(update, ns_steps)        # Iterative approximate orthogonalization.
    update = Renormalize(update)                   # Rescale update norm.
    update = VarianceRescale(update, second_momentum_buffer, beta2)
    mask = (update * p) >= 0                       # Apply weight decay only where update and weight align in sign.
    p = p - lr * update - lr * weight_decay * p * mask

    return p, m
```

<a id="inference-implementation"></a>

# Inference Implementation: Generation and State

`Engine.generate()` streams generated tokens incrementally. See [Inference](/zh/docs/ai/llm-workflow-with-nanochat/#推理用户输入怎样形成回答) for workflow context and [engine.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/engine.py) for the implementation.

## Engine.generate(): The Generation Loop

```text
Engine.generate()
├── Allocate KV caches
├── Prefill: Run full prompt to obtain initial logits
└── Decode loop
    ├── Check max_tokens and completion status
    ├── Sampling: Sample next token IDs
    ├── RowState: Track completion per sample
    ├── yield: Emit token_column and token_masks
    └── Forward pass: Feed new token IDs with kv_cache_decode to get next logits
```

`tokens` is the prompt ID list and `num_samples` (`B`) is the number of parallel generations (tool injection omitted below). Each yielded `(token_column, token_masks)` pair has length `B`, with `1` indicating model-sampled tokens.

<a id="prefill"></a>
<a id="decode"></a>

**Key code:**

```python
@torch.inference_mode()
def generate(self, tokens, num_samples=1, max_tokens=None,
             temperature=1.0, top_k=None, seed=42):
    # ① Set up the prompt and generation KV caches in nanochat/engine.py.
    device, dtype = self.model.get_device(), COMPUTE_DTYPE
    rng = torch.Generator(device=device)
    rng.manual_seed(seed)
    m = self.model.config
    kv_model_kwargs = dict(num_heads=m.n_kv_head, head_dim=m.n_embd // m.n_head,
                           num_layers=m.n_layer)

    # ② Prefill: Process the full prompt, populate the cache, and keep the last-position logits.
    kv_cache_prefill = KVCache(batch_size=1, seq_len=len(tokens), device=device,
                               dtype=dtype, **kv_model_kwargs)
    ids = torch.tensor([tokens], dtype=torch.long, device=device)
    logits = self.model.forward(ids, kv_cache=kv_cache_prefill)  # [1, T_prompt, V]
    logits = logits[:, -1, :].expand(num_samples, -1)           # [B, V]

    # Copy the populated prompt cache to the cache for all responses.
    capacity = len(tokens) + max_tokens if max_tokens is not None else m.sequence_len
    kv_cache_decode = KVCache(batch_size=num_samples, seq_len=capacity, device=device,
                              dtype=dtype, **kv_model_kwargs)
    kv_cache_decode.prefill(kv_cache_prefill)
    del kv_cache_prefill

    # ③ RowState tracks whether each response has finished.
    row_states = [RowState(tokens.copy()) for _ in range(num_samples)]
    assistant_end = self.tokenizer.encode_special("<|assistant_end|>")
    bos = self.tokenizer.get_bos_token_id()
    num_generated = 0
    while True:
        # Check the length limit and whether the full batch has finished.
        if max_tokens is not None and num_generated >= max_tokens:
            break
        if all(state.completed for state in row_states):
            break

        # Sampling: Select tokens using temperature and top-k.
        token_column = sample_next_token(logits, rng, temperature, top_k)[:, 0].tolist()
        token_masks = [1] * num_samples
        for state, token in zip(row_states, token_column):
            state.completed |= token in (assistant_end, bos)

        # yield: Emit the current tokens and masks, then resume on the next iteration.
        yield token_column, token_masks
        num_generated += 1

        # Forward pass: Feed in the new tokens and reuse the cache to compute the next logits.
        ids = torch.tensor(token_column, dtype=torch.long, device=device).unsqueeze(1)
        logits = self.model.forward(ids, kv_cache=kv_cache_decode)[:, -1, :]
```

Prefill produces initial logits for the first generated token, and each decode step advances `kv_cache_decode` by one token. `max_tokens` counts all emitted columns, including injected tool tokens when enabled.

<a id="kv-cache"></a>

## Reading and Writing the KV Cache

`KVCache` stores preallocated key and value tensors per layer so decode steps only compute `Q`, `K`, and `V` for newly arrived tokens while attending over all cached history.

| Field | Shape or type | Purpose |
|---|---|---|
| `k_cache` / `v_cache` | `[L, B, S, Hkv, D]` each | Preallocated key and value buffers across layers and batch items |
| `cache_seqlens` | `[B]`, `int32` | Number of valid tokens written so far per batch row |
| `prev_embedding` | `None` or `[B, 1, C]` | Prior token embedding retained across steps for `Smear` |

Here `L` is `num_layers`, `S` is cache capacity (`seq_len`), `Hkv` is `num_kv_head`, `D` is `head_dim`, and `C` is `n_embd`. `get_pos()` reads the current synchronized cache position.

**Key code:**

```python
# ① KVCache.__init__(): Preallocate the cache in nanochat/engine.py.
def __init__(self, batch_size, num_heads, seq_len, head_dim, num_layers, device, dtype):
    self.batch_size = batch_size
    self.n_layers = num_layers
    self.k_cache = torch.zeros(num_layers, batch_size, seq_len, num_heads, head_dim,
                               device=device, dtype=dtype)
    self.v_cache = torch.zeros(num_layers, batch_size, seq_len, num_heads, head_dim,
                               device=device, dtype=dtype)
    self.cache_seqlens = torch.zeros(batch_size, dtype=torch.int32, device=device)
    self.prev_embedding = None

# ② KVCache.get_layer_cache(): Get a view of the layer's cache in nanochat/engine.py.
def get_layer_cache(self, layer_idx):
    return self.k_cache[layer_idx], self.v_cache[layer_idx]

# ③ KVCache.get_pos(): Get the cached sequence length in nanochat/engine.py.
def get_pos(self):
    return self.cache_seqlens[0].item()

# ④ KVCache.advance(): Advance the position after all layers write to the cache in nanochat/engine.py.
def advance(self, num_tokens):
    self.cache_seqlens += num_tokens
```

```python
# ⑤ KVCache.prefill(): Copy the prompt keys, values, length, and previous embedding in nanochat/engine.py.
def prefill(self, other):
    pos = other.get_pos()
    self.k_cache[:, :, :pos] = other.k_cache[:, :, :pos]
    self.v_cache[:, :, :pos] = other.v_cache[:, :, :pos]
    self.cache_seqlens.fill_(pos)
    if other.prev_embedding is not None:
        self.prev_embedding = other.prev_embedding.expand(self.batch_size, -1, -1).clone()
```

```python
# ⑥ CausalSelfAttention.forward(): Cached path in nanochat/gpt.py (QKV projection and output projection omitted).
def forward(self, x, ve, cos_sin, window_size, kv_cache):
    B, T, C = x.size()
    ...  # Compute q, k, and v.

    if kv_cache is not None:
        k_cache, v_cache = kv_cache.get_layer_cache(self.layer_idx)
        y = flash_attn.flash_attn_with_kvcache(
            q, k_cache, v_cache, k=k, v=v,
            cache_seqlens=kv_cache.cache_seqlens,
            causal=True, window_size=window_size,
        )
        if self.layer_idx == kv_cache.n_layers - 1:
            kv_cache.advance(T)

    ...  # Merge heads, apply output projection, and return y.
```

`Smear` updates `prev_embedding` across steps; see [gpt.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py) for projection details and [flash_attention.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/flash_attention.py) for the attention kernel wrapper.

<a id="token-sampling"></a>

## Token Sampling: Selecting the Next Token

Given `logits` of shape `[B, V]`, `sample_next_token()` returns sampled token IDs of shape `[B, 1]`: greedy `argmax` when `temperature == 0.0`, or temperature-scaled softmax sampling (optionally filtered to `top_k`) otherwise.

**Key code:**

```python
# nanochat/engine.py → sample_next_token().
def sample_next_token(logits, rng, temperature=1.0, top_k=None):
    assert temperature >= 0.0
    # ① Greedy decoding: Select the highest-scoring token ID.
    if temperature == 0.0:
        return torch.argmax(logits, dim=-1, keepdim=True)

    # ② Top-k: Restrict to top-k candidates, scale by temperature, and sample.
    if top_k is not None and top_k > 0:
        k = min(top_k, logits.size(-1))
        vals, idx = torch.topk(logits, k, dim=-1)
        probs = F.softmax(vals / temperature, dim=-1)
        choice = torch.multinomial(probs, num_samples=1, generator=rng)
        return idx.gather(1, choice)

    # ③ Full vocabulary: Scale by temperature and sample.
    probs = F.softmax(logits / temperature, dim=-1)
    return torch.multinomial(probs, num_samples=1, generator=rng)
```

<a id="row-state"></a>

## RowState: State for Each Response

Each generated sequence in a batch maintains its own `RowState`:

| Field | Purpose |
|---|---|
| `current_tokens` | Prompt token IDs followed by tokens emitted so far for this row |
| `forced_tokens` | Queued tool-result token IDs scheduled for injection |
| `in_python_block` / `python_expr_tokens` | State and token buffer for an in-progress Python tool expression |
| `completed` | Whether an assistant end marker or BOS has been reached |
