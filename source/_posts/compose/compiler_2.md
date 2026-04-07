---
title: Compose Compiler(1) Compose plugin
categories: [Compose, Compiler]
date: 2022-12-30
---

# 概览 

- 前端检查
- ir生成
- recompose判断

 <!-- more -->

常见注解
  - @Composable
  - @ComposeCompilerApi
  - @InternalComposeApi
  - @DisallowComposableCalls
  - @ReadOnlyComposable
  - @NonRestartableComposable
  - @StableMarker
  - @Immutable
  - @Stable

# 1. Frontend checker
- ComposableCallChecker : 检查是否可以调用 @Composable 函数
- ComposableDeclarationChecker : 检查 @Composable 的位置是否正确
- ComposableTargetChecker
- ComposeDiagnosticSuppressor : 屏蔽不必要的编译诊断错误

# 2. IRCodeLower
Lowering 是编译原理中的概念，在编译过程的每一步，使用不同的 Lower 来来逐步删除高级特征，并生成更低级别特征的 IR。这样做足够多次，最终你会得到一个足够简单的IR，可以编译到汇编级

![](/image/compose_compiler//compiler_lower.svg)

[ComposeIrGenerationExtension.kt](https://cs.android.com/androidx/platform/frameworks/support/+/androidx-main:compose/compiler/compiler-hosted/src/main/java/androidx/compose/compiler/plugins/kotlin/ComposeIrGenerationExtension.kt)

```kotlin
class ComposeIrGenerationExtension(...) : IrGenerationExtension {

    override fun generate(moduleFragment: IrModuleFragment,pluginContext: IrPluginContext) {
      
        ClassStabilityTransformer(pluginContext,//..)
            .lower(moduleFragment)

        LiveLiteralTransformer( pluginContext, //..)
            .lower(moduleFragment)

        ComposableFunInterfaceLowering(pluginContext)
            .lower(moduleFragment)

        // Memoize normal lambdas and wrap composable lambdas
        ComposerLambdaMemoization( pluginContext, //..)
            .lower(moduleFragment)

        CopyDefaultValuesFromExpectLowering()
            .lower(moduleFragment)

        if (decoysEnabled) { }

        // transform all composable functions to have an extra synthetic composer
        // parameter. this will also transform all types and calls to include the extra
        // parameter.
        ComposerParamTransformer(pluginContext, //..)
            .lower(moduleFragment)

        ComposableTargetAnnotationsTransformer(pluginContext,//..)
            .lower(moduleFragment)

        // transform calls to the currentComposer to just use the local parameter from the
        // previous transform
        ComposerIntrinsicTransformer(pluginContext, decoysEnabled)
            .lower(moduleFragment)

        ComposableFunctionBodyTransformer(pluginContext,//..)
            .lower(moduleFragment)

        if (decoysEnabled) { }
        if (isKlibTarget) { }
        if (pluginContext.platform.isJs()) {}   
    }
}
```

[各种lower代码地址](https://cs.android.com/androidx/platform/frameworks/support/+/androidx-main:compose/compiler/compiler-hosted/src/main/java/androidx/compose/compiler/plugins/kotlin/lower/)

### 2.1 ClassStabilityTransformer 

判断类型稳定性, 为 Class 添加@StabilityInferred 注解, 并为 Class 生成 $stable 静态变量，服务于 Stability.Runtime 的代码生成。(用于后续compose判断重组代码生成)

### 2.2 LiveLiteralTransformer 
将常量文字表达式转换为读取 MutableState 实例的表达式，以便无需重新编译即可将对常量文字源代码的更改传达给运行时。 这种转变旨在改善开发人员体验，永远不应在发布版本中启用，因为它会显着放慢对性能敏感的代码

在gradle的[ComposeOption中](https://developer.android.com/reference/tools/gradle-api/8.0/com/android/build/api/dsl/ComposeOptions) 使用useLiveLiterals开启/关闭

```gradle
//file: Foo.kt origin 
fun Foo() {
    print("Hello World")
}
//file: Foo.kt into 
fun Foo() {
    print(LiveLiterals$FooKt.getString$arg-0$call-print$fun-Foo())
}
 
object LiveLiterals$FooKt {
    var String$arg-0$call-print$fun-Foo: String = "Hello World"
    var State$String$arg-0$call-print$fun-Foo: MutableState<String>? = null
    
    fun getString$arg-0$call-print$fun-Foo(): String {
        val field = this.String$arg-0$call-print$fun-Foo
        val state = if (field == null) {
            val tmp = liveLiteral(
                "String$arg-0$call-print$fun-Foo",
                this.String$arg-0$call-print$fun-Foo
            )
            this.String$arg-0$call-print$fun-Foo = tmp
            tmp
         } else field
      return field.value
    }
}
```

### 2.3 ComposableFunInterfaceLowering
### 2.4 ComposerLambdaMemoization
### 2.5 CopyDefaultValuesFromExpectLowering
### 2.6 ComposerParamTransformer

为`@Composable` 函数增加 $compsoer 等参数

```kotlin
@Composable
fun Counter() {
    //..
}

//转换成
@Composable
fun Counter($composer:Composer, $changed: Int) { 
    //...
}
```

源码部分

```
// 1.添加$composer参数
val composerParam = fn.addValueParameter {
                name = KtxNameConventions.COMPOSER_PARAMETER
                type = composerType.makeNullable()
                origin = IrDeclarationOrigin.DEFINED
                isAssignable = true
}

// 2.添加$changed[n]参数
val changed = KtxNameConventions.CHANGED_PARAMETER.identifier
for (i in 0 until changedParamCount(realParams, fn.thisParamCount)) {
    fn.addValueParameter(
        if (i == 0) changed else "$changed$i",
        context.irBuiltIns.intType
     )
}

// 3.添加$default[n]参数
if (oldFn.requiresDefaultParameter()) {
    val defaults = KtxNameConventions.DEFAULT_PARAMETER.identifier
    for (i in 0 until defaultParamCount(currentParams)) {
        fn.addValueParameter(
            if (i == 0) defaults else "$defaults$i",
            context.irBuiltIns.intType,
            IrDeclarationOrigin.MASK_FOR_DEFAULT_FUNCTION
        )
    }
}

```

### 2.7 ComposableTargetAnnotationsTransformer
### 2.8 ComposerIntrinsicTransformer
### 2.9 ComposableFunctionBodyTransformer

非常复杂的一个trasnfromer, Composable 函数体内生成 startXXXGroup/endXXXGroup/recompose 等相关代码

![](/image/compose_compiler//compose_compiler.png)

``` kotlin
/**
 * This IR Transform is responsible for the main transformations of the body of a composable
 * function.
 *
 * 1. Control-Flow Group Generation
 * 2. Default arguments
 * 3. Composable Function Skipping
 * 4. Comparison Propagation
 * 5. Recomposability
 * 6. Source location information (when enabled)
 *

```