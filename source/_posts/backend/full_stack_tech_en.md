---
title: A Backend Technology Map from a Full-Stack Perspective
categories: BackEnd
date: 2026-10-09
---

# Goal

Quickly understand full-stack architecture, with a focus on the backend technology stack.

1. A high-level architecture and technology map for full-stack projects.
2. A flash-sale e-commerce case study to connect the architecture with key backend technologies.
3. Practical references for project technology selection and architecture design.

Chinese version: [全栈视角下的后端技术栈地图](/i18n/zh/backend/full_stack_tech.html)

<!-- more -->

# Full-Stack Architecture Overview

The main system path can be understood as "front end + backend". The front end handles client-side business logic, client frameworks, and local runtime behavior. The backend handles request entry, business processing, data, async workflows, and deployment runtime.

| Area | Level | Main Layer | Problem Solved | Common Technologies / Patterns / Infrastructure |
|---|---:|---|---|---|
| Front end | 1 | Frontend application layer | Client-side business logic, page flows, user interactions, business state | Web App, Mobile App, Mini Program, Dashboard, Content Site |
| Front end | 2 | Framework layer | Page/client development model, components, routing, state, API calls | Android, iOS, React, Vue, Rax, Next.js, Pinia, TanStack Query |
| Front end | 3 | System kernel layer | Code compilation, runtime, virtual machine, rendering, threads, event loop | Compiler, JS VM, JVM, ART, WebView, Browser Rendering, Native Rendering |
| Backend | 4 | Entry layer | Request entry, routing, reverse proxy, traffic control | Nginx, API Gateway, web frameworks: Gin, Gorilla Mux, Spring MVC |
| Backend | 5 | Authentication and authorization layer | Identity, login state, roles, permissions, resource access control | JWT, Session, OAuth2, OIDC, RBAC, auth frameworks/libraries: Better Auth |
| Backend | 6 | Backend business layer | Use-case orchestration, transaction boundaries, external dependency calls, error semantics | Service, Use Case, Application Service, business state machine |
| Backend | 7 | Domain model layer | Business concepts, business rules, state transitions, domain events | Entity, Value Object, Aggregate, Domain Event |
| Backend | 8 | Data and storage layer | Persistence, queries, cache, search, upload/download | MySQL, PostgreSQL, Redis, Elasticsearch, S3, MinIO |
| Backend | 9 | Async and realtime layer | Peak shaving, long-running tasks, retries, long workflows, realtime progress updates | Kafka, RabbitMQ, River, workflow engines: Temporal, Hatchet, SSE, WebSocket |
| Backend | 10 | Framework and system layer | Backend frameworks, language runtimes, build tools, deployment runtime | Frameworks: Spring Boot, Gin, NestJS, Express, Fastify<br>Runtimes: JVM, Go runtime, Node.js runtime<br>Build/package management: Maven, Gradle, Go toolchain, npm, pnpm<br>Deployment infrastructure: Docker, Kubernetes, cloud runtime |

Cross-cutting capabilities span all layers and support security, stability, and maintainability.

| Cross-Cutting Capability | Layers Covered | Problem Solved | Common Technologies / Cloud Capabilities |
|---|---|---|---|
| Configuration and environments | All | Multi-environment configuration, secrets, feature flags, runtime parameters | `.env`, Viper, Vault, Secret Manager, ConfigMap, Feature Flag |
| Security governance | All | Prevent attacks, leaks, privilege escalation, abuse, and support audit/compliance | WAF, CORS, Rate Limit, KMS, IAM, Gitleaks, Trivy, bcrypt |
| Observability | All | Logs, metrics, tracing, health checks, alerts, capacity judgment | Prometheus, Grafana, Loki, ELK, OpenTelemetry, CloudWatch |
| Cloud-managed capabilities | All | Use managed services instead of self-hosted infrastructure to reduce operations cost | CDN, LB, RDS, Redis, S3/OSS/COS, SQS, EKS, Cloud Run |
| AI governance | Backend business layer, data and storage layer, async and realtime layer, framework and system layer | Prompt injection protection, content safety, model evaluation, cost control, call audit | Guardrails, Moderation, Eval, Token Budget, Prompt Audit, Model Router |

## AI Application Backend Supplement

An AI application backend usually adds model calls, context retrieval, tool calls, async tasks, and governance capabilities on top of a traditional backend path.

| AI Backend Capability | Related Path | Common Technologies / Patterns |
|---|---|---|
| Retrieval augmentation | Data and storage layer, backend business layer | RAG, Embedding Store, pgvector, Milvus, Pinecone, Weaviate |
| Task orchestration | Backend business layer, async and realtime layer | AI Use Case, Agent Workflow, Prompt Orchestration, Tool Calling, Agent Task Queue |
| Model runtime | Framework and system layer | Ollama, vLLM, Triton, SageMaker, Vertex AI |
| Streaming responses | Async and realtime layer, entry layer | Streaming Response, SSE, WebSocket |
| Governance and evaluation | Cross-cutting capability | Guardrails, Moderation, Eval, Token Budget, Prompt Audit, Model Router |

# Connecting the Stack with a Flash-Sale E-Commerce System

## 1. What Is the Business Scenario?

```text
100 phones available for limited-time purchase
A large number of users request at the same time
The system must guarantee performance, data consistency, and security
```

## 2. Why Use This Scenario?

A flash-sale system is a useful backend architecture case because it includes both a complete business loop and system quality requirements. On the business side, it needs login, eligibility checks, stock deduction, order creation, payment, and cancellation. On the system side, it needs high concurrency handling, overselling prevention, idempotency, peak shaving, compensation, scaling, and troubleshooting.

To use this scenario to connect the backend technology stack, first break down the problems, then map each problem type to the backend capability layer that solves it:

```text
Business problem -> functional requirement -> business layer / domain layer / data layer
System problem -> non-functional requirement -> entry layer / cache / MQ / observability / deployment runtime
```

## 3. Requirements and Capability Needs in This Scenario

The requirements in this scenario can be divided into two categories: functional requirements complete the business loop, while non-functional requirements keep the system stable and correct under high traffic, failures, and business edge cases.

Functional requirements:

| Functional Requirement | Backend Capability | Typical Technologies / Methods |
|---|---|---|
| Users must be logged in and eligible to participate | Authentication and authorization layer, risk control | Session / JWT, RBAC, eligibility token, CAPTCHA, IP/user rate limiting |
| The campaign must start and end at specific times | Business rules, campaign configuration | Campaign configuration, time-window checks, switch controls |
| Stock must be queryable and deductible | Data and storage layer, consistency control | Redis stock, DB stock, stock ledger |
| Each user can only purchase once | Idempotency and deduplication | User-level dedup key, request_id, unique order index |
| A successful purchase must create an order | Backend business layer, data persistence | Application Service, Order Worker, MySQL |
| Orders need payment, cancellation, and closure | Domain model layer, state transitions | Order state machine, domain events, payment callback |
| Stock must be released after payment timeout | Async tasks, compensation | Delay queue, scheduled task, stock rollback |

Non-functional requirements can be grouped into four categories: high performance, high availability, high scalability, and data consistency.

| Category | Non-Functional Requirement | Backend Capability | Typical Technologies / Methods |
|---|---|---|---|
| High performance | Many users enter the campaign page at the same time | Entry layer, traffic control, static resource acceleration | CDN, Nginx, API Gateway, Rate Limit |
| High performance | Traffic spikes must not directly overload the database | Cache, peak shaving, async processing | Redis, MQ, Worker, queuing |
| High performance | Hot products must not drag down the system | Hotspot cache, hotspot isolation, rate limiting | Local cache, Redis, Rate Limit, stock sharding |
| High availability | Orders must not be lost when some components fail | Reliable messaging, retry, compensation | Local message table, transactional messages, Retry, DLQ, compensation scan |
| High availability | Issues must be diagnosable | Observability | traceId, Metrics, Logs, Tracing, alerts |
| High scalability | The system must scale as traffic grows | Horizontal scaling, capacity planning | Stateless services, multiple replicas, Redis Cluster, MQ Cluster, Worker scaling |
| Data consistency | 100 phones must not be oversold | Atomic deduction, transactional fallback | Redis Lua, DB optimistic locking |
| Data consistency | Repeated requests must not create repeated orders | Idempotency, deduplication, unique constraints | request_id, idempotency table, unique order index |
| Data consistency | Payment timeout must not occupy stock forever | State transitions, compensation | Delay queue, order closure, stock release |

When functional and non-functional requirements are connected, they form the main flash-sale system path:

```text
Preparation phase
-> Preload product stock into Redis
-> Generate campaign configuration, purchase limits, and eligibility tokens

Request phase
-> CDN / Nginx / Gateway
-> Rate limiting, risk control, login check
-> Check campaign time, eligibility, one-order-per-user rule
-> Atomically deduct stock with Redis Lua
-> Publish to MQ after success

Async order phase
-> Worker creates order asynchronously
-> Persist order into MySQL
-> Cancel order after payment timeout
-> Compensate stock
```

# Flash-Sale System Evolution Path

## Stage 1: Monolith

```text
User -> Nginx -> Spring Boot / Gin monolith -> MySQL
```

| Item | Content |
|---|---|
| Goal | Understand basic web architecture, complete the business loop, and learn Controller / Service / DAO |
| Solves | Basic ordering, product query, user login, order persistence |
| Does not solve | High database pressure under concurrency, possible overselling, limited single-instance scalability |
| Suitable for | Small projects, internal systems, MVPs |

Core path code:

```go
func Seckill(ctx context.Context, userID, skuID int64) {
	// Start a transaction so stock deduction and order creation succeed or fail together.
	tx := db.Begin()

	// Lock the stock row to avoid concurrent requests reading the same stock value.
	stock := tx.Query("select stock from sku where id = ? for update", skuID)
	if stock <= 0 {
		tx.Rollback()
		return
	}

	// Deduct stock.
	tx.Exec("update sku set stock = stock - 1 where id = ?", skuID)

	// Create order.
	tx.Exec("insert into orders(user_id, sku_id, status) values (?, ?, 'created')", userID, skuID)
	tx.Commit()
}
```

Related technology stack:

| Category | Role | JS / Node | Go | Java |
|---|---|---|---|---|
| Web framework | Receive requests, route requests, organize APIs | Express, NestJS, Fastify | Gin, Echo, Fiber | Spring Boot, Spring MVC |
| Data access | Queries, transactions, CRUD | Prisma, TypeORM, Drizzle | database/sql, GORM, sqlc, ent | MyBatis, Spring Data JPA, MyBatis-Plus |
| Basic engineering | Configuration, logging, validation, project organization | dotenv, Pino, Zod | Viper, zap, validator | Spring Config, Logback, Hibernate Validator |

This stage can complete the loop of querying stock, deducting stock, and creating orders. As concurrency increases, requests hit the database directly, and row locks on stock plus order writes become bottlenecks.

## Stage 2: Introduce Redis

```text
User
  |
Nginx
  |
App
  |-- Redis: hot products, stock, eligibility, deduplication
  |-- MySQL: orders, users, product persistence
```

| Item | Content |
|---|---|
| Goal | Reduce database pressure, improve hot-read performance, and use atomic operations to control stock deduction |
| Solves | Hot product reads, fast stock deduction, initial repeated-order blocking |
| Does not solve | Async peak shaving, order persistence pressure, Redis/DB consistency, hot keys |
| Upgrade signal | Redis can handle reads/writes, but order creation, payment, notifications, or later steps begin to block |

Core path code:

```go
func Seckill(ctx context.Context, userID int64, skuID string) {
	stockKey := "stock:" + skuID
	userKey := fmt.Sprintf("seckill:user:%d:sku:%s", userID, skuID)

	// Redis Lua atomically completes stock deduction and user deduplication.
	result := redis.Eval(decrStockLua, stockKey, userKey)
	if result != "ok" {
		return
	}

	// Create the order synchronously after the stock pre-deduction succeeds.
	db.Exec("insert into orders(user_id, sku_id, status) values (?, ?, 'created')", userID, skuID)
}
```

Related technology stack:

| Category | Role | JS / Node | Go | Java |
|---|---|---|---|---|
| Redis client | Access Redis and execute Lua | ioredis, node-redis | go-redis | Spring Data Redis, Lettuce, Jedis |
| Cache and stock deduction | Hot cache, stock pre-deduction, deduplication | Redis Lua, lru-cache | Redis Lua, Ristretto | Redis Lua, Caffeine, Redisson |
| Rate limiting and anti-abuse | Control user, IP, and API frequency | Bottleneck, rate-limiter-flexible | x/time/rate, redis-rate | Bucket4j, Resilience4j |

This stage moves hot stock deduction from the database to Redis, improving stock checks and deduction throughput. Orders are still written synchronously to the database, so database writes still block when request peaks continue to grow.

## Stage 3: Introduce a Message Queue

```text
User
  |
Gateway / Nginx
  |
App
  |
Redis Lua stock deduction
  |
MQ
  |
Order Worker
  |
MySQL
```

| Item | Content |
|---|---|
| Goal | Smooth traffic spikes, return quickly from requests, and create orders asynchronously in the background |
| Solves | Instant traffic spikes, synchronous order-write pressure, blocking from long-running tasks |
| Does not solve | Duplicate messages, message loss, MQ backlog, stock deducted but order creation failed |
| Upgrade signal | More modules appear, and order, stock, user, and payment services need independent evolution and scaling |

Core path code:

```go
func Seckill(ctx context.Context, userID int64, skuID, requestID string) {
	userKey := fmt.Sprintf("seckill:user:%d:sku:%s", userID, skuID)

	// In the request phase, only validate eligibility, deduplicate, and pre-deduct stock.
	result := redis.Eval(decrStockLua, "stock:"+skuID, userKey)
	if result != "ok" {
		return
	}

	// Publish a message after stock deduction succeeds, then return quickly.
	mq.Publish("order.create", OrderCreateMessage{UserID: userID, SkuID: skuID, RequestID: requestID})
}

func ConsumeOrderCreate(msg OrderCreateMessage) {
	// Create the order asynchronously. A unique request_id constraint guarantees idempotency.
	db.Exec(`
		insert into orders(user_id, sku_id, request_id, status)
		values (?, ?, ?, 'created')
		on duplicate key update request_id = request_id
	`, msg.UserID, msg.SkuID, msg.RequestID)
}
```

Related technology stack:

| Category | Role | JS / Node | Go | Java |
|---|---|---|---|---|
| Message queue | Peak shaving, async ordering, service decoupling | KafkaJS, amqplib, BullMQ | kafka-go, amqp091-go, Asynq, River | Spring Kafka, Spring AMQP, RocketMQ Client |
| Consumer reliability | Idempotency, retry, dead letter, duplicate consumption control | Idempotency Key, Retry, DLQ | Idempotency Key, Retry, DLQ | Idempotency Key, Retry, DLQ |
| Delayed tasks | Payment timeout, order closure, stock compensation | BullMQ, Agenda | Asynq, River | Quartz, Spring Batch, RocketMQ Delay Message |

This stage uses MQ for peak shaving. The request path returns quickly, and orders are created asynchronously by workers. Message redelivery, worker restarts, and consumption failures will happen, so order creation must be idempotent.

## Stage 4: Service Decomposition

```text
User
  |
API Gateway
  |-- User Service -> User DB
  |-- Order Service -> Order DB
  |-- Stock Service -> Redis / Stock DB

Order Service -> MQ -> Order Worker
Order Worker -> Stock Service / Payment Service
```

| Item | Content |
|---|---|
| Goal | Support multi-person collaboration, independent service deployment, and independent service scaling |
| Solves | Coupling among user/order/stock modules, local service scaling, unclear team boundaries |
| Does not solve | Distributed transaction complexity, harder trace debugging, higher service governance cost |
| Constraint | For high concurrency, prioritize cache, peak shaving, rate limiting, and idempotency. Service decomposition is suitable after business complexity, team size, and independent deployment needs grow. |

Core path code:

```go
func CreateSeckillOrder(ctx context.Context, userID int64, skuID, requestID string) {
	// The order service first calls the stock service to reserve stock.
	reservationID := stockService.Reserve(userID, skuID, requestID)

	// Create a pending order after stock reservation succeeds.
	orderID := orderRepo.CreatePending(userID, skuID, reservationID)

	// Publish an order event to drive payment, notification, and stock confirmation.
	mq.Publish("order.created", OrderCreatedEvent{OrderID: orderID, ReservationID: reservationID})
}

func ReserveStock(userID int64, skuID, requestID string) string {
	// The stock service still uses Redis Lua internally to make deduction and reservation atomic.
	return redis.Eval(reserveStockLua, "stock:"+skuID, "reservation:"+requestID)
}

func OnOrderCreateFailed(reservationID string) {
	// Release reserved stock when order creation fails, preventing stock from being held forever.
	stockService.Release(reservationID)
}
```

Related technology stack:

| Category | Role | JS / Node | Go | Java |
|---|---|---|---|---|
| Service communication | Inter-service RPC / HTTP calls | gRPC-js, tRPC, OpenAPI | gRPC-Go, Connect-Go, Resty | gRPC Java, OpenFeign, Dubbo |
| Microservice framework | Service governance, module organization, team collaboration | NestJS Microservices, Moleculer | go-zero, Kratos, Kitex | Spring Cloud, Dubbo |
| Service governance | Service discovery, configuration, rate limiting, circuit breaking | Consul, etcd | Consul, etcd | Nacos, Eureka, Sentinel, Resilience4j |
| Distributed consistency | Saga, compensation, long-running workflow state | Temporal TypeScript SDK | Temporal Go SDK | Seata, Temporal Java SDK |

This stage splits users, orders, and stock into independent services that can scale separately according to pressure. Cross-service paths require compensation events; otherwise order success, stock failure, and payment failure can lead to inconsistent states.

## Stage 5: Highly Available Production Version

```text
User
  |
CDN / WAF / LB
  |
API Gateway cluster
  |
Service replicas
  |-- Redis Cluster
  |-- MQ Cluster
  |-- MySQL primary-replica / sharding
  |-- Object Storage

Observability
  |-- Metrics: Prometheus
  |-- Dashboard: Grafana
  |-- Logs: ELK / Loki
  |-- Tracing: Jaeger / Tempo / SkyWalking
```

| Item | Content |
|---|---|
| Goal | Support high concurrency, failure recovery, capacity expansion, and production troubleshooting |
| Solves | Single points of failure, insufficient capacity, unobservable production issues, unrecoverable services |
| Does not solve | Architecture complexity, operations cost, distributed consistency difficulty |
| Suitable for | Systems with large user volume, core transaction paths, and high availability/disaster recovery requirements |

Core path code:

```go
func SeckillHandler(ctx context.Context, req SeckillRequest) {
	// Rate limit at the gateway or service entry to protect the backend core path.
	if !limiter.Allow(req.UserID, req.IP) {
		return
	}

	// Create a trace for one flash-sale request across gateway, services, MQ, and database.
	trace := tracing.Start("seckill", req.RequestID)

	// Execute the business main path.
	result := seckillService.Submit(ctx, req.UserID, req.SkuID, req.RequestID)

	// Record metrics and logs for capacity analysis, troubleshooting, and alerts.
	metrics.Record("seckill", result)
	logs.Write(req.RequestID, req.UserID, req.SkuID, result)
	trace.End()
}
```

Related technology stack:

| Category | Role | JS / Node | Go | Java |
|---|---|---|---|---|
| Observability | Metrics, logs, tracing, alerts | OpenTelemetry JS, prom-client, Pino | OpenTelemetry Go, Prometheus Client, zap | Micrometer, Actuator, OpenTelemetry Java Agent |
| Performance diagnosis | CPU, memory, blocking, slow-call analysis | clinic.js, 0x | pprof | JFR, Arthas |
| Deployment and orchestration | Containerization, replicas, rolling releases, scaling | Docker, Kubernetes, Helm | Docker, Kubernetes, Helm | Docker, Kubernetes, Helm |
| High-availability infrastructure | Gateway, load balancing, cache cluster, database cluster | Nginx, Envoy, Redis Cluster, MQ Cluster | Nginx, Envoy, Redis Cluster, MQ Cluster | Nginx, Envoy, Redis Cluster, MQ Cluster |

This stage improves availability through replicas, clusters, rate limiting, and observability. As more components are added, troubleshooting depends on unified traceId, metrics, logs, and alerts.

# How to Select Technologies and Design Architecture for Real Business

Architecture design should start from business problems, select the core capabilities needed to satisfy those problems, and leave room for future scaling and high availability.

Decision sequence:

```text
Clarify requirements
-> Select core capabilities
-> Design for future scalability and high availability
```

## 1. Clarify Requirements: Identify the Current Business Problem First

Clarify the business goal, core path, user scale, data consistency requirements, team maintenance capability, and deployment environment.

Key questions during requirement clarification:

| Question | What to Judge |
|---|---|
| What is the main business path? | What key steps does the user go through from entry to result? |
| What is the current biggest risk? | Performance, data consistency, security, delivery speed, operations |
| How large is the traffic scale? | QPS, peak traffic, concurrent users, hot data |
| How strong must data consistency be? | Strong consistency, eventual consistency, compensation allowed |
| What can the team maintain? | Monolith, queue, microservices, Kubernetes, cloud-managed services |
| What is the deployment environment? | Local, VPS, cloud provider, Kubernetes, Serverless |

## 2. Select Core Capabilities That Match Business Needs

Only introduce capabilities that solve current problems. If there is no clear problem, delay complex components.

| Requirement Signal | Suggested Capability | Risk If Missing |
|---|---|---|
| Normal CRUD | Front end, entry layer, application service, Repository, database | Overengineering slows development |
| Login, roles, resource ownership | Authentication and authorization layer | Privilege escalation, data leaks |
| Images, attachments, exported files | File and object storage | Database bloat, hard backups, slow access |
| Long-running tasks | Job Queue | Request timeout, user waiting, hard failure retry |
| Instant high concurrency | Redis, rate limiting, MQ | Database overload, API collapse |
| Multi-step long workflow | Workflow Engine | Lost state, hard failure recovery, chaotic retries |
| Progress bar or notification | SSE / WebSocket | Poor polling experience, high pressure |
| Public production deployment | Security governance | Abuse, attacks, secret leakage |
| Stable operations | Observability | Problems happen without root-cause visibility |
| Multi-environment deployment | Configuration and environment layer | Configuration chaos, unreproducible environments |
| Insufficient operations capacity | Cloud-managed capabilities | High self-hosting cost, slow failure recovery |
| Complex business rules | Domain model layer | Rules scattered across code, harder maintenance later |
| Long-term evolution | Modular boundaries / Clean Architecture / DDD | Tight coupling, harder changes as features grow |

## 3. Consider Future Scalability and High Availability

Future-oriented design focuses on leaving evolution points in key places while avoiding an overly heavy initial solution.

| Future Need | What to Reserve in Advance | Upgrade Trigger |
|---|---|---|
| Traffic growth | Stateless services, cache interfaces, rate-limit points | Single-machine CPU / DB / network becomes the bottleneck |
| Data growth | Indexes, archiving, partitioning, possibility of read/write splitting | Slow queries, oversized tables, slower backup and recovery |
| High concurrency peaks | Redis, MQ, queuing, idempotency design | Peak traffic impacts the core path |
| Service high availability | Health checks, replicas, automatic restarts | Single-instance failure affects core business |
| Troubleshooting | Logs, metrics, trace id, alerts | Production issues cannot be located |
| Multi-environment delivery | Config layering, Secret management, CI/CD | Development, testing, and production configs start to diverge |
| Team growth | Module boundaries, API contracts, coding conventions | Multiple people frequently conflict in the same module |
| Operations complexity | Cloud-managed services, IaC, standardized deployment | Self-hosted component maintenance cost becomes too high |

Architecture selection principles:

1. Confirm the current bottleneck first, then choose components.
2. New components must directly solve a clear problem.
3. Component benefits must exceed their development, operations, and troubleshooting costs.
4. Architecture complexity must match the team's maintenance capability.
5. Do not introduce heavyweight solutions before there is an actual problem.

Common mistakes:

- Introducing Kafka, Kubernetes, and microservices before a high-concurrency problem appears.
- Applying full DDD to a normal CRUD project.
- Self-hosting too much infrastructure when the team lacks operations capacity.
- Replacing architecture design with a list of cloud products.
- Listing technical terms without explaining problems, costs, and suitable conditions.

## 4. Technology Selection for Common Scenarios

Choose the basic architecture by business scenario first, then add components based on specific capabilities.

| Scenario | Recommended Architecture / Implementation Shape | Notes |
|---|---|---|
| Internal tool / admin dashboard | Modular monolith + CRUD + RBAC | Prioritize delivery speed, permission boundaries, and data operation efficiency |
| Blog / content site | CMS / Static Site / CDN / Cache | Read-heavy; prioritize publishing workflow, cache, and access speed |
| SaaS MVP | Modular monolith + Auth + Tenant Model + Job Queue | Ensure module boundaries, tenant model, and async tasks first |
| E-commerce / transaction | API + Service + DB + Cache + MQ + Idempotency | Prioritize stock, orders, payment, and state consistency |
| Flash sale / ticketing | Gateway + Redis + MQ + Worker + DB + Rate Limit | Prioritize hotspots, peak shaving, idempotency, and compensation |
| AI application | Client -> API / BFF -> Application Service -> Agent Orchestration -> AI Infrastructure | The application layer handles business use cases; Agent Orchestration handles planning and tool calls. AI Infrastructure includes Model Gateway, Tool Adapters, Memory Store, Queue / Worker |
| Complex business with multiple teams | Modular monolith or microservices + API Contract + Observability | Prioritize business boundaries, API contracts, and independent delivery |

Add components by capability:

| Need | Suggested Addition | Notes |
|---|---|---|
| File upload / export | Object Storage + Job Queue | Do not put files directly into the business database; run export tasks asynchronously |
| Search | Search Engine | Do not put complex search pressure on the primary database |
| Notification / email | Job Queue + Template + Provider Adapter | Needs retry, templates, and provider isolation |
| Realtime progress / online status | SSE / WebSocket + Redis / MQ | Distinguish one-way progress updates from bidirectional realtime communication |
| Approval flow / long workflow | State Machine / Workflow Engine | Needs state recovery, retry, and audit |
| Reporting analytics | OLAP / ETL / Read Replica | Separate analytical queries from transaction paths |
| Third-party integration / Webhook | Adapter + Signature Verify + Retry + Idempotency | Prevent duplicates, forgery, and support replay |
| Highly available production | Multi Replica + Observability + Backup + Rollout + Rate Limit | Cover runtime, recovery, and release risks |
