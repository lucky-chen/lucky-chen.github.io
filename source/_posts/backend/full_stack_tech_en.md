---
title: Backend Architecture and Technology Stack Map
categories: BackEnd
date: 2026-10-09
---

# Goal

<span style="color: #007c91; font-weight: 600;">Chinese version:</span> <a href="/i18n/zh/backend/full_stack_tech.html" style="color: #007c91; border-bottom-color: #007c91; font-weight: 600;">全栈视角下的后端技术栈地图</a>

Get a fast overview of full-stack architecture, with a focus on backend systems.

1. A high-level architecture and technology stack map for full-stack projects.
2. A flash-sale e-commerce case study to connect the architecture with key backend technologies.
3. Practical references for project technology selection and architecture design.

<!-- more -->

# Full-Stack Architecture Overview

The main request path can be understood as "frontend + backend". The frontend handles client-side business logic, client frameworks, and local runtime behavior. The backend handles ingress, application logic, data, asynchronous workflows, and runtime infrastructure.

| Area | Level | Main Layer | Problem Solved | Common Technologies / Patterns / Infrastructure |
|---|---:|---|---|---|
| Frontend | 1 | Frontend application layer | Client-side business logic, page flows, user interactions, business state | Web App, Mobile App, Mini Program, Dashboard, Content Site |
| Frontend | 2 | Framework layer | Client development model, components, routing, state, API calls | Android, iOS, React, Vue, Rax, Next.js, Pinia, TanStack Query |
| Frontend | 3 | Runtime and rendering layer | Code compilation, runtime, virtual machine, rendering, threads, event loop | Compiler, JS VM, JVM, ART, WebView, Browser Rendering, Native Rendering |
| Backend | 4 | Ingress layer | Request entry, routing, reverse proxy, traffic control | Nginx, API Gateway, web frameworks: Gin, Gorilla Mux, Spring MVC |
| Backend | 5 | AuthN / AuthZ layer | Identity, sessions, roles, permissions, resource access control | JWT, Session, OAuth2, OIDC, RBAC, auth frameworks/libraries: Better Auth |
| Backend | 6 | Application layer | Use-case orchestration, transaction boundaries, external dependency calls, error semantics | Service, Use Case, Application Service, business state machine |
| Backend | 7 | Domain model layer | Business concepts, business rules, state transitions, domain events | Entity, Value Object, Aggregate, Domain Event |
| Backend | 8 | Data and storage layer | Persistence, queries, caching, search, uploads, downloads | MySQL, PostgreSQL, Redis, Elasticsearch, S3, MinIO |
| Backend | 9 | Async and real-time layer | Traffic spike buffering, long-running jobs, retries, long-running workflows, real-time progress updates | Kafka, RabbitMQ, River, workflow engines: Temporal, Hatchet, SSE, WebSocket |
| Backend | 10 | Framework and runtime foundation | Backend frameworks, language runtimes, build tools, deployment runtime | Frameworks: Spring Boot, Gin, NestJS, Express, Fastify<br>Runtimes: JVM, Go runtime, Node.js runtime<br>Build/package management: Maven, Gradle, Go toolchain, npm, pnpm<br>Deployment infrastructure: Docker, Kubernetes, cloud runtime |

Cross-cutting capabilities span all layers and support security, stability, and maintainability.

| Cross-Cutting Capability | Layers Covered | Problem Solved | Common Technologies / Cloud Capabilities |
|---|---|---|---|
| Configuration and environments | All | Multi-environment configuration, secrets, feature flags, runtime parameters | `.env`, Viper, Vault, Secret Manager, ConfigMap, Feature Flag |
| Security governance | All | Attack prevention, data leakage prevention, privilege control, abuse prevention, audit and compliance | WAF, CORS, Rate Limit, KMS, IAM, Gitleaks, Trivy, bcrypt |
| Observability | All | Logs, metrics, distributed tracing, health checks, alerts, capacity planning | Prometheus, Grafana, Loki, ELK, OpenTelemetry, CloudWatch |
| Cloud-managed capabilities | All | Use managed services instead of self-managed infrastructure to reduce operations cost | CDN, LB, RDS, Redis, S3/OSS/COS, SQS, EKS, Cloud Run |
| Release and change management | Application layer, data and storage layer, async and real-time layer, framework and runtime foundation | Progressive delivery, fast rollback, database changes, configuration changes | CI/CD, Blue-Green, Canary, Schema Migration, Rollback |
| AI governance | Application layer, data and storage layer, async and real-time layer, framework and runtime foundation | Prompt injection protection, content safety, model evaluation, cost control, call audit | Guardrails, Moderation, Eval, Token Budget, Prompt Audit, Model Router |

## AI Application Backend Supplement

An AI application backend usually adds model calls, context retrieval, tool calls, asynchronous jobs, and governance capabilities on top of a traditional backend path.

| AI Backend Capability | Related Path | Common Technologies / Patterns |
|---|---|---|
| Retrieval augmentation | Data and storage layer, application layer | RAG, Embedding Store, pgvector, Milvus, Pinecone, Weaviate |
| Task orchestration | Application layer, async and real-time layer | AI Use Case, Agent Workflow, Prompt Orchestration, Tool Calling, Agent Task Queue |
| Model serving | Framework and runtime foundation | Ollama, vLLM, Triton, SageMaker, Vertex AI |
| Streaming responses | Async and real-time layer, ingress layer | Streaming Response, SSE, WebSocket |
| Governance and evaluation | Cross-cutting capability | Guardrails, Moderation, Eval, Token Budget, Prompt Audit, Model Router |

# Connecting the Stack with a Flash-Sale E-Commerce System

## 1. What Is the Business Scenario?

```text
100 phones available for limited-time purchase
A large number of users submit requests at the same time
The system must guarantee performance, data consistency, and security
```

## 2. Why Use This Scenario?

A flash-sale system is a useful backend architecture case because it includes both a complete business flow and system quality requirements. On the business side, it needs login, eligibility checks, stock decrement, order creation, payment, and cancellation. On the system side, it needs concurrency control, oversell prevention, idempotency, traffic spike buffering, compensation, scaling, and troubleshooting.

To use this scenario to connect the backend technology stack, first break down the problems, then map each problem type to the backend capability layer that solves it:

```text
Business problem -> functional requirement -> application layer / domain layer / data layer
System problem -> non-functional requirement -> ingress layer / cache / MQ / observability / deployment runtime
```

## 3. Requirements and Capability Needs in This Scenario

The requirements in this scenario can be divided into two categories: functional requirements complete the business flow, while non-functional requirements keep the system stable and correct under high traffic, failures, and business edge cases.

Functional requirements:

| Functional Requirement | Backend Capability | Typical Technologies / Methods |
|---|---|---|
| Users must be logged in and eligible to participate | Authentication and authorization layer, risk control | Session / JWT, RBAC, eligibility token, CAPTCHA, IP/user rate limiting |
| The campaign must start and end at specific times | Business rules, campaign configuration | Campaign configuration, time-window checks, feature switches |
| Stock must support reads and atomic decrements | Data and storage layer, consistency control | Redis stock, DB stock, stock ledger |
| Each user can only purchase once | Idempotency and deduplication | User-level dedup key, request_id, unique order index |
| A successful purchase must create an order | Application layer, data persistence | Application Service, Order Worker, MySQL |
| Orders need payment, cancellation, and closure | Domain model layer, state transitions | Order state machine, domain events, payment callback |
| Stock must be released after payment timeout | Async jobs, compensation | Delayed queue, scheduled job, stock rollback |

Non-functional requirements can be grouped into four categories: high performance, high availability, high scalability, and data consistency.

| Category | Non-Functional Requirement | Backend Capability | Typical Technologies / Methods |
|---|---|---|---|
| High performance | Many users enter the campaign page at the same time | Ingress layer, traffic control, static asset acceleration | CDN, Nginx, API Gateway, Rate Limit |
| High performance | Traffic spikes must not directly overload the database | Cache, traffic buffering, async processing | Redis, MQ, Worker, queuing |
| High performance | Hot products must not overload the system | Hotspot cache, hotspot isolation, rate limiting | Local cache, Redis, Rate Limit, stock sharding |
| High availability | Orders must not be lost when some components fail | Reliable messaging, retry, compensation | Local message table, transactional messages, Retry, DLQ, reconciliation scan |
| High availability | Issues must be diagnosable | Observability | trace ID, Metrics, Logs, Tracing, alerts |
| High scalability | The system must scale as traffic grows | Horizontal scaling, capacity planning | Stateless services, multiple replicas, Redis Cluster, MQ Cluster, Worker scaling |
| Data consistency | 100 phones must not be oversold | Atomic decrement, transactional fallback | Redis Lua, DB optimistic locking |
| Data consistency | Duplicate requests must not create duplicate orders | Idempotency, deduplication, unique constraints | request_id, idempotency table, unique order index |
| Data consistency | Payment timeout must not hold stock forever | State transitions, compensation | Delayed queue, order closure, stock release |

When functional and non-functional requirements are connected, they form the main flash-sale system path:

```text
Preparation phase
-> Preload product stock into Redis
-> Generate campaign configuration, purchase limits, and eligibility tokens

Request phase
-> CDN / Nginx / Gateway
-> Rate limiting, risk control, login check
-> Check campaign time, eligibility, one-order-per-user rule
-> Atomically decrement stock with Redis Lua
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
| Goal | Understand basic web architecture, complete the business flow, and learn Controller / Service / DAO |
| Solves | Basic ordering, product query, user login, order persistence |
| Does not solve | High database pressure under concurrency, possible overselling, limited single-instance scalability |
| Suitable for | Small projects, internal systems, MVPs |

Core path code:

```go
func Seckill(ctx context.Context, userID, skuID int64) {
	// Start a transaction so stock decrement and order creation succeed or fail together.
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

This stage completes the loop of reading stock, decrementing stock, and creating orders. As concurrency increases, requests hit the database directly, and stock row locks plus order writes become bottlenecks.

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
| Goal | Reduce database pressure, improve hot-read performance, and use atomic operations to control stock decrement |
| Solves | Hot product reads, fast stock decrement, initial duplicate-order prevention |
| Does not solve | Async traffic buffering, order persistence pressure, Redis/DB consistency, hot keys |
| Upgrade signal | Redis can handle reads/writes, but order creation, payment, notifications, or later steps begin to block |

Core path code:

```go
func Seckill(ctx context.Context, userID int64, skuID string) {
	stockKey := "stock:" + skuID
	userKey := fmt.Sprintf("seckill:user:%d:sku:%s", userID, skuID)

	// Redis Lua atomically completes stock decrement and user deduplication.
	result := redis.Eval(decrStockLua, stockKey, userKey)
	if result != "ok" {
		return
	}

	// Create the order synchronously after the stock pre-decrement succeeds.
	db.Exec("insert into orders(user_id, sku_id, status) values (?, ?, 'created')", userID, skuID)
}
```

Related technology stack:

| Category | Role | JS / Node | Go | Java |
|---|---|---|---|---|
| Redis client | Access Redis and execute Lua | ioredis, node-redis | go-redis | Spring Data Redis, Lettuce, Jedis |
| Cache and stock decrement | Hot cache, stock pre-decrement, deduplication | Redis Lua, lru-cache | Redis Lua, Ristretto | Redis Lua, Caffeine, Redisson |
| Rate limiting and anti-abuse | Control user, IP, and API frequency | Bottleneck, rate-limiter-flexible | x/time/rate, redis-rate | Bucket4j, Resilience4j |

This stage moves hot stock decrement from the database to Redis, improving stock checks and decrement throughput. Orders are still written synchronously to the database, so database writes still block when request peaks continue to grow.

## Stage 3: Introduce a Message Queue

```text
User
  |
Gateway / Nginx
  |
App
  |
Redis Lua stock decrement
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
| Does not solve | Duplicate messages, message loss, MQ backlog, stock decremented but order creation failed |
| Upgrade signal | More modules appear, and order, stock, user, and payment services need independent evolution and scaling |

Core path code:

```go
func Seckill(ctx context.Context, userID int64, skuID, requestID string) {
	userKey := fmt.Sprintf("seckill:user:%d:sku:%s", userID, skuID)

	// In the request phase, only validate eligibility, deduplicate, and pre-decrement stock.
	result := redis.Eval(decrStockLua, "stock:"+skuID, userKey)
	if result != "ok" {
		return
	}

	// Publish a message after stock decrement succeeds, then return quickly.
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
| Message queue | Traffic buffering, async order creation, service decoupling | KafkaJS, amqplib, BullMQ | kafka-go, amqp091-go, Asynq, River | Spring Kafka, Spring AMQP, RocketMQ Client |
| Consumer reliability | Idempotency, retry, dead-letter handling, duplicate consumption control | Idempotency Key, Retry, DLQ | Idempotency Key, Retry, DLQ | Idempotency Key, Retry, DLQ |
| Delayed tasks | Payment timeout, order closure, stock compensation | BullMQ, Agenda | Asynq, River | Quartz, Spring Batch, RocketMQ Delay Message |

This stage uses MQ to buffer traffic spikes. The request path returns quickly, and orders are created asynchronously by workers. Message redelivery, worker restarts, and consumption failures will happen, so order creation must be idempotent.

Production systems must also handle the failure point where stock has been decremented but the message publish fails. A common pattern is to write the pending event to a local message table / Outbox first, let a background job publish it to MQ, and use reconciliation scans to catch events that were not published successfully. Consumers should use `message_id`, `request_id`, or a unique order constraint to guarantee idempotency and avoid duplicate orders from duplicate messages.

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
| Goal | Support team collaboration, independent service deployment, and independent service scaling |
| Solves | Coupling among user/order/stock modules, service-specific scaling, unclear ownership boundaries |
| Does not solve | Distributed transaction complexity, harder trace debugging, higher service governance cost |
| Constraint | For high concurrency, prioritize cache, traffic buffering, rate limiting, and idempotency. Service decomposition is suitable after business complexity, team size, and independent deployment needs grow. |

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
	// The stock service still uses Redis Lua internally to make decrement and reservation atomic.
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

This stage splits users, orders, and stock into independent services that can scale separately according to load. Cross-service paths require compensation events; otherwise order success, stock failure, and payment failure can lead to inconsistent states.

After service decomposition, order, stock, and payment usually cannot rely on a single database transaction. The cross-service flow should be managed by a Saga state machine, for example `INIT -> STOCK_RESERVED -> ORDER_CREATED -> PAID -> DONE`. When any step fails, the flow enters a compensation state to release stock, close the order, or cancel payment. Compensation can also fail, so it needs retries, idempotency, and an operator intervention path.

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
| Goal | Support high concurrency, failure recovery, capacity scaling, and production troubleshooting |
| Solves | Single points of failure, insufficient capacity, lack of production visibility, weak recovery |
| Does not solve | Architecture complexity, operations cost, distributed consistency difficulty |
| Suitable for | Systems with large user volume, core transaction paths, and high availability/disaster recovery requirements |

Core path code:

```go
func SeckillHandler(ctx context.Context, req SeckillRequest) {
	// Rate limit at the gateway or service ingress to protect the backend core path.
	if !limiter.Allow(req.UserID, req.IP) {
		return
	}

	// Create a trace for one flash-sale request across gateway, services, MQ, and database.
	trace := tracing.Start("seckill", req.RequestID)

	// Execute the core business path.
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

This stage improves availability through replicas, clusters, rate limiting, and observability. As more components are added, troubleshooting depends on a consistent trace ID, metrics, logs, and alerts.

# How to Select Technologies and Design Architecture for Real Business

Architecture design should first clarify business requirements, then translate them into technical requirements, and finally choose between self-managed infrastructure and managed cloud services.

Decision sequence:

```text
Business requirements
-> Technical requirements
-> Cloud provider capabilities
```

## 1. Business Requirements: Clarify the Current Business First

Business requirement discovery should focus on factors that affect architecture shape: core path, read/write pattern, consistency, state complexity, external dependencies, permission boundaries, and delivery constraints.

| Question | Architecture Impact |
|---|---|
| What is the core business path? | Determines module boundaries, API boundaries, and transaction boundaries |
| What is the main read/write pattern? | Determines database, cache, search, and read/write splitting choices |
| How strong must data consistency be? | Determines local transactions, eventual consistency, compensation, and distributed transaction approaches |
| Is business state complex? | Determines basic CRUD, state machines, workflow engines, and event-driven design |
| Are there high-frequency external dependencies? | Determines adapters, retries, idempotency, circuit breaking, and graceful degradation |
| Are permission and tenant boundaries complex? | Determines Auth, RBAC, ABAC, Tenant Model, and resource isolation |
| Are files, search, or reporting needed? | Determines object storage, search engines, OLAP, and async tasks |
| Is realtime interaction needed? | Determines polling, SSE, WebSocket, MQ, and Redis Pub/Sub |
| What are the team and delivery constraints? | Determines monolith, modular design, microservices, Kubernetes, Serverless, and managed services |

## 2. Technical Requirements: Select Backend Capabilities

Technical requirements come from business requirements and non-functional load. First map business requirements to backend capabilities, then use performance, availability, scalability, and quantitative signals to judge whether the architecture needs to evolve.

### 2.1 From Business Requirements to Technical Capabilities

| Requirement Signal | Technical Capability | Problem Solved |
|---|---|---|
| Basic CRUD | Ingress layer, application service, Repository, database | Basic data create, read, update, delete |
| Login, roles, resource ownership | Auth, RBAC, Tenant Model | Identity, permission, tenant isolation |
| Files, attachments, export | Object Storage, Job Queue | File storage, async export |
| Search | Search Engine | Complex search, full-text search |
| Long workflow | State Machine, Workflow Engine | State recovery, retry, audit |
| Realtime progress / notification | SSE, WebSocket, MQ | Realtime updates, async notification |
| Third-party integration | Adapter, Signature Verification, Retry, Idempotency | Request authenticity, deduplication, failure recovery |
| Complex business rules | Domain Model, DDD, business state machine | Rule centralization, state transitions, long-term evolution |

### 2.2 From Non-Functional Requirements to Technical Capabilities

| Technical Need | Technical Capability | Upgrade Signal |
|---|---|---|
| High performance | Cache, indexes, async processing, rate limiting, hotspot isolation | P95 / P99 latency increases, or CPU / DB / network becomes a bottleneck |
| High availability | Replicas, health checks, backups, graceful degradation, circuit breaking | Single-instance failure affects core business |
| High scalability | Stateless services, queues, read/write splitting, horizontal scaling | Traffic, data volume, or team size grows |
| High concurrency spikes | Redis, MQ, queuing, idempotency design | Peak traffic impacts the core path |
| Data growth | Indexes, archiving, partitioning, read/write splitting, OLAP | Slow queries, oversized tables, slower backup and recovery |
| Observability | Logs, Metrics, Tracing, Alert | Production issues cannot be diagnosed |
| Security | WAF, KMS, IAM, audit | Public exposure, complex permissions, compliance requirements |
| Multi-environment delivery | Config, Secrets, CI/CD, IaC | Development, staging, and production configs start to diverge |

Architecture selection principles:

1. Confirm the current bottleneck first, then choose components.
2. New components must directly solve a clear problem.
3. Component benefits must exceed their development, operations, and troubleshooting costs.
4. Architecture complexity must match the team's maintenance capability.
5. Do not introduce heavyweight solutions before there is an actual problem.

Common mistakes:

- Introducing Kafka, Kubernetes, and microservices before a high-concurrency problem appears.
- Applying full DDD to a basic CRUD project.
- Self-hosting too much infrastructure when the team lacks operations capacity.
- Replacing architecture design with a list of cloud products.
- Listing technical terms without explaining problems, costs, and suitable conditions.

### 2.3 Quantitative Signals

Architecture selection needs current load data and growth rate. The ranges below are experience-based references; real judgment depends on business type, API complexity, data model, instance size, and team maintenance capability.

| Metric | Observation Target | Experience-Based Judgment |
|---|---|---|
| QPS < 50 | Internal systems, admin dashboards, small content sites | Monolith + single database is usually enough; prioritize delivery speed, permission boundaries, and data correctness |
| QPS 50-300 | Normal SaaS, content systems, regular business APIs | Prioritize indexes, slow query tuning, cache, and API latency |
| QPS 300-1000 | Online business with visible traffic | Evaluate cache, rate limiting, async tasks, read/write splitting, and horizontal scaling |
| QPS 1000+ | High-concurrency ingress, campaign page, transaction entry | Need Redis, MQ, rate limiting, load testing, capacity planning, and graceful degradation |
| Peak QPS / average QPS > 5 | Flash sales, ticketing, push traffic, marketing campaigns | Need traffic buffering, queuing, hotspot isolation, and ingress rate limiting |
| P95 latency > 300ms | User-facing APIs | Check slow SQL, external calls, lock waits, serialization, and network latency |
| P99 latency > 1s | Core APIs with obvious tail latency | Need timeout control, retry control, circuit breaking, async processing, and resource isolation |
| Error rate > 0.1%-1% | APIs, jobs, message consumption | Need alerts, rate limiting, graceful degradation, rollback, and failure compensation |
| DB CPU stays above 70% | Primary database, read replica, analytics database | Check slow queries, indexes, connection count, and cache hit rate before scaling |
| DB connections approach the limit | Application-to-database path | Need connection pool tuning, slow request tuning, read/write splitting, or rate limiting |
| Redis hit rate is below expectation | Cache path | Check key design, expiration strategy, cache misses, cache stampedes, and hot keys |
| MQ backlog keeps growing | Async jobs, orders, notifications, exports | Consumption capacity is insufficient; scale workers, split tasks, rate-limit entry, or optimize consumers |
| Single table reaches tens of millions of rows | Core business table | Watch indexes, archiving, partitioning, hot/cold data split, and backup recovery time |
| Single table reaches hundreds of millions of rows | High-growth transaction, log, or ledger table | Need sharding, archiving, search engine, OLAP, or an independent data path |

Quantitative signals identify the current bottleneck. If the database is slow, check slow queries and indexes first. If spikes are the problem, check rate limiting and traffic buffering. If jobs accumulate, check consumer capacity. If issues are invisible, add logs, metrics, and tracing first.

## 3. Cloud Provider Capabilities: Decide Managed or Self-Managed

Cloud provider capabilities are managed implementations of infrastructure capabilities. Selection should start from the needed capability, then decide whether to use a managed service or operate it yourself.

| Capability | Self-Managed Option | Managed Cloud Option | Suitable Conditions |
|---|---|---|---|
| Static resource acceleration | Nginx, static server | CDN | Images, JS/CSS, downloads, campaign pages |
| Load balancing | Nginx, HAProxy, Envoy | ALB / CLB / ELB | Multi-instance entry, cross-AZ traffic distribution |
| Relational database | Self-managed MySQL / PostgreSQL | RDS, Cloud SQL, Aurora | Normal business data, transaction data, permission data |
| Cache | Self-managed Redis / Redis Cluster | Managed Redis, ElastiCache | Hot data, sessions, rate limiting, ranking |
| Message queue | Kafka, RabbitMQ, RocketMQ | SQS, Pub/Sub, EventBridge, MSK | Async traffic buffering, event-driven design, task decoupling |
| Object storage | Local disk, MinIO | S3, OSS, COS, GCS | Images, attachments, exported files, backups |
| Container runtime | Self-managed Kubernetes | EKS, GKE, ACK, Cloud Run | Multi-service deployment, elastic scaling, rolling releases |
| Security | Self-managed WAF, certificates, key management system | WAF, KMS, IAM, Secrets Manager | Public services, permission isolation, secret management, audit |
| Observability | Prometheus, Grafana, ELK, Loki | CloudWatch, Cloud Logging, Cloud Monitoring | Logs, metrics, alerts, tracing |

Small teams and early-stage projects usually prefer managed services to reduce installation, upgrade, backup, disaster recovery, and incident recovery costs. For core transaction paths, check SLA, rate limits, backup restore, cross-AZ capability, failover time, and cost model.

Self-managed infrastructure mainly applies to cost control, compliance requirements, multi-cloud deployment, stronger control, or extreme performance requirements. Before choosing self-management, confirm that the team can handle deployment, upgrades, monitoring, backups, scaling, incident recovery, and security hardening.
