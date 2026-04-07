---
title: DartVM概述
categories: [Dart, VM, Compiler]
date: 2023-5-28
---

# 主要内容：

- Dart对象模型
- 虚拟机内部模型

<!--more-->

现代虚拟机, 不同语言实现方式和细节千差万变，但万变不离其宗,总体结构基本一致

<img src="/image/dart/dart_vm_guide.jpg" width="400" height="500" />

- 内存管理: 高级语言都有GC的模型和算法
- 对象模型: 定义堆中的对象的内存格式，以及基本继承关系
- 调用约定: 定义如何调用函数，如何传递参数
- 线程/协程模型: 实现语言的线程/协程机制
- 编译器&&编译产物:  实现代码编译逻辑，源码-> 前端编译器->中间产物IR->后端编译器->机器码, 这部分参见 Dart compiler编译器概要设计 

# Dart对象模型

## 继承结构
和Java类似，dart也是一个单根继承系统，所有类都是Object类的直接或间接子类。


![](/image/dart/dart_vm_object_instance.jpg)

- 所有类都从Object类派生
- Instance就是dart语言中的Object类. 在dart语言中定义的非内置类，从Instance类派生。
- 上面所有的类都是dart内置类，都是用C++用语言编写的。但是绿色部分的类可能同时也有对应的dart类，这种类可以看作是C++和dart混合编写的
- 绿色的类都直接或间接从Instance类派生，因而能在dart语言中访问；
- 灰色类都对dart语言不可见，只能在虚拟机的C++代码中访问

## Object类
 Object类对应的C++类叫UntaggedObject,包含两方面的信息
- 堆和GC相关信息
- 对象的类型信息
这两部分信息都存储在tags_字段上

```C++
class UntaggedObject {
  AtomicBitFieldContainer<uword> tags_;
};
```
-  0-7位 :  是一系列与堆和GC相关的标记位 (NEW OLD)
-  8-15位 : 是一个八位整数，表示对象在堆中的大小
-  16-31位: 用16位记录对象的class_id
-  32-63位: 仅在64位机&&对象是字符串的时候会被设置，其值即字符串的hash值

## 引用和小数

Dart在底层技术实现上, 变量可以是任意类型. , 类型只不过是编译期的限制信息，运行期没有任何区别. 为了让一个变量的值是一个字符串或者其他类型的对象，只需要让其对应的内存记录对象的地址即可
变量a是一个引用,  值是字符串```"hello workld!"``` 的内存地址```0x00FE8C60```

<img src="/image/dart/dart_vm_ref.jpg" width="500" height="298" />

但是有个问题, 碰到```a =  0x00FE8C60(数值)```, 这种方式没办法判断a是一个引用还是一个数值. C++/Java这种语言中,变量有类型. 但是在dart中,由于变量可以赋予任何类型的值，必须要求变量的值本身可以反映其类型. 
观察数据存储规律,我们发现:
一个合法的对象地址，其二进制值最后一位总是0. (32位对齐) Dart和JavaScript都利用了这个特性，实现了一个变量既可以存储地址，又可以存储整数。
-  对于地址，将其值加1，作为变量的值，这个值总是奇数；
-  对于整数，将其乘以2，作为变量的值，这个值总是偶数。
整数值需要被乘以2才被储存到变量，如果这个结果超出了变量的表示范围，上述方案就会失效。这时候，就可以采取在堆中分配整数对象，变量存储其地址的方案了
- 可以直接存储在变量中的整数，叫做小整数，简称```Smi```
- 那些需要在堆中分配的整数叫做大整数，简称```Mint```。
它们对应的C++类分别为```UntaggedSmi```和```UntaggedMint```，后两者都是```UntaggedInteger```的子类。

## Zone

- c++代码通过zone中的handle间接访问dart堆中的对象, 使得gc能够感知到c++中堆dart对象的引用
- 供了一种更加简洁的内存管理方案: 从Zone中分配的C++对象不能通过delete关键字手动析构，Zone释放时会释放其中所有的C++对象

### GC关联c++引用

如果直接使用c++ 访问dart对象object处于C++栈中, gc并不知道这里有引用, 如果触发了gc 
```C++
ObjectPtr object = xxxUntaggedObject;
```
1. object变量引用的UntaggedObject对象被GC回收掉
2. object变量引用的UntaggedObject移动到其他地方
上面两种可能性都会导致object所保存的地址不再指向一个有效的对象，从而导致后续的访问发生错误，甚至崩溃

<img src="/image/dart/dart_vm_zone_handle.jpg" width="500" height="515" />

1. 由于虚拟机GC过程中可以通过遍历Zone链表跟踪到每一个Handle，所以能够防止Handle引用的对象被回收；
2. 如果GC过程中，对象的位置发生改变，虚拟机可以更新Handle使其指向新的位置，以后C++代码通过Handle访问对象，自然可以确保操作的是新的内存位置。
使用demo

```C++
Thread* thread = Thread::Current();
StackZone stack_zone(thread);       // 创建一个新Zone,压入当前Zone栈
Object& object = Object::Handle();   // 分配一个Handle
object = ...;                        // 操作Handle
// stack_zone析构，将Zone从栈弹出并释放
```
### c++内存管理分配

从Zone中分配的C++对象不能通过delete关键字手动析构，Zone释放时会释放其中所有的C++对象。
```c++
//从ZoneAllocated继承
class A : public ZoneAllocated {
  ...
};

// 从zone中分配内存创建A对象, 不能手动调用delete，zone被释放时a指向的对象也会被释放；
A* a = new (zone) A();
```

## HandleScope

## Handle

# 虚拟机对象

 在虚拟机中，需要维护一系列代表程序运行结构的对象。
- 如```Library```、```Class```等等，其实现都是Untagged系列类，如```UntaggedLibrary```，```UntaggedClass```等
- 它们的C++方法大多在其````Handle```类中实现，例如Library类，Class类等

## Library

Library代表一个库。在dart里，每一个dart文件都是一个库, 几乎保存了dart文件的全部结构
- name（library关键字声明的名称）
- url（引用Library使用的名称，例如package:flutter/material.dart)
- imports(import关键字引入的其他名称), exports(export关键字导出的名称）等
- 包含了若干个Class对象，对应dart文件中声明的类

特殊之处在于，每一个Library都有一个顶级类(Top Level Class)。这是虚拟机内置生成的类，其中包含了dart文件中的全局方法和全局变量。通过这样的方式，Library对象不再包含方法和域，达到简化对象结构的目的


![](/image/dart/dart_vm_library.jpg)

## Class

Class类的每一个实例都代表一个dart类,    虚拟机的每一个内置类也都对应一个类对象，例如String, Mint, Library等。每个类对象——也就是Class类的实例——都有一个cid，每个类对象都会在虚拟机的类表（Class Table)中注册，其索引正是cid

![](/image/dart/dart_vm_class.jpg)

上图中，每个对象都有一个cid，指向类表中的类对象。每个类对象，因为本身都是对象，自然也具有cid，指向的自然是Class类对象。而每个类对象由于都是Class实例，因而都有一个id,正是它在类表中的索引。显然，任何对象的cid正好等于它的类对象的id
特别的,Class类本身也有类对象,我们称它为Class类对象, Class类对象的类对象，是它本身。
![](/image/dart/dart_vm_class_object.jpg)

- Smi类也有类对象,虚拟机在判断Tagging Pointer类型的时候，若发现它是小整数，会特殊的认为它的cid是Smi类对象的id。
-  null也有类对象,指向一个全局唯一的null实例。null实例的cid指向的就是null类对象
-  void也是一个类, 实存在void类对象
-  内置类的类对象都是虚拟机自行创建的，非内置类都是加载dart编译产物(dill文件或快照)时根据产物内容创建的。然而内置类中，Instance类及其子类都有对应dart代码，那么它们是在什么时候创建的呢？答案是，两者都是——虚拟机将会自行创建类对象，在加载编译产物时又会修改这些类对象，添加dart代码中定义的额外信息。
- 模版类只有一个类对象。在运行期，一个类模版类的所有模版实例都共享同一个类对象，本质上也是同一个类

主要成员

- super_type(AbstractType类型): 表示基类类型
-  interfaces是该类的接口列表，列表中每一项都是一个AbstractType
- type_parameters是该类的模版参数
-  functions是该类包含的所有方法列表，每一项都是一个Function实例。
-   fields是该类包含的所有Field列表，每一项都是一个Field实例。
- host_instance_size_in_words: 整形 ,记录这个类的实例大小, 虚拟机正是根据这个成员去为实例分配内存
  - 对于非内置类以及部分内置类，实例大小是固定的(编译确定), 
  - String, Array等变长类，这个成员会被设置为0，虚拟机会根据构造函数参数去计算实例大小

## AbstractType

AbstractType代表一个类型, 包含表达类的```Class```类型 和dart一些语言特性类型
- class类型: 每一个类就是一种类型. 例如int对应Integer类，double对应Double类
- 函数类型:  ```bool Function(int, int) compareFunc``` , compareFunc 就是一个函数类型
- 空安全: int i 和  int? i; 代表可空和不可空整形 两种类型
- 模版实例类型 : 模版 ```class A<T>``` , 实例 ```A<int>``` 是一个类型, 类似java里面的类型膨胀


<img src="/image/dart/dart_vm_abstract_type.jpg" width="347" height="267" />

- ```Type```: 表示类类型 和 nullability标记是否是空安全类型
- ```FunctionType```: 代表函数类型
- ```TypeRef```: 是虚拟机内部机制引入的类型
- ```TypeParameter```: 代表一个模版形参

## Field

```Dart
class A {
  final int a = 2;
  int b = 3;
}
```
Field类主要包含下面几个数据
- kind_bits 位编码的修饰符标记，每一位代表一个修饰符是否存在。是否有初始化函数的标记也编码在这个标记中。(final)
- type: AbstractType类型的成员，表示域的类型 (int)
- name String类型的成员，表示域的名称(a)
- intializer_function Function类型的成员，由初始化表达式编译得到的函数，如果没有初始化表达式这个成员为空。(2)


访问filed有static filed两种不同的方式
- fileld,  每一个对象都拥有一份该域的值, 虚拟机会根据类的定义去计算每一个非static域的偏移量， 存储到```host_offset_or_field_id```中

![](/image/dart/dart_vm_field_class.jpg)

- Static field,  虚拟机将所有static域的值存放在一片叫做域表```Field Table```的内存中。域值在域表中的索引，存放在Field的```host_offset_or_field_id```中

```Dart
class A {
  static int a = 0;
}

class B {
  static int b = 0;
}
```

![](/image/dart/dart_vm_field_static.jpg)

> host_offset_or_field_id在后端编译时就作为立即数编码到存取指令中了，运行时并不会再从Field中去查询偏移量

## Function

Function对象代表一个函数。dart文件中声明的方法、构造函数、访问器都是函数, 此外, 编译器会为特定目的生成一些其他的函数
- 普通函数
- 构造函数 
- 访问器函数: get set
- 闭包函数: 
- 隐式访问器函数: 由编译器自动生成的访问器函数
- 域初始化函数（FieldInitializer)：编译器会为域生成一个域初始化函数，以便在初始化时调用。
```Dart
class A {
  // int f_() {
  //   return f() + 2;
  // }
  int v = f() + 2;
}
```
- 方法提取器函数(MethodExtractor)： 方法提取器也可以看作对方法的getter, 编译器生成
```Dart
class A {
  // 编译器为func生成方法提取器，起作用等效于下面这个函数：
  // void Function() get_func() {
  //   ... // 返回用A.func的隐式闭包函数创建的闭包
  // }
  void func() {
    ...
  }
}

class B extends A {
  // 编译器为func生成方法提取器，起作用等效于下面这个函数：
  // void Function() get_func() {
  //   ... // 返回用B.func的隐式闭包函数创建的闭包
  // }
  void func() {
    ...
  }
}

A a = B();
// 按照dart语言特性，这里的a.func应该返回的闭包应该调用类B的func函数
// 将a.func看作一个对类A的方法提取器的调用，就可以利用后绑定机制根据a的类型调用到勒B的方法提取器，从而获取到类B的func函数对应的隐式闭包。
void Funcion() f = a.func;

f();
```

Function的重要成员包括：
- name.函数名称，String类型。
- kind_tag: 多种信息的组合。包括kind，区分上面介绍的各种函数类型；各种修饰符；等等。
- data: Object类型的成员，表示函数的关联数据，其具体意义取决于函数的类型。
- code Code类型的成员，表示函数对应的机器码相关信息。这是Function最重要的成员。
- entry_point: 机器码入口地址，来自于code成员。
- signature: FunctionType类型的成员，描述函数的返回值、模版类型、参数类型等信息

## Code&&Instructions

Instructions对象中存放编译生成的机器码，在堆中分配，可以被GC机制回收

<img src="/image/dart/dart_vm_instructions.jpg" width="200" height="404" />


Code存放机器码相关信息, 最重的信息是下面两类:
- instructions 对Instructions对象的引用。
- entry_point：机器码入口的地址。

JIT模式下，instructions指向一个在堆中的Instructions对象，entry_point指向它的入口地址
AOT模式下，instructions为空，entry_point直接指向对应机器码地址, instructions主要作用是维护机器码的生命周期


<img src="/image/dart/dart_vm_code.jpg" width="400" height="637" />


上图中的entry_point 实际上有4种类型
- entry_point: 普通入口。不进行单态测试和参数检查。
- monomorphic_entry_point: 单态入口。进行单态测试，但不进行参数检查。
- unchecked_entry_point: 未检查入口。不进行单态测试，进行参数检查。
- monomorphic_unchecked_entry_point: 未检查单态入口。进行单态测试和参数检查。
关于单态和参数检查两种操作说明
- 参数检查代码也是一小段机器码片段，用于检查传入参数是否合法。如果不合法，也需要跳转到一段错误处理逻辑。
- 单态测试和动态调用相关，简单的说，单态测试代码是一小段机器码片段，用于测试该段机器码是否是预期调用目标。如果不是，则需要跳出机器码，以便进行更为复杂的目标查找逻辑。单态测试片段的作用相当于一段Hook代码


![](/image/dart/dart_vm_entry_point.jpg)
