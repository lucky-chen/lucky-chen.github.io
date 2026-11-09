---
title: nanochat：LLM 训练与推理流程
categories: [AI]
date: 2026-05-20
---

# Goal

结合 nanochat 官方源码，按执行顺序介绍预训练、SFT、RL 与对话推理的调用入口、核心步骤和产物。

- 预训练：准备数据和 Tokenizer，初始化模型，执行训练、评测与 Checkpoint 保存。
- 后训练：加载基础模型进行 SFT，再通过回答采样、Reward 和策略 Loss 执行 RL。
- 推理：加载模型，编码对话历史，调用 Engine 生成并输出回答。

<!-- more -->

源码依据：[karpathy/nanochat 官方仓库](https://github.com/karpathy/nanochat)的固定提交 [92d63d4](https://github.com/karpathy/nanochat/commit/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd)。文中源码链接均指向该提交；代码片段为节选或简化伪代码。`scripts/` 编排各阶段执行，`runs/` 串联运行命令。

模块内部实现见配套文章 [nanochat：LLM 核心架构与实现](llm_system_nanochat.md)。

# 执行流程

```text
文本与 tokenizer → 预训练 → base checkpoint → SFT → SFT checkpoint → RL → RL checkpoint
SFT checkpoint / RL checkpoint → 对话推理
```

各阶段共用 tokenizer，按“整体流程 → 核心代码逻辑 → 训练产物或推理产物”展开。代码注释标明步骤编号、作用与实现位置；`args` 表示命令行参数。

教学示例沿用 System 的 `Cats sit on mats`，正文 token IDs 为 `[12,45,78,90]`，实际 ID 由训练后的 Tokenizer 决定。预训练中，输入 `Cats sit on` 对应目标 `sit on mats`；SFT 中，句子生成指令对应标准回答 `Cats sit on mats`；推理中，输入前缀 `Cats sit on` 后逐步选择下一 token。数据与目标的具体对应见[模型输入与监督目标](llm_system_nanochat.md#model-inputs)。RL 保留官方 GSM8K 任务，用标准答案计算 reward。

各阶段产物的根目录由 `NANOCHAT_BASE_DIR` 指定，默认为 `~/.cache/nanochat`。下文 `<tag>` 表示模型目录名，`<step:06d>` 表示补齐至六位的训练步数，例如 `model_001000.pt`。单卡优化器文件以 `rank0` 结尾，多卡按 rank 分文件保存。

[speedrun.sh](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/runs/speedrun.sh) 和 [runcpu.sh](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/runs/runcpu.sh) 都没有自动执行 RL。`speedrun.sh` 在 SFT 后运行 `chat_eval`；`runcpu.sh` 执行到 SFT，训练中的评测由 SFT 参数控制。

<a id="pretrain-flow"></a>

# 预训练

预训练从随机初始化的 GPT 开始，用文本的下一 token 预测任务学习文本续写。输入为预训练文本、tokenizer 和训练配置，输出 base checkpoint，供 SFT 或文本生成使用。

## 整体流程

```text
1. 准备数据：下载文本，训练 tokenizer，评测编码效果。
2. 准备训练：选择设备，加载 tokenizer，创建 GPT、初始化权重，准备 optimizer 和 dataloader。
3. 反复训练：预测下一个 token → 计算 loss → 反向传播计算梯度 → 更新参数 → 清空梯度。
4. 在每个训练 step 开始时检查是否需要评测和保存；完成设定步数后，执行结束阶段的评测和保存。
```

## 核心代码逻辑

训练入口：[base_train.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py)。

### 数据准备

**核心逻辑代码**：

```bash
# ① 下载预训练文本数据集，这里下载 8 个 Parquet 分片；nanochat/dataset.py。
python -m nanochat.dataset -n 8
# ② 训练 tokenizer，并保存每个 token 对应的字节数；scripts/tok_train.py。
python -m scripts.tok_train
# ③ 评测 tokenizer；scripts/tok_eval.py。
python -m scripts.tok_eval
```

数据准备产物：

| 路径 | 内容与用途 |
|---|---|
| `base_data_climbmix/*.parquet` | 下载的预训练文本数据分片 |
| `tokenizer/tokenizer.pkl` | 训练后的分词器，用于文本与 token IDs 之间的转换；后续各阶段共用，不随 checkpoint 重复保存 |
| `tokenizer/token_bytes.pt` | 各 token 对应的字节数，供 BPB 评测使用 |

### 初始化设备、tokenizer、模型与 optimizer

模型创建见 [模型初始化](llm_system_nanochat.md#gpt-init)，参数分组见 [GPT.setup_optimizer()](llm_system_nanochat.md#optimizer-setup)。以下省略 batch size、学习率和权重衰减的缩放计算及 optimizer 参数，完整配置见 [base_train.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py)。

**核心逻辑代码**：

```python
# ① 选择设备、设置随机种子并初始化多卡通信；nanochat/common.py。
device_type = autodetect_device_type() if args.device_type == "" else args.device_type
ddp, ddp_rank, ddp_local_rank, ddp_world_size, device = compute_init(device_type)

# ② 加载 tokenizer、token 字节表及词表大小；nanochat/tokenizer.py。
tokenizer = get_tokenizer()
token_bytes = get_token_bytes(device=device)
vocab_size = tokenizer.get_vocab_size()

# ③ 按配置创建 GPT；scripts/base_train.py。
model = build_model_meta(args.depth)

# ④ 在目标设备分配参数内存。
model.to_empty(device=device)

# ⑤ 初始化权重与 RoPE 缓存；nanochat/gpt.py。
model.init_weights()

# 按配置恢复 checkpoint、执行可选 FP8 转换；scripts/base_train.py。
# 保留未编译模型，用于评测和保存；scripts/base_train.py。
orig_model = model

# ⑥ 编译模型。
model = torch.compile(model, dynamic=False)

# ⑦ 按训练规模配置 optimizer，省略缩放计算与参数；scripts/base_train.py、nanochat/gpt.py。
optimizer = model.setup_optimizer(...)
```

### 读取数据并训练模型

预训练文档打包见 [dataloader.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/dataloader.py)，batch 与预测目标关系见 [模型输入与监督目标](llm_system_nanochat.md#model-inputs)，预测和 loss 如何计算见 [GPT.forward()](llm_system_nanochat.md#gpt-forward)，梯度累积见 [Backward](llm_system_nanochat.md#optimizer-update)，参数更新见 [Optimizer](llm_system_nanochat.md#optimizer-setup)；FP16 的 GradScaler 分支见 [base_train.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py)。

**核心逻辑代码**：

```python
# ① 创建 train_loader；首次调用 next(train_loader) 时才读取数据；nanochat/dataloader.py。
train_loader = tokenizing_distributed_data_loader_with_state_bos_bestfit(
    tokenizer, args.device_batch_size, args.max_seq_len,
    split="train", device=device,
)
# ② 读取首个 batch 的输入 x、target y 和数据读取进度；nanochat/dataloader.py。
x, y, dataloader_state_dict = next(train_loader)

# 根据每次参数更新的目标 token 数，计算需要累积多少个 micro-batch。
world_tokens = args.device_batch_size * args.max_seq_len * ddp_world_size
assert total_batch_size % world_tokens == 0
grad_accum_steps = total_batch_size // world_tokens

# 训练步数可直接指定，也可根据计算量预算或训练 token 数与参数量的比例计算。
# 每次参数更新执行以下代码。这里展示 BF16/FP32，FP16 使用 GradScaler。
for micro_step in range(grad_accum_steps):
    # ③ 计算 next-token prediction 的 cross-entropy loss；nanochat/gpt.py。
    loss = model(x, y)
    loss = loss / grad_accum_steps
    # ④ 反向传播，将当前 micro-batch 的梯度累加到参数的 .grad。
    loss.backward()
    # ② 读取下一个 micro-batch。
    x, y, dataloader_state_dict = next(train_loader)

# 按当前训练步数调整学习率、Muon 动量和权重衰减。
for group in optimizer.param_groups:
    group["lr"] = group["initial_lr"] * get_lr_multiplier(step)
    if group["kind"] == "muon":
        group["momentum"] = get_muon_momentum(step)
        group["weight_decay"] = get_weight_decay(step)
# ⑤ 根据累加的梯度更新参数；nanochat/optim.py。
optimizer.step()
# ⑥ 清空梯度，准备下一次参数更新。
model.zero_grad(set_to_none=True)
```

### 评测与保存

评测脚本：[scripts/base_train.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py) 在训练中调用；[scripts/base_eval.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_eval.py) 用于独立评测。

| 指标 | 含义 | 评测数据集及内容 |
|---|---|---|
| BPB（Bits Per Byte） | 每字节的预测损失，越低越好 | ClimbMix 验证文本：本地排序后的最后一个 Parquet 分片，评估文本续写预测能力 |
| CORE | 各任务准确率按随机基线归一化后取平均，越高越好 | `eval_bundle/core.yaml` 指定的任务：知识问答、常识推理、阅读理解和符号逻辑，如 ARC、HellaSwag、SQuAD、Winograd |

评测结果：

- `base_eval/base_model_<step>.csv`：独立 CORE 评测的各任务准确率、归一化得分和 CORE 总分。
- 终端日志：BPB、CORE 及训练中的对应 step。
- W&B 记录：启用后保存训练中的验证 BPB、CORE、各任务归一化得分及对应 step。

## 训练产物

产物由 [scripts/base_train.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/base_train.py) 写入 `base_checkpoints/<tag>/`。

- `model_<step:06d>.pt`：模型权重及持久化 buffer，用于 SFT 或文本续写。
- `optim_<step:06d>_rank<rank>.pt`：各 rank 的 optimizer 状态及参数组配置，用于恢复训练。
- `meta_<step:06d>.json`：模型配置、训练参数、步数、验证 BPB、数据位置及训练循环状态，用于加载或恢复。

<a id="sft-flow"></a>

# 后训练 SFT

SFT 加载 base checkpoint 和共享 tokenizer，用带标准回答的指令与对话数据继续训练，学习遵循用户指令并完成任务，输出 SFT checkpoint。

本项目会更新模型的全部参数。另一种方案是 [LoRA（低秩适配）](https://huggingface.co/learn/llm-course/en/chapter11/4)：冻结基础权重，仅训练新增的低秩矩阵，可大幅减少可训练参数、梯度与 optimizer state 的显存占用，并减少部分反向计算；基础模型仍需加载和执行，实际显存与计算收益取决于配置。当前项目未实现 LoRA。

## 整体流程

```text
1. 加载预训练模型和配置，创建 optimizer，按需加载已有的 optimizer state。
2. 将任务整理成对话，编码并打包，用 mask 标出需要学习的回答。
3. 反复训练：计算回答 token 的 loss → 反向传播计算梯度 → 更新参数 → 清空梯度。
4. 训练中按配置评测 BPB / ChatCORE，结束时完成最终评测并保存 SFT 模型。
```

## 核心代码逻辑

训练入口：[chat_sft.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_sft.py)。

### 加载预训练模型

下方省略参数回退细节；加载实现见 [checkpoint_manager.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/checkpoint_manager.py)，参数分组见 [GPT.setup_optimizer()](llm_system_nanochat.md#optimizer-setup)。

**核心逻辑代码**：

```python
# ① 为这次训练选择设备；多卡时建立进程间通信；nanochat/common.py。
device_type = autodetect_device_type() if args.device_type == "" else args.device_type
ddp, ddp_rank, ddp_local_rank, ddp_world_size, device = compute_init(device_type)
# ② 加载预训练模型、tokenizer 和训练配置；nanochat/checkpoint_manager.py。
model, tokenizer, meta = load_model(
    "base", device, phase="train", model_tag=args.model_tag, step=args.model_step,
)

# 未指定的训练参数按预训练配置、脚本默认值的顺序补齐。

# ③ 保留 orig_model 用于评测和保存，训练时使用同一模型的编译版本。
orig_model = model
model = torch.compile(model, dynamic=False)
# ④ 创建 SFT optimizer；nanochat/gpt.py。
optimizer = model.setup_optimizer(
    embedding_lr=args.embedding_lr, unembedding_lr=args.unembedding_lr,
    matrix_lr=args.matrix_lr, weight_decay=0.0,
)
# ⑤ 按配置加载预训练 optimizer state，再把学习率改回本次设置的值；nanochat/checkpoint_manager.py。
if args.load_optimizer:
    state = load_optimizer_state("base", device, ddp_rank,
                                 model_tag=args.model_tag, step=args.model_step)
    if state is not None:
        lrs = [group["lr"] for group in optimizer.param_groups]
        optimizer.load_state_dict(state)
        for group, lr in zip(optimizer.param_groups, lrs):
            group["lr"] = lr
for group in optimizer.param_groups:
    group["lr"] *= args.init_lr_frac
    group["initial_lr"] = group["lr"]
```

### 准备训练对话和标准回答

[数据加载与适配](llm_system_nanochat.md#data-loading)、[对话编码与监督 mask](llm_system_nanochat.md#conversation-encoding)、[token 打包和补齐](llm_system_nanochat.md#token-packing)。

**核心逻辑代码**：

```python
# ① 加载任务：默认 SmolTalk ×1、MMLU ×3、GSM8K ×4；tasks/smoltalk.py、tasks/mmlu.py、tasks/gsm8k.py。
train_tasks = [
    SmolTalk(split="train"),
    *[MMLU(subset="all", split="auxiliary_train") for _ in range(args.mmlu_epochs)],
    *[GSM8K(subset="main", split="train") for _ in range(args.gsm8k_epochs)],
]

# ② 合并各任务的数据，并打乱样本读取顺序；tasks/common.py。
train_dataset = TaskMixture(train_tasks)
# 验证时从 val_dataset 读取对话。
val_dataset = TaskMixture([
    SmolTalk(split="test"),
    MMLU(subset="all", split="test", stop=5200),
    GSM8K(subset="main", split="test", stop=420),
])

# ③ 将对话编码为 token 和 mask，打包后构造输入 x 和 target y；scripts/chat_sft.py。
train_loader = sft_data_generator_bos_bestfit("train")

# ④ y 只保留参与 loss 计算的 token，其余位置设为 -1；scripts/chat_sft.py。
x, y = next(train_loader)
```

标准回答直接来自数据集。对话编码与监督位置见 [对话编码](llm_system_nanochat.md#conversation-encoding)，输入与 target 的移位见 [下一 token 目标](llm_system_nanochat.md#next-token-targets)。

### 计算回答 token 的 loss 并更新模型

loss 计算见 [GPT.forward()](llm_system_nanochat.md#gpt-forward)，梯度累积见 [Backward](llm_system_nanochat.md#optimizer-update)，参数更新见 [Optimizer](llm_system_nanochat.md#optimizer-setup)；FP16 分支见 [chat_sft.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_sft.py)。

**核心逻辑代码**：

```python
# 训练开始前计算梯度累积步数，x / y 来自上一步的 dataloader。
world_tokens = args.device_batch_size * args.max_seq_len * ddp_world_size
assert args.total_batch_size % world_tokens == 0
grad_accum_steps = args.total_batch_size // world_tokens
progress = 0.0

# 每次参数更新执行以下代码；外层循环记录步数、决定何时结束。这里展示 BF16/FP32。
for micro_step in range(grad_accum_steps):
    # ① 计算 target token 的 cross-entropy loss，忽略 y=-1 的位置；nanochat/gpt.py。
    loss = model(x, y)
    # ② 将 loss 除以梯度累积步数，再反向传播。
    (loss / grad_accum_steps).backward()
    # ③ 读取下一个 micro-batch，同时由 generator 更新 approx_progress；scripts/chat_sft.py。
    x, y = next(train_loader)
    progress = max(progress, approx_progress)

for group in optimizer.param_groups:
    group["lr"] = group["initial_lr"] * get_lr_multiplier(progress)
    if group["kind"] == "muon":
        group["momentum"] = get_muon_momentum(step)
# ④ 根据累加的梯度更新模型；nanochat/optim.py。
optimizer.step()
# ⑤ 清空梯度，准备下一次参数更新。
model.zero_grad(set_to_none=True)
```

学习率随训练数据的读取进度变化。各 rank 同步结束标记，避免有的进程结束、有的还在等待通信。generator 根据已读取的 micro-batch 数和 `--num-iterations` 判断是否结束。

### 评测与保存

评测脚本：[scripts/chat_sft.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_sft.py) 调用 BPB 与 ChatCORE；[scripts/chat_eval.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_eval.py) 执行对话任务评测。

| 指标 | 含义 | 评测数据集及内容 |
|---|---|---|
| BPB（Bits Per Byte） | 监督目标每字节的预测损失，越低越好 | SmolTalk `test` 对话、MMLU `test` 前 5200 条学科选择题、GSM8K `test` 前 420 条数学应用题，统计被监督的回答内容 |
| ChatCORE | 五项任务准确率按基线归一化后取平均，越高越好 | ARC-Easy / ARC-Challenge：科学选择题；MMLU：多学科选择题；GSM8K：数学应用题；HumanEval：Python 编程题，以测试通过情况判分 |

评测结果：

- 终端日志：验证 BPB、各任务准确率、ChatCORE；独立 `chat_eval.py` 输出各任务准确率和 ChatCORE。
- W&B 记录：启用后保存训练中的验证 BPB、各任务准确率、ChatCORE 及对应 step。

## 训练产物

产物由 [scripts/chat_sft.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_sft.py) 写入 `chatsft_checkpoints/<tag>/`。

- `model_<step:06d>.pt`：模型权重及持久化 buffer，用于对话推理或 RL。
- `optim_<step:06d>_rank<rank>.pt`：各 rank 的 optimizer 状态及参数组配置，保存更新历史。
- `meta_<step:06d>.json`：模型配置、训练参数、步数和验证 BPB，用于加载模型及记录训练结果。

<a id="rl-flow"></a>

# 后训练 RL

RL 加载 SFT checkpoint 和共享 tokenizer，使用带标准答案的 GSM8K 题目，让模型为同一道题生成多个回答，再根据各回答的 reward 调整模型，输出 RL checkpoint。

当前实现采用简化的 REINFORCE：每个回答的 advantage 等于其 reward 减去同题回答的平均 reward，不做标准差归一化，也未加入参考模型的 KL 约束或 PPO 的 ratio clipping。

本项目根据回答是否匹配标准答案计算 reward。RL 中还有 [RLHF（基于人类反馈的强化学习）](https://huggingface.co/learn/llm-course/en/chapter12/2)，使用人类偏好作为 reward 信号。

- DeepSeek 使用 GRPO，比较同一道题多个回答的 reward，调整模型生成这些回答的概率；原理与效果见 [HF：DeepSeek R1 与 GRPO](https://huggingface.co/learn/llm-course/en/chapter12/3)。

## 整体流程

```text
1. 加载 SFT 模型，创建 optimizer 和 Engine。
2. 每次参数更新处理分给各 rank 的题目，通过 next(batch_iterator) 依次获取每道题的数据：
   编码题目 → 模型生成多个回答 → 计算 reward 和 advantage → 整理成训练数据。
3. 用 advantage 加权各回答的 token 对数概率，计算策略梯度 loss；累加各题的梯度，更新参数后清空梯度。
4. 在指定步数开始时评测 pass@k，参数更新后按条件保存 RL 模型。
```

## 核心代码逻辑

训练入口：[chat_rl.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_rl.py)。采样与目标构造在 `get_batch()` 内完成，由参数更新循环中的 `next(batch_iterator)` 驱动；每次参数更新处理分给本 rank 的题目。

### 加载 SFT 模型，创建 Engine 与 optimizer

[模型加载](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/checkpoint_manager.py)、[Engine](llm_system_nanochat.md#inference-implementation)、[参数分组](llm_system_nanochat.md#optimizer-setup)。

**核心逻辑代码**：

```python
# 为本次 RL 训练选择设备，设置多卡通信。
device_type = autodetect_device_type() if args.device_type == "" else args.device_type
ddp, ddp_rank, ddp_local_rank, ddp_world_size, device = compute_init(device_type)
# ① 加载 SFT 模型权重，optimizer 从头创建；nanochat/checkpoint_manager.py。
model, tokenizer, meta = load_model(
    "sft", device, phase="eval", model_tag=args.model_tag, step=args.model_step,
)
# ② Engine 使用当前模型；更新参数后，下一轮生成会使用新权重；nanochat/engine.py。
engine = Engine(model, tokenizer)
# ③ 读取题目和标准答案：题目交给模型，标准答案用于计算 reward；tasks/gsm8k.py。
train_task = GSM8K(subset="main", split="train")
val_task = GSM8K(subset="main", split="test")
# ④ 新建 optimizer；nanochat/gpt.py。
optimizer = model.setup_optimizer(
    embedding_lr=args.embedding_lr, unembedding_lr=args.unembedding_lr,
    matrix_lr=args.matrix_lr, weight_decay=args.weight_decay,
)
# 设置 RL 开始时的学习率，后续在此基础上逐步降低。
for group in optimizer.param_groups:
    group["lr"] *= args.init_lr_frac
    group["initial_lr"] = group["lr"]
# 将每次参数更新所需的题目数平均分给各 rank。
assert args.examples_per_step % ddp_world_size == 0
examples_per_rank = args.examples_per_step // ddp_world_size
num_steps = (len(train_task) // args.examples_per_step) * args.num_epochs
```

### Rollout：为每道训练题采样多个回答

[render_for_completion()](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/tokenizer.py)、[Engine.generate_batch()](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/engine.py)、[reward 与训练目标构造](#rl-targets)。

以下代码位于 `get_batch()` 内部，每次处理一道题。分批采样限制单次生成的 batch size；生成的回答和 mask 用于下一步计算 reward 和构造训练 target。

**核心逻辑代码**：

```python
# get_batch()：回答采样部分，省略 reward 与目标构造；scripts/chat_rl.py。
@torch.no_grad()
def get_batch():
    rank_indices = range(ddp_rank, len(train_task), ddp_world_size)
    for example_idx in itertools.cycle(rank_indices):
        # ① 读取一道题，保留原始对话中的标准答案，用于计算 reward；tasks/gsm8k.py。
        conversation = train_task[example_idx]
        # ② 编码时移除标准回答，保留 assistant 起始标记，供模型续写；nanochat/tokenizer.py。
        tokens = tokenizer.render_for_completion(conversation)
        prefix_length = len(tokens)

        model.eval()
        sequences, masks = [], []
        # 默认每题生成 16 个回答，分成每批 8 个；生成时不记录梯度。
        for sampling_step in range(args.num_samples // args.device_batch_size):
            seed = hash((step, example_idx, sampling_step)) & 0x7FFFFFFF
            # ③ 生成回答，同时返回区分模型采样与工具注入位置的 mask；nanochat/engine.py。
            seq_batch, mask_batch = engine.generate_batch(
                tokens, num_samples=args.device_batch_size,
                max_tokens=args.max_new_tokens,
                temperature=args.temperature, top_k=args.top_k, seed=seed,
            )
            sequences.extend(seq_batch)
            masks.extend(mask_batch)

        # ④ sequences 包含 prompt 和回答；masks 中，模型采样位置为 1，prompt 和工具注入位置为 0；scripts/chat_rl.py。
        # reward 计算和 target 构造在下一步继续展开。
        ...  # reward 与目标构造在下一小节展开。
        yield ...
```

<a id="rl-targets"></a>

### 计算 reward、advantage，构造训练目标

以下代码接续回答采样，仍在同一 `get_batch()` 内，使用已生成的 `sequences`、`masks`、`conversation` 与 `prefix_length`。

**核心逻辑代码**：

```python
# get_batch()：reward 与目标构造部分；scripts/chat_rl.py。
@torch.no_grad()
def get_batch():
    rank_indices = range(ddp_rank, len(train_task), ddp_world_size)
    for example_idx in itertools.cycle(rank_indices):
        ...  # 上一小节的采样得到 sequences、masks、conversation、prefix_length。

        rewards = []
        for seq in sequences:
            # 去掉 prompt，将模型生成的回答解码为文本。
            response = tokenizer.decode(seq[prefix_length:])

            # ① 任务适配器提取并比较答案，返回 0/1 reward；tasks/gsm8k.py。
            reward = train_task.reward(conversation, response)
            rewards.append(reward)

        # ② 用 advantage 衡量同一道题各回答的相对表现；scripts/chat_rl.py。
        rewards = torch.tensor(rewards, dtype=torch.float, device=device)
        advantages = rewards - rewards.mean()
        # rewards=[1, 0, 1, 0] → advantages=[0.5, -0.5, 0.5, -0.5]。
        # 正 advantage 推动模型提高这些 token 的概率，负 advantage 则推动降低。
        # 同题回答全对或全错时，advantage 均为 0。

        # ③ 补齐到本题最长回答，再构造输入和 target；非采样位置不计入 loss；scripts/chat_rl.py。
        max_length = max(len(seq) for seq in sequences)
        assistant_end = tokenizer.encode_special("<|assistant_end|>")
        ids = torch.tensor([seq + [assistant_end] * (max_length - len(seq))
                            for seq in sequences], dtype=torch.long, device=device)
        mask_ids = torch.tensor([mask + [0] * (max_length - len(mask))
                                 for mask in masks], dtype=torch.long, device=device)
        inputs = ids[:, :-1]
        targets = ids[:, 1:].clone()
        targets[mask_ids[:, 1:] == 0] = -1
        # ④ 返回给参数更新循环中的 next(batch_iterator)；scripts/chat_rl.py。
        yield sequences, inputs, targets, rewards, advantages
```

`assistant_end` 用于补齐，mask 为 0；prompt、工具注入和 padding 均不计入 loss。

### 计算策略 loss，累积梯度并更新参数

逐 token loss 的计算见 [GPT.forward()](llm_system_nanochat.md#gpt-forward)，参数更新见 [Optimizer](llm_system_nanochat.md#optimizer-setup)，分布式梯度同步见 [MuonAdamW](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/nanochat/optim.py)。

**核心逻辑代码**：

```python
# 训练开始前创建 batch_iterator；每次 next(batch_iterator) 为下一道题生成回答并构造训练数据。
batch_iterator = get_batch()

# 外层按训练步数循环；每次参数更新先处理分给本 rank 的所有题目。
for example_step in range(examples_per_rank):
    # ① 驱动 get_batch()，为本题采样回答、计算奖励并构造训练数据；scripts/chat_rl.py。
    sequences, inputs_all, targets_all, rewards_all, advantages_all = next(batch_iterator)
    model.train()
    num_passes = inputs_all.size(0) // args.device_batch_size

    for pass_idx in range(num_passes):
        # batch_size=8 时依次取回答 [0:8]、[8:16]。
        b0 = pass_idx * args.device_batch_size
        b1 = b0 + args.device_batch_size
        inputs, targets = inputs_all[b0:b1], targets_all[b0:b1]
        advantages = advantages_all[b0:b1]

        # ② NLL 取负得到每个 token 的对数概率，再乘以该回答的 advantage；nanochat/gpt.py。
        logp = -model(inputs, targets, loss_reduction="none").view_as(inputs)
        pg_obj = (logp * advantages.unsqueeze(-1)).sum()
        num_valid = (targets >= 0).sum().clamp(min=1)
        loss = -pg_obj / (num_valid * num_passes * examples_per_rank)
        # ③ 反向传播，累加本题当前 micro-batch 的梯度。
        loss.backward()

for group in optimizer.param_groups:
    group["lr"] = group["initial_lr"] * get_lr_multiplier(step)
# ④ 本次所有题目处理完后，用累计梯度更新参数；nanochat/optim.py。
optimizer.step()
# ⑤ 清空梯度，下一步让更新后的模型重新生成回答。
model.zero_grad(set_to_none=True)
```

### 评测与保存

评测脚本：[scripts/chat_rl.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_rl.py) 中的 `run_gsm8k_eval()`。

| 指标 | 含义 | 评测数据集及内容 |
|---|---|---|
| pass@k | 每题前 k 个采样回答中至少一个正确的题目占比，越高越好 | GSM8K `main/test`：多步数学应用题，提取生成回答的最终数值，与标准答案比较 |

评测结果：

- 终端日志：各 k 值对应的 pass@k 和训练 step。
- W&B 记录：启用后保存各 k 值对应的 pass@k 和训练 step。

## 训练产物

产物由 [scripts/chat_rl.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_rl.py) 写入 `chatrl_checkpoints/<tag>/`。

- `model_<step:06d>.pt`：模型权重及持久化 buffer，用于对话推理。
- `meta_<step:06d>.json`：模型配置，用于加载模型。

<a id="inference-flow"></a>

# 推理

加载 SFT 或 RL checkpoint，根据用户输入和历史生成回答。`chat_cli.py` 负责输入输出及历史，`Engine` 负责本轮生成；内部实现见 [生成与状态管理](llm_system_nanochat.md#inference-implementation)。

## 整体流程

```text
加载模型与 tokenizer，创建 Engine
→ 编码用户输入，追加对话历史
→ 调用 generate()，创建 generator
→ 迭代 generator：Prefill → 采样与 Decode → 结束
→ 解码输出，将回答追加到历史
```

## 核心代码逻辑

以下代码按调用顺序摘自 [scripts/chat_cli.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_cli.py)，省略交互命令与日志。

### 加载模型与创建 Engine

**核心逻辑代码**：

```python
# ① 初始化设备环境；nanochat/common.py。
device_type = autodetect_device_type() if args.device_type == "" else args.device_type
_, _, _, _, device = compute_init(device_type)

# ② 加载 SFT / RL 模型与共享 tokenizer；nanochat/checkpoint_manager.py。
model, tokenizer, meta = load_model(
    args.source, device, phase="eval", model_tag=args.model_tag, step=args.step,
)

# ③ 创建本轮生成使用的 Engine；nanochat/engine.py。
engine = Engine(model, tokenizer)
```

### 编码输入与对话历史

**核心逻辑代码**：

```python
# ① 初始化对话历史和角色标记；nanochat/tokenizer.py。
bos = tokenizer.get_bos_token_id()
user_start = tokenizer.encode_special("<|user_start|>")
user_end = tokenizer.encode_special("<|user_end|>")
assistant_start = tokenizer.encode_special("<|assistant_start|>")
assistant_end = tokenizer.encode_special("<|assistant_end|>")
conversation_tokens = [bos]

# ② 每轮编码 user 输入，追加 assistant 起始标记；scripts/chat_cli.py。
conversation_tokens.append(user_start)
conversation_tokens.extend(tokenizer.encode(user_input))
conversation_tokens.append(user_end)
conversation_tokens.append(assistant_start)
```

`conversation_tokens` 保存完整历史。后续轮次接着追加 user 输入，`clear` 将历史重置为 `[bos]`。

### 调用 Engine 生成回答

**核心逻辑代码**：

```python
# ① 传入完整历史和生成参数，创建 generator；nanochat/engine.py。
generation = engine.generate(
    conversation_tokens,
    num_samples=1,
    max_tokens=256,
    temperature=args.temperature,
    top_k=args.top_k,
)
```

`generate()` 的单回答伪代码，省略设备、随机数初始化、工具调用和临时缓存复制：

```python
# Engine.generate()：单回答生成伪代码；nanochat/engine.py。
def generate(self, tokens, max_tokens, temperature, top_k):
    # ① 创建本轮 KV Cache，预留 prompt 和后续生成的空间。
    kv_cache = KVCache(...)

    # ② Prefill：完整 prompt 转 Tensor，计算并缓存各层 K/V。
    ids = torch.tensor([tokens])                         # [1, T_prompt]
    logits = self.model.forward(ids, kv_cache=kv_cache)[:, -1, :]  # [1, V]

    completed = False
    for step in range(max_tokens):
        if completed:
            break

        # ③ 选择下一 token：temperature=0 取最高分，否则按温度和 top-k 采样。
        next_id = sample_next_token(logits, rng, temperature, top_k)
        token = next_id[0, 0].item()

        # ④ 更新结束状态，将 token 交给调用方。
        completed = token in (assistant_end, bos)
        yield [token], [1]

        # ⑤ Decode：只输入新 token，追加其 K/V，复用历史 K/V，预测下一 token。
        ids = torch.tensor([[token]])                    # [1, 1]
        logits = self.model.forward(ids, kv_cache=kv_cache)[:, -1, :]  # [1, V]
```

| 参数 | 作用 | CLI 设置 |
|---|---|---|
| `temperature` | 控制采样分布；0 时采用 Greedy | 默认 0.6 |
| `top_k` | 将采样候选限制为分数最高的 k 个 token | 默认 50 |
| `max_tokens` | 限制本轮输出的 token 数，包含工具注入位置 | 固定为 256 |

内部实现见 [Prefill](llm_system_nanochat.md#prefill)、[KV Cache](llm_system_nanochat.md#kv-cache)、[Token Sampling](llm_system_nanochat.md#token-sampling)、[Decode](llm_system_nanochat.md#decode) 和 [RowState](llm_system_nanochat.md#row-state)。

### 输出回答与更新历史

**核心逻辑代码**：

```python
# ① 迭代 generator，逐个解码并输出 token；scripts/chat_cli.py。
response_tokens = []
for token_column, token_masks in generation:
    token = token_column[0]
    response_tokens.append(token)
    print(tokenizer.decode([token]), end="", flush=True)

# ② 补齐回答结束标记，将本轮回答追加到历史。
if response_tokens[-1] != assistant_end:
    response_tokens.append(assistant_end)
conversation_tokens.extend(response_tokens)
```

### 评测

评测脚本：[scripts/chat_eval.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/chat_eval.py)、[scripts/infer_bench.py](https://github.com/karpathy/nanochat/blob/92d63d4e8bb4df75c3b71618f31ddde2378b2bcd/scripts/infer_bench.py)。

```bash
# ① 评测对话任务；scripts/chat_eval.py。
python -m scripts.chat_eval -i sft

# ② 测量生成性能；scripts/infer_bench.py。
python -m scripts.infer_bench -i sft
```

| 指标 | 含义 | 数据或输入 |
|---|---|---|
| 各任务准确率、ChatCORE | 对话任务表现及归一化综合分，越高越好 | ARC 科学选择题、MMLU 学科选择题、GSM8K 数学应用题、HumanEval Python 编程题 |
| Prefill / Decode 吞吐、首 token 延迟、显存占用 | 生成速度、响应时间与内存开销 | benchmark prompt，按配置控制长度及 batch size |

评测结果：

- `chat_eval.py` 终端输出：各任务准确率与 ChatCORE。
- `infer_bench.py` 终端输出：性能统计，最后一行为 JSON；当前使用单 CUDA GPU，RL checkpoint 缺少其所需的 step 字段。

## 推理产物

- 回答文本：CLI 流式输出；`--prompt` 模式回答一次后退出。
- 对话历史：保存在 CLI 的 `conversation_tokens` 中，供下一轮输入使用。
