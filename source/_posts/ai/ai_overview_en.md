---
title: "Getting Started with AI: A Four-Layer Technology Map"
categories: [AI]
date: 2025-12-07
tags: [AI]
lang: en
---

# goal

**Chinese version: [AI 入门总览：四层技术框架](/i18n/zh/ai/ai-overview.html)**

The goal is to understand the four-layer AI technology map and its principles, and apply that understanding to real projects. Start with hands-on prompting and deepen understanding through investigation, practice, and iterative review.

| Layer | Main Question | Representative Modules |
| --- | --- | --- |
| Application / Product | How do model capabilities become useful business features? | AI applications, prompt / context, RAG, tools, skills, agents, workflows, Agent SDKs |
| Model / Algorithm | How are model capabilities learned and improved? | Model architecture, pretraining, post-training, fine-tuning, multimodality, capability evaluation |
| AI Systems / Infrastructure | How are models trained and served efficiently and reliably? | Distributed training, inference engines, model serving, resource scheduling, deployment and operations |
| Accelerated Computing / Hardware | How is computation executed and optimized? | GPUs, CUDA, compilers, kernels, compute and communication libraries, memory and interconnects |

<!-- more -->

1. **Investigation**: Understand principles, capability boundaries, existing solutions, and the problems to solve.
2. **Practice**: Choose a concrete task or engineering project, implement a solution, and validate judgments.
3. **Iteration through review**: Use results and execution records to locate problems, revise understanding and design, then begin the next round of investigation and practice.

# Application / Product layer

This layer combines models, data, tools, and software processes into features for business scenarios. Most AI Application / Product Engineer work falls within this scope.

## AI Applications and Products

Identify user needs, define interactions, business rules, and acceptance criteria, then integrate and deliver AI features. Customer support, coding assistance, and travel planning are different application scenarios; whether an application needs an agent depends on its tasks.

### Project References

1. `sdlc`: Connect requirements, design, implementation, and verification into a staged delivery workflow, with continuous updates based on existing artifacts.

## Agents / Workflows

Workflows organize explicit steps, conditions, and human intervention. Agents use models to select actions during execution, update state from tool feedback, and continue running. Both approaches can be combined and can include multiple cooperating agents.

### Project References

1. Deep dive: [Agent Engineering: SDK Requirements and Runtime Architecture](/2025/12/07/ai/agent_sdk_design_en/) covers recurring requirements, module boundaries, runtime layers, and implementation status.
2. The [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) open-source project.

# Model / Algorithm layer

This layer focuses on model representations, learning methods, and capability boundaries. A later model deep dive will develop this area; the main modules are outlined here.

## Model Architecture and Principles

Understand tokens, embeddings, attention, Transformers, and autoregressive generation, along with how parameters, context length, and model structure affect capabilities and compute requirements.

## Pretraining

Learn general representations and capabilities from large datasets and training objectives. Topics include data selection, cleaning, deduplication, objectives, and optimization methods.

## Post-Training and Task Adaptation

Adjust model behavior through supervised fine-tuning, preference optimization, and reinforcement learning. Adapt models with full fine-tuning or parameter-efficient methods such as LoRA. These categories overlap: SFT is a common post-training stage, and fine-tuning is also used for task adaptation.

## Multimodality

Study representations, alignment, and joint modeling across text, images, audio, and video, including understanding and generation capabilities.

## Model Capability Evaluation

Evaluate knowledge, reasoning, coding, tool use, multimodality, and safety. Distinguish benchmark performance from real task performance, and identify hallucination and generalization limits.

# AI Systems / Infrastructure layer

This layer turns training algorithms and models into runnable, scalable systems. A later inference and infrastructure deep dive will develop these topics.

## Distributed Training Systems

Organize training with data, tensor, and pipeline parallelism. Handle communication, checkpoints, failure recovery, and resource utilization at scale.

## Inference Engines

Load and execute models efficiently through prefill / decode processing, KV caches, batching, quantized execution, and parallel inference. Engines map model computation to lower-level kernels and devices.

## Model Serving

Expose inference as a callable service. Handle APIs, streaming, request queues, routing, rate limits, load balancing, and service availability.

## Resource Scheduling, Deployment, and Operations

Allocate GPUs and other resources. Manage containers, clusters, autoscaling, releases, and failures, while observing throughput, latency, utilization, and cost.

## Model and Data Management

Manage datasets, model weights, versions, experiment records, and artifacts so training, evaluation, deployment, and rollback remain traceable.

An inference runtime in this layer executes model computation; an Agent runtime in the first layer manages tasks, tools, and state. Training algorithms belong to the second layer, while parallel execution and recovery mechanisms belong here.

# Accelerated Computing / Hardware layer

This layer supplies the computing capabilities required by training and inference. A GPU is hardware; CUDA is NVIDIA's parallel computing platform. They are different kinds of components within this area.

## GPUs and Other Accelerators

Understand parallel execution units, matrix computation units, and device architecture, along with the workloads suited to accelerators such as GPUs and TPUs.

## CUDA and Device Programming

Understand threads, thread blocks, scheduling, and memory access, and use device programming models to implement parallel computation. CUDA is one such platform.

## Compilers and Kernels / Operators

Translate high-level model computation into executable programs. Improve performance through code generation, operator fusion, and memory-access optimization. A kernel is a program executed on a device; a model operator may map to one or more kernels.

## Compute and Communication Libraries

Use matrix computation, deep learning operator, and collective communication libraries to support training and inference. Examples include cuBLAS, cuDNN, and NCCL.

## Device Memory, Bandwidth, and Interconnects

Understand the memory footprint of weights, activations, and KV caches, plus the constraints imposed by memory bandwidth, device interconnects, and network communication. These limits affect parallelism, scheduling, and deployment choices in the third layer.
