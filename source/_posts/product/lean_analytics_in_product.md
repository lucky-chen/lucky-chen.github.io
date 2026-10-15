---
title: "Lean Analytics for Product Engineers"
categories: Product
date: 2026-10-14
---

# Goal

**Chinese version: [面向产品工程师的精益数据分析](/i18n/zh/product/lean_analytics_in_product.html)**

Continuing the product engineer career path discussion, this article helps software engineers build a basic product thinking framework:

1. What validation stages does product innovation usually go through?
2. What qualitative judgment should be made at each stage?
3. What quantitative metric can be used to validate that judgment?

This article draws on [*Lean Analytics*](https://www.amazon.sg/dp/1449335675), a book on validating innovation that also helps engineers develop product thinking.

Recommended by [Kevin Weil](https://www.oreilly.com/library/view/lean-analytics/9781449335687/apc.html), [Dan Martell](https://www.oreilly.com/library/view/lean-analytics/9781449335687/pr01.html), [Fan Bing](https://www.sohu.com/a/115328943_358836), [Zhang Ximeng](https://www.woshipm.com/pmd/393383.html), and [Ding Lei](https://tech.sina.cn/csj/2019-03-05/doc-ihsxncvf9865915.d.html).



<!-- more -->

# Why

Software engineers often join product work from the delivery side. They know how to build the system, but may not have a clear framework for judging whether the product direction itself is valid.

Common gaps include:

- Not knowing which stage the product is currently in
- Treating all metrics as equally important
- Confusing feature delivery with product progress
- Optimizing technical or operational details before validating the core product risk
- Lacking a shared language for discussing product value, business risk, and user behavior

This article uses Lean Analytics to provide a simple operating framework:

- Use stages to locate the current product uncertainty
- Use qualitative questions to clarify what needs to be judged
- Use quantitative metrics to validate whether the product is moving forward

# How

The core process is:

1. Identify the current product stage.
2. Identify the main question of that stage.
3. Choose the evidence that can validate the question.
4. Choose the quantitative metric that best represents the evidence.
5. Use the metric result to decide whether to keep iterating, change direction, or move to the next stage.

> Note: The underlying logic draws on *On Contradiction* (identify the main question at each stage) and *On Practice* (test judgments through practice). Interested readers can explore both essays in *Selected Works of Mao Zedong*.

# What

This article has four parts:

1. Product Decision Pattern: how to turn product uncertainty into decisions.
2. Metrics: how to choose useful indicators.
3. Stages: how product innovation stages map to main questions, OMTM, focus, pass logic, and examples.
4. Business Model Metric References: stage-based metric references for different business models.

## Product Decision Pattern

### Use Stage to Choose Metrics

Different stages require different metrics.

The metric should serve the current biggest risk. A product in the empathy stage should not optimize channel ROI. A product with weak retention should not treat paid acquisition as the main problem.

### Use Metrics to Decide Actions

| Situation | Decision Focus |
|---|---|
| The metric worsens | Locate the bottleneck |
| The metric improves | Judge whether the stage risk has been reduced |
| The metric is distorted | Return to user behavior and qualitative evidence |
| The metric improves but the business does not | Recheck whether the metric is tied to the right risk |

### Use Stage Signals to Ask for Resources

The stages are introduced in the Stages section below. For product engineers, stage signals are evidence for asking the company to start, continue, or expand a project.

| Stage Signal | Internal Resource Request |
|---|---|
| Empathy signal is clear | Ask for time to build a prototype or run a focused experiment |
| Stickiness signal is clear | Ask for engineering, design, or data support to improve the product loop |
| Stickiness and revenue signals are both clear | Ask for more resources based on PMF evidence |
| Revenue signal is clear | Ask for sales, marketing, pricing, or infrastructure resources |
| Scale signal is clear | Ask for larger team allocation, channel investment, operations support, or platform work |

> Note: In startup language, these signals are similar to PMF evidence. Founders use PMF evidence to ask investors or partners for more resources; product engineers can use stage evidence to make similar resource requests inside a company.


## Metrics

Metrics are useful only when they help a team make a decision.

### What Makes a Good Metric

| Principle | Meaning |
|---|---|
| Actionable | When the metric changes, the team knows what to adjust |
| Comparable | It can be compared with history, targets, segments, or competitors |
| Ratio first | Ratios show efficiency and quality better than raw volume |
| Simple and clear | Non-data roles can understand it |
| Problem-revealing | A decline can expose the business bottleneck |

### OMTM: One Metric That Matters

OMTM is the one metric that best represents whether the current main risk is being reduced.

A good OMTM should answer three questions:

1. What is the current main risk?
2. Which metric best shows whether that risk is improving?
3. What action will the team take based on the result?

### Common Metric Types

These types are useful as a checklist, not as the main framework.

| Type | Role | Examples |
|---|---|---|
| Vanity metrics | Show scale but do not directly guide decisions | PV, total registered users, cumulative downloads |
| Action metrics | Guide product or business action | Conversion rate, retention rate, CAC, LTV |
| Leading indicators | Signal future outcomes early | Activation rate, key action completion rate, day-1 retention |
| Lagging indicators | Reflect final outcomes | Revenue, profit, GMV, churn rate |
| Qualitative evidence | Explain why something happens | User interviews, support feedback, review text |
| Quantitative evidence | Judge scale and change | Funnel data, retention curves, revenue data |


## Stages

The stage model answers two questions:

1. What is the main uncertainty of the current business?
2. How much evidence is enough to move to the next stage?

The standards below are directional. The actual threshold depends on business model, usage frequency, margin structure, acquisition cycle, and product maturity.

| Stage | Core Question | OMTM Tendency | Minimum Standard for the Next Stage |
|---|---|---|---|
| Empathy | Does the problem really exist? | Valid interviews, reservation rate, manual conversion rate | Clear target users, real pain, existing alternatives, willingness to act |
| Stickiness | Do users keep using it? | Activation rate, retention rate, key action completion rate | Stable retention, clear core value, repeatable activation path |
| Virality | Do users bring new users? | Share rate, invitation conversion rate, viral coefficient | Invited users activate and retain, organic spread reduces CAC |
| Revenue | Can it make money? | Paid conversion rate, LTV/CAC, gross margin | Acceptable unit economics, repeatable revenue, controllable cost structure |
| Scale | Can growth be amplified efficiently? | Channel ROI, CAC payback period, profit margin | Growth, quality, organization, and finance remain controlled |

### Empathy: Does a Real Problem Exist?

**Step 1: Main Question**

Whether the target user has a real, painful problem worth solving.

**Step 2: Focus**

| Focus | What to Judge | Evidence | Common Mistake | Pass Signal |
|---|---|---|---|---|
| Problem intensity | Whether the problem is painful in a concrete scenario | Interview signal, problem frequency | Listening to what users say instead of observing what they do | Users describe the scenario, loss, and current workaround clearly |
| Existing alternatives | Whether users already spend effort solving the problem | Current workaround, paid alternative, manual process | Treating no alternative as a good sign | Users already use a workaround, paid product, or manual process |
| Willingness to act | Whether users will spend money, time, or switching cost | Reservation rate, trial request, manual conversion rate | Treating verbal interest as real demand | Users leave information, try, reserve, pay, or spend time |
| Target users | Which segment feels the pain most strongly | Segment-level interview signal | Averaging feedback across weak and strong users | The team can explain who feels the pain most, why, and when |

**Step 3: Possible OMTM**

Valid interviews, reservation rate, or manual conversion rate. Choose one based on the riskiest assumption in the current iteration.

**Step 4: Pass Logic**

- Move forward when: the problem, target user, existing alternative, and willingness to act are clear.
- Risk of skipping: the team may build a solution for an imagined problem.

**Example**

Suppose the product is an AI code review SaaS. At this stage, the team should not start by measuring model accuracy alone. The first question is whether engineering teams already suffer from review delay, inconsistent review quality, or repeated manual checklist work. Strong evidence would include teams using custom scripts, written review rules, senior engineers spending repeated time on similar comments, or trial requests after seeing a manual demo.

### Stickiness: Do Users Keep Using It?

**Step 1: Main Question**

Whether users keep using the product because it creates real value.

**Step 2: Focus**

| Focus | What to Judge | Evidence | Common Mistake | Pass Signal |
|---|---|---|---|---|
| Activation | Whether new users can reach the first core value | Activation rate | Treating registration as activation | New users can consistently complete the core action |
| Retention | Whether users return within the expected usage cycle | Day-1, day-7, day-30 retention | Letting new user growth hide weak retention | Core users keep returning within a reasonable cycle |
| Usage depth | Whether repeated usage happens on the core value path | Core action frequency, task completion rate | Treating any activity as core value usage | Users repeatedly use the core value path |
| Key behavior | Which behavior predicts long-term retention | Behavior cohort analysis | Treating every click as meaningful behavior | The team can identify behaviors strongly related to long-term retention |

**Step 3: Possible OMTM**

Activation rate, retention rate, or key action completion rate. Choose one based on whether the bottleneck is first value, repeat usage, or a specific retained-user behavior.

**Step 4: Pass Logic**

- Move forward when: retention is stable, core value is clear, and new users can repeatedly reach that value.
- Risk of skipping: scaling acquisition usually only exposes churn faster.

**Example**

For the AI code review SaaS, stickiness depends on whether teams repeatedly run reviews through the product after the first trial. A useful OMTM may be weekly active repositories with completed AI reviews, because it ties usage to the actual review workflow instead of counting logins or page views.

### Virality: Do Users Bring New Users?

**Step 1: Main Question**

Whether user behavior can create new users without relying only on paid acquisition.

**Step 2: Focus**

| Focus | What to Judge | Evidence | Common Mistake | Pass Signal |
|---|---|---|---|---|
| Sharing | Whether users share or invite for a real product reason | Share rate, invitation rate | Treating share-button clicks as real spread | Sharing comes from value, relationship, collaboration, or identity expression |
| Conversion | Whether invited users accept and activate | Invitation acceptance rate, share-to-activation rate | Celebrating exposure without conversion | Invited users activate and retain |
| Viral loop | Whether each user brings in new users within a reasonable cycle | Viral coefficient, propagation cycle | Reading viral coefficient without propagation time | Organic spread reduces overall CAC |
| User quality | Whether referred users retain and behave like good users | Referred-user retention, complaint rate | Driving low-quality users through rewards | New user quality, retention, and complaints do not worsen significantly |

Not every business must pass through the virality stage. Low-frequency, high-ticket, transaction-heavy businesses may move from stickiness directly to revenue validation.

**Step 3: Possible OMTM**

Share rate, invitation conversion rate, or viral coefficient. Choose one based on whether the current risk is motivation, conversion, loop efficiency, or referred-user quality.

**Step 4: Pass Logic**

- Move forward when: sharing has a real motivation, invited users activate and retain, and organic spread lowers acquisition cost without damaging quality.
- Risk of skipping: referral or sharing mechanisms may bring low-quality users without sustainable growth.

**Example**

For the AI code review SaaS, virality may come from collaboration rather than public sharing. If one engineer installs the tool and then invites teammates to comment, approve, or configure repository rules, workspace invite activation becomes more meaningful than generic share rate.

### Revenue: Can It Make Money?

**Step 1: Main Question**

Whether product value can become repeatable revenue.

**Step 2: Focus**

| Focus | What to Judge | Evidence | Common Mistake | Pass Signal |
|---|---|---|---|---|
| Payment intent | Whether users pay for the product value | Paid conversion rate, trial-to-paid rate | Treating free usage as willingness to pay | Users pay for the product value |
| Pricing logic | Whether users understand what value they are paying for | ARPU, plan selection, discount sensitivity | Testing price without understanding perceived value | The team can explain why users pay and which value they pay for |
| Revenue repeatability | Whether payment repeats through renewal, repurchase, or expansion | Renewal rate, repeat purchase rate, expansion revenue | Treating one-time payment as repeatable revenue | Payment, renewal, or repeat purchase is not accidental |
| Unit economics | Whether revenue can cover acquisition and delivery cost | LTV/CAC, gross margin, payback period | Letting revenue growth hide unsustainable cost | LTV covers CAC, fulfillment cost, and service cost |

**Step 3: Possible OMTM**

Paid conversion rate, LTV/CAC, or gross margin. Choose one based on whether the current risk is payment intent, acquisition efficiency, or delivery cost.

**Step 4: Pass Logic**

- Move forward when: revenue is repeatable, pricing logic is clear, and unit economics are acceptable.
- Risk of skipping: growth may amplify an unprofitable business model.

**Example**

For the AI code review SaaS, revenue validation begins when repeated review usage turns into paid team or company accounts. Trial-to-paid rate may be the first useful metric, but renewal rate, expansion seats, and LTV/CAC become more important once teams depend on the tool in their engineering workflow.

### Scale: Can Growth Be Amplified Efficiently?

**Step 1: Main Question**

Whether growth can be amplified without losing efficiency, quality, or financial control.

**Step 2: Focus**

| Focus | What to Judge | Evidence | Common Mistake | Pass Signal |
|---|---|---|---|---|
| Growth efficiency | Whether channels keep working as spend increases | Channel ROI, CAC payback period | Letting total growth hide channel-level losses | Core channel ROI is stable, and CAC does not deteriorate quickly |
| Organizational efficiency | Whether delivery and experiment speed remain healthy | Revenue per employee, experiment throughput | Using headcount growth as the main scaling method | Delivery efficiency and experiment efficiency do not decline significantly |
| Quality stability | Whether more volume creates proportional quality problems | Complaint rate, failure rate, fulfillment failure rate | Ignoring systemic problems amplified by scale | Complaints, failures, and fulfillment issues do not worsen proportionally with scale |
| Profitability | Whether larger scale improves or preserves financial health | Profit margin, cash flow, marginal cost at scale | Assuming bigger scale automatically improves profit | Gross margin, cash flow, and payback period support continued investment |

**Step 3: Possible OMTM**

Channel ROI, CAC payback period, or profit margin. Choose one based on whether the current risk is acquisition efficiency, cash recovery, or profitability.

**Step 4: Pass Logic**

- Keep scaling when: growth, quality, organization, and finance remain controlled.
- Risk of skipping: scale may amplify channel losses, quality failures, and organizational inefficiency.

**Example**

For the AI code review SaaS, scale should be judged after retention and revenue are working. At this stage, CAC payback, NRR, gross margin, and revenue per employee matter because growth may increase onboarding support, repository integration work, and inference cost.


## Business Model Metric References

Stage-based metric references for common business models.

### E-commerce / Transaction Platform

Core logic: traffic -> supply -> conversion -> repeat purchase -> profit.

| Stage | Metric References | Judgment Point |
|---|---|---|
| Empathy | Search behavior, interview signal, existing purchase path, manual order conversion | Users already have purchase intent or existing transaction behavior |
| Stickiness | Repeat purchase rate, purchase frequency, reorder interval, saved items, cart recovery | Users return for the category or transaction need |
| Virality | Referral conversion rate, share-to-purchase rate, group-buy participation, invite-driven GMV | Sharing creates new transactions |
| Revenue | GMV, take rate, gross margin, subsidy rate, fulfillment cost, LTV/CAC | Revenue quality is visible beyond transaction volume |
| Scale | Channel ROI, CAC payback period, supply coverage, fulfillment failure rate, cash conversion cycle | Growth can be evaluated across acquisition, supply, fulfillment, and cash flow |

### SaaS / Subscription Business

Core logic: acquisition -> activation -> usage -> retention -> payment -> expansion.

| Stage | Metric References | Judgment Point |
|---|---|---|
| Empathy | Problem interviews, workflow frequency, current tool usage, manual workaround, trial request | Users already have a repeated workflow problem |
| Stickiness | Activation rate, first core task completion rate, WAU/MAU, feature usage depth, cohort retention | Users repeatedly complete the core workflow |
| Virality | Workspace invite rate, invite activation rate, collaboration-created accounts, team adoption depth | Collaboration brings in qualified users |
| Revenue | Trial-to-paid rate, MRR, ARR, ARPU, churn rate, renewal rate, LTV/CAC | Usage converts into recurring revenue |
| Scale | CAC payback period, NRR, seat expansion, revenue per employee, gross margin | Growth is supported by retention, expansion, and efficient acquisition |

### UGC / Community

Core logic: users create content -> content is consumed -> interaction gives feedback -> creators keep contributing -> the community retains.

| Stage | Metric References | Judgment Point |
|---|---|---|
| Empathy | Creator interviews, existing publishing behavior, community participation, manual content contribution | Users already have creation, discovery, or interaction needs |
| Stickiness | Creator retention, consumer retention, posting frequency, consumption depth, interaction rate | Creators and consumers both keep returning |
| Virality | Share rate, invite conversion rate, content-driven signup rate, follow graph growth | Content or relationships bring in new retained users |
| Revenue | Ad revenue per user, creator monetization rate, paid community conversion, take rate, LTV/CAC | Monetization can be tracked without losing creator and consumer signals |
| Scale | DAU/MAU, active creators, high-quality content ratio, moderation pass rate, report rate | Growth can be evaluated across activity, supply, quality, and moderation |
