---
title: Compose架构模块梳理
categories: Compose
date: 2023-2-15
---

# 背景

[Jetpack Compose](https://developer.android.com/jetpack/compose?hl=zh-cn) 是Google推出的一个使用kotlin语言、声明式的UI框.

- 针对框架的PreCompose优化方案
- 通过PreCompose方案，深入compose的源码: 介绍有哪些模块, 有什么作用, 未来能做些什么

<!-- more -->

# PreCompose方案简介

## 问题分析

```kotlin
//demo
@Composable
fun listContent() {
        LazyColumn(modifier = Modifier.fillMaxSize()) {
            itemsIndexed( items = list, key = { index, item -> item.id }) { index, item ->
                Row {
                    Detail(item)
                }
            }
        }
}
```

分析trace,5个主要步骤,几乎80%的耗时在compose和applychange这2两个步骤,围绕这两点探索优化方案
![](/image/compose/list_trace.JPEG)

## 流程改造

![](/image/compose/compose_ppl.PNG)

1. 编译器编译,对@compose函数进行代码生成
2. runtime调度运行compose函数
3. compose结果写入slotable
4. Apply compose执行过程中产生的change
5. Layout measure draw

PreCompose是将2和3的过程, 提前在另外一个线程运行 (类比前端框架的话, 大概可以理解为预先执行JS逻辑, 生成domtree?)

![](/image/compose/precompose_ppl.png)

PreCompose方案改动涉及1到4的流程, 所以需要预先对compose有一定的了解, 下面会一边介绍compose内部原理、模块,一边介绍PreCompose的改造.

# 源码模块划分以及改造方案详解

## 1. 分层/模块设计

[Jetpack Compose architectural layering](https://developer.android.com/jetpack/compose/layering), 由上到下架构总共分为5层,每层又包含不同的模块,举个实际代码的例

![](/image/compose/compose_code_layer_demo.png)

- Material: 提供了 Material Design 的实现组件
  - Android 平台上的特定能力， 比如组件库，主题等
- Foundation :  与设计系统无关的组件、能力
  - Row  行布局
  - LazyList 列表组件 (组件适配)
  - 特定手势识别
- UI: 界面工具包的基本组件
  - 输入事件处理
  - 布局:LayoutNode
  - 绘图(RenderNodeLayer  DisplayList canvas)
  - Modifer : 对 UI 效果进行一些修饰或添加行为，类似css 
- Runtime :  Compose 运行时的基本环境、组件
  - Snapshot  :  Compose 通过名为“快照（Snapshot）”的系统撑状态(State )管理与重组机制的运行
  - Composable functions: 基本组成单元, 唯一目的就是构建一颗 Composition tree
  - SlotTable: 数据结构,记录CompositionTree(包括节点tree、位置记忆、参数、remembered values等等)
  - Recomposer 处理由于state更改导致的重新compose
- Compiler  The Road to the K2 Compiler | The Kotlin Blog
  - 基于KCP(kotlin compile plugin)，针对compose特性编写的编译器插件, 其中前端编译部分做语法、静态检查，后端编译操作IR做Compose代码的转换
PreCompose的改造涉及2个模块
- Runtime : 修改composeinit和recompose的运行时许、协程调度
- Foundation : 适配lazylist组件 (item 单独compose处理)

## 2. Compose Compiler Plugin

基于KCP(kotlin compile plugin),compose 开发了一个用于compose的插件， 分别在前端编译和后端编译阶段进行一些逻辑处理 

### 2.1 Kotlin k2编译器

[The Road to the K2 Compiler | The Kotlin Blog](https://blog.jetbrains.com/kotlin/2021/10/the-road-to-the-k2-compiler/)

![](/image/compose/kotlin_compiler_flow.svg)

#### Frontend（编译器前端）  ide插件复用

![](/image/compose/kotlin_compiler_fir.png)

- 提升前端静态分析&&检查的性能 (比如频繁修改局部代码, 基于FIR做了大量性能优化)
- 做一些简单的脱糖&&代码生成工作

#### Backend（编译器后端）

基于IR等产物，代码生成、优化、生成平台目标代码
![](/image/compose/kotlin_compiler_ir.png)

### 2.2 Compose的编译插件

Compose编译和runtime阶段是互相配合的, 编译器根据runtime的一些规则、逻辑, 分析@Compose函数代码,进行代码生成
- Compose Compiler(1) kotlin编译架构&&KCP 
- Compose Compiler(2): Compose plugin 

Compose Compiler 是一个 KCP, 核心在于其实现逻辑的Extension . 入口在[ComposePlugin.kt](https://cs.android.com/androidx/platform/frameworks/support/+/androidx-main:compose/compiler/compiler-hosted/src/main/java/androidx/compose/compiler/plugins/kotlin/ComposePlugin.kt)

#### 2.2.1 前端编译

```kotlin
class ComposeComponentRegistrar : ComponentRegistrar {
    //frontend 部分, ide
    fun registerCommonExtensions(project: Project) {
        StorageComponentContainerContributor.registerExtension(project,
            //检查是否可以调用 @Composable 函数
            ComposableCallChecker()
        )
        StorageComponentContainerContributor.registerExtension(project,
            //检查 @Composable 的位置是否正确
            ComposableDeclarationChecker()
        )
        //...
    }
}
```

[ComposeErrorMessages.kt](https://android.googlesource.com/platform/frameworks/support/+/d9b093e6c6ae29e35c003f9b2733d032b8dacddf/compose/compiler/compiler-hosted/src/main/java/androidx/compose/compiler/plugins/kotlin/ComposeErrorMessages.kt)

![](/image/compose/kotlin_compiler_fir_error_tips.png)

#### 2.2.2 后端编译

操作IR的Transformer， 一层一层lower，直到汇编机器码级别
![](/image/compose/kotlin_compiler_ir_api.png)

compose逻辑
![](/image/compose/compose_kcp.png)
```kotlin
class ComposeIrGenerationExtension(...) : IrGenerationExtension {
    override fun generate(moduleFragment: IrModuleFragment,pluginContext: IrPluginContext) {
      
        //判断类型稳定性并针对稳定类型生成跳过重组的对应代码
        ClassStabilityTransformer(pluginContext).lower(moduleFragment)
        ComposerLambdaMemoization(pluginContext).lower(moduleFragment)
        //...

        // transform all composable functions to have an extra synthetic composer
        // parameter. this will also transform all types and calls to include the extra
        // parameter.
        //为@Composable 函数增加 $compsoer 等参数
        ComposerParamTransformer(pluginContext).lower(moduleFragment)
        //内部调用: composerParam = fn.addValueParameter（...）
         
        //非常复杂的一个trasnfromer, Composable 函数体内生成 startXXXGroup/endXXXGroup/recompose 等相关代码
        //This IR Transform is responsible for the main transformations of the body of a composable function.
        //1. Control-Flow Group Generation
        //2. Default arguments
        //3. Composable Function Skipping
        //4. Comparison Propagation
        //5. Recomposability
        //6. Source location information (when enabled)
        ComposableFunctionBodyTransformer(pluginContext).lower(moduleFragment)

        if (isKlibTarget) { }
        if (pluginContext.platform.isJs()) {}   
    }
}
```

1. 将 Compose 代码以 Group 为单位，进行切块 (符合Slottable的规则, 运行期写入)
2. 加入一些 change 的判断逻辑来 skip 不需要重复执行的 Group （重组是乐观的）
3. IR 阶段注入的 $composer 连接了开发者编写的 Composable functions 和 Compose runtime。
4. ... 其它复杂的逻辑

### 2.3 我们可以做什么（编译优化） 

- 前端fir （ide 插件复用）
  - 静态语法、语义分析:  coding最佳实践提示
  - 最佳实践：state作用域 
- 后端ir
  - 代码插入： 代码覆盖率热点代码统计, 特殊逻辑
  - 优化：指令精简(包体积)、compose 逻辑优化（skip、复用）

## 3. Compose运行阶段

```kotlin
class MyComposeView2 @JvmOverloads constructor(context: Context) 
   : AbstractComposeView(context) {
  
    @Composable
    override fun Content() {
        var count by remember { mutableStateOf(1) }
        Button(onClick = { 
            count++ 
        }){
            Text(text = "count $count")
        }
    }
}
```

1. Env prepare : 创建相关对象,注册相关observer
2. Compose : 执行compose函数、applychange
3. measure、layout、draw
4. Recompose : 触发recompose

### 3.1 Step1: Compose Env Prepare

![](/image/compose/compose_env_prepare.png)

- 创建AbstractComposeView, 初始化平台相关lifecycle,关联compose生命周期,持有根@compose函数 Content
- 创建 AndroidComposeView 用于measure、layout、draw
- 初始化Composition && Slottable
- 初始化 Recomposer
  - 向GlobalSnapshot注册observer, 记录state的变更和state所属的scope
  - 开启一个协程, 观察state改变,从而触发重组

### 3.2 Step2: ComposeRuntime

#### 3.2.1 Snapshot system

Snapshot 系统作为Comppose的一个核心底层设施，可以脱离 Compose UI 单独使用, 支撑状态管理与重组机制的运行 [Introduction to the Compose Snapshot system](https://dev.to/zachklipp/introduction-to-the-compose-snapshot-system-19cn) ,  是一个 MVCC 系统的实现, 全称 Multiversion Concurrency Control （多版本并发控制），常用于数据库管理系统，实现事务并发 ,其模型与 Git 分支管理系统也有点类似. 有以下特性

![](/image/compose/snapshot_system.png)

- Mutablesnapshot /GlobalSnapshot
- Isolation: 访问隔离
- 快照修改、提交
- 冲突解决
- 响应式状态读写感知
- 并发与冲突解决 

```kotlin
fun main() {
  val count = mutableStateOf(1) //globalSnapshot      git main
  
  val readObserver: (Any) -> Unit = { readState ->
      println("state was read")
  }
  val writeObserver: (Any) -> Unit = { writtenState ->
      println("state was written")
  }
  
  val snapshot = Snapshot.takeMutableSnapshot(readObserver,writeObserver)   //git checkout
  println(count)    // 1
  
  snapshot.enter {
    count = 2        //edit in new branch.  Isolation
    println(count)   //2
    //compose func
  }
  //snapshot.apply() //git merge 1,2,2
  
  println(count)   //1 or 2 =====> apply? 2: 1   Isolation&& apply
}
```

#### 3.2.2 Compose env

demo
```kotlin
class MyComposeView @JvmOverloads constructor(...)) : AbstractComposeView(...) {

    @Composable
    override fun Content() {
        TestContent()
    }
```

最终会调用到composeInitial函数中,Content函数作为参数传递过来
```kotlin
//Recomposer.kt
override fun composeInitial(composition:ControlledComposition,content: @Composable () -> Unit) {
 
    composing(composition, null) {              //1
        composition.composeContent(content)     //2
    }
    Snapshot.notifyObjectsInitialized()        //3
    composition.applyChanges()
}

private inline fun <T> composing(composition,modifiedValues,block: () -> T): T {
    val snapshot = Snapshot.takeMutableSnapshot(  //1.1
        readObserverOf(composition), writeObserverOf(composition, modifiedValues)
    )
    snapshot.enter(block)     //1.2
    applyAndCheck(snapshot).  //1.3
}

class CompositionImpl() {
    override fun recordReadOf(value: Any) {
        composer.currentRecomposeScope?.let { observations.add(value, it) }
    }

    override fun recordWriteOf(value: Any) = synchronized(lock) {
        invalidateScopeOfLocked(value)
    }
}
```

![](/image/compose/compose_init.png)

1. 从GlobalSnapshot派生一个mutablesnapshot， 在mutablesnapshot中执行content组合函数 (并行化compose的基础之一) 
2. 执行compose函数， 产生button、text节点以及state等信息, 结果记录在slottable上

![](/image/compose/compose_runtime_slotable.png)

3. compose中产生的change记录在changeList上，下个阶段applychange调用
4. 合并state变动调用snapshot.apply 
  - 合并状态更改: 回掉globalsnapshot 的observer， 将mutablesnapshot中state的改动merge回globalsnapshot上
  - 记录被更改的composition: Map<State,Composition>
5. 调用composition的applychange, composition执行changelist
```kotlin
composition.applyChanges()
```

### 3.3 Step3: ApplyChange

在compose函数执行过程中，产生了非常多的change，在这一步会apply各种change
```kotlin
private fun applyChangesInLocked(changes: MutableList<Change>) {
    applier.onBeginChanges()
    slotTable.write { slots ->
        changes.fastForEach { change ->
            change(applier, slots, manager)
    }    
    applier.onEndChanges()
}
```

这些change是什么呢
![](/image/compose/compose_change_list.png)

- Sideeffect

```kotlin
@Compose
fun Widget(){
    print("phase: compose !")
    val strat = time.current()
    SideEffect {
        //timing, compose done || node create end.   //change 0
        val timeCost = time.current() - start
        print("phase: applychange ! time diff: $timeCost") 
    }
}
```

- 创建、更新节点

```kotlin
//text
fun Text(){
    ReusableComposeNode(....)
}

ReusableComposeNode<ComposeUiNode, Applier<Any>>(
    factory = ComposeUiNode.Constructor,  //change 1. create node
    update = {
        set(density, ComposeUiNode.SetDensity). //change2 update node
        set(layoutDirection, ComposeUiNode.SetLayoutDirection) 
    },
)

AndroidView(modifier = Modifier.width(60.dp), 
    factory = { ctx ->                                
        ImageView(ctx).apply { setImageDrawable(d) }  //change 3. create androidview 
    }, update = {                                     
         it.startAnimation()                         //change 4. update androidview 
    }
)
```

- 操作Applier

```kotlin
//composer.kt
private fun realizeUps() {
    record { applier, _, _ ->
        repeat(count) { applier.up() }
    }
}

interface Applier<N> {
    val current: N
    fun onBeginChanges() {}
    fun onEndChanges() {}
    fun down(node: N)
    fun up()
    fun insertTopDown(index: Int, instance: N)
    fun insertBottomUp(index: Int, instance: N)
    fun remove(index: Int, count: Int)
    fun move(from: Int, to: Int, count: Int)
    fun clear()
}
```
SlotTable 中的状态不能直接用来渲染，通过 Applier 转换成渲染树NodeTree

![](/image/compose/compose_slotable_applier_layoutnode.png)

```kotlin
//android
internal class UiApplier(root: LayoutNode) : AbstractApplier<LayoutNode>(root) {
    override fun insertTopDown(index: Int, instance: LayoutNode) {}
    override fun insertBottomUp(index: Int, instance: LayoutNode) {
        current.insertAt(index, instance)
    }
    override fun remove(index: Int, count: Int) {
        current.removeAt(index, count)
    }
    override fun move(from: Int, to: Int, count: Int) {
        current.move(from, to, count)
    }
    override fun onClear() {
        root.removeAll()
    }
    override fun onEndChanges() {
        super.onEndChanges()
        root.owner?.onEndApplyChanges()
    }
}
```

> !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! <br>
> 这里是不是很有趣,完全可以自己实现一套自定义的LayoutNode, 跨平台渲染能力 <br>
> !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

### 3.4 我们能做什么？PreCompose性能优化方案详解

前面讲过, 从性能trace上看, compose和applychange两部分耗时几乎占了80%+,如果要优化首帧,必须想办法解决compose和applychange两部分的消耗
- Compose:  运行compose函数, 根据状态和运行过程, 生成slottable, 记录changes
- Applychange: 运行上一步记录的changs (生成node、回掉node的update函数, 更新layoutnode、其他callback)

理论上可以把compose和Applychange两部分提前执行. 

但是考虑到实际场景, 通常提前执行是在异步线程中, 而Applychange涉及到(AndroidView)的操作,异步破坏了流程设计.  所以, 最后决定将compose部分提前多线程执行
由于初期不确定方案的改造范围和实际coding风险,  分为3步逐步改造验证
1. 在UI线程PreCompose一个常规组件的页面 (row、text、button)
2. 在ui线程PreCompose一个具备特殊组件的页面(lazylist)
3. 重复1和2, 将PreCompose放到多线程下执行

#### 3.4.1 UI线程Precompose

如上所示， compose 后的结果一个是slottable， 一个是list<change>,只需要在applychange这一步切一刀

![](/image/compose/precompose_ppl.png)

api设计

```kotlin
abstract class AbstractPreComposeView @JvmOverloads constructor()     
   fun preComposeContent() {
        //prepare compose env
        initPreComposeOnUiThread()
        //run composeinit
        callComposeContent()
     }
 } 
```

- 提前处理好各种lifecycle的绑定和触发时机 (Android和activeity/fragment绑定的一些lifecycle)

```kotlin
abstract class AbstractPreComposeView @JvmOverloads constructor()     
    fun initPreComposeOnUiThread() {
        //bind wrap lifecycle
        delegateLifecycleOwner.registry.handleLifecycleEvent(Lifecycle.Event.ON_RESUME)
        //make composition && register lifecycle
        ensureCompositionCreated()
        composition?.isAsyncCompose = true
        
        //prepare composition
        composeView?.initLifeCycleEnv()
        composeView?.invokeOnViewTreeOwnersAvailable()
    }
    
     override fun onAttachedToWindow() {
        //lifecycle处理
        delegateSavedStateOwner.originOwner = realSavedStateRegistryOwner
        ViewTreeLifecycleOwner.set(this, delegateLifecycleOwner)
        setViewTreeSavedStateRegistryOwner(delegateSavedStateOwner)
        super.onAttachedToWindow()
    }
}
```
- 驱动Compose函数的执行

```kotlin
abstract class AbstractPreComposeView @JvmOverloads constructor()  
    fun callComposeContent() {
        //触发composeInit
        composeEventObserver.onStateChanged(delegateLifecycleOwner,Lifecycle.Event.ON_CREATE)
        block?.let { it() }
    }
}
```

- 上屏时,只需要执行`ApplyChange`驱动后续的流程: 将slottable和list<change>的变动apply

```kotlin
abstract class AbstractPreComposeView @JvmOverloads constructor()     
    fun initPreComposeOnUiThread() {
        composeView?.calledwhenAttachToWindow = {
            uiDispatcher?.postFrameCallback {
                //上屏时驱动applyAsyncComposeChange
               composition?.applyAsyncComposeChange()
            }
        }
    }

```

#### 3.4.2 List Item Precompose 

普通组件这么写是ok的,但是如果有特殊组件如列表, 这样还不够

```kotlin
@Composable
fun listContent() {
   // CompositionLocalProvider(LocalPreComposeItemCount provides 10) {
        LazyColumn(modifier = Modifier.fillMaxSize()) {
            itemsIndexed( items = list, key = { index, item -> item.id }) { index, item ->
                androidViewItem(item)
            }
        }
   // }
}
```

- 上面那种,只能触发最外层的Composition的逻辑, 列表每一个Item是一个subcompositon, 是在measure阶段触发的,需要适配

![](/image/compose/compose_list.png)

处理好compose、applychange、measure的时序

- `lazyList`
```kotlin
internal class LazyLayoutMeasureScopeImpl internal constructor() {
    
    override fun measure(index: Int, constraints: Constraints): List<Placeable> {
        //val cachedPlaceable = placeablesCache[index]
        val key = itemContentFactory.itemProvider().getKey(index)
        val itemContent = itemContentFactory.getContent(index, key)
            //compose
        val measurables = subcomposeMeasureScope.subcompose(key, itemContent)
            //measure
        List(measurables.size) { i -> measurables[i].measure(constraints)}
    }
}


fun subcompose(slotId: Any?, content: @Composable () -> Unit): List<Measurable> {
    subcompose(node, slotId, content) //=> subcomposeInto
}

 private fun subcomposeInto(composable: @Composable () -> Unit): Composition {
    return createSubcomposition(container, parent).apply {
            isAsyncCompose = asyncCompose
            setContent(composable)
    };
}

```

- 在外层compose阶段, 收集list item的信息

```kotlin
@Composable
fun LazyLayout(...){
    SubcomposeLayout(subcomposeLayoutState,itemContentFactory,measurePolicy)
    val preComposeItemCount = LocalPreComposeItemCount.current
    parentView.composeblock = {
        for (index in 0 until preComposeItemCount) {
            val key = itemContentFactory.itemProvider().getKey(index)
            val contentItem = itemContentFactory.getContent(index, key)
            subcomposeLayoutState.asyncComposeInit(key, contentItem)
        }
    }
}
```

- 在外层compose执行完后, 预执行list的items的compose

```kotlin
//subcomposeLayoutState
fun asyncComposeInit(slotId: Any?, content: @Composable () -> Unit) {
    precompose(slotId, content)
    asyncComposeRegister.add(slotId)
}

fun precompose(slotId: Any?, content: @Composable () -> Unit): PrecomposedSlotHandle {
    makeSureStateIsConsistent()
    if (!slotIdToNode.containsKey(slotId)) {
        val node = precomposeMap.getOrPut(slotId) {
            val reusedNode = takeNodeFromReusables(slotId)
            if (reusedNode != null) {
                // now move this node to the end where we keep precomposed items
                precomposedCount++
                reusedNode
            } else {
                createNodeAt(root.foldedChildren.size).also {precomposedCount++}
            }
        }
        subcompose(node, slotId, content)
    }
    return object : PrecomposedSlotHandle {」
}  
```

- 第一次measureItems时,执行各个子compostion的applychange

```kotlin
fun subcompose(slotId: Any?, content: @Composable () -> Unit): List<Measurable> {
    applyAsyncAllComposeChange()
    val node = slotIdToNode.getOrPut(slotId) {
        val precomposed = precomposeMap.remove(slotId)
        if (precomposed != null) {
            precomposed
        } else {
            takeNodeFromReusables(slotId) ?: createNodeAt(currentIndex)
        }
    }
    //subcompose(node, slotId, content) //=> subcomposeInto
}

private fun applyAsyncAllComposeChange() {
    asyncComposeRegister.forEach {
        val preComposedNode = precomposeMap[it]
        val nodeState = nodeToNodeState[preComposedNode]
        val cmp = nodeState?.composition
        if ((nodeState?.isAsyncCompose == true) && (cmp != null) && cmp.isAsyncCompose) {
            cmp.applyAsyncComposeChange()
        }
    }
    asyncComposeRegister.clear()
}
```

![](/image/compose/precompose_list.png)

#### 3.4.3 Compose异步化方案

- Compose函数 
- Snapshot
- Slottable

![](/image/compose/precompose_ayync_trace.png)

##### compose函数是否支持并行/异步? (函数式)

- [Composable functions can execute in any order](https://developer.android.com/jetpack/compose/mental-model#any-order)

```kotlin
@Composable
fun ButtonRow() {
    MyFancyNavigation {
        StartScreen()   // compose func 1
        MiddleScreen()  // compose func 2
        EndScreen()     // compose func 3
    }
}
//exectute order 1-2-3 or 1-3-2 or 2-3-1 or 3-2-1
```

- [Composable functions can run in parallel](https://developer.android.com/jetpack/compose/mental-model#parallel)

> Compose can optimize recomposition by running composable functions in parallel. This lets Compose take advantage of multiple cores, and run composable functions not on the screen at a lower priority. This optimization means a composable function might execute within a pool of background threads

##### State/Snapshot是否支持多线程?

Compose 通过名为“快照（Snapshot）”的系统支撑状态管理与重组机制的运行 ,多线程的支持

```kotlin
internal actual class SnapshotThreadLocal<T> {
    private val map = AtomicReference<ThreadMap>(emptyThreadMap)
    private val writeMutex = Any()

    @Suppress("UNCHECKED_CAST")
    actual fun get(): T? = map.get().get(Thread.currentThread().id) as T?

    actual fun set(value: T?) {
        val key = Thread.currentThread().id
        synchronized(writeMutex) {
            val current = map.get()
            if (current.trySet(key, value)) return
            map.set(current.newWith(key, value))
        }
    }
}
```
![](/image/compose/snapshot_concurrent.png)

如果state发生了冲突,提供了merge判断的接口

```kotlin
class Dog {
  var name: MutableState<String> =
    mutableStateOf("", policy = object : SnapshotMutationPolicy<String> {
      override fun equivalent(a: String, b: String): Boolean = a == b

      override fun merge(previous: String, current: String, applied: String): String =
        "$applied, briefly known as $current, originally known as $previous"
    })
}
```

也就是说, snapshot的设计已经支持了多线程的创建、运行、合并.

##### SlotTable怎么处理

Slottable 只允许存在2种状态
- 同时多个reader 
- 有且只有一个writer

```kotlin
fun openReader(): SlotReader {
    if (writer) error("Cannot read while a writer is pending")
}
fun openWriter(): SlotWriter {
    runtimeCheck(!writer) { "Cannot start a writer when another writer is pending" }
    runtimeCheck(readers <= 0) { "Cannot start a writer when a reader is pending" }
}
```

异步的时候,只要保证不要同时触发这两天规则即可

- change会记录在composition的list上

```kotlin
private suspend fun recompositionRunner(block ){
    Snapshot.registerApplyObserver { changed, _ ->
        if (_state.value >= State.Idle) {
            snapshotInvalidations += changed
            deriveStateLocked(). //释放协程锁, 触发applychange
        } else null
    }?.resume(Unit)
}

private fun deriveStateLocked(): CancellableContinuation<Unit>? {
    return if (newState == State.PendingWork) {...}
}
```

所以, 整体上把拆出来的composeInit部分异步化,架构上是ok的

```kotlin
suspend fun preComposeForViewAsync(key: String,appContext: Context,composeContext: CoroutineContext
) {
    val v = MyComposeView2(appContext)
    v.initPreComposeOnUiThread()
    
    //开一个协程,运行在外部传过来的Dispatchers上 ,比如Dispatchers.IO
    val composeCoroutineScope = CoroutineScope(composeContext)
    composeCoroutineScope.launch(composeContext) {
        v.callComposeContent() //composeInit
    }
    composeCoroutineScope.coroutineContext.job.cancelAndJoin()
    Log.e("PreComposer", "preComposeForView: for view:$v")
    map[key] = v
}
```

## 4. Recompose 重组

如果发生了state的变更, 会发生什么

```kotlin
@Composable.                                       
fun TestContent() {
    Button(onClick = {  
        count++  //响应event ,通知GlobalSnapshotWriteObserver
    }) 
    count++     // 通知MutableSnapshotWriteObserver
}
```

### 4.1 常规流程

```kotlin
class AndroidComposeView(context: Context) :ViewGroup(context){
    private fun handleMotionEvent(motionEvent: MotionEvent): ProcessResult {
        pointerInputEventProcessor.process(pointerInputEvent,this,true)
    }
}
```
event中 state更改触发后，会通知SnapshotWriteObserver , Onclick 触发的是GlobalSnapshotWriteObserver

![](/image/compose/SnapshotObserver.png)

```kotlin
private suspend fun recompositionRunner(block ){
    Snapshot.registerApplyObserver { changed, _ ->
        snapshotInvalidations += changed
        //release lock
        deriveStateLocked()  //applychange之后, 释放
    }?.resume(Unit)
}

private fun deriveStateLocked(): CancellableContinuation<Unit>? {
    return if (newState == State.PendingWork) {...}
}

 suspend fun runRecomposeAndApplyChanges() = recompositionRunner { parentFrameClock ->
    while (shouldKeepRecomposing) {
        //wait lock  : recompose || applychage job  
        awaitWorkAvailable()
        recordComposerModificationsLocked()
        
        parentFrameClock.withFrameNanos { frameTime ->
            //collect recompose job
            compositionInvalidations.fastForEach { toRecompose += it }
            
           while (toRecompose.isNotEmpty() || toInsert.isNotEmpty()) {
               //excute recompose job
               performRecompose(composition, modifiedValues)?.let {
                   //collect apply job
                    toApply += it
               }
           }
           
           //excute apply job
           toApply.fastForEach { composition ->
               composition.applyChanges()
           }
        }
      }     
}
```

1. event的改动触发了state的修改
2. state的修改触发了snapshot上注册的writeobserver回掉, 由于是在onclick中触发的state改动, 所以对应的是globalsnapshot的writeobserver
3. writeobserver记录了更改的change, 并且尝试释放协程锁
4. runRecomposeAndApplyChanges函数获得锁, 执行下一步
  1. 找出change state对应的composition, 标记Invalidate
  2. 进入frameloop中, 遍历InvalidateComposition, 执行recompose和applychange

### 4.2 PreCompose流程

因为PreCompose将`composeinit`流程分割成2部分分别执行, 如果2部分中间发生了statechagne, 如何处理?
执行顺序可能变成 
1. 1-2-3-4-5 (state正常时许)
2. 1-3-2-4-5 (state出现在composeinit 和apply之间)

![](/image/compose/precompose_recompose_ppl.png)

第二种不会导致异常,两种情况在第2步渲染的结果(初始化首屏)和第5步(recompose)的ui结果一致.
有2个机制保障
- 锁释放时机

```kotlin

private fun deriveStateLocked(): CancellableContinuation<Unit>? {
    //balabala 
    return if (newState == State.PendingWork) {
        workContinuation
    } else null
}
```

- state改动记录机制
  - State 的更改直接合并到globalSnapshot
  - recordComposerModificationsLocked函数会将改动的state记录到对应的comositon上

```kotlin
private fun recordComposerModificationsLocked() {
    if (snapshotInvalidations.isNotEmpty()) {
        snapshotInvalidations.fastForEach { changes ->
            knownCompositions.fastForEach { composition ->
                composition.recordModificationsOf(changes)
            }
        }
    }
}
  ```

- 所以, 如果在compose和applychange中间发生状态改变, 只会发生一个state change的记录操作,不回有重复触发compose或者其他操作, 基本没影响

![](/image/compose/precompose_consume_change.png)

在调用applychange后, 检查到state发生了change,会触发recompose. 每个状态有去重操作,只recompose最后一次的改变

```kotlin
override fun recompose(): Boolean = synchronized(lock) {
    drainPendingModificationsForCompositionLocked()
    guardChanges {
        guardInvalidationsLocked { invalidations ->
            composer.recompose(invalidations).also { shouldDrain ->
                // Apply would normally do this for us; do it now if apply shouldn't happen.
                if (!shouldDrain) drainPendingModificationsLocked()
            }
        }
    }
}

//drainPendingModificationsForCompositionLocked
private fun addPendingInvalidationsLocked(values: Set<Any>) {

    fun invalidate(value: Any) {
       !observationsProcessed.remove(value, scope)            
    }
    
    for (value in values) {
        invalidate(value)
    }
}       
```

### 4.3 我们能做什么 ： 并行ReCompose && scope提示

- 并行recompose

```kotlin
//sync
suspend fun runRecomposeAndApplyChanges(){
    //run compose && applychange sync (ui thread)
    val changedComposition = performRecompose(composition, null)
    changedComposition.applyChange()
       
}

//Concurrently
@ExperimentalComposeApi
suspend fun runRecomposeConcurrentlyAndApplyChanges() {
    recomposeCoroutineScope.launch() {
        //run composeConcurrently
        val changedComposition = performRecompose(composition, null)
        changedComposition?.let { compositionsAwaitingApply += it }
        frameSignal.requestFrameLocked()
    }
}

private suspend fun runFrameLoop(){
   frameSignal.awaitFrameRequest(stateLock)
   while(true){
       parentFrameClock.withFrameNanos { frameTime ->
           changedComposition.applyChange()
       }
   }
}
```

- 12行开启一个协程, 运行compose函数 (任意线程)
- 18行发送requestFrameLocked, 唤醒协程runFrameLoop,执行applychagne (ui线程)

![](/image/compose/recompose_paralel.png)

- Recompose scope tools

## 5. 渲染阶段measure layout  draw

```kotlin
class AndroidComposeView(context: Context) :ViewGroup(context){
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        measureAndLayoutDelegate.updateRootConstraints(constraints)
        measureAndLayoutDelegate.measureOnly()
    }
    
    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        measureAndLayoutDelegate.measureAndLayout(resendMotionEventOnLayout)
    }
    
    override fun dispatchDraw(canvas: android.graphics.Canvas) {
        measureAndLayout()
        if (dirtyLayers.isNotEmpty()) {
            for (i in 0 until dirtyLayers.size) {
            val layer = dirtyLayers[i]    //RenderNodeLayer
            layer.updateDisplayList()     //DisplayList
        }
        
        val saveCount = canvas.save()
        canvas.clipRect(0f, 0f, 0f, 0f)
        super.dispatchDraw(canvas)
        canvas.restoreToCount(saveCount)
    }
}
```

### 5.1 我们能做什么 （渲染优化、自渲染）

- 渲染层优化
  - RenderNodeLayer
  - Layout
  - Displaylist
  - 多线程measure、layout
- 跨端渲染探索

![](/image/compose/compose_cross_platform.png)

# 未来可以做的

- runtime
  - 并行化
  - Appchange 
- render层
  - layout + measure 提前
  - Render layer 分层
  - 跨平台渲染切入
- 编译器
  - 包体积
  - 代码插入（覆盖率？特殊逻辑）
  - 不同平台编译
- 工具链&&编译器
  - 编译器静态分析提示
  - devtools 
- 上层
  - 相关组件、监控

# 附录

- [一文看懂 Jetpack Compose 快照系统 - 掘金](https://juejin.cn/post/7095544677515919367#heading-15)
- [Compose 为什么可以跨平台？](https://mdnice.com/writing/3dd7b593f86242b0a8cf254f9fff37ba)
