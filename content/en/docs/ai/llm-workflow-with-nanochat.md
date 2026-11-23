---
title: "The LLM Workflow: From Training to Inference with nanochat"
date: '2026-05-10'
categories:
- AI
weight: 10
---

This article follows a GPT-style decoder-only Transformer from training through response generation, using nanochat's code to show how each stage works.

- Pretraining: Prepare the text, tokenizer, and batches, then train the base model to predict the next token.
- Post-training: Use SFT to teach instruction-following behavior and RL to refine responses via reward signals. This section also shows where LoRA fits.
- Inference: Prepare the input, then connect prefill, token selection, decode, the KV cache, and output processing.
- Evaluation: Check predictive performance, task capabilities, response quality, and runtime performance throughout training and use.

<!--more-->

```text
Text → Tokenizer → Training sequences and batches
                   ↓
                   Pretraining → Base model
                                 ↓
                                 Instructions and reference responses → SFT → SFT model
                                                                              ├──→ Chat inference
                                                                              └──→ Optional RL → RL model → Chat inference

During training: Validate predictions, evaluate task capabilities, and save checkpoints
During use: Check response quality, latency, throughput, and resource usage
```

The code examples use nanochat at commit [92d63d4](https://github.com/karpathy/nanochat/commit/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd).

[LLM Systems (1)](/zh/docs/ai/llm-system-1/) covers the model architecture and forward pass. [LLM Systems (2)](/zh/docs/ai/llm-system-2/) covers training objectives, parameter updates, and generation.

# Pretraining: How the Model Learns from Text

In pretraining, the model predicts the next token from the text it has seen and adjusts its parameters based on the prediction error. We prepare the data first, then repeat the training updates:

```text
Collect text → Clean, deduplicate, and split into training and validation sets
    ↓
Prepare the tokenizer → Encode text as token IDs
    ↓
Packing → Batch → Attention mask
    ↓
Build inputs, next-token targets, and the loss mask
    ↓
Forward pass → Loss → Backpropagation → Optimizer updates parameters
    ↑                                   │
    └─────── Load the next batch ───────┘

During training: Run validation regularly and save checkpoints
After training: Save the base model for post-training or text generation
```

## Self-Supervision: Where the Targets Come From

The text itself supplies the prediction targets. Suppose we tokenize "Cats sit on mats" as follows:

```text
[Cats, sit, on, mats]
```

After seeing "Cats," the model predicts "sit." After seeing "Cats sit," it predicts "on." The answers come from the original text without manual labeling. Building a training signal from the data itself is called self-supervision.

Training feeds the entire sequence into the model at once, but each position can attend only to itself and earlier positions. A causal mask enforces that restriction so the model cannot see the answer in advance.

## Tokenization: From Text to Token IDs

Neural networks operate on continuous vectors and require a numerical representation of text. The tokenizer converts text to token IDs, and the model's embedding layer maps those IDs to vectors:

```text
Text → Tokenizer → Token IDs → Embedding layer → Vectors → Remaining model computation
```

Suppose our toy vocabulary has size $V = 256$. The splits and IDs below are illustrative. The actual result depends on the tokenizer:

```text
Text A: Cats sit on mats
Token: [Cats, sit, on, mats]
IDs: [12, 45, 78, 90]

Text B: Hi!
Token: [Hi, !]
IDs: [103, 9]

Text C: Go!
Token: [Go, !]
IDs: [104, 9]
```

A token can be a word, part of a word, punctuation, or a fragment of bytes, depending on the tokenizer. Common subword tokenization algorithms include **BPE, WordPiece, and Unigram**. See [Hugging Face: Normalization and pre-tokenization](https://huggingface.co/learn/llm-course/chapter6/4) and the chapters that follow for details.

The tokenizer is prepared before training. Both training and inference use the encoding rules that match the model. For the basics, see [Hugging Face: Tokenizers](https://huggingface.co/learn/llm-course/chapter2/4). For nanochat's implementation, see [nanochat: Core LLM Architecture and Implementation](/zh/docs/ai/llm-system-nanochat/).

[nanochat/dataset.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataset.py) downloads the pretraining text shards. [scripts/tok_train.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/tok_train.py) trains and saves the tokenizer:

```bash
# Download 8 text shards.
python -m nanochat.dataset -n 8
# Train and save the tokenizer.
python -m scripts.tok_train
# Evaluate tokenization.
python -m scripts.tok_eval
```

The tokenizer is saved to `tokenizer/tokenizer.pkl`. The byte count for each token is saved to `tokenizer/token_bytes.pt` for bits-per-byte (BPB) evaluation. Training and inference reuse the same tokenizer.

## Packing Short Documents

To process sequences in parallel during training, we typically arrange them in a tensor of shape $[B, T]$, where $B$ is the number of sequences and $T$ is their common length.

Documents vary in length. Giving every short document its own row leaves many padding positions, wasting compute.

Packing concatenates short documents into training sequences of a fixed length, reducing wasted computation. Filling unused positions is called padding, and `padding_id` denotes the token ID used to fill them.

For example, take `eos_id = 242` and `padding_id = 0`:

```python
eos_id = 242
padding_id = 0

# Each row holds 8 tokens.
# Before packing: One document per row, with padding in the unused positions.
sequences = [
    [12, 45, 78, 90, eos_id, padding_id, padding_id, padding_id],
    [103, 9, eos_id, padding_id, padding_id, padding_id, padding_id, padding_id],
]

# After packing: Both documents fit in the same row.
packed_sequences = [
    [12, 45, 78, 90, eos_id, 103, 9, eos_id],
]
```

Each training sequence has length 8, and `eos_id` is the token ID for the end-of-text marker. Before packing, the same 8 valid tokens take up two rows and leave 8 padding positions. After packing, they fit in one row.

For more on padding, see [Hugging Face: Padding the inputs](https://huggingface.co/learn/llm-course/chapter2/5#padding-the-inputs).

## Batching Sequences for Parallel Computation

Packing turns documents into training sequences. Feeding a large training set through the model one sequence at a time leaves hardware parallelism underused. We group sequences into a batch so the model can process them together.

Once padded, the sequences form a two-dimensional integer tensor of shape $[B, T]$, where $B$ is the number of sequences and $T$ is the sequence length.

Using the same sequences, compare processing them individually with processing them as a batch:

```python
# One at a time: two [1, 8] tensors; the GPU processes the first, then the second.
ids_1 = [12, 45, 78, 90, eos_id, 103, 9, eos_id]
ids_2 = [104, 9, eos_id, padding_id, padding_id, padding_id, padding_id, padding_id]

model(torch.tensor([ids_1], dtype=torch.long, device=device))
model(torch.tensor([ids_2], dtype=torch.long, device=device))

# Batched: one [2, 8] tensor; the GPU processes both sequences in parallel.
batched_ids = [
    [12, 45, 78, 90, eos_id, 103, 9, eos_id],
    [104, 9, eos_id, padding_id, padding_id, padding_id, padding_id, padding_id],
]

input_ids = torch.tensor(batched_ids, dtype=torch.long, device=device)
model(input_ids)
```

A tensor is a multidimensional array used for numerical computation. Here we convert a Python list to an integer tensor of shape $[2, 8]$ and pass it to the model. The token IDs keep their numerical values through that conversion. The model's embedding layer then maps them to vectors.

For an introduction, see [PyTorch: Tensors](https://docs.pytorch.org/tutorials/beginner/basics/tensorqs_tutorial.html).

## Attention Masks: Which Positions Can the Model Attend To?

Short sequences in the batch are padded with `padding_id`. Attention must exclude those positions because they are outside the original text.

The attention mask controls which positions attention can read. Start with the padding mask: mark real tokens with 1 and padding with 0. During attention, apply the causal mask as well to exclude future positions.

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

These flags control which input positions the model can attend to. The loss mask, covered below, controls which targets contribute to the prediction error.

For basic usage, see [Hugging Face: Attention masks](https://huggingface.co/learn/llm-course/chapter2/5#attention-masks).

## Shifting the Targets for Next-Token Prediction

Once the inputs are ready, each position needs a target. In next-token prediction, the model uses the current and earlier positions to predict the token immediately after them.

To set up that objective, offset the same sequence by one token to form input `x` and target `y`. This is called target shifting. Use the first training sequence from above:

```python
sequence = [12, 45, 78, 90, eos_id, 103, 9, eos_id]
x = sequence[:-1]  # [12, 45, 78, 90, eos_id, 103, 9]
y = sequence[1:]   # [45, 78, 90, eos_id, 103, 9, eos_id]
```

The corresponding text is `Cats sit on mats <EOS> Hi! <EOS>`.

Shifting the 8-token sequence gives us 7 input positions and their targets. For example, input token 12 (`Cats`) has target 45 (`sit`), and input token 45 (`sit`) has target 78 (`on`). The final input token is `!` (ID 9), with target `EOS` (ID 242).

## Loss Masks: Which Targets Count?

After shifting, some targets are still `padding_id`. Including those positions in the loss would train the model to predict padding.

A loss mask marks the targets that contribute to the loss. Mark valid targets with 1 and padding targets with 0. Here is how to build the inputs, targets, and loss mask for the second training sequence:

```python
sequence = [104, 9, eos_id, padding_id, padding_id, padding_id, padding_id, padding_id]
x = sequence[:-1]
y = sequence[1:]  # [9, eos_id, padding_id, padding_id, padding_id, padding_id, padding_id]
loss_mask = [1, 1, 0, 0, 0, 0, 0]
```

Only the two positions that predict 9 and `eos_id` contribute to the loss. The remaining targets are padding. The loss mask aligns with the targets. Slice the input-side attention mask with the input, taking the first 7 positions of the corresponding row.

The three masks serve different purposes:

| Mask | What it controls | Example |
|---|---|---|
| Padding mask | Which padding positions are excluded from the context | Exclude `padding_id` |
| Causal mask | Which future positions are hidden | When predicting "on," hide the input position for "on" and all later positions |
| Loss mask | Which target positions count toward the loss | Ignore padding targets or, during post-training, supervise only the response |

[nanochat/dataloader.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py) handles document encoding, packing, and target shifting in the data loader:

```python
# Create an iterator that yields the inputs, targets, and data loader state for each batch.
train_loader = tokenizing_distributed_data_loader_with_state_bos_bestfit(
    tokenizer, args.device_batch_size, args.max_seq_len,
    split="train", device=device,
)
x, y, dataloader_state_dict = next(train_loader)
```

## The Training Loop: From Prediction Error to Parameter Updates

**Question:** Once the inputs and targets are ready, how does prediction error help the model improve?

**Approach:**

1. **Measure prediction error:** Run a forward pass and compute cross-entropy loss against the next-token targets.
2. **Find the update direction:** Compute gradients with backpropagation.
3. **Apply the update:** Use the optimizer to update the parameters, then clear the gradients before processing the next batch.

**How it works:**

```text
Data loader → x, y → Forward pass → Logits
                 │                  │
                 └── y ───────────→ Loss
                                    ↓
                                    Backpropagation
                                    ↓
                                    Optimizer updates the parameters
                                    ↓
                                    Clear gradients → Next batch
```

[scripts/base_train.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py) initializes the GPT model, tokenizer, and optimizer, then reads `x` and `y` from the data loader in the previous section. When [GPT.forward()](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py) receives `y`, it runs the forward pass and computes cross-entropy, returning the mean loss over valid targets. It ignores positions whose target is `-1`.

The example below puts those steps together for one batch per update. The next section shows how to split an update across batches:

```python
x, y, dataloader_state_dict = next(train_loader)  # Get inputs and next-token targets.
loss = model(x, y)                              # Forward pass and cross-entropy.
loss.backward()                                 # Compute gradients; parameters are still unchanged.
optimizer.step()                                # Update the parameters using the gradients.
model.zero_grad(set_to_none=True)               # Clear gradients for the next update.
```

**Example:** Using `Cats sit on mats` again, take `[12, 45, 78]` as input and `[45, 78, 90]` as targets. Suppose the targets have negative log probabilities `[1.2, 0.8, 1.0]`:

```text
Read Cats        → Target sit (45)  → NLL = 1.2
Read Cats sit    → Target on (78)   → NLL = 0.8
Read Cats sit on → Target mats (90) → NLL = 1.0
                                      ↓
                       Loss = (1.2 + 0.8 + 1.0) / 3 = 1.0
                                      ↓
                              Backpropagation → Parameter update
```

Suppose a parameter is `0.5` and its gradient is `0.3`. In a simplified SGD example with a learning rate of `0.01`, the updated value is $0.5 - 0.01 \times 0.3 = 0.497$. The numbers are illustrative. nanochat uses AdamW / Muon, whose updates also depend on the optimizer state and update rules. See [LLM Systems (2)](/zh/docs/ai/llm-system-2/) for the calculations.

## Gradient Accumulation: Splitting an Update Across Micro-batches

**Question:** How do we complete a parameter update when the GPU cannot hold all the sequences at once?

**Approach:**

1. **Limit peak GPU memory:** Split the data for the update into micro-batches. Run the forward pass and backpropagation for each micro-batch in turn.
2. **Combine their contributions:** Accumulate gradients on the same parameters and update them once all micro-batches have been processed.
3. **Keep the loss average consistent:** Weight each micro-batch by its number of valid targets. With equal counts, divide by the number of accumulation steps.

**How it works:**

```text
Data for one update → Micro-batch 1 → Weight the loss → Backpropagation ──┐
                      Micro-batch 2 → Weight the loss → Backpropagation ──┤ Accumulate gradients
                                                                          ↓
                                                                          Optimizer updates once → Clear gradients
```

[scripts/base_train.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py) uses the total target token count to determine the number of accumulation steps. Pretraining fills every row, so each micro-batch has the same number of valid targets and contributes equally. The BF16 / FP32 update works as follows:

```python
# Count the tokens processed per micro-batch across all ranks.
world_tokens = args.device_batch_size * args.max_seq_len * ddp_world_size
assert total_batch_size % world_tokens == 0
grad_accum_steps = total_batch_size // world_tokens

# x and y are already loaded. Each backward pass accumulates gradients on the parameters.
for micro_step in range(grad_accum_steps):
    loss = model(x, y)
    (loss / grad_accum_steps).backward()
    x, y, dataloader_state_dict = next(train_loader)

optimizer.step()                     # Apply one update after accumulating the gradients.
model.zero_grad(set_to_none=True)    # Clear the gradients after the update.
```

The learning rate schedule runs before the update. The FP16 path uses GradScaler. See [LLM Systems (2)](/zh/docs/ai/llm-system-2/) for the reasoning behind loss weighting.

**Example:** Suppose an update uses 8 equal-length sequences, each with the same number of valid targets. GPU memory can hold only 4 sequences at a time, so split them into two micro-batches:

```text
First 4 sequences: Mean loss = 1.2 → 1.2 / 2 → Backpropagation ──┐
Last 4 sequences:  Mean loss = 0.8 → 0.8 / 2 → Backpropagation ──┤
                                                               ↓
                                                               Mean loss = 1.0 → Update parameters once
```

Both forward passes use the same parameters before the update. If we use the two padded rows from earlier, they have 7 and 2 valid targets respectively. Their weights should be `7/9` and `2/9`.

## Saving and Resuming Training with Checkpoints

Training can take a long time. If it stops midway, how do we keep what the model has learned and pick up where it left off?

A checkpoint saves the model parameters and training state to disk. Load that state to resume from the saved step.

Suppose we save a checkpoint at step 3000 and training stops unexpectedly at step 3200. On restart, load the latest checkpoint to restore the state at step 3000, then continue at step 3001.

A checkpoint typically contains:

| Contents | Purpose |
|---|---|
| Model Weights | Preserve the learned parameters |
| Optimizer State | Retain statistics from past gradients for subsequent updates |
| Training Step | Record training progress |
| Learning Rate Scheduler State | Resume the learning rate schedule |
| DataLoader State | Restore the position in the data |
| RNG State | Restore the state of random processes |

For more, see [Hugging Face: Checkpointing](https://huggingface.co/docs/accelerate/usage_guides/checkpoint).

[scripts/base_train.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py) saves checkpoints to `base_checkpoints/<tag>/`. The `NANOCHAT_BASE_DIR` setting determines the root directory for training artifacts and defaults to `~/.cache/nanochat`:

| File | Contents |
|---|---|
| `model_<step:06d>.pt` | Model weights |
| `optim_<step:06d>_rank<rank>.pt` | Optimizer state for each rank |
| `meta_<step:06d>.json` | Model configuration, step, validation BPB, data position, and training loop state |

For example, the weights at step 3000 are stored in `model_003000.pt`. The loader approximates its previous position using the shard, row group, and epoch. Because it does not save every buffered document, a resumed run may differ token by token. See [nanochat/checkpoint_manager.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/checkpoint_manager.py) for the loading code.

# Post-Training: Teaching the Model to Follow Instructions

A pretrained base model already has basic capabilities. It still needs to learn to follow instructions, hold a conversation, and meet task and response quality requirements.

Supervised fine-tuning (SFT) uses reference responses as demonstrations. Reinforcement learning (RL) improves the model using rewards for its generated responses. LoRA reduces the number of parameters we need to update during training.

```text
Pretrained model
    ↓
Instructions and reference responses → SFT
                                        ↓
Generated responses → Rewards → RL update (optional)
    ↑                               │
    └───────────────────────────────┘

During training: Evaluate and save checkpoints
After training: Use the resulting model for inference

Parameter updates: Full fine-tuning / LoRA
```

## SFT: Learning from Reference Responses

**Question:** The base model can already continue text. How do we align it to follow instructions and generate expected responses?

**Approach:**

1. **Demonstrate the expected behavior:** Pair instructions with reference responses in conversation examples.
2. **Separate context from targets:** Use a chat template to encode roles and boundaries. Use a supervision mask to select targets from the assistant response.
3. **Train on the demonstrations:** Load the base model and update it using cross-entropy over valid response targets only.
4. **Evaluate and save the result:** Measure how well the model predicts reference responses and how well its generated responses perform, then save the chat model.

```text
Instructions and reference responses → Encode the conversation → IDs and supervision mask
                                                                  ↓
                                               Pack and pad → Batch → Shifted inputs and targets
                                                                      ↓
                                                                      Set unsupervised targets to -1
                                                                      ↓
Base model ─────────────────────────────────────────────────────────→ Response loss → Backpropagation → Parameter update
                                                                                                        ↓
                     Validate predictions and evaluate generated responses ─────────────────────────────→ Save the SFT model
```

### Preparing Conversations and Supervision Targets

**Question:** The model reads the user's message and learns to reproduce the reference response. How do we turn the two into inputs and targets?

**Approach:**

1. **Encode roles and boundaries:** Apply a chat template to the conversation to produce token IDs.
2. **Mark what the model should learn:** Build the supervision mask alongside the IDs. Mark the user message and assistant start marker with 0, and the response text and end marker with 1.
3. **Pass the data to the training loop:** Pack and pad conversations into batches. After shifting, set unsupervised targets to `-1`.

**How it works:**

```text
User request + Assistant reference response
    ↓
Encode roles, boundaries, and text → IDs + Supervision mask
    ↓
Pack complete conversations and pad as needed → Equal-length token rows + Mask rows
    ↓
x = first T tokens, y = last T tokens, target mask = last T mask values
    ↓
Target mask is 0 → Set y to -1 → Pass to the training loop
```

[scripts/chat_sft.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_sft.py) uses `TaskMixture` to combine conversation data from tasks such as SmolTalk, MMLU, and GSM8K. Each example contains `messages`, which [render_conversation()](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/tokenizer.py) converts into IDs and a supervision mask:

```python
# conversation comes from the training dataset and contains user and assistant messages.
ids, mask = tokenizer.render_conversation(conversation)
```

`sft_data_generator_bos_bestfit()` packs complete conversations into rows, pads unused positions with BOS, and sets the corresponding mask values to 0. It builds the targets as follows:

```python
# rows and mask_rows are the equal-length packed token rows and supervision masks.
batch_tensor = torch.tensor(rows, dtype=torch.long)
inputs = batch_tensor[:, :-1].to(device)
targets = batch_tensor[:, 1:].to(device).clone()
mask_targets = torch.tensor(mask_rows, dtype=torch.int8)[:, 1:].to(device)
targets[mask_targets == 0] = -1  # Keep only the response text and response end marker as targets.
```

This changes which positions contribute to the loss. The user message stays in `inputs` so later response positions can attend to it. For an introduction to chat templates, see [Hugging Face: Chat Templates](https://huggingface.co/learn/llm-course/chapter11/2).

**Example:** Continue with the sentence-generation task:

```python
conversation = {"messages": [
    {"role": "user", "content": "Write a sentence about cats sitting on mats."},
    {"role": "assistant", "content": "Cats sit on mats"},
]}
```

Use the following illustrative IDs: `243 = BOS`, `240 = User start`, `244 = User end`, `241 = Assistant start`, and `242 = Assistant end`. Here `[200, 201]` stands for the full request. The response text is still `[12, 45, 78, 90]`. These IDs are made up for the example. A single conversation fills exactly one row:

```text
1. Encode roles, boundaries, and text
IDs: [243, 240, 200, 201, 244, 241, 12, 45, 78, 90, 242]

2. Mark the supervised positions
Mask: [  0,   0,   0,   0,   0,   0,  1,  1,  1,  1,   1]

3. Shift the targets and mask unsupervised positions
x: [243, 240, 200, 201, 244, 241, 12, 45, 78,  90]
y: [ -1,  -1,  -1,  -1,  -1,  12, 45, 78, 90, 242]
```

This gives us tensors `x` and `y`, both of shape `[1, 10]`, with 5 valid targets. The position containing `Assistant start` (ID 241) predicts `Cats` (ID 12), and the position containing `on` (ID 78) predicts `mats` (ID 90). The next section uses these inputs and targets.

### Loading and Training the Base Model

**Question:** How do we use the conversation inputs and targets from the previous section to teach a base model to produce reference responses?

**Approach:**

1. **Start from the pretrained model:** Load the base model weights and configuration, and create an optimizer for this run.
2. **Measure response prediction error:** Run a forward pass on the conversation inputs and compute cross-entropy only for valid response targets.
3. **Update the model:** Run backpropagation and apply the optimizer update. Use the same gradient accumulation procedure as in pretraining.

**How it works:**

```text
Base model weights and configuration → Model + Optimizer
                                         ↓
Conversation x and y ─────────────────→ Forward pass → Mean loss over valid response targets
                                                        ↓
                                                        Backpropagation → Parameter update → Next conversation batch
```

[scripts/chat_sft.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_sft.py) loads the model and creates the optimizer and data iterator from the previous section:

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

By default, the script loads the pretrained optimizer state and resets the learning rate. Use `--load-optimizer=0` to disable this. After setup, a BF16 / FP32 update works as follows:

```python
for micro_step in range(grad_accum_steps):
    loss = model(x, y)                   # Forward pass and cross-entropy; ignore y = -1.
    (loss / grad_accum_steps).backward() # Accumulate gradients from response targets.
    x, y = next(train_loader)            # Load the next batch of conversations.
optimizer.step()                         # Update parameters after accumulating the gradients.
model.zero_grad(set_to_none=True)
```

SFT changes the data source and the targets that contribute to the loss. The parameter update works as it does in pretraining. The script weights each micro-batch's mean loss equally. When the number of valid response tokens varies, that differs from averaging over all valid tokens at once.

**Example:** Use the `[1, 10]` tensors `x` and `y` from the previous section and assume the five valid targets have the following negative log probabilities:

```text
Target: Cats  sit   on  mats  Assistant end
NLL:     1.2  0.8  0.6   1.0       0.4
                         ↓
Loss = (1.2 + 0.8 + 0.6 + 1.0 + 0.4) / 5 = 0.8
                         ↓
             Backpropagation → One optimizer update
```

Assume `grad_accum_steps = 1` in this example. The other five targets are `-1` and are excluded from the mean. The model still attends to the user context when predicting the response, so the response loss can produce gradients for the parameters involved.

### Evaluating and Saving the Chat Model

**Question:** How do we check that the model responds as requested and make the trained model available for inference or RL?

**Approach:**

1. **Check reference response prediction:** Compute prediction metrics on response targets from held-out conversations.
2. **Test whether the model can do the task:** Give the model only the request, let it generate a response, and score it using the task rules.
3. **Save the trained model:** Save the weights and configuration. Resuming training also requires the corresponding training state.

**How it works:**

```text
Validation conversations + Reference responses → Prediction metrics on valid response targets
Held-out task prompts ───→ Generate responses → Score task performance
                              ↓
                     Save the selected SFT checkpoint
                         ├── Chat inference
                         └── Starting point for RL
```

`chat_sft.py` measures response BPB and ChatCORE during training. The final section explains these metrics. The script saves model weights, optimizer state for each rank, and metadata containing the model configuration, step, and validation BPB to `chatsft_checkpoints/<tag>/`. It loads the tokenizer from a shared directory.

Use [scripts/chat_eval.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_eval.py) to evaluate held-out tasks:

```bash
python -m scripts.chat_eval -i sft
```

**Example:** Hold out the request `Describe cats sitting on mats in one sentence.`, with `Cats sit on mats` as the reference response, and run both checks:

| Check | Model input | Result |
|---|---|---|
| Response prediction | Validation request and reference response `Cats sit on mats` | Prediction error on the five valid response targets |
| Response generation | Validation request and assistant start marker | A response generated by the model |

Suppose the model generates `Cats sit on mats`. That response satisfies the request. After saving the model, inference loads its weights to generate responses, and RL loads them to begin training with a new scoring process.

## LoRA: Reducing the Number of Trainable Parameters

SFT requires further parameter updates. For a large model, full fine-tuning keeps gradients and optimizer state for all trainable parameters, which can use substantial GPU memory and storage. How do we train fewer parameters?

LoRA freezes the base parameters and adds a small number of trainable parameters to selected layers. Training updates only those new parameters.

At the pinned revision, [scripts/chat_sft.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_sft.py) updates all parameters and does not implement LoRA. See [LLM Systems (2)](/zh/docs/ai/llm-system-2/) for the adapter computation.

Many layers use parameter matrices in their computations. Full fine-tuning updates those matrices directly. LoRA keeps the original matrices frozen and represents each update as the product of two smaller matrices. Only those two matrices are trained.

For example, a matrix of shape $[4096, 4096]$ has about 16.78 million parameters. LoRA with rank 8 adds matrices of shapes $[4096, 8]$ and $[8, 4096]$, for a total of about 66,000 trainable parameters. Their product has the same shape as the original matrix and can be added to it as an update.

**How it works**

```python
model = load_pretrained_model()

# Freeze the base parameters and add trainable LoRA adapters.
model = add_lora_adapter(model)

# Use the same data preparation and SFT training loop as before.
train(model, train_dataloader)

# Save the trained adapter.
save_adapter(model)
```

**Example**

Use the same sentence-generation task, with the same inputs and reference response. The parameters that get updated are different:

| Component | Full fine-tuning | LoRA |
|---|---|---|
| Base parameters | Updated | Frozen |
| LoRA adapter | None | Updated |
| Training data and targets | Instructions and reference responses | Same |
| Update steps | Forward pass → Loss → Backpropagation → Optimizer | Same |
| Saved parameters | Full model parameters | Adapter parameters |

At inference time, load the adapter with its matching base model or merge the adapter's update into the base parameters.

For more, see [Hugging Face: LoRA (Low-Rank Adaptation)](https://huggingface.co/learn/llm-course/chapter11/4).

## RL: Improving the Model Based on Its Responses

SFT provides demonstrations in the form of reference responses. The model can still give incorrect or low-quality answers when it generates its own responses. How do we improve it based on what it actually produces?

In RL, the model generates a response, receives a reward for it, and uses that reward to update its parameters.

```text
Prompt → Generate a response → Reward → Update the model
         ↑                               │
         └───────────────────────────────┘
```

### Scoring Generated Responses

RL needs a reward that reflects how well the model completed the task or how good its response was. Here are two ways to produce that reward.

**1. Score with explicit rules**

When a task has verifiable criteria, responses can be scored directly by checking them against a reference or running unit tests. For example:

```text
Prompt: Write a Python function that returns the larger of two numbers.

Response A: return max(a, b)
Response B: return a

Test inputs and expected outputs:
(3, 1)   → 3
(1, 3)   → 3
(-1, -3) → -1
(-3, -1) → -1

Response A: passes 4/4, reward = 1.0
Response B: passes 2/4, reward = 0.5
```

The example shows only the functions' return statements. Each reward is the fraction of tests that pass.

**2. Learn to score from human preferences**

Qualities such as helpfulness and clarity are difficult to capture with explicit rules. Instead, collect human preferences and train a reward model to score new responses.

### RLHF: Training with Human Preferences

For example, ask people to compare two responses to the same prompt:

```text
Prompt: Explain what a tokenizer does in one sentence.

Response A: A tokenizer converts text into token IDs for a model.
Response B: It is something used in computers.

Human preference: A over B
```

Collect many such comparisons and train a reward model to learn which responses people tend to prefer. The model then generates new responses, the reward model scores them, and RL uses the scores to update the model. This process is called reinforcement learning from human feedback (RLHF).

```text
Humans compare responses → Preference data → Train a reward model
                                             ↓
Model generates responses ─────────────────→ Reward → Policy update
```

For more, see [Hugging Face: Introduction to Reinforcement Learning and its Role in LLMs](https://huggingface.co/learn/llm-course/chapter12/2).

<a id="grpo"></a>

### GRPO: Optimizing the Policy with Within-Group Comparisons

RLHF describes how human feedback enters training. Group Relative Policy Optimization (GRPO) is a policy optimization algorithm that uses rewards to update the model. Its rewards can come from a reward model trained on human preferences or from rules such as answer checking.

GRPO generates several responses to the same prompt, compares their rewards within the group to compute advantages, and uses those advantages to build the objective. We will use the reward model from the previous example.

**Training loop**

```python
for prompts in train_dataloader:
    responses = generate(model, prompts, num_samples=4)
    rewards = reward_model(prompts, responses)  # Score with the reward model.
    advantages = group_advantage(rewards)       # Compare rewards within each group.
    loss = grpo_loss(model, prompts, responses, advantages)

    loss.backward()        # Backpropagate.
    optimizer.step()       # Update parameters.
    optimizer.zero_grad()  # Clear gradients.
```

**Example**

Generate four new responses to the same prompt:

```text
Prompt: Explain what a tokenizer does in one sentence.
```

The rewards below are illustrative:

| Response | Reward model score | Advantage |
|---|---:|---:|
| A: A tokenizer converts text into token IDs for a model. | 0.9 | Positive |
| B: It is something used in computers. | 0.3 | Negative |
| C: A tokenizer splits text into tokens and maps them to IDs. | 0.8 | Positive |
| D: A tokenizer generates the model's final answer. | 0.2 | Negative |

The mean reward is 0.55. A and C score above the mean, while B and D score below it. GRPO builds a loss from these relative scores and updates the model. The updated model generates the next set of responses for scoring.

For more, see [Hugging Face: Understanding the DeepSeek R1 Paper](https://huggingface.co/learn/llm-course/chapter12/3).

### RL in nanochat: Sampling, Scoring, and REINFORCE Updates

**Question:** How do we turn responses generated by the current model and their scores into a parameter update?

**Approach:**

1. **Get a training signal:** Sample multiple responses per question and score them against the GSM8K reference answer.
2. **Compare responses to the same question:** Subtract the group mean reward from each response's reward to compute its advantage.
3. **Use the scores to update the model:** Recompute the log probabilities of generated targets, weight them by advantage to form the loss, then backpropagate and update the parameters.

**How it works:**

[scripts/chat_rl.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_rl.py) uses a simplified version of REINFORCE. Like the GRPO example, it compares rewards within a group. It omits division by the reward standard deviation, the reference-model KL constraint, and PPO ratio clipping.

```text
SFT model + Question → Sample repeatedly with gradients disabled → Responses and generation masks
      ↑                                                            ↓
      │                                        Reference answer → Reward → Advantage
      │                                                                     ↓
      │                                Pad and shift responses, keeping only valid generated targets
      │                                                                     ↓
      └── Parameter update ← Backpropagation ← Advantage-weighted log probabilities
```

The script loads the SFT model and creates an inference engine and a new optimizer. The engine shares the same model instance, so the next round of sampling uses the updated parameters. Training questions come from `GSM8K(subset="main", split="train")`.

**1. Sampling and scoring.** `get_batch()` runs under `@torch.no_grad()`. `render_for_completion()` drops the reference answer from each example, leaving the question and the assistant start marker. By default, the script samples 16 responses per question in two batches of 8:

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

# Decode only the text generated after the prompt and compare it with the reference answer.
rewards = [train_task.reward(conversation, tokenizer.decode(seq[prefix_length:]))
           for seq in generated_token_sequences]
```

**2. Building targets and computing advantages.** Responses vary in length, so first pad the token and mask rows. In `masks`, prompt tokens and tool outputs are marked 0, and tokens sampled by the model are marked 1. Padding positions are also set to 0:

```python
# ids and mask_ids are the padded token rows and generation mask rows.
inputs = ids[:, :-1]
targets = ids[:, 1:].clone()
targets[mask_ids[:, 1:] == 0] = -1  # Supervise only valid targets generated by the model.
rewards = torch.tensor(rewards, dtype=torch.float, device=device)
advantages = rewards - rewards.mean()  # Compare all responses to the same question together.
```

**3. Computing the policy loss and updating the model.** Sampling did not retain the computation graph, so run another forward pass in training mode. `batch_iterator = get_batch()` yields all responses and training targets for one question at a time. The update loop splits them into micro-batches:

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
        # Recompute log probabilities for generated targets. Ignored positions return 0.
        logp = -model(inputs, targets, loss_reduction="none").view_as(inputs)
        pg_obj = (logp * advantages.unsqueeze(-1)).sum()
        num_valid = (targets >= 0).sum().clamp(min=1)
        loss = -pg_obj / (num_valid * num_passes * examples_per_rank)
        loss.backward()  # Accumulate gradients across all questions and micro-batches in the update.
optimizer.step()
model.zero_grad(set_to_none=True)
```

`num_passes` is the number of micro-batches per question, and `examples_per_rank` is the number of questions per update on the current rank. Each response's advantage weights its valid generated targets. The script normalizes by the valid token count in each micro-batch before averaging. With variable-length responses, that differs from averaging over all valid tokens in the update.

**Example:** Consider a simplified math question: "Three cats eat two cookies each. How many cookies do they eat in total?" The reference answer is `6`. Suppose we sample four responses, each with exactly two valid generated targets. The responses are simplified so the answer can be extracted directly. Actual GSM8K responses follow the format required by the task:

| Response | Reward | Advantage | Sum of log probabilities for the two generated targets |
|---|---:|---:|---:|
| A: The answer is 6 | 1 | 0.5 | -1.0 |
| B: The answer is 5 | 0 | -0.5 | -2.0 |
| C: 6 in total | 1 | 0.5 | -1.5 |
| D: 8 in total | 0 | -0.5 | -3.0 |

The log probabilities are illustrative. The mean reward for this question is `0.5`. If the update contains just this question in one micro-batch, then `num_passes = 1` and `examples_per_rank = 1`, with 8 valid generated targets in total:

```text
Weighted sum = 0.5 × (-1.0) - 0.5 × (-2.0) + 0.5 × (-1.5) - 0.5 × (-3.0) = 1.25
Loss = -1.25 / 8 = -0.15625
    ↓
Backpropagation → Parameter update → Sample again with the updated parameters
```

A positive advantage pushes up the probability of the corresponding generated tokens. A negative advantage pushes it down. The policy loss can be negative, and its magnitude does not directly measure accuracy.

During training, the script measures pass@k on held-out questions. It saves the weights and model configuration to `chatrl_checkpoints/<tag>/`. The checkpoint lacks optimizer state, so it cannot directly resume the full RL training run.

# Inference: From User Input to a Response

After training, the model uses its learned parameters to generate a response one step at a time. Inference disables gradient tracking and skips backpropagation and optimizer updates.

```text
Load the model and tokenizer → Format the request and history → Prompt IDs
                                                                ↓
                                                                Prefill → Logits + KV cache
                                                                          ↓
                                                                          Select a token
                                                                          ↓
                                                             Emit it, record it, and check whether to stop
                                                                │                  │
                                                             Continue              Stop → Update the history
                                                                ↓
                                              New token + KV cache → Decode → New logits
                                                                               └──→ Select again
```

## Preparing the Prompt and Conversation History

**Question:** How do we turn the user's text and earlier messages into an input the model can continue?

**Approach:**

1. **Match the model's input format:** Load the trained weights and corresponding tokenizer, and use the same conversation format as in training.
2. **Add the current request:** Keep the history and append the user message and the assistant start marker.

**How it works:**

```text
Model weights and configuration + Tokenizer → Ready for inference
History + User request → Encode roles and boundaries → Assistant start marker → Prompt IDs
```

[scripts/chat_cli.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_cli.py) stores the conversation history in `conversation_tokens`. The tokenizer encodes the message text, and special tokens mark roles and message boundaries:

```python
model, tokenizer, meta = load_model(
    args.source, device, phase="eval", model_tag=args.model_tag, step=args.step,
)
engine = Engine(model, tokenizer)

# Initialize the history once per session and look up the role markers.
conversation_tokens = [tokenizer.get_bos_token_id()]
user_start = tokenizer.encode_special("<|user_start|>")
user_end = tokenizer.encode_special("<|user_end|>")
assistant_start = tokenizer.encode_special("<|assistant_start|>")
assistant_end = tokenizer.encode_special("<|assistant_end|>")

# Append the user input each turn and start a new assistant response.
conversation_tokens.append(user_start)
conversation_tokens.extend(tokenizer.encode(user_input))
conversation_tokens.append(user_end)
conversation_tokens.append(assistant_start)
```

**Example:** Return to the SFT sentence-generation task. The user enters `Write a sentence about cats sitting on mats.`. Using the same illustrative IDs, the input is:

```text
BOS → User start → User request → User end → Assistant start
243   240          200, 201       244        241

Prompt IDs: [243, 240, 200, 201, 244, 241]
```

The input leaves out the reference response `[12, 45, 78, 90, 242]`. The model generates the response one token at a time. To load the SFT model for interactive inference, run:

```bash
python -m scripts.chat_cli -i sft
```

## Prefill: Processing the Full Prompt

**Question:** Before generating the first token, how does the model process the entire context and prepare the state it will need later?

**Approach:** Run one forward pass over the full prompt. Save the keys and values (K/V) for each layer and use the logits at the last position to predict the first response token.

**How it works:**

```text
Full prompt IDs → Forward pass
                   ├── Keys and values for each layer → KV cache → Later decode steps
                   └── Logits at the last position → Token selection
```

[Engine.generate()](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/engine.py) stores the result of the first pass in a separate `kv_cache_prefill`:

```python
ids = torch.tensor([tokens], dtype=torch.long, device=device)
logits = self.model.forward(ids, kv_cache=kv_cache_prefill)
logits = logits[:, -1, :].expand(num_samples, -1)
```

The forward pass updates the cache in place and returns the logits. `expand` reuses the initial scores for multiple candidate responses to the same prompt. In the CLI, `num_samples = 1`.

**Example:** Process the 6 prompt tokens from the previous section together and cache their keys and values for each layer. The last position is `Assistant start` (ID 241). Its logits give the scores for candidates for the first response token. Suppose `Cats` (ID 12) has the highest score. Token selection happens in the next step.

## Token Selection: From Logits to an Output Token

**Question:** Given logits across the vocabulary, how do we pick the next token?

**Approach:**

1. **Always pick the highest-scoring candidate:** Use greedy decoding.
2. **Allow for varied outputs:** Adjust the temperature, limit the candidate set, then sample according to the resulting probabilities.

**How it works:**

```text
Logits ── Temperature=0 ──→ argmax → token
   │
   └── Temperature>0 → Optional top-k → Scale logits → Softmax → Sample → Token
```

[sample_next_token()](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/engine.py) receives logits from both prefill and decode. It selects a token as follows:

```python
if temperature == 0.0:
    next_ids = torch.argmax(logits, dim=-1, keepdim=True)  # Greedy decoding.
elif top_k is not None and top_k > 0:
    k = min(top_k, logits.size(-1))
    vals, idx = torch.topk(logits, k, dim=-1)             # Limit the candidate set.
    probs = torch.softmax(vals / temperature, dim=-1)   # Scale and normalize.
    choice = torch.multinomial(probs, num_samples=1, generator=rng)
    next_ids = idx.gather(1, choice)                     # Map back to vocabulary IDs.
else:
    probs = torch.softmax(logits / temperature, dim=-1)
    next_ids = torch.multinomial(probs, num_samples=1, generator=rng)
```

Top-p sampling and beam search are other ways to filter or search candidates. The sampler at this nanochat revision implements neither. See [Hugging Face: Basic decoding methods](https://huggingface.co/docs/transformers/main/en/generation_strategies#basic-decoding-methods) for an overview.

**Example:** Greedy decoding picks `Cats` (ID 12) from the previous section's logits. Suppose the model then generates `sit` and `on`, and when predicting `mats`, the illustrative logits are `mats = 0.9073` and `chairs = 0.6`, with all remaining candidates at `0`. With `temperature = 1` and `top_k = 2`, we get:

| Candidate token | ID | Probability within the candidate set |
|---|---:|---:|
| mats | 90 | 57.62% |
| chairs | 91 | 42.38% |

Greedy decoding picks `mats`. Sampling draws from the distribution in the table. Applying top-p with a threshold of `0.8` still keeps both candidates because the first alone has cumulative probability below `0.8`. The next section follows the path where we select `mats`.

## Decode: Continuing with Each New Token

**Question:** After selecting a token, how does the model use the existing context to continue generating until the response ends?

**Approach:**

1. **Reuse the earlier computation:** Feed the new token and the KV cache into the decode step to produce the next set of logits.
2. **Build the full response:** Repeat token selection, recording, and decode until an end marker appears or the length limit is reached.

**How it works:**

```text
Prefill logits → Select a token → Record and emit it, then check whether to stop
                 ↑                │ Continue
                 └── New logits ← Decode ← New token + KV cache
```

Each decode step in the engine takes only the new input of shape $[B, 1]$. The main call is:

```python
ids = torch.tensor(token_column, dtype=torch.long, device=device).unsqueeze(1)
logits = self.model.forward(ids, kv_cache=kv_cache_decode)[:, -1, :]
```

The CLI calls `engine.generate()` once for the turn, then iterates over the generator to display the output:

```python
generator = engine.generate(
    conversation_tokens, num_samples=1, max_tokens=256,
    temperature=args.temperature, top_k=args.top_k,
)
```

**Example:** For the same request, suppose greedy decoding produces this sequence:

| Model stage | Input IDs for this step | Token selected next |
|---|---|---|
| Prefill | `[243, 240, 200, 201, 244, 241]` | Cats, 12 |
| Decode | `[12]` | sit, 45 |
| Decode | `[45]` | on, 78 |
| Decode | `[78]` | mats, 90 |
| Decode | `[90]` | Assistant end, 242 |

The turn produces `[12, 45, 78, 90, 242]`. The end marker stops generation, leaving `Cats sit on mats` as the response text. The outputs are illustrative.

## KV Cache: Reusing Keys and Values

**Question:** Each decode step needs the keys and values from past positions. How do we avoid recomputing them?

**Approach:** During prefill, save the keys and values for each layer. At each decode step, compute Q, K, and V only for the new token and append its K and V to the cache. The new query can then attend over both past and current keys and values.

**How it works:**

```text
Cached keys and values ──────────┐
                                 ↓
New token → Q/K/V for this layer → Append K/V → Attention → Layer output
            │                                  ↑
            └─────────────── Q ────────────────┘
```

After prefill, the engine copies the result into `kv_cache_decode`, which has room for more tokens. Each attention layer reads its own keys and values from the cache. [nanochat/gpt.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/gpt.py) handles the reads and writes.

For more, see [Hugging Face: KV Caching](https://huggingface.co/docs/transformers/en/llm_tutorial#kv-caching).

# Evaluation: Predictive Performance, Task Capabilities, and Runtime Performance

Evaluation runs throughout training and use to check predictive performance, task capabilities, response quality, and runtime performance.

```text
Pretraining: Validation BPB
SFT: BPB on response predictions + ChatCORE task evaluation
RL: pass@k on held-out questions
During use: Latency, throughput, and resource usage
```

## Pretraining Evaluation: BPB

During pretraining, we mainly measure how well the model compresses text. A common metric is **bits per byte (BPB)**.

BPB converts cross-entropy loss into the number of bits needed per byte. Cross-entropy here uses natural logarithms (base $e$). Divide by $\ln 2$ to convert to bits, then divide by the average number of bytes per token to get bits per byte.

[scripts/base_eval.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_eval.py) computes BPB on the validation set:

```python
# Divide validation cross-entropy by ln(2), then convert to bits per byte.
bpb = loss.item() / math.log(2) / bytes_per_token
```

A lower BPB means the model predicts the text more accurately and compresses it more efficiently.

## Post-Training Evaluation: ChatCORE

In SFT and RL, we measure how well the model predicts response targets, using metrics such as BPB or loss, and also test whether it can perform the tasks.

nanochat uses **ChatCORE** to evaluate conversation and task performance. It includes subsets of tasks such as MMLU, GSM8K, and HumanEval. [scripts/chat_eval.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_eval.py) runs these evaluations.

## Evaluation in Use: Output Quality, Latency, and Throughput

Once the model is in use, evaluation shifts to output quality and runtime performance:

- **Output quality:** Check whether responses follow instructions, hallucinate, and reason coherently.
- **Latency:** Measure time to first token (TTFT) and time per output token (TPOT).
- **Throughput:** Count the total number of tokens generated per second.
- **Resource usage:** Track GPU memory usage and compute utilization.

That covers the LLM workflow from pretraining through post-training, inference, and evaluation, using nanochat's code.

