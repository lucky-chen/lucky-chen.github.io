---
title: 全栈视角下的后端技术栈地图
categories: BackEnd
date: 2026-10-09
---

# 目标

**English version: [Backend Architecture and Technology Stack Map](/2026/10/09/backend/full_stack_tech_en/)**

快速了解全栈，尤其是后端技术栈。

1. 全栈项目整体架构和技术栈地图。
2. 电商秒杀系统案例，串联整体架构和关键技术。
3. 具体项目选型和架构设计参考。

<!-- more -->

# 全栈架构总览

主链路按“大前端 + 后端”两部分理解。大前端负责端上业务逻辑、客户端框架和本地运行机制；后端负责请求接入、业务处理、数据、异步、部署运行。

| 部分 | 层级 | 主层 | 解决的问题 | 常见技术 / 模式 / 基础设施 |
|---|---:|---|---|---|
| 大前端 | 1 | 前端应用层 | 端上业务逻辑、页面流程、用户交互、业务状态 | Web App、Mobile App、Mini Program、Dashboard、Content Site |
| 大前端 | 2 | Framework 层 | 页面/客户端开发范式、组件、路由、状态、API 调用 | Android、iOS、React、Vue、Rax、Next.js、Pinia、TanStack Query |
| 大前端 | 3 | 系统内核层 | 代码编译、运行时、虚拟机、渲染、线程与事件循环 | Compiler、JS VM、JVM、ART、WebView、Browser Rendering、Native Rendering |
| 后端 | 4 | 接入层 | 请求入口、路由分发、反向代理、流量控制 | Nginx、API Gateway、Web 框架：Gin、Gorilla Mux、Spring MVC |
| 后端 | 5 | 认证授权层 | 身份识别、登录态、角色权限、资源访问控制 | JWT、Session、OAuth2、OIDC、RBAC、认证框架 / 库：Better Auth |
| 后端 | 6 | 后端业务层 | 用例编排、事务边界、外部依赖调用、错误语义 | Service、Use Case、Application Service、业务状态机 |
| 后端 | 7 | 领域模型层 | 业务概念、业务规则、状态转换、领域事件 | Entity、Value Object、Aggregate、Domain Event |
| 后端 | 8 | 数据与存储层 | 数据保存、查询、缓存、搜索、上传下载 | MySQL、PostgreSQL、Redis、Elasticsearch、S3、MinIO |
| 后端 | 9 | 异步与实时层 | 削峰、耗时任务、重试、长流程、实时进度推送 | Kafka、RabbitMQ、River、工作流引擎：Temporal、Hatchet、SSE、WebSocket |
| 后端 | 10 | 框架系统层 | 后端开发框架、语言运行时、构建工具、部署运行环境 | 框架：Spring Boot、Gin、NestJS、Express、Fastify<br>运行时：JVM、Go runtime、Node.js runtime<br>构建/包管理：Maven、Gradle、Go toolchain、npm、pnpm<br>部署运行基础设施：Docker、Kubernetes、云运行时 |

横切能力贯穿所有层，负责安全、稳定性和可维护性。

| 横切能力 | 贯穿哪些层 | 解决的问题 | 常见技术 / 云能力 |
|---|---|---|---|
| 配置与环境 | 全部 | 多环境配置、密钥、特性开关、运行参数 | `.env`、Viper、Vault、Secret Manager、ConfigMap、Feature Flag |
| 安全治理 | 全部 | 防攻击、防泄露、防越权、防滥用、合规审计 | WAF、CORS、Rate Limit、KMS、IAM、Gitleaks、Trivy、bcrypt |
| 可观测性 | 全部 | 日志、指标、链路追踪、健康检查、告警、容量判断 | Prometheus、Grafana、Loki、ELK、OpenTelemetry、CloudWatch |
| 云厂商托管能力 | 全部 | 用托管资源替代自建基础设施，降低运维成本 | CDN、LB、RDS、Redis、S3/OSS/COS、SQS、EKS、Cloud Run |
| 发布与变更管理 | 后端业务层、数据与存储层、异步与实时层、框架系统层 | 灰度发布、快速回滚、数据库变更、配置变更 | CI/CD、Blue-Green、Canary、Schema Migration、Rollback |
| AI 治理 | 后端业务层、数据与存储层、异步与实时层、框架系统层 | Prompt 注入防护、内容安全、模型评测、成本控制、调用审计 | Guardrails、Moderation、Eval、Token Budget、Prompt Audit、Model Router |

## AI 应用后端补充

AI 应用后端通常是在传统后端链路上增加模型调用、上下文检索、工具调用、异步任务和治理能力。

| AI 后端能力 | 所属链路 | 常见技术 / 模式 |
|---|---|---|
| 检索增强 | 数据与存储层、后端业务层 | RAG、Embedding Store、pgvector、Milvus、Pinecone、Weaviate |
| 任务编排 | 后端业务层、异步与实时层 | AI Use Case、Agent Workflow、Prompt Orchestration、Tool Calling、Agent Task Queue |
| 模型运行 | 框架系统层 | Ollama、vLLM、Triton、SageMaker、Vertex AI |
| 流式返回 | 异步与实时层、接入层 | Streaming Response、SSE、WebSocket |
| 治理与评测 | 横切能力 | Guardrails、Moderation、Eval、Token Budget、Prompt Audit、Model Router |

# 用电商秒杀系统串起来

## 业务场景是什么

```text
100 台手机限量抢购
大量用户同时请求
系统要保证性能、数据一致性和安全性
```

## 为什么用这个场景

秒杀系统适合作为后端架构案例，因为它同时包含业务闭环和系统质量要求。业务上要完成登录、资格校验、扣库存、下单、支付和取消；系统上要处理高并发、防超卖、幂等、削峰、补偿、扩容和排障。

用这个场景串后端技术栈，关键是把问题拆开，再看每类问题由哪一层后端能力解决：

```text
业务问题 → 功能需求 → 业务层 / 领域层 / 数据层
系统问题 → 非功能需求 → 接入层 / 缓存 / MQ / 可观测性 / 部署运行
```

## 这个场景的需求和能力要求

这个场景的需求可以拆成两类：功能需求负责完成业务闭环，非功能需求负责保证系统在高流量、故障和业务边界条件下仍然稳定且正确。

功能需求：

| 功能需求 | 对应的后端能力 | 典型技术 / 手段 |
|---|---|---|
| 用户必须登录且有资格参与 | 认证授权层、风控能力 | Session / JWT、RBAC、资格令牌、验证码、IP / 用户限流 |
| 活动必须按时间开始和结束 | 业务规则、活动配置 | 活动配置、时间窗口校验、开关控制 |
| 库存必须能查询和扣减 | 数据与存储层、一致性控制 | Redis 库存、DB 库存、库存流水 |
| 同一用户只能抢一次 | 幂等与去重能力 | 用户维度去重 key、request_id、订单唯一索引 |
| 抢购成功后要创建订单 | 后端业务层、数据持久化 | Application Service、Order Worker、MySQL |
| 订单需要支付、取消和关闭 | 领域模型层、状态流转 | 订单状态机、领域事件、支付回调 |
| 支付超时后要释放库存 | 异步任务、补偿能力 | 延迟队列、定时任务、库存回滚 |

非功能需求可以分为高性能、高可用、高扩展和数据一致性四类：

| 类别 | 非功能需求 | 对应的后端能力 | 典型技术 / 手段 |
|---|---|---|---|
| 高性能 | 大量用户同时进入活动页 | 接入层、流量控制、静态资源加速 | CDN、Nginx、API Gateway、Rate Limit |
| 高性能 | 请求高峰不能直接打爆数据库 | 缓存、削峰、异步处理 | Redis、MQ、Worker、排队 |
| 高性能 | 热点商品访问不能拖垮系统 | 热点缓存、热点隔离、限流 | 本地缓存、Redis、Rate Limit、库存分片 |
| 高可用 | 部分组件失败后不能丢单 | 可靠消息、重试、补偿 | 本地消息表、事务消息、Retry、DLQ、补偿扫描 |
| 高可用 | 出问题要能定位 | 可观测性 | traceId、Metrics、Logs、Tracing、告警 |
| 高扩展 | 流量增长后能扩容 | 水平扩展、容量规划 | 无状态服务、多副本、Redis Cluster、MQ Cluster、Worker 扩容 |
| 数据一致性 | 100 台手机不能超卖 | 原子扣减、事务兜底 | Redis Lua、DB 乐观锁 |
| 数据一致性 | 重复请求不能重复下单 | 幂等、去重、唯一约束 | request_id、幂等表、订单唯一索引 |
| 数据一致性 | 支付超时不能长期占用库存 | 状态流转、补偿 | 延迟队列、订单关闭、库存释放 |

功能需求和非功能需求连起来，就形成秒杀系统的主链路：

```text
准备阶段
→ 商品库存预热到 Redis
→ 生成活动配置、限购规则、资格令牌

请求阶段
→ CDN / Nginx / Gateway
→ 限流、风控、登录校验
→ 校验活动时间、资格、一人一单
→ Redis Lua 原子扣减库存
→ 成功后写入 MQ

异步订单阶段
→ Worker 异步创建订单
→ MySQL 持久化订单
→ 支付超时取消
→ 库存补偿
```

# 秒杀系统演进路线

## 阶段一：单体版

```text
User → Nginx → Spring Boot / Gin 单体应用 → MySQL
```

| 项 | 内容 |
|---|---|
| 目标 | 理解基础 Web 架构，实现完整业务闭环，掌握 Controller / Service / DAO |
| 能解决 | 基本下单、商品查询、用户登录、订单落库 |
| 不能解决 | 高并发下数据库压力大、库存容易超卖、单实例扩展能力有限 |
| 适用 | 小型项目、内部系统、MVP |

核心链路代码：

```go
func Seckill(ctx context.Context, userID, skuID int64) {
	// 开启事务，保证扣库存和创建订单一起成功或一起失败。
	tx := db.Begin()

	// 锁定库存行，避免并发请求同时读到相同库存。
	stock := tx.Query("select stock from sku where id = ? for update", skuID)
	if stock <= 0 {
		tx.Rollback()
		return
	}

	// 扣减库存。
	tx.Exec("update sku set stock = stock - 1 where id = ?", skuID)

	// 创建订单。
	tx.Exec("insert into orders(user_id, sku_id, status) values (?, ?, 'created')", userID, skuID)
	tx.Commit()
}
```

相关技术栈：

| 类别 | 作用 | JS / Node | Go | Java |
|---|---|---|---|---|
| Web 框架 | 接收请求、路由分发、组织接口 | Express、NestJS、Fastify | Gin、Echo、Fiber | Spring Boot、Spring MVC |
| 数据访问 | 查询、事务、CRUD | Prisma、TypeORM、Drizzle | database/sql、GORM、sqlc、ent | MyBatis、Spring Data JPA、MyBatis-Plus |
| 基础工程 | 配置、日志、校验、项目组织 | dotenv、Pino、Zod | Viper、zap、validator | Spring Config、Logback、Hibernate Validator |


该阶段可以完成查询库存、扣库存、创建订单的完整闭环。并发升高后，请求直打数据库，库存行锁和订单写入会成为瓶颈。

## 阶段二：引入 Redis

```text
User
  ↓
Nginx
  ↓
App
  ├─ Redis：热点商品、库存、资格、去重
  └─ MySQL：订单、用户、商品持久化
```

| 项 | 内容 |
|---|---|
| 目标 | 降低数据库压力，提升热点读性能，用原子操作控制库存扣减 |
| 能解决 | 热点商品读取、库存快速扣减、重复下单初步拦截 |
| 不能解决 | 异步削峰、订单落库压力、Redis 与 DB 一致性、热 key |
| 升级信号 | Redis 扛住读写，但订单创建、支付、通知等后续链路开始阻塞 |

核心链路代码：

```go
func Seckill(ctx context.Context, userID int64, skuID string) {
	stockKey := "stock:" + skuID
	userKey := fmt.Sprintf("seckill:user:%d:sku:%s", userID, skuID)

	// Redis Lua 原子完成库存扣减和用户去重。
	result := redis.Eval(decrStockLua, stockKey, userKey)
	if result != "ok" {
		return
	}

	// 库存预扣成功后，同步创建订单。
	db.Exec("insert into orders(user_id, sku_id, status) values (?, ?, 'created')", userID, skuID)
}
```

相关技术栈：

| 类别 | 作用 | JS / Node | Go | Java |
|---|---|---|---|---|
| Redis Client | 访问 Redis、执行 Lua | ioredis、node-redis | go-redis | Spring Data Redis、Lettuce、Jedis |
| 缓存与库存扣减 | 热点缓存、库存预扣、去重 | Redis Lua、lru-cache | Redis Lua、Ristretto | Redis Lua、Caffeine、Redisson |
| 限流与防刷 | 控制用户、IP、接口频率 | Bottleneck、rate-limiter-flexible | x/time/rate、redis-rate | Bucket4j、Resilience4j |


该阶段把热点库存扣减从数据库移到 Redis，提升库存判断和扣减能力。订单仍同步写入数据库，请求峰值继续升高时，数据库写入仍会堵塞。

## 阶段三：引入消息队列

```text
User
  ↓
Gateway / Nginx
  ↓
App
  ↓
Redis Lua 扣库存
  ↓
MQ
  ↓
Order Worker
  ↓
MySQL
```

| 项 | 内容 |
|---|---|
| 目标 | 削峰填谷，请求快速返回，后台异步创建订单 |
| 能解决 | 瞬时流量冲击、订单同步写入压力、耗时任务阻塞 |
| 不能解决 | 消息重复、消息丢失、MQ 堆积、库存扣了但订单失败 |
| 升级信号 | 服务模块越来越多，订单、库存、用户、支付需要独立演进和扩容 |

核心链路代码：

```go
func Seckill(ctx context.Context, userID int64, skuID, requestID string) {
	userKey := fmt.Sprintf("seckill:user:%d:sku:%s", userID, skuID)

	// 请求阶段只做资格校验、去重和库存预扣。
	result := redis.Eval(decrStockLua, "stock:"+skuID, userKey)
	if result != "ok" {
		return
	}

	// 扣库存成功后投递消息，请求快速返回。
	mq.Publish("order.create", OrderCreateMessage{UserID: userID, SkuID: skuID, RequestID: requestID})
}

func ConsumeOrderCreate(msg OrderCreateMessage) {
	// 消费端异步落单，用 request_id 唯一约束保证幂等。
	db.Exec(`
		insert into orders(user_id, sku_id, request_id, status)
		values (?, ?, ?, 'created')
		on duplicate key update request_id = request_id
	`, msg.UserID, msg.SkuID, msg.RequestID)
}
```

相关技术栈：

| 类别 | 作用 | JS / Node | Go | Java |
|---|---|---|---|---|
| 消息队列 | 削峰、异步下单、服务解耦 | KafkaJS、amqplib、BullMQ | kafka-go、amqp091-go、Asynq、River | Spring Kafka、Spring AMQP、RocketMQ Client |
| 消费可靠性 | 幂等、重试、死信、重复消费控制 | Idempotency Key、Retry、DLQ | Idempotency Key、Retry、DLQ | Idempotency Key、Retry、DLQ |
| 延迟任务 | 支付超时、订单关闭、库存补偿 | BullMQ、Agenda | Asynq、River | Quartz、Spring Batch、RocketMQ Delay Message |


该阶段用 MQ 削峰，请求链路快速返回，订单由 Worker 异步创建。消息重投、Worker 重启、消费失败都会出现，订单创建必须做幂等。

生产环境还要处理“库存已扣减，但消息发布失败”的断点。常见做法是把待发布事件先写入本地消息表 / Outbox，再由后台任务投递 MQ，并通过补偿扫描处理未成功发布的事件。消费端需要用 `message_id`、`request_id` 或订单唯一索引保证幂等，避免重复消息导致重复下单。

## 阶段四：服务拆分

```text
User
  ↓
API Gateway
  ├─ User Service → User DB
  ├─ Order Service → Order DB
  └─ Stock Service → Redis / Stock DB

Order Service → MQ → Order Worker
Order Worker → Stock Service / Payment Service
```

| 项 | 内容 |
|---|---|
| 目标 | 支持多人协作、服务独立部署、服务独立扩展 |
| 能解决 | 用户、订单、库存等模块耦合；局部服务按需扩容；团队边界不清 |
| 不能解决 | 分布式事务复杂、链路排查困难、服务治理成本升高 |
| 限制 | 高并发优先处理缓存、削峰、限流和幂等；服务拆分适用于业务复杂度、团队规模、独立部署需求上升后的阶段 |

核心链路代码：

```go
func CreateSeckillOrder(ctx context.Context, userID int64, skuID, requestID string) {
	// 订单服务先调用库存服务，预留库存。
	reservationID := stockService.Reserve(userID, skuID, requestID)

	// 库存预留成功后，创建待支付订单。
	orderID := orderRepo.CreatePending(userID, skuID, reservationID)

	// 发布订单事件，驱动支付、通知、库存确认等后续流程。
	mq.Publish("order.created", OrderCreatedEvent{OrderID: orderID, ReservationID: reservationID})
}

func ReserveStock(userID int64, skuID, requestID string) string {
	// 库存服务内部仍用 Redis Lua 保证扣减和预留记录的原子性。
	return redis.Eval(reserveStockLua, "stock:"+skuID, "reservation:"+requestID)
}

func OnOrderCreateFailed(reservationID string) {
	// 订单创建失败时释放预留库存，避免库存被永久占用。
	stockService.Release(reservationID)
}
```

相关技术栈：

| 类别 | 作用 | JS / Node | Go | Java |
|---|---|---|---|---|
| 服务通信 | 服务间 RPC / HTTP 调用 | gRPC-js、tRPC、OpenAPI | gRPC-Go、Connect-Go、Resty | gRPC Java、OpenFeign、Dubbo |
| 微服务框架 | 服务治理、模块组织、团队协作 | NestJS Microservices、Moleculer | go-zero、Kratos、Kitex | Spring Cloud、Dubbo |
| 服务治理 | 注册发现、配置、限流、熔断 | Consul、etcd | Consul、etcd | Nacos、Eureka、Sentinel、Resilience4j |
| 分布式一致性 | Saga、补偿、长流程状态 | Temporal TypeScript SDK | Temporal Go SDK | Seata、Temporal Java SDK |


该阶段把用户、订单、库存拆成独立服务，可以按压力单独扩容。跨服务链路需要补偿事件，否则订单成功、库存失败、支付失败等状态会不一致。

服务拆分后，订单、库存、支付通常不能依赖一个数据库事务完成。跨服务流程应由 Saga 状态机管理，例如 `INIT → STOCK_RESERVED → ORDER_CREATED → PAID → DONE`；任一步失败时进入补偿状态，执行释放库存、关闭订单、取消支付等操作。补偿本身也可能失败，因此需要重试、幂等和人工介入入口。

## 阶段五：高可用生产版

```text
User
  ↓
CDN / WAF / LB
  ↓
API Gateway 集群
  ↓
服务多副本
  ├─ Redis Cluster
  ├─ MQ Cluster
  ├─ MySQL 主从 / 分库分表
  └─ Object Storage

Observability
  ├─ Metrics：Prometheus
  ├─ Dashboard：Grafana
  ├─ Logs：ELK / Loki
  └─ Tracing：Jaeger / Tempo / SkyWalking
```

| 项 | 内容 |
|---|---|
| 目标 | 支撑高并发、故障恢复、容量扩展、生产排障 |
| 能解决 | 单点故障、容量不足、线上问题不可观测、服务不可恢复 |
| 不能解决 | 架构复杂、运维成本高、分布式一致性难度高 |
| 适用 | 用户量大、核心交易链路、对可用性和容灾要求高的系统 |

核心链路代码：

```go
func SeckillHandler(ctx context.Context, req SeckillRequest) {
	// 网关或服务入口先限流，保护后端核心链路。
	if !limiter.Allow(req.UserID, req.IP) {
		return
	}

	// 为一次秒杀请求建立 trace，贯穿网关、服务、MQ 和数据库。
	trace := tracing.Start("seckill", req.RequestID)

	// 执行业务主链路。
	result := seckillService.Submit(ctx, req.UserID, req.SkuID, req.RequestID)

	// 记录指标和日志，用于容量评估、排障和告警。
	metrics.Record("seckill", result)
	logs.Write(req.RequestID, req.UserID, req.SkuID, result)
	trace.End()
}
```

相关技术栈：

| 类别 | 作用 | JS / Node | Go | Java |
|---|---|---|---|---|
| 可观测性 | 指标、日志、链路追踪、告警 | OpenTelemetry JS、prom-client、Pino | OpenTelemetry Go、Prometheus Client、zap | Micrometer、Actuator、OpenTelemetry Java Agent |
| 性能诊断 | CPU、内存、阻塞、慢调用分析 | clinic.js、0x | pprof | JFR、Arthas |
| 部署与编排 | 容器化、多副本、滚动发布、扩缩容 | Docker、Kubernetes、Helm | Docker、Kubernetes、Helm | Docker、Kubernetes、Helm |
| 基础设施高可用 | 网关、负载均衡、缓存集群、数据库集群 | Nginx、Envoy、Redis Cluster、MQ Cluster | Nginx、Envoy、Redis Cluster、MQ Cluster | Nginx、Envoy、Redis Cluster、MQ Cluster |


该阶段通过多副本、集群、限流和观测体系提升可用性。系统组件增多后，排障依赖统一 traceId、指标、日志和告警。

# 实际业务如何选型设计架构

架构设计先澄清业务需求，再把业务需求转换成技术需求，最后选择自建基础设施或云厂商托管能力。

判断顺序：

```text
业务需求
→ 技术需求
→ 云厂商能力
```

## 业务需求：先澄清当前业务

业务需求澄清重点看会影响架构形态的因素：核心链路、读写模式、一致性、状态复杂度、外部依赖、权限边界和交付约束。

| 问题 | 影响的架构选择 |
|---|---|
| 核心业务链路是什么 | 决定模块边界、API 边界、事务边界 |
| 主要读写模式是什么 | 决定数据库、缓存、搜索、读写分离 |
| 数据一致性要求多高 | 决定本地事务、最终一致、补偿、分布式事务方案 |
| 业务状态是否复杂 | 决定普通 CRUD、状态机、工作流引擎、事件驱动 |
| 是否有高频外部依赖 | 决定 Adapter、重试、幂等、熔断、降级 |
| 权限和租户边界是否复杂 | 决定 Auth、RBAC、ABAC、Tenant Model、资源隔离 |
| 是否有文件、搜索、报表 | 决定对象存储、搜索引擎、OLAP、异步任务 |
| 是否需要实时交互 | 决定轮询、SSE、WebSocket、MQ、Redis Pub/Sub |
| 团队和部署约束是什么 | 决定单体、模块化、微服务、K8s、Serverless、云托管 |

## 技术需求：再选择后端能力

技术需求来自业务需求和非功能压力。先把业务需求映射到后端能力，再用性能、可用性、扩展性和定量指标判断是否需要升级架构。

### 业务需求到技术能力

| 需求信号 | 技术能力 | 解决的问题 |
|---|---|---|
| 普通 CRUD | 接入层、应用服务、Repository、数据库 | 基础数据增删改查 |
| 登录、角色、资源归属 | Auth、RBAC、Tenant Model | 身份、权限、租户隔离 |
| 文件、附件、导出 | Object Storage、Job Queue | 文件存储、异步导出 |
| 搜索 | Search Engine | 复杂检索、全文检索 |
| 长流程 | State Machine、Workflow Engine | 状态恢复、重试、审计 |
| 实时进度 / 通知 | SSE、WebSocket、MQ | 实时更新、异步通知 |
| 第三方集成 | Adapter、Signature Verify、Retry、Idempotency | 防伪造、防重复、失败恢复 |
| 复杂业务规则 | Domain Model、DDD、业务状态机 | 规则收敛、状态转换、长期演进 |

### 非功能需求到技术能力

| 技术诉求 | 技术能力 | 升级信号 |
|---|---|---|
| 高性能 | 缓存、索引、异步、限流、热点隔离 | P95 / P99 升高，CPU / DB / 网络成为瓶颈 |
| 高可用 | 多副本、健康检查、备份、降级、熔断 | 单实例故障影响核心业务 |
| 高扩展 | 无状态服务、队列、读写分离、水平扩容 | 流量、数据量、团队规模增长 |
| 高并发峰值 | Redis、MQ、排队、幂等设计 | 峰值流量冲击核心链路 |
| 数据量增长 | 索引、归档、分区、读写分离、OLAP | 慢查询、表过大、备份恢复变慢 |
| 可观测性 | Logs、Metrics、Tracing、Alert | 线上问题无法定位 |
| 安全 | WAF、KMS、IAM、审计 | 公网暴露、权限复杂、合规要求 |
| 多环境交付 | Config、Secret、CI/CD、IaC | 开发、测试、生产配置开始分裂 |

架构选型准则：

1. 先确认当前瓶颈，再选择组件。
2. 新组件必须直接解决明确问题。
3. 组件收益要大于引入后的开发、运维和排障成本。
4. 架构复杂度要匹配团队维护能力。
5. 没有实际问题时，不提前引入重型方案。

常见误区：

- 高并发问题未出现时，引入 Kafka、Kubernetes、微服务。
- 普通 CRUD 项目套用完整 DDD。
- 运维能力不足时，自建大量基础设施。
- 用云厂商产品列表代替架构设计。
- 罗列技术名词，缺少问题、代价和适用条件。

### 定量指标

架构选型需要结合当前压力数据和增长速度。下面的区间是经验参考，真实判断要结合业务类型、接口复杂度、数据模型、机器规格和团队运维能力。

| 指标 | 观察对象 | 经验判断 |
|---|---|---|
| QPS < 50 | 内部系统、管理后台、小型内容站 | 单体应用 + 单库通常够用，重点放在交付速度、权限和数据正确性 |
| QPS 50-300 | 普通 SaaS、内容系统、常规业务 API | 优先治理索引、慢查询、缓存和接口耗时 |
| QPS 300-1000 | 有明显流量的线上业务 | 需要评估缓存、限流、异步任务、读写分离和水平扩容 |
| QPS 1000+ | 高并发入口、活动页、交易入口 | 需要 Redis、MQ、限流、压测、容量规划和故障降级 |
| 峰值 QPS / 平均 QPS > 5 | 秒杀、抢购、推送、营销活动 | 需要削峰、排队、热点隔离和入口限流 |
| P95 延迟 > 300ms | 用户可感知接口 | 排查慢 SQL、外部调用、锁等待、序列化和网络耗时 |
| P99 延迟 > 1s | 尾延迟明显的核心接口 | 需要超时、重试控制、熔断、异步化和资源隔离 |
| 错误率 > 0.1%-1% | API、任务、消息消费 | 需要告警、限流、降级、回滚和失败补偿 |
| DB CPU 持续 > 70% | 主库、读库、分析库 | 先查慢查询、索引、连接数和缓存命中率，再考虑扩容 |
| DB 连接数接近上限 | 应用到数据库链路 | 需要连接池治理、慢请求治理、读写分离或限流 |
| Redis 命中率低于预期 | 缓存链路 | 需要检查 key 设计、过期策略、缓存穿透、缓存击穿和热 key |
| MQ 积压持续增长 | 异步任务、订单、通知、导出 | 消费能力不足，需要扩 worker、拆任务、限流入口或优化消费逻辑 |
| 单表千万级行数 | 核心业务表 | 需要关注索引、归档、分区、冷热数据拆分和备份恢复时间 |
| 单表亿级行数 | 高增长交易表、日志表、流水表 | 需要分库分表、归档、搜索引擎、OLAP 或独立数据链路 |

定量指标的作用是判断“当前瓶颈在哪里”。如果 DB 慢，先看慢查询和索引；如果峰值冲击大，先看限流和削峰；如果任务积压，先看消费能力；如果问题不可见，先补日志、指标和链路追踪。

## 云厂商能力：最后决定托管还是自建

云厂商能力适合作为基础设施的托管实现。选型时先判断需要什么能力，再判断托管还是自建。

| 能力 | 自建方案 | 云托管方案 | 适用条件 |
|---|---|---|---|
| 静态资源加速 | Nginx、静态服务器 | CDN | 图片、JS/CSS、下载文件、活动页 |
| 负载均衡 | Nginx、HAProxy、Envoy | ALB / CLB / ELB | 多实例入口、跨可用区流量分发 |
| 关系型数据库 | 自建 MySQL / PostgreSQL | RDS、Cloud SQL、Aurora | 常规业务数据、交易数据、权限数据 |
| 缓存 | 自建 Redis / Redis Cluster | Managed Redis、ElastiCache | 热点数据、会话、限流、排行榜 |
| 消息队列 | Kafka、RabbitMQ、RocketMQ | SQS、Pub/Sub、EventBridge、MSK | 异步削峰、事件驱动、任务解耦 |
| 对象存储 | 本地磁盘、MinIO | S3、OSS、COS、GCS | 图片、附件、导出文件、备份文件 |
| 容器运行 | 自建 Kubernetes | EKS、GKE、ACK、Cloud Run | 多服务部署、弹性扩缩容、滚动发布 |
| 安全 | 自建 WAF、证书、密钥系统 | WAF、KMS、IAM、Secrets Manager | 公网服务、权限隔离、密钥管理、审计 |
| 可观测性 | Prometheus、Grafana、ELK、Loki | CloudWatch、Cloud Logging、Cloud Monitoring | 日志、指标、告警、链路追踪 |

小团队和早期项目通常优先使用托管服务，减少安装、升级、备份、容灾和故障恢复成本。核心交易链路使用托管服务时，要确认 SLA、限流规则、备份恢复、跨可用区能力、故障切换时间和成本模型。

自建基础设施主要对应成本控制、合规要求、跨云部署、强控制力或极端性能要求。选择自建前，需要确认团队能承担部署、升级、监控、备份、扩容、故障恢复和安全加固成本。

