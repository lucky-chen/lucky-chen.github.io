---
title: "LLM Systems (2): Training Objectives, Parameter Updates, and Text Generation"
date: '2026-05-15'
categories:
  - AI
weight: 16
---

# Goal

[LLM Systems (1): GPT Architecture and Forward Computation](/zh/docs/ai/llm-system-1/) traced a GPT forward pass through to the output logits. This article picks up from there to examine training objectives, parameter updates, and autoregressive text generation:

- Training objectives: How cross-entropy measures prediction error, how SFT masks unsupervised positions, and how GRPO converts response rewards into a policy loss.
- Parameter updates: How backpropagation computes gradients, how optimizers update parameters, and where gradient accumulation and LoRA fit into the training loop.
- Generation: How the KV cache enables incremental attention, and how greedy decoding, sampling, and beam search select output tokens.

<!--more-->

[LLM Systems (1): GPT Architecture and Forward Computation](/zh/docs/ai/llm-system-1/) explains how input IDs become logits. [The LLM Workflow: From Training to Inference with nanochat](/zh/docs/ai/llm-workflow-with-nanochat/) covers the end-to-end training and inference stages. [nanochat: Core LLM Architecture and Implementation](/zh/docs/ai/llm-system-nanochat/) walks through the source implementation.

The worked examples continue with `Cats sit on mats`. The input is `Cats sit on` and the target IDs are `45, 78, 90`. The vocabulary size is `V = 256`, and the illustrative model has two layers with `C = 4, H = 2, D = 2`. The architecture, weights, and intermediate activations carry over from Part 1.

# Training Objectives: From Logits to Loss

Starting from the logits produced in [the GPT model walkthrough](/zh/docs/ai/llm-system-1/), this section demonstrates how cross-entropy quantifies prediction error, how SFT filters supervised positions, and how GRPO translates response scores into a policy gradient loss. For pipeline stages and data preparation, see [The LLM Workflow](/zh/docs/ai/llm-workflow-with-nanochat/).

## Cross-Entropy Loss

**Question**

[The LM head in Part 1](/zh/docs/ai/llm-system-1/#lm-head) outputs vocabulary logits for each position. At `on`, for example, the score for `mats` is `0.9073`, while the ground-truth token in the training text is `mats` (ID `90`).

Given raw logits and the ground-truth token ID, we need a differentiable loss function that penalizes low probability mass on the target token and drives parameter updates.

**Approach**

Cross-entropy compares two probability distributions:

- Model distribution `p`: Applying softmax across the vocabulary logits yields the predicted probability for every token.
- Target distribution `y`: The ground-truth token ID defines a one-hot distribution with `1` at the target index and `0` elsewhere.

Cross-entropy decreases as the model assigns higher probability mass to the correct target token.

**How it works**

```text
LM head logits [B, T, V]             Targets from training data [B, T]
             │                                │
             ▼                                ▼
          Softmax                       1 at target ID, 0 elsewhere
             │                                │
             ▼                                ▼
       Model distribution p [B, T, V]     Target distribution y [B, T, V]
             │                                │
             └───────── Cross-Entropy ────────┘
                               │
                               ▼
                         Loss at each position
                               │
                               ▼
                       Mean over valid positions
                               │
                               ▼
                     Scalar loss → Backpropagation
```

At each valid position, we look up the predicted probability assigned to the target ID; the position loss is the negative natural logarithm of that probability.

In practice, implementations index the log-probabilities directly by target ID without materializing a dense one-hot tensor `y`:

```python
def cross_entropy(logits, targets, ignore_index=-100):
    # 1. Exclude positions whose target is ignore_index.
    logits, targets = select_valid_positions(logits, targets, ignore_index)

    # 2. Convert the vocabulary logits to log probabilities.
    log_probs = log_softmax(logits)
    # 3. Look up the entry for the correct token using its target ID.
    target_log_probs = select_by_target_id(log_probs, targets)
    # At on, look up target ID 90. Its log probability is about -4.6455.

    # 4. Negate the log probabilities and average over valid positions.
    position_losses = -target_log_probs
    return mean(position_losses)  # About 4.7943 in this example.


# logits: raw scores from the LM head, [B, T, V].
# targets: correct token IDs from the training data, [B, T].
loss = cross_entropy(
    logits.reshape(-1, 256), targets.reshape(-1), ignore_index=-100
)
```

**Example**

Starting at position `on`:

```text
Training text: Cats sit on mats
Input:         Cats sit on
Target:        mats, ID = 90
```

The table below aligns the LM head logits with both distributions by token ID. Four candidates are shown explicitly while the remaining 252 are grouped; all 256 entries still enter the softmax denominator:

| Data | sit (45) | on (78) | mats (90) | chairs (91) | Remaining 252 entries |
|---|---:|---:|---:|---:|---|
| LM head logits | -0.0275 | 0.4582 | 0.9073 | -0.0911 | 0 each |
| Model distribution p after softmax | 0.003772 | 0.006130 | 0.009605 | 0.003539 | About 0.976954 in total |
| Target distribution y from the target ID | 0 | 0 | 1 | 0 | 0 each |

Computing the probability for `mats`:

```text
Z = 252 × exp(0) + exp(-0.0275) + exp(0.4582)
    + exp(0.9073) + exp(-0.0911)
  ≈ 257.9447

p[90] = exp(0.9073) / Z ≈ 0.009605
```

Substituting into cross-entropy:

```text
Loss_on = -(0 × ln(0.003772) + 0 × ln(0.006130)
            + 1 × ln(0.009605) + 0 × ln(0.003539) + remaining zero terms)
        = -ln(0.009605)
        ≈ 4.6455
```

As the predicted probability for the target approaches `1`, the loss approaches `0`; as it approaches `0`, the loss diverges toward $+\infty$.

Applying the same calculation across all three input positions:

| Input position | Target | Loss at that position |
|---|---|---:|
| Cats | sit (45) | 4.9190 |
| sit | on (78) | 4.8186 |
| on | mats (90) | 4.6455 |

With all three positions valid:

```text
Batch Loss = (Loss_Cats + Loss_sit + Loss_on) / 3
           ≈ (4.9190 + 4.8186 + 4.6455) / 3
           ≈ 4.7943
```

Backpropagation uses this scalar batch loss to compute parameter gradients.

## SFT: How Supervised Positions Affect the Loss

**Question**

An SFT training example contains both a user prompt and a reference assistant response. How do we compute prediction error exclusively on the assistant response while masking out the user prompt and padding?

**Approach**

SFT applies the same cross-entropy calculation using two inputs:

- Model predictions: A single forward pass over the full dialogue produces vocabulary logits at every position, which softmax converts into next-token probability distributions.
- Reference response: The assistant tokens and end-of-turn marker supply ground-truth token IDs at supervised positions.

A target mask identifies supervised positions. At each retained position, we look up the reference token's probability and compute its negative log-likelihood, averaging over retained positions to yield a scalar loss.

**How it works**

Two indices govern the lookup: the sequence position selects a row of logits, and the target ID indexes that row's probability distribution. The loss mask controls whether that position contributes to the loss. For target alignment details, see [The LLM Workflow: SFT](/zh/docs/ai/llm-workflow-with-nanochat/#sft通过标准回答学习).

```python
def sft_loss(input_ids, targets, target_mask):
    # 1. Run a forward pass over the full conversation to get vocabulary logits at each input position.
    logits = model(input_ids)

    # 2. Keep assistant target IDs and replace the others with -100.
    masked_targets = targets.copy()
    for position in positions:
        if target_mask[position] == 0:
            masked_targets[position] = -100

    # 3. Apply cross-entropy at the retained positions.
    position_losses = []
    for position, target_id in enumerate(masked_targets):
        if target_id == -100:
            continue
        probabilities = softmax(logits[position])
        target_probability = probabilities[target_id]
        position_losses.append(-ln(target_probability))

    # 4. Average only the supervised positions to get a scalar loss for this example.
    return mean(position_losses)
```

This snippet illustrates a single example without the batch axis. In production training, `masked_targets` is passed directly into `cross_entropy(..., ignore_index=-100)` while user prompt tokens remain in `input_ids` to provide causal context during the forward pass.

**Example**

Using the same reference response, `Cats sit on mats`:

```text
User: Write a sentence about cats sitting on mats.
Assistant: Cats sit on mats
```

Here the user prompt is abbreviated to two tokens with illustrative special token IDs (`242` denotes `<END>`). Each input position aligns with its shifted next-token target:

```text
Input position   <USER>       Question 1   Question 2   <ASSISTANT>  Cats  sit  on    mats
Target token     Question 1   Question 2   <ASSISTANT>  Cats         sit   on   mats  <END>
Token ID           200          201          241          12          45    78   90    242
Target Mask          0            0            0           1           1     1    1      1
masked_targets    -100         -100         -100          12          45    78   90    242
```

Using illustrative softmax probabilities for each supervised target:

| Input position | Reference token | Target ID | Mask | Selected probability | Position loss |
|---|---|---:|---:|---|---|
| &lt;USER&gt; | Question 1 | 200 | 0 | — | Excluded |
| Question 1 | Question 2 | 201 | 0 | — | Excluded |
| Question 2 | &lt;ASSISTANT&gt; | 241 | 0 | — | Excluded |
| &lt;ASSISTANT&gt; | Cats | 12 | 1 | p[12] = 0.5 | -ln(0.5) ≈ 0.6931 |
| Cats | sit | 45 | 1 | p[45] = 0.25 | -ln(0.25) ≈ 1.3863 |
| sit | on | 78 | 1 | p[78] = 0.5 | -ln(0.5) ≈ 0.6931 |
| on | mats | 90 | 1 | p[90] = 0.25 | -ln(0.25) ≈ 1.3863 |
| mats | &lt;END&gt; | 242 | 1 | p[242] = 0.5 | -ln(0.5) ≈ 0.6931 |

```text
Loss for this example ≈ (0.6931 + 1.3863 + 0.6931 + 1.3863 + 0.6931) / 5
                      ≈ 0.9704
```

The scalar `0.9704` represents the mean cross-entropy across the five supervised tokens and drives backpropagation.

## GRPO: From Response Scores to an Optimization Objective

**Question**

[The LLM Workflow: GRPO](/zh/docs/ai/llm-workflow-with-nanochat/#grpo) demonstrates how to sample multiple responses per prompt and score each with a reward. We now need to connect sequence-level rewards to token-level predictions to form a differentiable policy loss.

Because a reward evaluates the entire completion while the model generates tokens sequentially, how do we assign credit to individual generated tokens and constrain policy updates?

**Approach**

GRPO uses group-relative rewards to determine update direction and aggregates the loss across three levels: **token position → response → prompt group**.

1. **Determine update direction per response:** Normalize rewards within each prompt group to compute advantages. Positive advantages reinforce generated tokens, whereas negative advantages suppress them. All valid generated tokens in a response share that response's advantage.
2. **Compute token-level clipped surrogate loss:** At each generated position, compute the probability ratio between the current policy and the rollout policy (`current_prob / old_prob`), multiply by the advantage, and apply ratio clipping to prevent overly aggressive policy steps.
3. **Aggregate per response:** Average the token losses across all valid generated positions in each response.
4. **Aggregate across the group:** Average response losses across the group to produce a scalar objective for backpropagation.

**How it works**

This section details the loss formulation; for rollout generation, scoring, and training loops, see [The LLM Workflow: GRPO](/zh/docs/ai/llm-workflow-with-nanochat/#grpo).

The objective takes sampled responses for a prompt, their rewards, rollout (`old`) and current token probabilities, and a generation mask:

| Input | Role in the loss |
|---|---|
| Reward → Advantage | Group-normalized reward indicating whether to reinforce or penalize a response; broadcast across all valid tokens in that response. |
| Old probability | Token probability recorded during rollout sampling, held fixed as the baseline for the update batch. |
| Current probability | Recomputed on each training forward pass for the sampled tokens; carries gradients during backpropagation. |
| Valid-position mask | Selects generated response tokens while excluding prompt tokens and padding. |

```text
        Reward                        Old and current probabilities
           │                                  │
           ▼                                  ▼
┌────────────────────┐            ┌──────────────────────┐
│ Normalize rewards  │            │ Current prob. / old  │
└──────────┬─────────┘            └───────────┬──────────┘
           │                                  │
      Advantage                            Ratio
           │                                  │
           └─────────────────┬────────────────┘
                             ▼
          ┌────────────────────────────────────┐
          │      Loss at each valid token      │
          │   Advantage, ratio, and clipping   │
          │  Compare objectives, then negate   │
          └──────────────────┬─────────────────┘
                             │
                         Position loss
                             │
                             ▼
          ┌────────────────────────────────────┐
          │          Loss aggregation          │
          │  Mean over tokens → Response loss  │
          │  Mean over responses → Group loss  │
          └──────────────────┬─────────────────┘
                             │
                         Group loss
                             │
                             ▼
                         Backward
```

Ratio clipping bounds the policy update incentive within `[0.8, 1.2]` in this example:

```python
def grpo_loss(rewards, old_probs, current_probs, generated_mask):
    # 1. Set the direction for each response. All its valid generated positions share the same advantage.
    advantages = (rewards - mean(rewards)) / (std(rewards) + 1e-8)

    answer_losses = []
    for answer in range(len(rewards)):
        position_losses = []

        for position in valid_positions(generated_mask[answer]):
            # 2. Compute the loss for this token, starting with the current-to-old probability ratio.
            ratio = current_probs[answer, position] / old_probs[answer, position]

            # Combine the advantage and clipping, then negate the position objective.
            advantage = advantages[answer]
            clipped_ratio = clip(ratio, 0.8, 1.2)
            objective = min(ratio * advantage, clipped_ratio * advantage)
            position_losses.append(-objective)

        # 3. Average over valid positions to get the response loss.
        answer_losses.append(mean(position_losses))

    # 4. Average the response losses to get a scalar for the group.
    return mean(answer_losses)
```

**Example**

Using the four response rewards from [The LLM Workflow: GRPO](/zh/docs/ai/llm-workflow-with-nanochat/#grpo), assume each response has two valid generated positions with illustrative probabilities. Intermediate values retain full precision while displayed outputs are rounded to four decimal places.

First, normalize rewards within the group to obtain each response's advantage:

```text
Reward: [0.9, 0.3, 0.8, 0.2]
mean = (0.9 + 0.3 + 0.8 + 0.2) / 4 = 0.55
std = sqrt(((0.9 - 0.55)² + (0.3 - 0.55)²
            + (0.8 - 0.55)² + (0.2 - 0.55)²) / 4)
    ≈ 0.3041

Advantage_A = (0.9 - 0.55) / std ≈  1.1508
Advantage_B = (0.3 - 0.55) / std ≈ -0.8220
Advantage_C = (0.8 - 0.55) / std ≈  0.8220
Advantage_D = (0.2 - 0.55) / std ≈ -1.1508
```

| Response | Reward | Advantage at position 1 | Advantage at position 2 | Direction |
|---|---:|---:|---:|---|
| A | 0.9 | 1.1508 | 1.1508 | Encourage |
| B | 0.3 | -0.8220 | -0.8220 | Discourage |
| C | 0.8 | 0.8220 | 0.8220 | Encourage |
| D | 0.2 | -1.1508 | -1.1508 | Discourage |

Next, compute the probability ratio for each generated token:

| Response | Generated position | Old probability | Current probability | Ratio = current / old |
|---|---:|---:|---:|---|
| A | 1 | 0.20 | 0.26 | 0.26 / 0.20 = 1.3 |
| A | 2 | 0.10 | 0.11 | 0.11 / 0.10 = 1.1 |
| B | 1 | 0.20 | 0.14 | 0.14 / 0.20 = 0.7 |
| B | 2 | 0.10 | 0.09 | 0.09 / 0.10 = 0.9 |
| C | 1 | 0.20 | 0.22 | 0.22 / 0.20 = 1.1 |
| C | 2 | 0.10 | 0.12 | 0.12 / 0.10 = 1.2 |
| D | 1 | 0.20 | 0.18 | 0.18 / 0.20 = 0.9 |
| D | 2 | 0.10 | 0.08 | 0.08 / 0.10 = 0.8 |

Applying the clipping range `[0.8, 1.2]` to compute token losses:

In Response A (`advantage = 1.1508`), position 1 has `ratio = 1.3` (clipped to `1.2`), while position 2 has `ratio = 1.1` (unclipped):

```text
A, position 1:
Loss = -min(1.3 × 1.1508, 1.2 × 1.1508) ≈ -1.3810

A, position 2:
Loss = -min(1.1 × 1.1508, 1.1 × 1.1508) ≈ -1.2659
```

In Response B (`advantage = -0.8220`), position 1 has `ratio = 0.7` (clipped to `0.8`), while position 2 has `ratio = 0.9` (unclipped):

```text
B, position 1:
Loss = -min(0.7 × (-0.8220), 0.8 × (-0.8220)) ≈ 0.6576

B, position 2:
Loss = -min(0.9 × (-0.8220), 0.9 × (-0.8220)) ≈ 0.7398
```

Computing C and D identically yields all token losses:

| Response | Loss at position 1 | Loss at position 2 |
|---|---:|---:|
| A | -1.3810 | -1.2659 |
| B | 0.6576 | 0.7398 |
| C | -0.9042 | -0.9864 |
| D | 1.0357 | 0.9206 |

Averaging across positions within each response:

```text
Response A: (-1.3810 - 1.2659) / 2 ≈ -1.3234
Response B: ( 0.6576 + 0.7398) / 2 ≈  0.6987
Response C: (-0.9042 - 0.9864) / 2 ≈ -0.9453
Response D: ( 1.0357 + 0.9206) / 2 ≈  0.9782
```

Finally, averaging across the four responses in the group:

```text
Group loss ≈ (-1.3234 + 0.6987 - 0.9453 + 0.9782) / 4
           ≈ -0.1480
```

Backpropagation differentiates this scalar with respect to `current_probs`, while `advantages` and `old_probs` act as detached constants.

For implementation details, see [Hugging Face: GRPO Trainer](https://huggingface.co/docs/trl/grpo_trainer).

# From Loss to Parameter Updates

Once a scalar loss is computed, backpropagation traverses the computation graph to populate parameter gradients, and the optimizer updates the weights. Gradient accumulation aggregates gradients across micro-batches before stepping, while LoRA restricts trainable updates to low-rank adapter matrices.

```text
Loss → Backpropagation → Parameters.grad → Optimizer → Updated parameters
                                                           │
                                                           ▼
                                              Used in the next forward pass
```

## Backward

**Question**

Cross-entropy yielded a batch loss of `≈ 4.7943`. How does backpropagation propagate error signals backward through the LM head, final norm, Transformer layers, and embedding table to populate parameter gradients?

**Approach**

Backpropagation applies the chain rule in reverse topological order to compute each parameter's gradient:

1. **Retain intermediate activations:** The forward pass caches operation inputs and intermediate tensors needed for derivative calculations.
2. **Propagate gradients in reverse:** Starting from the scalar loss, compute input and parameter gradients layer by layer in reverse order.
3. **Accumulate multi-path contributions:** Sum gradients wherever parameters are shared across positions, across attention interactions, or across residual branches.
4. **Populate `.grad` buffers:** Accumulate gradients into each parameter's `.grad` attribute without modifying parameter values yet.

**How it works**

The backward pass propagates all the way back to the token embedding table, with each module accumulating its own parameter gradients and passing upstream gradients backward:

```text
                      Loss
                        │
                        ▼
        ┌──────────────────────────────┐
        │        Loss backward         │
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
        │     Transformer Layer 2      │──→ Layer parameters .grad
        └───────────────┬──────────────┘
                        │
                        ▼
        ┌──────────────────────────────┐
        │     Transformer Layer 1      │──→ Layer parameters .grad
        └───────────────┬──────────────┘
                        │
                        ▼
        ┌──────────────────────────────┐
        │       Token Embedding        │──→ Matching parameter rows .grad
        └──────────────────────────────┘
```

Here `cache` denotes the saved forward activation tape required for differentiation (distinct from the inference KV cache used to store past keys and values during decoding).

Each backward step takes an upstream output gradient, accumulates parameter gradients using saved activations, and returns the input gradient:

```python
def model_backward(grad_logits, model, cache):
    # 1. LM head: Store weight gradients and return gradients for the input features.
    grad = lm_head_backward(grad_logits, model.lm_head, cache.lm_head)

    # 2. Final norm: Store gradients for the scale weights and propagate to the last layer.
    grad = norm_backward(grad, model.final_norm, cache.final_norm)

    # 3. Transformer: Backpropagate from the last layer to the first.
    for index in reversed(range(len(model.layers))):
        grad = layer_backward(grad, model.layers[index], cache.layers[index])

    # 4. Embedding: Accumulate into the parameter rows indexed by input token ID.
    for position, token_id in enumerate(cache.input_ids):
        model.embedding.weight.grad[token_id] += grad[position]
```

Within each pre-norm Transformer block:

```python
r = x + attention(norm1(x))
y = r + mlp(norm2(r))
```

Backpropagation traverses the MLP block first and then the attention block, summing gradients across both residual skip connections:

```python
def layer_backward(grad_y, layer, cache):
    # 1. Second residual addition: Pass the incoming gradient along the direct path.
    grad_r = grad_y.copy()

    # 2. MLP path: Backpropagate through the MLP and Norm 2, then add the direct gradient.
    grad_norm2 = mlp_backward(grad_y, layer.mlp, cache.mlp)
    grad_r += norm_backward(grad_norm2, layer.norm2, cache.norm2)

    # 3. First residual addition: Again preserve the direct gradient.
    grad_x = grad_r.copy()

    # 4. Attention path: Backpropagate through attention and Norm 1, then sum at the input.
    grad_norm1 = attention_backward(grad_r, layer.attention, cache.attention)
    grad_x += norm_backward(grad_norm1, layer.norm1, cache.norm1)

    return grad_x
```

Backward dependencies mirror the forward graph from [Part 1](/zh/docs/ai/llm-system-1/#transformer-computation):

| Component | Backward computation |
|---|---|
| LM head | Uses hidden states to compute weight gradients and projection weights to compute input gradients. |
| MLP | Backpropagates through the down projection, nonlinearity, and up projection for parameter and input gradients. |
| Attention | Backpropagates through `Wo`, per-head value aggregation, softmax weights, and `Q`, `K`, and `V` projections, summing contributions across positions. |
| Norm | Computes gradients for scale weights and pre-normalization inputs. |
| Embedding | Scatter-adds input gradients into the embedding rows indexed by `input_ids`. |

The backward pass begins with the gradient of cross-entropy loss with respect to `logits` (with parameter `.grad` buffers zeroed beforehand):

```python
def cross_entropy_backward(logits, targets):
    # Compute the logit gradient at each position from the predicted distribution and target.
    grad_logits = softmax(logits)
    for position, target_id in enumerate(targets):
        grad_logits[position, target_id] -= 1

    # The loss averages valid positions, so scale gradients by the same count.
    return grad_logits / len(targets)


grad_logits = cross_entropy_backward(logits, targets)
model_backward(grad_logits, model, cache)
```

Each parameter's `.grad` buffer now holds its accumulated gradient; integer `input_ids` are discrete indices and do not receive gradients.

**Example**

Tracing `mats` and its LM head weight `w = W[mats, c3] = 0.3` across `Cats sit on`:

At `on`, the target is `mats`, so we subtract `1` from `p(mats)` and divide by `3` (the number of valid positions in the batch mean):

```text
Predicted probability: 0.009605
Correct target: mats

Gradient of Loss_on with respect to the mats logit:
0.009605 - 1 = -0.990395

Gradient of the batch loss with respect to this logit:
-0.990395 / 3 ≈ -0.330132
```

Multiplying by feature `c3` from [the final norm output in Part 1](/zh/docs/ai/llm-system-1/#final-norm) (`1.7522` at `on`):

```text
This position's contribution to w.grad:
-0.330132 × 1.7522 ≈ -0.578457
```

Because `w` also scores `mats` as a candidate at `Cats` and `sit` (where `mats` is not the target), those positions contribute positive logit gradients `p(mats) / 3`:

| Input position | p(mats) | Target | Gradient for the mats logit | h_c3 | Contribution to w.grad |
|---|---:|---|---:|---:|---:|
| Cats | 0.007204 | sit | 0.007204 / 3 ≈ 0.002401 | 1.1141 | 0.002675 |
| sit | 0.010159 | on | 0.010159 / 3 ≈ 0.003386 | 0.8659 | 0.002932 |
| on | 0.009605 | mats | (0.009605 - 1) / 3 ≈ -0.330132 | 1.7522 | -0.578457 |

Summing across all three positions gives the total gradient for `w`:

```text
w.grad ≈ 0.002675 + 0.002932 - 0.578457
       ≈ -0.57285

After backpropagation:
w      = 0.3
w.grad ≈ -0.57285
```

A negative gradient indicates that increasing `w` slightly will reduce the loss.

Continuing backpropagation with full-precision activations down to the embedding layer produces the following activation gradients at `on`:

| Point in the backward pass | Gradient at on |
|---|---|
| Final norm output | `[-0.066341, -0.131573, -0.031755, -0.098827]` |
| Final norm input (Layer 2 output) | `[-0.015602, -0.013969, -0.008004, 0.007508]` |
| Layer 2 input (Layer 1 output) | `[-0.014462, -0.023547, -0.008080, 0.012506]` |
| Layer 1 input (embedding output) | `[-0.040909, -0.131007, -0.003027, 0.059970]` |

Selected parameter gradients populated across the model:

```python
# LM head: Gradient for the scoring weights of mats (ID=90).
lm_head.weight.grad[90]
# tensor([0.002580, -0.312774, 0.016978, -0.572860])

# Final norm: Gradients for the four per-coordinate scale weights.
final_norm.weight.grad
# tensor([-0.026763, -0.284987, -0.198043, -0.237038])

# Layer 2 attention: Gradient for row 3 of the output projection weights.
layers[1].attention.Wo.grad[3]
# tensor([-0.012041, -0.019549, -0.021298, 0.031453])

# Layer 2 MLP: Gradient for row 3 of the down projection weights.
layers[1].mlp.W_down.grad[3]
# tensor([-0.019836, -0.007320, -0.022560, 0.023984])

# Token embedding: Gradients for the rows selected by the input token IDs.
embedding.weight.grad[12]  # Cats
# tensor([-0.008727, -0.008054, -0.097432, 0.128552])
embedding.weight.grad[45]  # sit
# tensor([-0.025421, -0.047753, -0.005087, 0.077225])
embedding.weight.grad[78]  # on
# tensor([-0.040909, -0.131007, -0.003027, 0.059970])
```

Weights remain unchanged until the optimizer executes a step.

## Optimizer

**Question**

Backpropagation has populated `.grad` for every trainable parameter. How does the optimizer determine step sizes, update parameter values, and maintain historical statistics across steps?

**Approach**

An optimizer reads parameters, gradients, and internal state buffers, then updates both weights and state. Using **AdamW** as the standard example:

1. **Update moment estimates:** Track exponential moving averages of the gradient (first moment `m`) and squared gradient (second moment `v`).
2. **Apply bias correction and scale:** Correct zero-initialization bias in early steps and normalize the step direction by the root-mean-square gradient scale.
3. **Apply decoupled weight decay and step:** Decay weights directly by `lr * weight_decay`, subtract the adaptive update, and persist updated moment buffers.

For further reading, see [Optimizer: What Does It Do and Why We Need It](https://huggingface.co/blog/onekq/adam-optimizer), [Optimizers and schedulers](https://huggingface.co/docs/transformers/optimizers), and [PyTorch: AdamW](https://docs.pytorch.org/docs/stable/generated/torch.optim.AdamW.html).

**How it works**

```text
┌────────────────────────────────────────┐
│  Parameter, gradient, optimizer state  │
└────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────┐
│    Update moments and correct bias     │
│    Direction m_hat and scale v_hat     │
└────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────┐
│           Compute the update           │
│   Scale by learning rate and history   │
└────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────┐
│       Write parameter and state        │
│ Apply decay, then subtract the update  │
└────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────┐
│      Updated parameter and state       │
│    Used in the next pass and update    │
└────────────────────────────────────────┘
```

The optimizer maintains per-parameter state buffers throughout training:

| Data | Purpose |
|---|---|
| Parameter and Parameter.grad | Current parameter tensor and its accumulated gradient |
| State: step, m, v | Step counter, first moment (gradient EMA), and second moment (squared gradient EMA) |
| lr, beta1, beta2 | Learning rate and exponential decay rates for `m` and `v` |
| epsilon, weight_decay | Numerical stability constant and decoupled weight decay coefficient |

```python
def adamw_step(parameter, state, lr, beta1, beta2, epsilon, weight_decay):
    # 1. Read the gradient and update this parameter's moving statistics.
    g = parameter.grad
    state.step += 1
    state.m = beta1 * state.m + (1 - beta1) * g
    state.v = beta2 * state.v + (1 - beta2) * g**2

    # 2. Correct the initial bias and compute the update from direction and scale.
    m_hat = state.m / (1 - beta1**state.step)
    v_hat = state.v / (1 - beta2**state.step)
    update = lr * m_hat / (sqrt(v_hat) + epsilon)

    # 3. Write the new parameters. Keep m, v, and step in the optimizer state.
    parameter.value *= 1 - lr * weight_decay
    parameter.value -= update
```

`optimizer.step()` updates weights in place, and `optimizer.zero_grad()` clears `.grad` buffers while preserving `m`, `v`, and `step`.

**Example**

Using `w = 0.3` and `w.grad ≈ -0.57285` with `lr = 0.1, beta1 = 0.9, beta2 = 0.999, weight_decay = 0.01, epsilon = 1e-8` (initialized with `step = m = v = 0`):

Updating the first and second moments:

```text
step = 1
m = 0.9 × 0 + 0.1 × (-0.57285) = -0.057285
v = 0.999 × 0 + 0.001 × (-0.57285)² ≈ 0.000328157
```

Applying bias correction and computing the adaptive step:

```text
m_hat = -0.057285 / (1 - 0.9) = -0.57285
v_hat ≈ 0.000328157 / (1 - 0.999) ≈ 0.328157
update = 0.1 × m_hat / (sqrt(v_hat) + 1e-8) ≈ -0.1
```

Applying weight decay and updating `w`:

```text
After weight decay:    w = 0.3 × (1 - 0.1 × 0.01) = 0.2997
After the update:      w = 0.2997 - (-0.1) ≈ 0.3997
```

| Data | Before the update | After the update |
|---|---:|---:|
| w | 0.3 | 0.3997 |
| step | 0 | 1 |
| m | 0 | -0.057285 |
| v | 0 | 0.000328157 |

Comparing the first update step across SGD, Momentum, and AdamW from the same starting point:

| Algorithm | First step | Updated w |
|---|---|---:|
| Gradient Descent | 0.3 - 0.1 × (-0.57285) | 0.357285 |
| Momentum (`velocity = 0`) | `velocity = 0.9 × 0 - 0.57285`, then `w - lr × velocity` | 0.357285 |
| AdamW (`m = v = 0`) | Worked example above | 0.3997 |

## Gradient Accumulation

**Question**

When a target global batch size exceeds available GPU memory, we split the batch into smaller micro-batches. How do we accumulate gradients across micro-batches so the resulting parameter update matches a single full-batch step?

**Approach**

Gradient accumulation processes micro-batches sequentially while holding model weights constant:

1. **Weight by valid token share:** Count valid target tokens in each micro-batch and across the full step so every valid token receives equal weight in the global mean loss.
2. **Accumulate weighted gradients:** Scale each micro-batch's mean loss by `valid_tokens / total_valid_tokens` and call `.backward()`, summing gradients into `.grad`.
3. **Step once:** Once all micro-batches have been processed, execute `optimizer.step()` once and zero out gradients.

When micro-batches contain equal numbers of valid tokens, each is weighted by `1 / grad_accum_steps`. For the training loop implementation, see [The LLM Workflow: Gradient Accumulation](/zh/docs/ai/llm-workflow-with-nanochat/#梯度累积一次更新的数据怎样分批计算).

**How it works**

```text
                          Same parameters throughout the update
                                          │
                   ┌──────────────────────┴──────────────────────┐
                   ▼                                             ▼
┌────────────────────────────────────┐        ┌────────────────────────────────────┐
│           micro-batch 1            │        │           micro-batch 2            │
│ Mean loss × Share of valid targets │        │ Mean loss × Share of valid targets │
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
                     │         Shared Parameter.grad          │
                     │      Sum all batch contributions       │
                     └────────────────────────────────────────┘
                                          │
                                          ▼
                     ┌────────────────────────────────────────┐
                     │         One optimizer update           │
                     └────────────────────────────────────────┘
```

| Data or state | Role in gradient accumulation |
|---|---|
| Valid targets per micro-batch and in total | Determines the loss scaling factor for each micro-batch |
| Parameter | Held constant across all micro-batches until the final optimizer step |
| Parameter.grad | Accumulates weighted gradients across successive `.backward()` calls |

```python
def accumulation_step(micro_batches, optimizer):
    # 1. Set each micro-batch's weight using the total count of valid targets.
    counts = [count_valid_targets(batch) for batch in micro_batches]
    total_count = sum(counts)
    optimizer.zero_grad()

    # 2. Keep parameters fixed and accumulate gradients across micro-batches.
    for batch, count in zip(micro_batches, counts):
        if count == 0:
            continue
        batch_loss = mean_loss(batch)
        weighted_loss = batch_loss * (count / total_count)
        weighted_loss.backward()

    # 3. Update once after all micro-batches finish, then clear the gradients.
    optimizer.step()
    optimizer.zero_grad()
```

**Example**

Suppose four valid targets yield gradients `[1, 3, -1, 5]` for a parameter initialized at `0.3`. The full-batch mean gradient is:

```text
(1 + 3 - 1 + 5) / 4 = 2
```

Splitting into two equal micro-batches while holding the parameter at `0.3`:

| Micro-batch | Target gradients | Valid targets | Mean gradient | Weight | Contribution to .grad |
|---|---|---:|---:|---:|---:|
| 1 | [1, 3] | 2 | 2 | 2/4 | 1 |
| 2 | [-1, 5] | 2 | 2 | 2/4 | 1 |

```text
Accumulated parameter.grad = 1 + 1 = 2
```

With SGD (`lr = 0.1`), a single optimizer update gives:

```text
parameter_new = 0.3 - 0.1 × 2 = 0.1
```

With unequal valid target counts (`[1, 3]` and `[5]`):

| Micro-batch | Target gradients | Mean gradient | Weight | Contribution to .grad |
|---|---|---:|---:|---:|
| 1 | [1, 3] | 2 | 2/3 | 4/3 |
| 2 | [5] | 5 | 1/3 | 5/3 |

```text
Accumulated gradient = 4/3 + 5/3 = 3
Full-batch mean gradient = (1 + 3 + 5) / 3 = 3
```

Exact equivalence holds because weights remain frozen across micro-batches and per-token forward/backward computations are independent across examples.

## LoRA: Representing Trainable Updates with Low-Rank Matrices

**Question**

Full fine-tuning updates every model weight and maintains gradients and optimizer states for all parameters, incurring substantial memory overhead. How can we adapt model behavior while training far fewer parameters?

**Approach**

Low-Rank Adaptation (LoRA) freezes pretrained weights and injects trainable low-rank residual matrices:

1. **Freeze base weights:** Keep the original weight matrix `W` frozen and introduce two low-rank matrices `A` and `B`, allocating gradients and optimizer states only for `A` and `B`.
2. **Add a low-rank residual path:** Pass input `x` through both `W` and the `A → B` bottleneck, adding the scaled adapter output to the base output without changing tensor shapes.
3. **Train with the standard loop:** Backpropagate loss into `A` and `B` and update only those adapter weights.

Note that training still stores frozen base weights and forward activations. For workflow usage, see [The LLM Workflow: LoRA](/zh/docs/ai/llm-workflow-with-nanochat/#lora减少可训练参数).

**How it works**

```text
                                       Input x
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                               ▼
┌──────────────────────────────────┐            ┌──────────────────────────────────┐
│          Base path: W            │            │         Adapter path: A/B        │
│         Frozen weights           │            │     Low-rank and trainable       │
└──────────────────────────────────┘            └──────────────────────────────────┘
                  │                                               │
             base_output                                     adjustment
                  │                                               │
                  └───────────────────────┬───────────────────────┘
                                          ▼
                     ┌────────────────────────────────────────┐
                     │            Add both outputs            │
                     │          Keep the output shape         │
                     └────────────────────────────────────────┘
                                          │
                                          ▼
                     ┌────────────────────────────────────────┐
                     │        Later modules and loss          │
                     └────────────────────────────────────────┘
                                          │
                                          ▼
                     ┌────────────────────────────────────────┐
                     │                Backward                │
                     │         Gradients for A and B          │
                     └────────────────────────────────────────┘
                                          │
                                          ▼
                     ┌────────────────────────────────────────┐
                     │        Optimizer updates A and B       │
                     │         Base W stays unchanged         │
                     └────────────────────────────────────────┘
```

| Parameter or setting | Purpose |
|---|---|
| `W [out, in]` | Frozen base weight matrix of the linear layer |
| `A [rank, in]`, `B [out, rank]` | Trainable low-rank projection matrices whose product parameterizes $\Delta W$ |
| `rank` | Bottleneck dimension (`rank << min(in, out)`), yielding `rank × (in + out)` trainable parameters |
| `scale = alpha / rank` | Constant scaling factor applied to the adapter output |

```python
def lora_forward(x, frozen_weight, A, B, scale):
    # 1. Use the frozen weight for the original transformation.
    base_output = x @ frozen_weight.T

    # 2. Compute a trainable output adjustment with adapter matrices A and B.
    adapter_hidden = x @ A.T
    adjustment = (adapter_hidden @ B.T) * scale

    # 3. Add the two outputs and pass the result to the existing downstream modules.
    return base_output + adjustment


# Freeze W. The optimizer manages only A and B.
freeze(W)
optimizer = Optimizer([A, B])
```

Gradients still flow through frozen `W` whenever upstream layers contain trainable parameters.

**Example**

Comparing optimizer state memory for a `[4096, 4096]` projection matrix (`16,777,216` parameters) versus `rank = 8` LoRA (`A [8, 4096]` and `B [4096, 8]`, totaling `65,536` parameters) in FP32 (4 bytes per float):

| Quantity | Full fine-tuning | LoRA |
|---|---:|---:|
| Trainable parameters | 4096 × 4096 = 16,777,216 | 8 × 4096 + 4096 × 8 = 65,536 |
| Gradient | 64 MiB | 256 KiB |
| AdamW m and v | 128 MiB | 512 KiB |
| Gradient, m, and v combined | 192 MiB | 768 KiB |

These figures reflect gradients and AdamW moments alone, excluding base weights, adapter parameters, and activations.

Tracing a concrete numerical update where `W` is the `4 × 4` identity matrix and `rank = 1, scale = 1`:

```text
A = [[1, 0, 0, 0]]
B = [[0.1], [0.2], [0.3], [0.4]]
x = [1, -2, 3, -4]
```

Forward pass across both branches:

```python
base = x @ W.T                     # [1, -2, 3, -4]
adapter_hidden = x @ A.T           # [1]
adjustment = adapter_hidden @ B.T  # [0.1, 0.2, 0.3, 0.4]
output = base + adjustment         # [1.1, -1.8, 3.3, -3.6]
```

Given an upstream output gradient of `[1, 1, 1, 1]`, backpropagation produces:

```text
A.grad = [[1, -2, 3, -4]]
B.grad = [[1], [1], [1], [1]]
W.grad is not stored
```

Applying an SGD update with `lr = 0.01`:

```text
A_new = [[0.99, 0.02, -0.03, 0.04]]
B_new = [[0.09], [0.19], [0.29], [0.39]]
W remains the 4 × 4 identity matrix
```

Re-evaluating the forward pass on the same input `x` reflects the updated adapter contribution:

```text
x @ A_new.T = [0.70]
adjustment_new = [0.063, 0.133, 0.203, 0.273]
output_new = [1.063, -1.867, 3.203, -3.727]
```

Updating `A` and `B` shifts the layer's output without modifying `W`.

# Generation: From Logits to the Next Token

Autoregressive generation reuses the model architecture and weights from [Part 1](/zh/docs/ai/llm-system-1/). This section covers caching past keys and values for incremental decoding and converting final-position logits into output token IDs. For input formatting and serving loops, see [The LLM Workflow](/zh/docs/ai/llm-workflow-with-nanochat/).

## KV Cache: Layout and Incremental Attention

**Question**

After processing `Cats sit on`, the model has computed key and value tensors across every layer and position. When `mats` is generated next, causal attention at `mats` still requires those historical keys and values.

Re-running the full prefix on every step would redundantly recompute earlier positions. How do we cache past keys and values so each decode step computes only the newly generated token while reducing cache memory footprint?

**Approach**

A KV cache stores historical keys and values per layer:

- Prefill processes the entire prompt in parallel and populates the initial cache entries for each layer.
- Decode processes a single new token per step, computing its `Q`, `K`, and `V`, appending `K` and `V` to the cache, and attending over all cached and current keys and values.

Memory footprint also depends on how KV heads are shared across query heads: Multi-Head Attention (MHA) assigns dedicated KV heads per query head, Grouped-Query Attention (GQA) shares KV heads across query groups, and Multi-Query Attention (MQA) shares a single KV head across all query heads.

**How it works**

The cache stores processed key-value tensors per layer:

```text
KV Cache
├── Layer 1
│   ├── K: [Batch, KV Head, Cached Token, Head Dimension]
│   └── V: [Batch, KV Head, Cached Token, Head Dimension]
└── Layer 2
    ├── K: Same layout
    └── V: Same layout
```

During decode, each layer projects the new token into `Q`, `K`, and `V` (with RoPE applied to `Q` and `K` at the current sequence index, as in [Part 1](/zh/docs/ai/llm-system-1/#rope)):

```python
def cached_attention(q, new_k, new_v, layer_cache, query_positions):
    # 1. Read the past keys and values stored for this layer.
    history_k = layer_cache.K
    history_v = layer_cache.V

    # 2. Append the new position to the cached positions.
    all_k = concat(history_k, new_k, axis="token")
    all_v = concat(history_v, new_v, axis="token")

    # 3. Use the current query to attend to the visible past and current keys and values.
    output = causal_attention(q, all_k, all_v, query_positions)

    # 4. Store the updated cache for the next decode step.
    layer_cache.K = all_k
    layer_cache.V = all_v
    return output
```

Prefill initializes the cache, and subsequent decode steps append along the token axis; `q` is used immediately and discarded rather than cached.

Comparing KV head sharing topologies across four query heads:

```text
       ┌────────────────┬────────────────┬────────────────┬────────────────┐
MHA    │  Q0→[K0/V0]    │  Q1→[K1/V1]    │  Q2→[K2/V2]    │  Q3→[K3/V3]    │  4 sets
       ├────────────────┴────────────────┼────────────────┴────────────────┤
GQA    │          Q0,Q1→[K0/V0]           │          Q2,Q3→[K1/V1]           │  2 sets
       ├─────────────────────────────────┴─────────────────────────────────┤
MQA    │                        Q0,Q1,Q2,Q3→[K0/V0]                        │  1 set
       └───────────────────────────────────────────────────────────────────┘
```

Query heads sharing a KV head still maintain distinct query projections, allowing them to attend to different positions while shrinking cache memory.

For instance, GPT-3 Small (125M) uses MHA with 12 query heads and 12 KV heads per layer ([Language Models are Few-Shot Learners](https://arxiv.org/html/2005.14165v4#S2.SS1)). GQA and MQA trade expressive capacity in key-value representations for significant KV cache memory savings during long-context inference ([GQA](https://arxiv.org/abs/2305.13245)).

**Example**

After prefill on `Cats sit on` in our two-layer model, Head 0 of Layer 1 holds:

| Position | Token | Cached key | Cached value |
|---:|---|---|---|
| 0 | Cats | `[0.7303, -0.3651]` | `[0.7303, -0.3651]` |
| 1 | sit | `[-1.8665, 0.0567]` | `[-0.9608, 1.6013]` |
| 2 | on | `[-0.6663, 0.0230]` | `[0.2981, 0.5963]` |

Appending `mats` at position `3` (`embedding.weight[90] = [0.3, 0.1, 0.2, 0.4]`) and applying normalization, projections, and RoPE from [Part 1](/zh/docs/ai/llm-system-1/#transformer-computation) yields:

```text
Q_mats = [-1.1360, -0.2069]
K_mats = [-1.1360, -0.2069]
V_mats = [1.0954, 0.3651]
```

Appending `K_mats` and `V_mats` extends the cache to four entries:

| Position | Token | Cached key | Cached value |
|---:|---|---|---|
| 3 | mats | `[-1.1360, -0.2069]` | `[1.0954, 0.3651]` |

`Q_mats` attends over all four cached positions to produce the identical Head 0 output as a full-sequence forward pass:

```text
Key position: Cats       sit       on       mats
Scores:   [-0.5332,  1.4910,   0.5319,  0.9428]
Weights:  [ 0.0631,  0.4777,   0.1831,  0.2761]

Head 0 output ≈ [-0.0559, 0.9519]
Cache length: 3 → 4
```

Comparing KV cache memory across MHA, GQA, and MQA for `N = 32, B = 1, sequence_length = 4096, num_query_heads = 32, D = 128` in FP16/BF16 (2 bytes per element):

| Attention scheme | KV heads | KV cache |
|---|---:|---:|
| MHA | 32 | 2 GiB |
| GQA | 8 | 512 MiB |
| MQA | 1 | 64 MiB |

For additional background, see [Hugging Face: How caching works](https://huggingface.co/docs/transformers/en/cache_explanation).

## Token Selection: Probability Distributions and Sampling

**Question**

Given vocabulary logits at the final sequence position, how do decoding strategies select the next token, control output diversity, or search across multi-token continuations?

**Approach**

Standard decoding strategies include greedy decoding, stochastic sampling, and beam search (see [Hugging Face: Generation strategies](https://huggingface.co/docs/transformers/v5.22.2/en/generation_strategies)):

1. **Greedy decoding:** Deterministically selects the highest-logit token (`argmax`) at every step along a single hypothesis.
2. **Sampling:** Scales logits by `temperature`, optionally truncates the distribution via `top-k` or `top-p` (nucleus) filtering, and samples from the renormalized probabilities.
3. **Beam search:** Maintains `num_beams` active hypotheses, expands each by top candidate tokens, accumulates log probabilities, and retains the highest-scoring sequences at each step.

For end-to-end generation loops, see [The LLM Workflow](/zh/docs/ai/llm-workflow-with-nanochat/).

**How it works**

```text
                             Last-position logits for each candidate sequence
                                              │
              ┌───────────────────────────────┼───────────────────────────────┐
              ▼                               ▼                               ▼
┌──────────────────────────┐    ┌──────────────────────────┐    ┌──────────────────────────┐
│      Greedy Search       │    │         Sampling         │    │       Beam Search        │
│Select highest-scoring ID │    │    Adjust temperature    │    │  Extend and add scores   │
└──────────────────────────┘    │Filter with top-k / top-p │    │      Keep num_beams      │
              │                 │Sample from probabilities │    └──────────────────────────┘
              │                 └──────────────────────────┘                  │
              │                               │                               │
              │                               │                               ▼
              │                               │                 ┌──────────────────────────┐
              │                               │                 │Candidates for next round │
              └───────────────┬───────────────┘                 │Keep extending and pruning│
                              │                                 └──────────────────────────┘
                              ▼                                               │
        ┌──────────────────────────────────────────┐                          │
        │              Next Token ID               │                          ▼
        │         Pass to the next decode step     │            ┌──────────────────────────┐
        └──────────────────────────────────────────┘            │        On completion     │
                                                                │ Return the best sequence │
                                                                └──────────────────────────┘
```

Greedy decoding and sampling select one token per step:

```python
def select_token(logits, mode, temperature=1, k=None, p=None):
    # 1. In greedy decoding, return the highest-scoring token ID.
    if mode == "greedy":
        return argmax(logits)

    # 2. For sampling, apply temperature and optionally retain the top-k candidates.
    scores = logits / temperature
    candidates = all_token_ids()
    if k is not None:
        candidates = top_k_ids(scores, k)
    probabilities = softmax(scores[candidates])

    # 3. For top-p, retain the smallest prefix whose cumulative probability reaches the threshold.
    if p is not None:
        order = sort_by_probability_descending(probabilities)
        keep = prefix_until_cumulative_reaches(order, probabilities, p)
        candidates = candidates[keep]
        probabilities = normalize(probabilities[keep])

    # 4. Sample from the final distribution and return the original vocabulary ID.
    return sample(candidates, probabilities)
```

When combining `top-k` and `top-p`, `top-k` truncates the vocabulary first and `top-p` filters the remaining sorted distribution up to cumulative probability threshold `p`.

Beam search tracks `num_beams` candidate sequences scored by cumulative log probability:

```python
def beam_search(prompt, num_beams, max_new_tokens, eos_id):
    beams = [(prompt, 0)]

    for step in range(max_new_tokens):
        candidates = []
        for sequence, score in beams:
            # 1. Keep the scores of finished sequences and continue predicting for the others.
            if sequence[-1] == eos_id:
                candidates.append((sequence, score))
                continue
            log_probs = log_softmax(model(sequence).last_logits)

            # 2. Extend each candidate and add the new token's log probability.
            for token_id in top_ids(log_probs, num_beams):
                candidates.append(
                    (sequence + [token_id], score + log_probs[token_id])
                )

        # 3. Keep the top num_beams across all extensions.
        beams = top_sequences(candidates, num_beams)
        if all_ended(beams, eos_id):
            break

    # 4. Return the highest-scoring retained sequence.
    return best_sequence(beams)
```

**Example**

Using `Cats sit on` (`V = 256`) with illustrative logits comparing `mats` and `chairs`:

| Candidate | mats (90) | chairs (91) | Remaining 254 entries |
|---|---:|---:|---|
| Logit | 0.9073 | 0.6000 | 0 each |
| Full-vocabulary probability | 0.009592 | 0.007054 | About 0.983354 combined |

Greedy decoding selects the maximum logit (`0.9073`), returning `ID = 90` (`mats`).

For stochastic sampling with `temperature = 1, top_k = 2, top_p = 0.8`, `top-k` retains `mats` and `chairs` with renormalized probabilities:

```text
mats:   exp(0.9073) / (exp(0.9073) + exp(0.6)) ≈ 0.5762
chairs: exp(0.6) / (exp(0.9073) + exp(0.6))    ≈ 0.4238
```

| Candidate, sorted by probability | Probability | Cumulative probability | Kept by top-p = 0.8? |
|---|---:|---:|---|
| mats (90) | 0.5762 | 0.5762 | Yes |
| chairs (91) | 0.4238 | 1.0000 | Yes |

Both tokens remain after `top-p = 0.8`. Drawing `u = 0.7` from $\text{Uniform}(0, 1)$ selects `chairs` (`ID = 91`):

```text
mats:   u ∈ [0, 0.5762)
chairs: u ∈ [0.5762, 1)

u = 0.7
next_token_id = 91, corresponding to chairs
```

Running beam search with `num_beams = 2, max_new_tokens = 2` (`<END>` = `242`):

Step 1 retains the top two hypotheses from the full vocabulary:

| Generated sequence | Probability | Cumulative log probability |
|---|---:|---:|
| mats | 0.009592 | -4.6468 |
| chairs | 0.007054 | -4.9541 |

Step 2 expands both hypotheses given illustrative next-token distributions:

| Generated so far | Next-token candidates and probabilities | Remaining 254 entries |
|---|---|---|
| mats | &lt;END&gt;: 0.40, chairs: 0.30 | Share the remaining 0.30 equally |
| chairs | &lt;END&gt;: 0.80, mats: 0.10 | Share the remaining 0.10 equally |

Ranking all extensions by cumulative log probability:

| Generated sequence | Cumulative log probability | Kept this round? |
|---|---:|---|
| chairs &lt;END&gt; | -4.9541 + ln(0.80) ≈ -5.1773 | Yes |
| mats &lt;END&gt; | -4.6468 + ln(0.40) ≈ -5.5631 | Yes |
| mats chairs | -4.6468 + ln(0.30) ≈ -5.8508 | No |
| chairs mats | -4.9541 + ln(0.10) ≈ -7.2567 | No |

Both surviving beams have terminated with `<END>`, returning the top-scoring sequence:

```text
Generated token IDs: [91, 242]
Generated text: chairs <END>
```

Although `chairs` had lower initial probability than `mats`, its higher transition probability into `<END>` yields the higher cumulative sequence score.

Finally, tightening `top-p` from `0.8` to `0.5` after `top-k = 2` keeps only `mats` (renormalized probability `1.0`), whereas lowering temperature without `top-k` or `top-p` sharpens the full-vocabulary distribution:

| Candidate | Temperature = 1 | Temperature = 0.5 |
|---|---:|---:|
| mats | 0.9592% | 2.3300% |
| chairs | 0.7054% | 1.2602% |