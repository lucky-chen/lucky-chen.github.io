---
title: Compose Compiler(1) kotlin编译架构&&KCP
categories: [Compose, Compiler]
date: 2022-12-25
---


# 概览
Compose compiler是compose框架的一部分, 本质是一个kcp(kotlin compiler plugin),用于支持编译期针对compose特性进行静态检查和代码生成.

![](/image/compose_compiler//compose_layer.PNG)

 在进入compose的编译之前, 需要事先对kotlin的编译架构、过程以及概念做一些探究储备

 <!-- more -->

# kotlin编译过程简介

[The Road to the K2 Compiler | The Kotlin Blog](https://blog.jetbrains.com/kotlin/2021/10/the-road-to-the-k2-compiler/)

- Frontend（编译器前端）：对源代码分析得到 AST （抽象语法树）以及符号表，并完成静态检查
- Backend（编译器后端）：基于 AST/IR等前端产物，生成平台目标代码
kotlin的编译有 k1和k2两个版本, 目前最新版都已切换成k2架构.

![](/image/compose_compiler//kotlin_k2_compiler.PNG)
下面我们了解一下k1和k2 

## k1编译器

![](/image/compose_compiler//kotlin_k1_compiler.svg)

### Frontend

```kotlin
interface Cat { 
    fun void meow()
}
class Pet:Cat {
    override fun void meow(){}
}

void fun main() {
    if (pet is Cat) {
        pet.meow()
    }else {
        print("*")
    }
}
```

通过parser和语义分析, 生成语法树PSI(Program Structure Interface) 语义信息(BindingContext)
- PSI存储对应的语法结构信息 (一颗tree,包含字符串以及调用结构顺序)
- BindingContext存储对应的语义信息 ( 这是一个什么类的什么变量、这是一个函数调用)

![](/image/compose_compiler//kotlin_k1_frond.PNG)

### Bacend


- js、jvm后端直接使用生成的语法树和语义信息, 编译对应的后端产物
- native后端开始, kotlin团队决定引入中间表示: IR 产物, 通过 IR再生成对应的汇编机器码

![](/image/compose_compiler//kotlin_compiler_k1_backend.PNG)

## k2编译器

![](/image/compose_compiler//kotlin_compiler_k2.svg)

K2编译器主要的特性有2点
- 引入了中间ir表示:  前端FIR + 中间产物IR
- 引入插件机制: 允许开发者通过注册插件,在前端编译过程 和 后端过程操作IR进行code的生成和变化. 

> Compose 编译器只能工作在k2编译架构上, 因为compose的compiler实际上是一个KCP(kotlin compile pugin)

### Frontend

FIR  =  BindingContxt + PSI  合并.
- 提升前端静态分析&&检查的性能 (比如频繁修改局部代码, 基于FIR做了大量性能优化)
 ide的kotlin插件复用了kotlin编译器的前端编译部分
- 做一些简单的脱糖&&代码生成工作 (K1做不了, 因为k2支持对FIR树结构进行编辑和变化)

![](/image/compose_compiler//kotlin_compiler_k2_frond.png)

### Bacend

统一使用中间IR作为输入, 然后进行优化, 最后调用对应平台后端来生成平台目标代码

![](/image/compose_compiler//kotlin_compiler_k2_bacend.png)

# KCP简介 (kotlin compiler plugin)

## Kcp 结构开发流程

![](/image/compose_compiler//kcp.png)

Gradle Plugin：
- Plugin：KCP 是通过 Gradle 配置的，需要定义一个 Gradle 插件，并在 Gradle 中配置 KCP 所需的编译参数。
- Subplugin： 建立从 Gradle Plugin 到 Kotlin Plugin 的连接，并将 Gradle 中配置的参数传递给 Kotlin Plugin
Kotlin Plugin：
- CommandLineProcessor：KCP 的入口，定义 KCP 的 id、解析命令行参数等
- ComponentRegister：注册 KCP 中的 Extension 扩展点。它与 CommandLineProcessor 一样都是通过 SPI 调用，需要添加 auto-service 注解
- XXExtension：这是实现 KCP 逻辑的地方。Kotlin 提供了许多类型的 Extension 供我们实现。编译器会在前端、后端的各个编译环节中调用 KCP 注册的对应类型的 Extension。例如 ExpressionCodegenExtension 可用来修改 Class 的 Body；ClassBuilderInterceptorExtension 可以修改 Class 的 Definition 等等

## 举个例子


针对kotlin的数据类
data class People(var name:String,var age:Int,var sex:Int)
对于data类型, kotlin编译器会默认生成
- 带参数的构造函数
- 参数的get/set

```kotlin
public final class People {
    private String name;
    private int age;
    private int sex;
    final String getName() { return this.name; }
    public final void setName(String var1) {}
    //有参构造函数
    public People(String name, int age, int sex) { 
        super(); 
        this.name = name; 
        this.age = age; 
        this.sex = sex; }     
    }
}
```
使用时只能传参：
People people=new People("lei",23,1);
但是在一些框架中(Kotlin+Spring Boot), 需要反射无参构造函数, 来初始化数据类, 但是data类型的默认生成有参构造, 无法完成这个功能. kotlin官方提供一个NoArg插件 解决这个问题

```kotlin
@NoArg
data class People(var name:String,var age:Int,var sex:Int)


//生成的代码
public class People {
    //NoArg 生成的无参构造函数
    public People(){}
    //默认生成
    public People(@NotNull String name, int age, int sex)
    //get/set 
    //...
}
```


- [FirNoArgDeclarationChecker](https://cs.android.com/android-studio/kotlin/+/master:plugins/noarg/noarg.k2/src/org/jetbrains/kotlin/noarg/fir/FirNoArgDeclarationChecker.kt)：新的 K2 前端，可基于 FIR 检查 InnerClass

```kotlin
object FirNoArgDeclarationChecker : FirRegularClassChecker() {
    override fun check(declaration: FirRegularClass, context: CheckerContext, reporter: DiagnosticReporter) {
        val source = declaration.source ?: return
        if (declaration.classKind != ClassKind.CLASS) return
        val matcher = context.session.noArgPredicateMatcher
        if (!matcher.isAnnotated(declaration.symbol)) return

        when {
            declaration.isInner -> reporter.reportOn(source, KtErrorsNoArg.NOARG_ON_INNER_CLASS_ERROR, context)
            declaration.isLocal -> reporter.reportOn(source, KtErrorsNoArg.NOARG_ON_LOCAL_CLASS_ERROR, context)
        }

        val superClassSymbol = declaration.symbol.getSuperClassSymbolOrAny(context.session)
        if (superClassSymbol.declarationSymbols.filterIsInstance<FirConstructorSymbol>().none { it.isNoArgConstructor() } && !matcher.isAnnotated(superClassSymbol)) {
            reporter.reportOn(source, KtErrorsNoArg.NO_NOARG_CONSTRUCTOR_IN_SUPERCLASS, context)
        }

    }

    private fun FirRegularClassSymbol.getSuperClassSymbolOrAny(session: FirSession): FirRegularClassSymbol {
        for (superType in resolvedSuperTypes) {
            val symbol = superType.fullyExpandedType(session).toRegularClassSymbol(session) ?: continue
            if (symbol.classKind == ClassKind.CLASS) return symbol
        }
        return session.builtinTypes.anyType.type.toRegularClassSymbol(session) ?: error("Symbol for Any not found")
    }

    private fun FirConstructorSymbol.isNoArgConstructor(): Boolean {
        return valueParameterSymbols.all { it.hasDefaultValue }
    }
}
```

- [NoArgIrGenerationExtension](https://cs.android.com/android-studio/kotlin/+/master:plugins/noarg/noarg.backend/src/org/jetbrains/kotlin/noarg/NoArgIrGenerationExtension.kt)：继承自 IrGenerationExtension ，基于 IR 添加无参构造函数

```kotlin
class NoArgIrGenerationExtension(...) : IrGenerationExtension {
    override fun generate(moduleFragment: IrModuleFragment, pluginContext: IrPluginContext) {
        moduleFragment.accept(NoArgIrTransformer(pluginContext, annotations, invokeInitializers), null)
    }
}

private class NoArgIrTransformer(
    private val context: IrPluginContext,
    private val annotations: List<String>,
    private val invokeInitializers: Boolean,) : AnnotationBasedExtension, IrElementVisitorVoid {
    
    //使用IR的API生成无参构造函数
    private fun getOrGenerateNoArgConstructor(klass: IrClass): IrConstructor = noArgConstructors.getOrPut(klass) {
        //1. 创建一个构造函数
        context.irFactory.buildConstructor {
            startOffset = SYNTHETIC_OFFSET
            endOffset = SYNTHETIC_OFFSET
            returnType = klass.defaultType
        }.also { ctor ->
            ctor.parent = klass
            ctor.body = context.irFactory.createBlockBody(
                ctor.startOffset, ctor.endOffset,
                listOfNotNull(
                    IrDelegatingConstructorCallImpl(
                        ctor.startOffset, ctor.endOffset, context.irBuiltIns.unitType,
                        superConstructor.symbol, 0, superConstructor.valueParameters.size
                    ),
                    IrInstanceInitializerCallImpl(
                        ctor.startOffset, ctor.endOffset, klass.symbol, context.irBuiltIns.unitType
                    ).takeIf { invokeInitializers }
                )
            )
        }
    }
}
```

## Compose compiler


Compose Compiler 是一个 KCP, 核心在于其实现逻辑的Extension . 入口在ComposePlugin.kt

```kotlin
class ComposeComponentRegistrar : ComponentRegistrar {
    override fun registerProjectComponents(...) {
        registerCommonExtensions(project)
        registerIrExtension(project, configuration)
    }
    //frontend 部分
    fun registerCommonExtensions(project: Project) {
        StorageComponentContainerContributor.registerExtension(
            project,
            ComposableCallChecker()
        )
        StorageComponentContainerContributor.registerExtension(
            project,
            ComposableDeclarationChecker()
        )
        StorageComponentContainerContributor.registerExtension(
            project,
            ComposableTargetChecker()
        )
        //用于抑制语法错误
        ComposeDiagnosticSuppressor.registerExtension(
            project,
            ComposeDiagnosticSuppressor()
        )
    }

    //bacend 操作IR部分
    fun registerIrExtension(
        project: Project,
        configuration: CompilerConfiguration
    ) {
        IrGenerationExtension.registerExtension(
            project,
            ComposeIrGenerationExtension(
                liveLiteralsEnabled = liveLiteralsEnabled,
                liveLiteralsV2Enabled = liveLiteralsV2Enabled,
                generateFunctionKeyMetaClasses = generateFunctionKeyMetaClasses,
                sourceInformationEnabled = sourceInformationEnabled,
                intrinsicRememberEnabled = intrinsicRememberEnabled,
                decoysEnabled = decoysEnabled,
                metricsDestination = metricsDestination,
                reportsDestination = reportsDestination,
                validateIr = validateIr,
            )
        )
    }
}
```

# 附录
- [The Road to the K2 Compiler | The Kotlin Blog](https://blog.jetbrains.com/kotlin/2021/10/the-road-to-the-k2-compiler/)
- [Writing Your First Kotlin Compiler Plugin](https://resources.jetbrains.com/storage/products/kotlinconf2018/slides/5_Writing%20Your%20First%20Kotlin%20Compiler%20Plugin.pdf)
- [深入浅出 Compose Compiler(1) Kotlin Compiler & KCP - 掘金](https://juejin.cn/post/7153076275207208991)