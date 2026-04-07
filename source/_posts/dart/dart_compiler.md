---
title: Dart编译器概述
categories: [Dart, VM, Compiler]
date: 2023-6-12
---

# 概览

- 了解编译原理,对现代编译器compiler设计有所了解
- 介绍dart编译器设计, 工程实践上如何设计和实现
- 了解dart编译器核心代码流转: 核心代码、主要优化

<!--more-->

# Dart编译器架构设计

现代编译器基本分成两个部分
- ```Frontend```（编译器前端）：对源代码分析得到```AST```(抽象语法树)以及符号表，并完成静态检查
- ```Backend```（编译器后端）：基于 AST/IR等前端产物，生成平台目标代码

## 编译架构
在dart中,这两部分具体工作:
1. ```cfe前端编译```: dart代码输入, 通过词法、语法分析,构建一颗ast(compoent)树,在经过一系列的优化(```treeshake```、```tfa```、```Desugaring```),将优化后的ast树二进制写入到```dill```文件中
2. ```后端编译链路```: dill作为输入,重建ast树,再将ast树转化为中间```FlowGraph```, 经过```FlowGraph```中一系列的平台无关优化,根据编译目标生成JIT或者机器码

![](/image/dart/dart_compiler_guide.png)

## 编译模式:
- __JIT 模式__：```!defined(DART_PRECOMPILED_RUNTIME)```
- __AOT 模式__：```defined(DART_PRECOMPILED_RUNTIME)```
- __模拟器模式__:  ```USING_SIMULATOR```, Dart 虚拟机将以 CPU 模拟器的方式工作，逐条执行 JIT 编译出来的机器指令。

## 编译产物

- __snapshot__: 适用 Dart 编译器和 Flutter Tools （JIT 或 Kernel）
- __elf__: 适用 Android AOT
- __assembly__: 适用 iOS AOT

# 前端编译链路CFE


![](/image/dart/dart_compiler_guide_cfe.jpg)

简化流程代码
```dart
 //pkg/frontend_server/lib/frontend_server.dart
 Future<bool> compile(){
  //1.kernelForProgram(source) 源码编译为ast树
  //语法、词法分析、构建astoutinle
  summaryComponent = await kernelTarget.buildOutlines(...);
  //构建完整ast树
  component = await kernelTarget.buildComponent(...);

  //2.运行优化transformer: 语法糖去糖、tfa、treeshaking
  res = await runGlobalTransformations(component)
  
  //3. 序列化为二进制
  await writeDillFile(res)
 }
```

1. 根据输入文件,进行词法、语法分析
2. 构建ast树: 第一次构建ast主题元素, 第二次构建完整ast
3. 运行各种优化:语法糖脱糖(eg async) 、 CFE 阶段最重要的2个优化 Tree-shaking和tfa
4. 将优化后的ast树二进制写入dill文件中

## 词法分析

```dart
int Add(int a, int b) {
  return a+b; 
}
```
分词产生token, 源码位置```pkg/_fe_analyzer_shared/lib/src/scanner```
```dart
int       offset:0, false
Add       offset:4, false
(         offset:7, false
int       offset:8, false
a         offset:12, false
,         offset:13, false
int       offset:15, false
b         offset:19, false
)         offset:20, false
{         offset:22, false
return    offset:24, true
a         offset:31, false
+         offset:32, false
b         offset:33, false
;         offset:34, false
}  
``` 

## 语法分析

语法分析结果输出. 源码```pkg/_fe_analyzer_shared/lib/src/parser```

```dart
Procedures: [Add, main]
main = test::main;
library from "file:///.../test.dart" as test {

  static method Add(core::int a, core::int b) → core::int {
    return a.{core::num::+}(b){(core::num) → core::int};
  }
}
```

## AST树构建

1. 构建ast outine, 构建顶层元素: lib、class、filed、 函数体(procedure)节点本身(函数内容不处理)
2. 完整ast构建: 处理函数体procedure内容, 即函数内部逻辑的ast
ast树的结构如下

![](/image/dart/dart_compiler_ast_tree.jpg)

## 前端编译优化

在```pkg/kernel/lib/transformations/```下有各种优化,```runCompiler ```函数传入 ```--aot``` 选项开启这些优化。
- ```Desugaring```语法脱糖: 比如将 async/await转换成基于 Future 实现
- ```Tree-shaking``` : 从 kernel 产物中摘除未使用的 procedures、fields、classes，
- ```TFA优化```: 全局分析类型流，并进行一些优化工作（比如简化参数传递)

## AST序列化为dill

函数入口
```dart
// import 'package:front_end/src/fasta/kernel/utils.dart'
List<int> serializeComponent(Component c) {
  ByteSink byteSink = new ByteSink();
  BinaryPrinter printer = new BinaryPrinter(byteSink);
  printer.writeComponentFile(c);
  return byteSink.builder.takeBytes();
}
```

dill文件格式如下

![](/image/dart/dart_compiler_dill.jpg)

- ```Headerinfo``` : 包含一些版本信息、hash、tag
- ```Metadata```: 大部分是基于TFA(type flow analysis)分析后产生
  - ```vm.call-site-attributes.metadata```: 一般用于接口型对象进行调用的时候注明实际调用对象的类型
  - ```vm.direct-call.metadata``` : 就是通过分析可以确认不存在虚函数调用的情况可以直接转为基于特定类型的调用
  - ```vm.table-selector.metadata```: 用于生成dispatch table, 每个selector自身的index对应selector编号 (虚函数调用)
  - ```vm.loading-units.metadata``` 用于注明加载单元的信息. id和lib uri
- ```Uri-source```: 记录到源码的映射 (行号、offset)
- ```Constant table``` + ````Constant table index```
  -  常量表: 基本组成格式是 "ConstantTag"+"Constant value" 
  - 常量表索引: 对应于常量表每个条目在文件中的位置。
- ```LinkTable```
- ```StringTable```:字符串常量表
- ```ComponentIndex```: 记录上述section的index和全局信息 

# 后端编译链路 GenSnapshot

![](/image/dart/dart_compiler_guide_cbe.jpg)

入口```gen_snapshot```

1. 加载kernel序列化ast: 处理元数据部分:包含所有 Class 和顶层 Procedure(即function),,内部ast不处理,设置为lazycompile, 用offset记录
2. 编译函数体,转化成中间指令表示IL : 从main函数(LazyCompile)开始, 编译直接/间接被 main 函数调用的其他函数,,得到```FlowGraph```,即```IL```中间指令
3. 平台无关指令优化 : 调用 ```CompilerPass::RunPipeline``` 执行一系列平台无关的优化，以求最终生成性能和体积俱佳的机器指令
4. 指令编译为机器码 : 将IL指令编译为具体平台的汇编(x86、x64、arm)
5. 将机器码序列化到文件中:  elf、snanshot、assembly

## kernel加载过程

Program 类封装 kernel，再经由```KernelLoader```工具类LoadLibrary 方法还原成 Library 对象（包含所有 Class 和顶层 Procedure）

![](/image/dart/dart_compiler_kernel_load.jpg)

加载完成后,生成ast树, 之后编译器会将ast转化为IL表示
> IL定位是编译器通用设计中中间指令IR的概念,  类似于llvm或者kotlin compiler中的IR.

## IL介绍

compiler pipeline 首先通过 FlowGraphBuilder 把```kernel```转换成 ```FlowGraph```. 即IL. ```IL```本质上是一种线性结构，它由一系列基本的指令(Instruction)组成，表示一个函数的运行过程. 一个或多个指令按顺序排列在一起，构成一个块(Block)。块的最后一条指令可能是一个跳转指令（包括条件跳转和无条件跳转），指向其他块；或者是一条Return指令，表示退出函数。

![](/image/dart/dart_compiler_il.jpg)

Instruction指的是非BlockEntryInstr的子类, BlockEntryInstr分为好几种类型:(这一套机制主要作用是用来做流分析和优化工作的，做一些限制可以简化分析过程)
- GraphEntryInstr:  任何一个函数的起始都是一个GraphEntryInstr,不包括任何实际机器码.拥有一到三个后继，每一个后继都是函数的一个入口点，包括：
  - normal entry：函数正常入口点，这个入口点是每个函数都具备的。
  - unchecked entry: 未检查入口点，从这个入口点进入，会首先执行检查参数类型代码，然后再执行函数体，这个入口点是可选的。
  - osr entry: OSR=on stack replacement 入口点是可选的。
- FunctionEntryInstr: 函数入口点,normal entry和unchecked entry都是这个类型
- OsrEntryInstr osr entry:   osr entry入口点是这个类型
- JoinEntryInstr: 无条件跳转指令目标块,多个不同块的无条件跳转指令跳转到同一个JoinEntryInstr是允许的。(类似goto的label)
- TargetEntryInstr:  条件跳转指令的目标块 (类似if else)
- CatchBlockEntryInstr:  catch语句块

## IL优化

编译器得到 FlowGraph 后，调用 CompilerPass::RunPipeline 执行一系列平台无关的优化，以求最终生成性能和体积俱佳的机器指令

```c++
// compiler_pass.cc
FlowGraph* CompilerPass::RunPipeline(PipelineMode mode, CompilerPassState* pass_state) {
  INVOKE_PASS(Inlining);
  INVOKE_PASS(BranchSimplify);
  INVOKE_PASS(IfConvert);
  //...
  // Repeat branches optimization after DCE, as it could make more
  // empty blocks.
  INVOKE_PASS(OptimizeBranches);
  INVOKE_PASS(DCE);
  return pass_state->flow_graph();
}
```

- [ConstantPropagation](https://en.wikipedia.org/wiki/Constant_folding) 常量传播与折叠优化
- [Inlining](https://en.wikipedia.org/wiki/Inline_expansion)（函数内联优化）
- CallSpecializer (函数调用特化）

### ConstantPropagation（常量传播与折叠优化）

demo
```dart
ConstProp() {
  int x = 14;
  var y = 7 - x / 2;
  return y * (28 / x + 2);     // return 0;
}
```
未优化 IR：
```shell
% dart --print_flow_graph abc.dart
...
*** BEGIN CFG
Unoptimized Compilation
==== file:///.../abc.dart_::_ConstProp (RegularFunction)
B0[graph]:0
B1[function entry]:2
    CheckStackOverflow:8(stack=0, loop=0)
    DebugStepCheck:10()
    DebugStepCheck:12()
    t0 <- Constant(#14)
    StoreLocal(x @-1, t0)
    t0 <- Constant(#7)
    t1 <- LoadLocal(x @-1)
    t2 <- Constant(#2)
    t1 <- InstanceCall:14( /<0>, t1, t2)
    t0 <- InstanceCall:16( -<0>, t0, t1)
    StoreLocal(y @-2, t0)
    t0 <- LoadLocal(y @-2)
    t1 <- Constant(#28)
    t2 <- LoadLocal(x @-1)
    t1 <- InstanceCall:18( /<0>, t1, t2)
    t2 <- Constant(#2)
    t1 <- InstanceCall:20( +<0>, t1, t2)
    t0 <- InstanceCall:22( *<0>, t0, t1)
    DebugStepCheck:24()
    Return:26(t0)
*** END CFG
```
优化ir
```shell
% dart --print_flow_graph_optimized --print-flow-graph-filter=ConstProp --optimization_counter_threshold=1 --no-background-compilation abc.dart
...
*** BEGIN CFG
After AllocateRegisters
==== file:///.../abc.dart_::_ConstProp (RegularFunction)
  0: B0[graph]:0 {
      v44 <- Constant(#0.0) T{_Double}
}
  2: B1[function entry]:2
  3:     ParallelMove rax <- C
  4:     Return:26(v44)
*** END CFG
```
### Inlining（函数内联优化）

```dart
int Add(int a, int b) {
  return a + b;
}
void main() {
  print(Add(100, 200));   // print(300)
}
```

未优化ir
```shell
% dart --print_flow_graph add.dart
...
*** BEGIN CFG
Unoptimized Compilation
==== file:///.../add.dart_::_main (RegularFunction)
B0[graph]:0
B1[function entry]:2
    CheckStackOverflow:8(stack=0, loop=0)
    DebugStepCheck:10()
    t0 <- Constant(#100)
    t1 <- Constant(#200)
    t0 <- StaticCall:12( Add<0> t0, t1)
    StaticCall:14( print<0> t0)
    t0 <- Constant(#null)
    DebugStepCheck:16()
    Return:18(t0)
*** END CFG
*** BEGIN CFG
Unoptimized Compilation
==== file:///.../add.dart_::_Add (RegularFunction)
B0[graph]:0
B1[function entry]:2
    CheckStackOverflow:8(stack=0, loop=0)
    DebugStepCheck:10()
    t0 <- LoadLocal(a @2)
    t1 <- LoadLocal(b @1)
    t0 <- InstanceCall:12( +<0>, t0, t1)
    DebugStepCheck:14()
    Return:16(t0)
*** END CFG
```

优化ir
```shell
% dart pkg/vm/bin/gen_kernel.dart --platform vm_platform_strong.dill --tfa --aot -o add.dill add.dart
% gen_snapshot --snapshot_kind=app-aot-elf --print_flow_graph_optimized --print-flow-graph-filter=main --elf=add.aot add.dill
...
*** BEGIN CFG
After AllocateRegisters
==== file:///.../add.dart_::_main (RegularFunction)
  0: B0[graph]:0 {
      v0 <- Constant(#null) T{Null?}
      v11 <- Constant(#300) [300, 300] T{_Smi}
}
  2: B1[function entry]:2
  4:     CheckStackOverflow:8(stack=0, loop=0)
  6:     PushArgument(v11)
  8:     StaticCall:14( print<0> v11)
  9:     ParallelMove rax <- C
 10:     Return:18(v0)
*** END CFG
```

## IL生成机器码

FlowGraph 经过众多 Pipeline 优化后交给 CompilerPass::GenerateCode 生成机器指令，GenerateCode 通过 FlowGraphCompiler 类遍历 FlowGraph 所有指令块 Block，每个 Block 包含若干条 Instruction，每条 Instruction 可以生成（lowering）相应的若干条机器指令

```c++
// flow_graph_compiler.cc
void FlowGraphCompiler::CompileGraph() {
  InitCompiler();
  VisitBlocks();
}

void FlowGraphCompiler::VisitBlocks() {
    set_current_block(entry);
    set_current_instruction(entry);
    entry->EmitNativeCode(this);
}
```

CallSpecializer 指令生成阶段(x64平台)：
```c++
// il_x64.cc
void BinaryInt64OpInstr::EmitNativeCode(FlowGraphCompiler* compiler) {
  const Location left = locs()->in(0);
  const Location right = locs()->in(1);
  const Location out = locs()->out(0);
  EmitInt64Arithmetic(compiler, op_kind(), left.reg(), right.reg());
}
template <typename OperandType>
static void EmitInt64Arithmetic(FlowGraphCompiler* compiler, Token::Kind op_kind, Register left, const OperandType& right) {
  switch (op_kind) {
    case Token::kADD:
      __ addq(left, right);
      break;
    case Token::kSUB:
      __ subq(left, right);
      break;
    case Token::kMUL:
      __ imulq(left, right);
      break;
  }
}
```

在代码生成最后的阶段，针对当前编译的函数，虚拟机创建相应的 Instructions 对象和 Code 对象，为机器指令分配可执行内存，最后 Attach 到 Function 对象，设置 entry 属性。

```c++
// object.cc
CodePtr Code::FinalizeCode(FlowGraphCompiler* compiler, compiler::Assembler* assembler, PoolAttachment pool_attachment, bool optimized, CodeStatistics* stats /* = nullptr */) {
    // Hook up Code and Instructions objects.
    code.set_instructions(instrs);
}

void Function::SetInstructionsSafe(const Code& value) const {
  untag()->set_code(value.ptr());
  StoreNonPointer(&untag()->entry_point_, value.EntryPoint());
  StoreNonPointer(&untag()->unchecked_entry_point_, value.UncheckedEntryPoint());
}
```

## 代码序列化

编译后的代码分成两部分: 
- 数据段: 存储一些静态变量、类信息,虚拟机只read这部分数据.
- 代码段: 机器码运行指令Instruction,即机器码运行指令(x86、x64),虚拟机excute需要可执行权限.
 AOT产物(app.so)中,数据段存在于 _kDartVmSnapshotData、_kDartIsolateSnapshotData.代码段存在于_kDartVmSnapshotInstructions、_kDartIsolateSnapshotInstructions
为了运行机器码，运行时必须掌握每一段机器码Instruction的内存位置。因此，在数据区必须记录机器码的位置信息。记录机器码位置信息的对象是Code对象。所以总体的数据格式大致如下

![](/image/dart/dart_compiler_code_instruction.jpg)

Code对象与记录机器码位置有关的主要成员有以下两个：
- entry_point_ 记录Code对象对应的机器码在内存中的位置
- instructions_: Instructions类型的对象，指向包含机器码的Instructions对象 (还有monorphic_entry_point_等其他三个) 

### 数据段序列化

数据段主要格式如下
- Header数据区: 存储一些校验、版本、feature等等额外信息
- 对象数据区: 存储真代码相关的信息: 类型信息、字符串等等

Header数据格式

对象数据区数据格式

对象序列化的并不复杂, 如果想要序列化对象A：
1. 收集到A直接或间接引用到的所有对象（包括A)
2. 为每个对象分配一个id
3. 将所有对象按id顺序序列化到流中，序列化数据应包括对象的类型（以cid表示)和对象的每一个成员。对于引用类型的成员，以被引用对象的的id代替。
4. 序列化A的id到流的末尾。

|字段       |长度(字节) |备注                          |
|:---       |:---    |:---                          |
|magic      |4       |0xdcdcf5f5                    |
|length     |4      |Snapshot数据总长度               |
|kind       |8     |值为下列数值之一： FullFullCore/FullJIT/FullAOT/None/Invalid,在AOT模式下，kind的值总是FullAOT            |
|version    |32      |32字节长的hash字符串（无终结符）。其hash值依据下列文件内容计算：```app_snapshot.h snapshot.cc object.cc``` .... |
|length     |n      |feature字符串（以0为终结符）。其内容包含: 编译版本、vm全局选项、isolate group选项(enable_asserts) 、abi信息、指针压缩选项、null-safety选项             |




Serialize方法的实现核心为代码，大致分为以下几步：
1. 添加基础对象，并为基础对象分配id
2. 根据根对象搜索所有需要被序列化的对象，按cid(class)分类,放入对应的SerializationCluster中
3. 写入头部区 : 对象个数、instructions table的长度、cluster数量等等
4. 为被序列化对象分配id，并写入分配信息区
5. 写入填充信息区: 写入分配好的序列化详细信息
6. 写入根对象区

![](/image/dart/dart_compiler_cbe_serialize_code.jpg)

```c++
void Serializer::Serialize(){
    //1. 添加基础对象，并为基础对象分配id；
    roots->AddBaseObjects(this);
    //2.根据根对象搜索所有需要被序列化的对象，按cid(class)分类；
    roots->PushRoots(this); 
    //3. 写入头部区
    WriteUnsigned(num_objects); // 写入对象总数
    WriteUnsigned(clusters.length()); // 写入cluster数量
    WriteUnsigned(instructions_table_len_);  // 写入instructions table的长度
    //4. 为被序列化对象分配id，并写入分配信息区
    for (SerializationCluster* cluster : clusters) {
         cluster->WriteAndMeasureAlloc(this);
    }
    //5. 序列化填充信息区
    for (SerializationCluster* cluster : clusters) {
        cluster->WriteAndMeasureFill(this);
    }
    //6. 序列化根对象区
    roots->WriteRoots(this);
}
```

### 机器码序列化
Code对象和机器码的关系至少有两种：
1. Code对象以instructions_成员持有Instructions对象，entry_point_指向Instructions中的机器码位置
2. Code对象不持有Instructions对象引用（instructions_成员为空)，entry_point_指向代码段中的机器码位置
在JIT模式下，以及在AOT编译阶段，机器码显然保存在分配自堆中的Instructions对象中; 在AOT模式下, Code对象本身会被序列化到数据段中，其中entry_point_以对应机器码相对于代码段的偏移量代替

![](/image/dart/dart_compiler_serialize.jpg)

序列化过程
1. 按正常流程序列化Code对象中除Instructions和entry_point_之外的其他信息
2. 把Instructions对象序列化到代码段，可以序列化整个Instructions对象，或者只序列化机器码部分。
3. 得到Instructions对象在代码段中的偏移量，在Code的填充信息区记录该偏移量

序列化过程中的一些细节:
1. dedup优化: 如果发现两个或者多个函数的机器码完全一样，删除多余的机器码，公用同一份机器码
2. instructions table: 根据PC寄存器的值反查当前Code对象. 将所有Code对象搜集为一个列表。为了提高搜索效率，要求Code对象按照其机器码的内存位置的顺序排列，以便采用二分法高效搜索。  dedup优化的存在打破了以上的前提，Code对象的序列化顺序不再和机器码顺序严格一致。为此，在序列化之前，还需要做一个排序操作，让共享同一份Instructions对象的Code对象排列在一起
3. 基于pc相对位置的函数调用:  在AOT模式下，为了提高运行效率，对静态函数调用会采用基于pc相对位置跳转的方式.在序列化之前，机器码在代码区的布局还没有确定, 在编译时需要写入一个假的偏移量，序列化过程中需要计算真实的偏移量去替换。

 机器码序列化/反序列化的主要相关类是CodeSerializationCluster和CodeDeserializationCluster。
1. 跟踪引用时记录Code对象
```C++
//1. Code序列化第一步，仍然是在跟踪引用时记录Code对象。
 odeSerializationCluster::Trace()
//2. 在写入头部区之前，需要处理机器码排序、pc相对位置重定向等操作
instructions_table_len_ = PrepareInstructions();
//3. 分配信息写入 CodeSerializationCluster::WriteAlloc(Serializer* s)方法
```
2. 在写入头部区之前，需要处理机器码排序、pc相对位置重定向等操作
```c++
// Serializer::Serialize方法
int Serializer::PrepareInstructions(...){
    //1. 机器码排序： 将共享同一个Instructions对象的Code排在一起
    CodeSerializationCluster::Sort(code_cluster_->objects());
    //2. 处理pc偏移量调用重定向
    //据Code列表计算机器码布局
    RelocateCodeObjects(vm_, &code_objects, &writer_commands);
    //记录机器码布局, 后续序列化使用
    image_writer_->PrepareForSerialization(&writer_commands);
}
```
3. 写入分配信息
```c++
// CodeSerializer::WriteAlloc(Serializer* s, CodePtr code)方法

// 为Code对象分配id
s->AssignRef(code);
const int32_t state_bits = code->untag()->state_bits_;
// 写入Code对象的state_bits标记
s->Write<int32_t>(state_bits);
```
4. 写入填充信息
```c++
CodeSerializationCluster::WriteFill(){
    // 写入机器码
    s->WriteInstructions(code);
    // 写入object pool的引用
    WriteField(code, object_pool_);
    //写入其他Code关联对象引用
    WriteField(code, xxx);
}


// 首先获取Instructions对象在代码区的偏移量。
// GetTextOffsetFor方法会将instr对象添加到一个列表，并计算其在代码区的偏移量。如果已经
// 添加过，则直接返回其在代码区的偏移量。注意，use_bare_instructions模式下，由于在pc
// 偏移量调用重定向过程中已经决定了代码布局，Code对象已经被添加进列表，此时总是返回其偏移量
// 即可
void Serializer::WriteInstructions(){
    // 在use_bare_instructions模式下，对每个Code对象，序列化其相对于前一个Code对象在
      // 代码区的偏移量之差。另外序列化其unchecked偏移量和单态标记。
    if (FLAG_precompiled_mode && FLAG_use_bare_instructions) {
        delta = xxx
        WriteUnsigned(delta);
        WriteUnsigned(payload_info);
        return;
    }
    // 非use_bare_instructions模式下，直接序列化机器码偏移量和unchecked偏移量
    Write<uint32_t>(offset);
    WriteUnsigned(unchecked_offset);
}

```
done

