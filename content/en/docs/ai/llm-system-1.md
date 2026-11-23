---
title: "LLM Systems (1): GPT Architecture and Forward Computation"
date: '2026-04-07'
categories:
    - AI
weight: 15
---

# Goal

Trace a GPT forward pass from input token IDs to vocabulary scores (logits) for the next token.

- Model architecture: How token embeddings, Transformer layers, the final norm, and the LM head connect and pass representations forward.
- Inside a Transformer layer: How normalization and residual connections organize attention and the MLP.
- Attention and the MLP: Q, K, and V, attention heads, RoPE, attention weights, and the feed-forward transformation.

<!--more-->

[LLM Systems (2)](/en/docs/ai/llm-system-2/) covers training objectives, parameter updates, and generation. [The LLM Workflow: From Training to Inference with nanochat](/en/docs/ai/llm-workflow-with-nanochat/) explains how the stages fit together. [nanochat: Core LLM Architecture and Implementation](/en/docs/ai/llm-system-nanochat/) walks through the implementation.

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

The GPT model computes logits. Training uses an objective to update parameters, whereas inference selects tokens from the logits and generates responses by running forward passes iteratively.

# The GPT Forward Pass: Architecture and Data Flow


```text
                Input IDs [B, T]
                       │
                       ▼
               Token Embedding
                       │
                       ▼
           Hidden States [B, T, C]
                       │
                       ▼
     ┌─────────────────────────────────┐
     │     Transformer Layers × N      │
     │                                 │
     │  ┌───────────────────────────┐  │
     │  │ Layer 1 / Block 1         │  │
     │  │ Attention, MLP,           │  │
     │  │ Norm, Residual            │  │
     │  └───────────────────────────┘  │
     │                │                │
     │               ...               │
     │                │                │
     │                ▼                │
     │  ┌───────────────────────────┐  │
     │  │ Layer N / Block N         │  │
     │  │ Attention, MLP,           │  │
     │  │ Norm, Residual            │  │
     │  └───────────────────────────┘  │
     └─────────────────────────────────┘
                       │
                       ▼
           Hidden States [B, T, C]
                       │
                       ▼
                  Final Norm
                       │
                       ▼
                  LM Head
                       │
                       ▼
               Logits [B, T, V]
```

| Component | Function |
|---|---|
| Token Embedding | Looks up the vector for each input token ID. |
| Transformer Layers × N | Process token vectors across multiple layers and return representations that incorporate earlier context. |
| Final Norm | Normalizes the vectors from the final layer while preserving their shape. |
| LM Head | Projects the processed vectors into a score for every token in the vocabulary. |

Here `B` is the batch size, `T` is the sequence length, `C` is the hidden dimension, and `V` is the vocabulary size. The `C` coordinates together encode learned features; individual coordinates do not have fixed, human-defined meanings.

This walkthrough uses `Cats sit on mats` throughout, with `Cats sit on` as the input sequence. We track the hidden states across all three positions and use the output at `on` to predict `mats`. The numerical examples use `V = 256`, `C = 4`, and `N = 2`, with token IDs `12, 45, 78, 90` in order.


## Token Embedding

**Question**

The tokenizer maps `Cats` to integer ID `12`. That index only identifies the token's entry in the vocabulary: ID `90` does not carry twice the semantic weight of ID `45`, and raw token IDs alone convey no relationship between tokens.

Downstream layers need dense feature vectors whose values can be adjusted during training.

**Approach**

The embedding layer uses each token ID to index a row in a weight matrix, producing a trainable vector per token. These vectors preserve token order and pass into the first Transformer layer.

**How it works**

```text
embedding.weight [V, C]

                   Each row contains C values
              ┌──────────────────────────┐
token ID 0    │ c0   c1   c2   …   c(C-1) │
token ID 1    │ c0   c1   c2   …   c(C-1) │
token ID 2    │ c0   c1   c2   …   c(C-1) │
    ⋮         │             ⋮            │
token ID V-1  │ c0   c1   c2   …   c(C-1) │
              └──────────────────────────┘

V: Vocabulary size, the number of rows
C: Hidden dimension, the number of values per token vector
```

Labels such as `c0` and `c1` index coordinates within a vector, and each row stores its own trainable parameters.

Parameters are initialized at model setup, updated via backpropagation and optimizer steps during training, and restored from a checkpoint during inference.

```python
# input_ids is the integer tensor from batch preparation, with shape [B, T].
hidden_states = embedding(input_ids)  # Pass the [B, T, C] output to the Transformer.
```

**Example**

Suppose `V = 256` and `C = 4`. Only selected rows are shown below, with words included as reference labels:

```text
embedding.weight [256, 4]

Row           c0     c1     c2     c3
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

The input `Cats sit on` has token IDs `[[12, 45, 78]]`. Looking up rows `12`, `45`, and `78` yields:

```python
input_ids = tensor([[12, 45, 78]])  # Integer tensor of shape [1, 3].
hidden_states = embedding.weight[input_ids]
```

```text
hidden_states = [
    [
        [ 0.2, -0.1,  0.4, 0.3],       # Cats, row 12
        [-0.3,  0.5,  0.1, 0.2],       # sit, row 45
        [ 0.1,  0.2, -0.2, 0.6],       # on, row 78
    ]
]                                      # Shape: [1, 3, 4]
```

These three 4-dimensional vectors enter the first Transformer layer. At this point, each vector reflects only its own token ID lookup, before attention brings in context from earlier positions.

## Transformer

**Question**

For `Cats sit on`, the embedding lookup produces an initial vector for each token. The vector at `on` depends solely on its own ID and does not yet reflect the preceding context `Cats sit`.

Predicting `mats` next requires knowing the subject, action, and context of the phrase, none of which are present in the standalone embedding for `on`.

**Approach**

The Transformer uses causal attention so `on` can read from `Cats`, `sit`, and itself, followed by an MLP that transforms those features into a contextualized hidden state at each position. Pre-layer normalization and residual connections structure each block and update representations across layers.

All positions undergo the same computation in parallel, subject to a causal mask that restricts attention to the current and earlier positions. After the final block, `final_norm` and the LM head project the last position's representation into candidate scores (such as for `mats` and `chairs`) for the next token.

**How it works**

```text
Hidden States [B, T, C]
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
Hidden States [B, T, C]

Each layer contains attention, an MLP, normalization, and residual connections.
```

Here, Transformer layer and block refer to the same unit. Each block holds its own parameters and updates the hidden states sequentially across layers.

```python
x = transformer(hidden_states)  # [B, T, C] → [B, T, C]; pass to the final norm.
```

**Example**

Consider a single sequence of three tokens with `B = 1`, `T = 3`, and `C = 4`. After two Transformer layers, the output is a 3D floating-point tensor:

```text
Input tokens     Cats             sit              on
Input IDs        12               45               78

Transformer output hidden_states, shape [1, 3, 4]

[
    [
        [ 3.1458, -0.1000,  6.2916, 4.7187],   # Feature vector for Cats
        [-0.2929,  6.6708,  3.4566, 3.6111],   # sit with context from Cats
        [-0.0134,  4.1119, -0.1371, 7.4768],   # on with context from Cats sit
    ]
]
```

These rows are **the hidden states (feature vectors) at the three input positions Cats, sit, and on**, each with `C` features. The final norm and LM head convert each row into vocabulary logits for next-token prediction.

For layer-internal details, see [The Transformer Forward Pass, Layer by Layer](#transformer-computation).

<a id="final-norm"></a>

## Final Norm: Scaling the Last Hidden States

**Question**

The Transformer outputs a feature vector per position, but vector magnitudes can vary across layers and positions. The scale of vectors entering the LM head directly affects logit magnitudes and how sharp the resulting softmax probability distribution is.

**Approach**

The final norm normalizes each token vector independently and scales each coordinate by a trainable gain parameter, preserving vector dimensionality and token order before passing the result to the LM head.

Because pre-norm layers normalize sublayer inputs rather than the residual stream itself, residual additions can shift overall magnitude across the stack. Applying normalization after the final block stabilizes scale right before the LM head projection.

**How it works**

This example uses RMSNorm independently on each token vector. `weight` is a trainable scale vector of length `C` (initialized to `1.0` here), and `epsilon` is a fixed small constant (`1e-6`) for numerical stability.

```text
Final Norm: RMSNorm
│
├── weight: C trainable values
│
│           c0    c1    c2    c3
│         ┌───────────────────────┐
│         │ 1.0   1.0   1.0   1.0 │
│         └───────────────────────┘
│
└── epsilon: fixed at 0.000001
```

```python
x = final_norm(x)  # [B, T, C] → [B, T, C]; pass to the LM head.
```

**Example**

Using the Transformer output for `Cats sit on` above, set `weight = [1, 1, 1, 1]` and `epsilon = 1e-6`:

```text
Input hidden_states, shape [1, 3, 4]
[
    [
        [3.1458, -0.1000, 6.2916, 4.7187],   # Feature vector for Cats
        [-0.2929, 6.6708, 3.4566, 3.6111],   # Feature vector for sit
        [-0.0134, 4.1119, -0.1371, 7.4768],   # Feature vector for on
    ]
]

For each row: output = x / sqrt(mean(x²) + epsilon) * weight

Take the row for on:
    mean(x²) ≈ 18.2073
    Divide each value by sqrt(18.2073 + epsilon), approximately 4.2670.
    Output ≈ [-0.0031, 0.9637, -0.0321, 1.7522]

Final norm output, still of shape [1, 3, 4]
[
    [
        [0.7427, -0.0236, 1.4855, 1.1141],   # Cats
        [-0.0702, 1.5995, 0.8288, 0.8659],   # sit
        [-0.0031, 0.9637, -0.0321, 1.7522],   # on
    ]
]
```

Each position vector is now rescaled while keeping its relative feature profile intact. The LM head then uses the final position (`on`) to score candidate next tokens.

<a id="lm-head"></a>

## LM Head: From Hidden States to Logits

**Question**

After processing `Cats sit on`, the model holds a contextualized vector for each position. How does it map those vectors to scores across the full vocabulary—for instance, scoring candidates like `mats` and `chairs` at position `on`—so training can compute loss and generation can select the next token?

**Approach**

The LM head computes the dot product between each position vector and every token's row vector in the output projection matrix, producing one logit per vocabulary ID across all positions.

**How it works**

```text
LM Head
│
└── weight: V rows × C columns, one row per candidate token

                   c0   c1   c2   …   c(C-1)
              ┌──────────────────────────────┐
token ID 0    │ c0   c1   c2   …   c(C-1)    │
token ID 1    │ c0   c1   c2   …   c(C-1)    │
    ⋮         │              ⋮               │
token ID V-1  │ c0   c1   c2   …   c(C-1)    │
              └──────────────────────────────┘
```

Each row in `lm_head.weight` acts as a linear readout vector for a candidate vocabulary token.

Taking the dot product of a position's normalized hidden state with each row of `lm_head.weight` produces that candidate's logit. Omitting bias terms, a single matrix multiplication computes logits for all positions and vocabulary entries at once:

```python
logits = x @ lm_head.weight.T
# [B, T, C] × [C, V] → [B, T, V]
```

Each entry in `logits` scores a candidate token at a given sequence position. Training compares these logits against next-token targets to compute loss, while autoregressive generation reads the logits at the last position to pick the next token.

Here the embedding matrix and LM head matrix are separate parameters; models that use weight tying share a single matrix between the two.

```python
logits = lm_head(x)  # [B, T, C] → [B, T, V]
```

**Example**

Given `Cats sit on`, how does the LM head score vocabulary candidates for the next token? Two inputs enter the calculation:

**① Features from the current sentence**

From the final norm output above, the vector at the last position (`on`) is approximately:

```text
h_on = [-0.0031, 0.9637, -0.0321, 1.7522]
```

This vector represents `on` after incorporating context from `Cats sit on`, and serves as the input to predict the next token.

**② Scoring weights for each candidate**

Consider three rows from the output weight matrix:

```text
lm_head.weight [256, 4]
Candidate token         c0     c1     c2     c3
                   ┌────────────────────────────┐
 90  mats          │  0.2    0.4    0.1    0.3  │
 91  chairs        │ -0.2    0.1    0.4   -0.1  │
 92  volcano       │  0.0    0.0    0.0    0.0  │
       …           │             …              │
                   └────────────────────────────┘
```

Even though `volcano` is semantically unrelated to the context, it is scored across the vocabulary alongside every other candidate. This illustrative matrix has nonzero entries in only four rows, with zeros elsewhere (here row `92` corresponds to `volcano`).

**③ Score each row against the same context vector**

For `mats`, the dot product sums element-wise products:

```text
Context feature    mats weight    Score contribution
 -0.0031     ×      0.2        =   -0.00062
  0.9637     ×      0.4        =    0.38548
 -0.0321     ×      0.1        =   -0.00321
  1.7522     ×      0.3        =    0.52566
                                  ────────
mats logit                     ≈    0.9073
```

Scoring other candidates against the same `h_on` gives:

```text
h_on · Weight_mats    →  0.9073
h_on · Weight_chairs  → -0.0911
h_on · Weight_volcano →  0.0000
             …
             ↓
      256 logits in total
```

Here `mats` receives the highest score. Trained models learn projection weights so contextually appropriate tokens receive higher relative logits and probabilities.

Across all three input positions, the output tensor has shape `[1, 3, 256]`.

<a id="transformer-computation"></a>

# The Transformer Forward Pass, Layer by Layer

## The Layer Stack and Its Data Flow

**Question**

The initial embedding vector at `on` does not yet include information from `Cats sit`. How does the Transformer turn independent per-token embeddings into contextualized representations across multiple layers?

A deep stack also needs to preserve signal across layers and maintain clean gradient flow during backpropagation. Because attention and MLP sublayers alter representation magnitudes, normalizing sublayer inputs helps keep training stable.

**Approach**

Each Transformer block combines causal attention, a position-wise MLP, normalization layers, and residual connections. Stacking `N` such blocks lets each layer read context via attention and transform features via the MLP while adding outputs back into the residual stream.

Residual connections add each sublayer's output to the running representation (`residual + sublayer_out`), preserving existing features and providing a direct additive gradient path back to earlier layers.

In a pre-norm block, normalization is applied before each sublayer while its output is added to the unnormalized residual stream. Normalization bounds sublayer input magnitudes, and the residual stream preserves continuity across depth.

Layer 1 takes token embeddings as input, and each subsequent layer refines the contextualized representations from the preceding layer before handing off to `final_norm` and the LM head.

```text
Embedding output for Cats sit on [B, T, C]
    ↓
Layer 1: Read context → Process features → Update the representation at each position
    ↓
Layer 2: Read and process the representations from the previous layer
    ↓
……
    ↓
Layer N output [B, T, C]
    ↓
Final Norm → LM Head
```

**How it works**

The Transformer maintains an ordered list of blocks. Below is a 2-layer layout:

```text
Transformer
└── layers
    ├── [0] TransformerLayer
    │   ├── norm1: weight [C]
    │   ├── attention: Wq, Wk, Wv, Wo
    │   ├── norm2: weight [C]
    │   └── mlp: W_up, W_down
    └── [1] TransformerLayer
        ├── norm1: weight [C]
        ├── attention: Wq, Wk, Wv, Wo
        ├── norm2: weight [C]
        └── mlp: W_up, W_down
```

All layers share the same architectural structure with independent parameters, passing `[B, T, C]` tensors from one block to the next. In this worked example, both layers use the same numerical weights for clarity.

Component roles within a block:

| Component | Function |
|---|---|
| Layer / Block | Takes `[B, T, C]` representations, aggregates context and transforms features, and passes updated `[B, T, C]` representations to the next block. |
| Norm 1 | Normalizes each token vector before attention (`norm1(x)`). |
| Self-Attention | Allows each position to attend to itself and earlier positions (for example, `on` reads context from `Cats` and `sit`). |
| Norm 2 | Normalizes the post-attention residual representation before the MLP (`norm2(r)`). |
| MLP | Applies a position-wise feed-forward network to combine features at each position (such as integrating subject and verb context at `on`). |

Both `norm1` and `norm2` use the same RMSNorm formula as `final_norm`, each with its own trainable `weight` of shape `[C]`. In the numerical example below, both gain vectors are `[1, 1, 1, 1]` and `epsilon = 1e-6`.

With pre-norm ordering, each block executes:

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

The two residual additions update the state in two stages:

- First: `r = x + attention_output` retains `x` and adds context aggregated by attention.
- Second: `y = r + mlp_output` retains `r` and adds transformed features from the MLP to produce the block output.

**Example**

Tracking the vector at `on` in `Cats sit on` through a 2-layer model with `C = 4`:

```text
Embedding output
on: [0.1000, 0.2000, -0.2000, 0.6000]
    ↓ Layer 1: Incorporate information from Cats, sit, and the current position.
on: [-0.0551, 2.0614, -0.1897, 4.0226]
    ↓ Layer 2: Read the previous layer's representations and refine the features.
on: [-0.0134, 4.1119, -0.1371, 7.4768]
    ↓
Pass to the final norm and LM head to score candidates for the next token.
```

Although this trace highlights `on`, every layer updates all three positions in parallel under a causal mask, so Layer 2 receives the contextualized representations of all three tokens from Layer 1.

The following sections detail the computation inside attention and the MLP.

## Self-Attention

Per-position feature vectors alone do not capture sequence context needed for next-token prediction. Self-attention computes content-based compatibility across positions to aggregate context into each token's representation. GPT uses causal self-attention, masking out future positions so each token attends only to itself and earlier tokens.

Starting from `Cats sit on` in Layer 1, the initial representation at `on` has not yet incorporated `Cats` or `sit`. Here is how it gathers context and updates its representation.

**Inputs and outputs**

In this pre-norm design, self-attention receives `norm1(x)` and returns a contextualized vector per position with shape preserved:

```text
Input x [B, T, C]                          Output attention_output [B, T, C]
┌─────────────────────┐                   ┌───────────────────────┐
│ Cats feature vector │                   │ Cats attention output │
│ sit  feature vector │ ─── Attention ──→ │ sit  attention output │
│ on   feature vector │                   │ on   attention output │
└─────────────────────┘                   └───────────────────────┘
```

**Key concepts**

Each token vector is projected into three roles: `Q` (query), `K` (key), and `V` (value). Attention weights derived from `Q` and `K` determine how much each position's `V` contributes to the output.

Multi-head attention splits these projections into multiple independent heads (`H` heads of dimension `D`). Each head computes attention weights and aggregates values in its own subspace, capturing distinct syntactic or semantic patterns before projection back to `C` dimensions.

**Computation**

```text
Feature vector at each position
    ↓ Project to Q, K, and V
    ↓ Split into heads
For each head:
    Encode position information in Q and K
    → Match Q against K and scale the scores
    → Apply the causal mask and softmax
    → Take a weighted sum of V
    ↓ Combine the heads and project with Wo
Attention output at each position
```

The layout diagrams use `C = 768` (`H = 12, D = 64`), while the worked numerical example uses `C = 4`, `H = 2`, and `D = 2` on `on` in Layer 1. Displayed decimals are rounded to four places, while intermediate steps keep full precision.

### 1. Q, K, and V: Projections and Attention Heads

**Question**

Each token position needs a mechanism to decide how strongly to attend to earlier positions and what information to pull from them, while also supporting multiple parallel attention patterns across different feature subspaces.

**Approach**

Project each input vector into three representations:

- **Q (query)**: Specifies what information the current position seeks.
- **K (key)**: Specifies what features each position exposes for matching against queries.
- **V (value)**: Supplies the payload vectors aggregated according to attention weights.

For `on` in `Cats sit on`:

```text
Q_on: Issue a query
    ↓ Match against K at each position
K_Cats     K_sit     K_on
    ↓ Compute attention weights
   16%       54%       30%       # Illustrative weights
    ↓ Take each position's content in proportion to its weight
V_Cats     V_sit     V_on
    ↓ Sum the weighted values
Contextualized result for on
```

**`Q` and `K` govern attention weights; `V` supplies the aggregated content.**

Splitting into multiple heads lets each head compute independent attention distributions and feature combinations.

**How it works**

**① Input: A feature vector at each position**

`x` is the output of `norm1(x)`. For `Cats sit on` (`B = 1`, `T = 3`) with `C = 768`, `x` has shape `[1, 3, 768]`:

```text
Input x [1, 3, 768]

           c0       c1       c2              c767
        ┌──────────────────────────────────────────┐
Cats    │ x0_0     x0_1     x0_2      …     x0_767  │
sit     │ x1_0     x1_1     x1_2      …     x1_767  │
on      │ x2_0     x2_1     x2_2      …     x2_767  │
        └──────────────────────────────────────────┘
```

**② Parameters: Project each input into three representations**

```text
                     Three trainable weight matrices
                  ┌─ × Wq [768, 768] → Q [1, 3, 768]
x [1, 3, 768] ────┼─ × Wk [768, 768] → K [1, 3, 768]
                  └─ × Wv [768, 768] → V [1, 3, 768]
```

**All positions within a layer share the same linear projection matrices `Wq`, `Wk`, and `Wv`:**

- **Wq**: Maps hidden states into query space.
- **Wk**: Maps hidden states into key space.
- **Wv**: Maps hidden states into value space.

Separate projections decouple matching criteria from value content. For instance, `Q_on` is compared against keys at visible positions to obtain weights that aggregate the corresponding values.

**Each Transformer block has its own `Wq`, `Wk`, and `Wv` matrices, shared across all token positions in that block.**

With `C = 768`, each projection matrix has shape `[768, 768]`, producing `Q`, `K`, and `V` of shape `[1, 3, 768]` before head splitting.

**③ Result: A query, key, and value at each position**

Each projection yields a sequence of vectors aligned with the input tokens:

```text
          Q [1, 3, 768]      K [1, 3, 768]      V [1, 3, 768]
Cats    Q_Cats [768]     K_Cats [768]     V_Cats [768]
sit     Q_sit  [768]     K_sit  [768]     V_sit  [768]
on      Q_on   [768]     K_on   [768]     V_on   [768]
```

Computing attention at a given position uses its query together with keys and values from that position and earlier ones.

**④ Layout: Split the projections into heads**

```text
Hidden state for one token, C=768
[x0, x1, x2, …, x767]
          ↓ Project with Wq, Wk, and Wv, then split into heads

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

**Each head runs self-attention independently** on its own `D`-dimensional slice of `Q`, `K`, and `V`, enabling specialization across heads.

In the `C = 768` layout:

- **C = 768**: Total hidden dimension per token before splitting.
- **H = 12**: Number of attention heads.
- **D = 64**: Per-head dimension (`768 / 12 = 64`).

In code, projections are computed and reshaped into `[B, H, T, D]`:

```python
# Input x: [B, T, C]
q = x @ Wq  # [B, T, C]
k = x @ Wk  # [B, T, C]
v = x @ Wv  # [B, T, C]

# Split the feature dimension into H groups, then group all tokens by head.
q = split_heads(q)  # [B, T, C] → [B, H, T, D]
k = split_heads(k)
v = split_heads(v)
```

**Example**

Tracing `on` in Layer 1 with `C = 4`, `H = 2`, and `D = 2` on `Cats sit on`:

```python
# Input from norm1 in Layer 1, with shape [1, 3, 4].
# The vector for on is [0.2981, 0.5963, -0.5963, 1.7888].
x = norm1_output

# Wq, Wk, and Wv are all 4 × 4 identity matrices here.
q = x @ Wq  # Q_on: [0.2981, 0.5963, -0.5963, 1.7888]
k = x @ Wk  # K_on: [0.2981, 0.5963, -0.5963, 1.7888]
v = x @ Wv  # V_on: [0.2981, 0.5963, -0.5963, 1.7888]

# H=2 and D=2. The shape changes from [1, 3, 4] to [1, 2, 3, 2].
q = split_heads(q)  # Q_on: Head 0 [0.2981, 0.5963]; Head 1 [-0.5963, 1.7888]
k = split_heads(k)  # K_on: Head 0 [0.2981, 0.5963]; Head 1 [-0.5963, 1.7888]
v = split_heads(v)  # V_on: Head 0 [0.2981, 0.5963]; Head 1 [-0.5963, 1.7888]
```

<a id="rope"></a>

### 2. RoPE: Adding Relative Position Information

**Question**

Content projections alone do not encode token positions in the sequence. For example, both `Cats` and `sit` precede `on`, but at different distances.

**Approach**

Rotary Position Embedding (RoPE) rotates 2D coordinate pairs of `Q` and `K` by position-dependent angles so that dot products naturally capture relative token distance. Value vectors `V` are not rotated.

**How it works**

`positions` indexes each token's position in the sequence:

```text
token       Cats    sit     on
positions     0      1      2
```

Within each head, pairs of coordinates in `Q` and `K` are rotated by `position * frequency`:

```python
angle = position * frequency

a_new = a * cos(angle) - b * sin(angle)
b_new = a * sin(angle) + b * cos(angle)

# Apply the rotation to Q and K at every position in every head.
q, k = apply_rope(q, k, positions)
```

RoPE transforms `Q` and `K` values in place without changing tensor shape `[B, H, T, D]`.

**Example**

With `D = 2`, each head has a single coordinate pair. Using frequency `1` so the rotation angle equals the position index, rotating `Q_on` at position `2` in Head 0 gives:

```text
Q_on: [0.2981, 0.5963] → [-0.6663, 0.0230]
```

Applying the same rotation to keys across all three positions gives:

```text
             Before RoPE             After RoPE
K_Cats   [ 0.7303, -0.3651]      [ 0.7303, -0.3651]
K_sit    [-0.9608,  1.6013]      [-1.8665,  0.0567]
K_on     [ 0.2981,  0.5963]      [-0.6663,  0.0230]
```

For `Cats sit on`:

```text
Cats (0)        sit (1)         on (2)
    └─────── 2 positions apart ───┘
                    └─ 1 position ─┘

Matching Q_on with K_Cats reflects a distance of 2 positions.
Matching Q_on with K_sit reflects a distance of 1 position.
```

Because each vector is rotated by its own position angle, the angle between a rotated query and key depends on their relative distance as well as their content.

The next step computes scaled dot-product attention scores from these rotated `Q` and `K` vectors while keeping `V` unchanged.

### 3. Turning Match Scores into Attention Weights

**Question**

1. **Score magnitude and variance:** As head dimension `D` increases, dot products grow larger in magnitude and variance, pushing softmax toward sharp distributions with small gradients that slow training. For example:

   ```text
   Scores [1, 2, 3]    → Softmax ≈ [9%, 24%, 67%]
   Scores [10, 20, 30] → Softmax ≈ [0%,  0%, 100%]
   ```

2. **Causality:** Autoregressive decoding requires each token to attend only to itself and earlier tokens, excluding future positions.

**Approach**

1. **Scale dot products:** Divide query-key dot products by `sqrt(D)` to stabilize variance across dimensions and prevent overly saturated softmax outputs.
2. **Apply a causal mask:** Set logits at disallowed future positions to `-∞` so softmax assigns them zero probability mass.

Applying softmax along the key dimension then yields normalized attention weights summing to `1.0` per query position.

**How it works**

```python
# Match each query against the keys at all positions in the same head.
scores = (q @ k.transpose(-2, -1)) / sqrt(D)  # [B, H, T, T]

# Mask future positions and convert scores into attention weights.
weights = softmax(scores + causal_mask, dim=-1)  # [B, H, T, T]
```

In `scores` and `weights`, the second-to-last axis indexes queries and the last axis indexes keys; row `on` contains the attention weights from `on` to each visible key.

Adding `-∞` at masked future positions zeroes them out after softmax:

```text
Rows are query positions. Columns are key positions.
           Cats   sit    on
Cats        0     -∞     -∞
sit         0      0     -∞
on          0      0      0
```

**Example**

Continuing with `on` in Layer 1, Head 0, compare rotated `Q_on = [-0.6663, 0.0230]` against each key:

| Query → key position | Query | Key | Dot product / √2 |
|---|---|---|---:|
| on → Cats | `[-0.6663, 0.0230]` | `[0.7303, -0.3651]` | -0.3500 |
| on → sit | Same query | `[-1.8665, 0.0567]` | 0.8803 |
| on → on | Same query | `[-0.6663, 0.0230]` | 0.3143 |

None of the three positions are masked for `on`. Applying softmax yields:

```text
Scores: [-0.3500, 0.8803, 0.3143]
Weights: [ 0.1571, 0.5376, 0.3053]
            Cats    sit     on
```

These weights set how much each position's `V` contributes when aggregating context, with `sit` receiving roughly `53.76%` of the weight in this head.

### 4. Aggregating Values and Projecting the Output

**Question**

Given the attention weights from `on` to `Cats`, `sit`, and `on`, how do we aggregate value vectors across positions and merge outputs across heads into a single `[C]` vector for `on`?

**Approach**

Within each head, compute the weighted sum of `V_Cats`, `V_sit`, and `V_on` using the attention weights. Concatenate the resulting head vectors along the feature axis and apply the output projection `Wo` to produce `attention_output_on`.

**How it works**

Per-head weighted aggregation:

```text
Attention weights [T] × Values at each position [T, D]
    ↓
Context vector for the current token in this head [D]
```

Concatenating across heads and projecting with `Wo`:

```text
Head 0 output [D] ─┐
Head 1 output [D] ─┼→ Concatenate [C] → × Wo [C, C] → Attention output [C]
        …        ─┘
```

`Wo` is a trainable linear projection (`[C, C]`) that mixes features across heads after concatenation.

When `C = 768`, concatenating 12 heads of dimension `64` gives a 768-dimensional vector, and `Wo` has shape `[768, 768]`.

Batched execution in code:

```python
head_output = weights @ v               # [B, H, T, D]
output = merge_heads(head_output) @ Wo  # [B, T, C]
```

**Example**

Using `C = 4`, `H = 2`, and `D = 2` for `on`:

```python
# Head 0: attention weights from the previous step.
weights_on = [0.1571, 0.5376, 0.3053]  # Cats, sit, on

# Head 0: value vectors at each position.
values = [
    [ 0.7303, -0.3651],  # V_Cats
    [-0.9608,  1.6013],  # V_sit
    [ 0.2981,  0.5963],  # V_on
]

# Take the weighted sum of features from the three positions.
head0_on = weights_on @ values
# ≈ [-0.3108, 0.9856]

# Head 1 computes its output independently.
head1_on = [-0.5261, 1.7135]

# Concatenate the two head outputs.
merged_on = concat(head0_on, head1_on)
# [-0.3108, 0.9856, -0.5261, 1.7135]

# Wo is a 4 × 4 identity matrix here, so the projection leaves the values unchanged.
attention_output_on = merged_on @ Wo
# [-0.3108, 0.9856, -0.5261, 1.7135]
```

This 4D vector is then added to the block's input via the first residual connection.

For the standard operator specification, see [PyTorch: scaled_dot_product_attention](https://docs.pytorch.org/docs/stable/generated/torch.nn.functional.scaled_dot_product_attention.html).

## MLP (Position-wise FFN)

**Question**

Once attention gathers sequence context at each position, how does the model combine those features nonlinearly to support reasoning and next-token prediction? The MLP performs this transformation independently at every token position.

Consider a completion example:

```text
The cat sits on the mat. It looks ...
```

At the token `looks`:

```text
Attention: Read contextual information about cat, sits, and mat.
MLP: Combine features already present at this position to support later predictions such as sleepy or comfortable.
```

The MLP outputs a vector of dimension `C`, which is added to the residual stream and passed to subsequent layers and the LM head.

**Approach**

A position-wise feed-forward network projects each token representation up to intermediate dimension `F`, applies a nonlinearity, and projects back down to dimension `C` before adding to the residual stream at the second residual connection.

For architectural context, see [Attention Is All You Need — Position-wise Feed-Forward Networks](https://arxiv.org/html/1706.03762v7#S3.SS3) and [Transformer Feed-Forward Layers Are Key-Value Memories](https://aclanthology.org/2021.emnlp-main.446/).

**How it works**

Here `x` is the normalized output from `norm2` in the current block.

Let `F` be the intermediate hidden dimension (`C = 4`, `F = 8` here). At each position, `W_up` expands `4` features into `8` intermediate features, a nonlinearity is applied, and `W_down` projects back to `4` features to match the residual stream.

Using row-vector right multiplication, `W_up` has shape `[C, F] = [4, 8]` and `W_down` has shape `[F, C] = [8, 4]`. This example uses the weight matrices:

```text
MLP
├── W_up: 4 rows × 8 columns
│        f0 f1 f2 f3 f4 f5 f6 f7
│   c0  [1, 0, 0, 0,-1, 0, 0, 0]
│   c1  [0, 1, 0, 0, 0,-1, 0, 0]
│   c2  [0, 0, 1, 0, 0, 0,-1, 0]
│   c3  [0, 0, 0, 1, 0, 0, 0,-1]
├── Activation: ReLU
└── W_down: 8 rows × 4 columns
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

Bias terms are omitted in this example.

```python
mlp_output = mlp(x)
```

**Example**

Continuing with `on` in Layer 1 after attention and the first residual addition, `norm2` passes a 4D vector into the MLP:

```python
x = [-0.1557, 0.8758, -0.5364, 1.7091]

h = x @ W_up
# [-0.1557, 0.8758, -0.5364, 1.7091, 0.1557, -0.8758, 0.5364, -1.7091]

h = relu(h)
# [0, 0.8758, 0, 1.7091, 0.1557, 0, 0.5364, 0]

mlp_output = h @ W_down
# [0.1557, 0.8758, 0.5364, 1.7091]
```

`W_up` expands the vector to 8 intermediate features, `relu` zeros out negative values, and `W_down` projects the result back to 4 dimensions before adding to the residual stream. Other sequence positions share the same weights and are computed independently.

[LLM Systems (2): Training Objectives, Parameter Updates, and Text Generation](/en/docs/ai/llm-system-2/) continues with training and generation.