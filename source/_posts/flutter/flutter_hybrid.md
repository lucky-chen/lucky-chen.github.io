---
title: Flutter混合栈的实现原理
categories: Flutter
date: 2019-12-25
---

# 概览

解决2个问题
- 容器和engine的对应关系
- 路由管理

<!-- more -->

Flutter作为一个跨平台高性能的渲染方案，业界和集团许多App和业务都在进行上马尝试。由于基本都是现有的成熟App，所以大多数人在迁移到Flutter技术栈时，基本会碰到同一个block问题：flutter混合栈方案。



Google在Flutter最初的设计上面，挖了一个天大的坑:没有考虑混合栈的方式。最初的设计是all in flutter,App只有一个容器Activity，Flutter页面在这一个实例上面nav转换。这种方案是没有办法直接集成到现有App上的，因此需要有一套方案，来做这件事情。

> 得益于闲鱼同学之前和Google的沟通合作，在Flutter 1.12版本后，官方终于提供了部分混合栈能力Api,不过还是缺少Nav能力完成闭环。

# 方案梳理

Q: 什么是混合栈方案，要达到一个什么样的形态？
A: 如下图所示，满足2个要求

- 页面互相独立
- flutter和native之间能够互相跳转

那么就有2个要素需要解决

- 需要一个flutter的容器，承载flutter页面
- 需要一个nav逻辑，支持native和flutter页面之间的跳转

# 容器方案

容器的方案核心就三种，各种方案只是在具体实现方式上有所区别

## 纯flutter页面

这种是flutter最早的官方方案，只适合all in flutter的新app，特点是
- 全局就一份engine实例
- 整个app就一个activity，只能在flutter页面间互相跳转。
- 代码层面不需要改动，直接follow官方的api用就行了

对于现有app来说，直接pass，因为更多的场景是flutter页面和native页面互相跳转。只是flutter页面自己跳转是远远满足不了需求的。

## 混合容器，不复用engine

第二种方案，同时能够满足新app以及现有app混合栈的需求，特点是

- 能够满足基本的混合栈需求，flutter和native页面之间可以互相互相跳转
- 多engine实例：以Activity为单位，每个单位拥有一份自己独立的容器以及Engine实例由于是多engine方案，实例间的数据无法共享，带来额外的成本。
- 性能比较差。

为什么说性能比较差呢？主要是因为多Engine实例的原因。每个engine实例都会初始化一份独立的环境
- 创建3个线程
- 创建DartVm、dartIsolate
- 初始化skia环境
- 各自独立的一份图片缓存

这些操作对性能、稳定性影响非常大:

- 在不断push的过程中，多Engine势必会对内存造成极大的压力
- 每个engine有一份独立的图片cache,内存必然爆炸。
- 启动过程中，会初始化engine，造成页面启动过慢。参考另外一篇[FlutterEngine启动性能优化](https://lucky-chen.github.io/2019/12/15/flutter/flutter_engine_startup/)，中低端机上，原生engine启动耗时Android 300ms左右，iOS在380ms左右，这个耗时是不可接受的.

Flutter官方对[启动一份engine内存、耗时占用的测试结果](https://flutter.dev/docs/development/add-to-app/performance?spm=ata.13261165.0.0.563d158eT1oPLv)

综上所述，如果要投入生产环境，这种方案还需要进一步优化。

##  混合容器，复用engine

第二种方案的优化版本，特点

- 单Engine实例，多个容器间共享一个Engine
- 能够满足基本的混合栈需求，flutter和native页面之间可以互相互相跳转
- flutter官方1.12版本采用的也是这种方案

从图中可以看出，这种方案是比较合理的，不同的flutter容器间共享一个engine。不会有内存和启动性能上的问题。这类共享engine方案的具体实现方式，随着flutter版本的不断演进，有几个不同的实现变种

- 通过共享FlutterView、FlutterNativeView方式
- 官方代码重构后，抽象出FlutterEngine概念，将View和Engine概念解耦，达到Engine复用目标

### 共享view方式

在1.12之前公开的api中,一个FlutterView对一个Engine,这就非常蛋疼了。

> 图

因此，为了达到共享Engine的目标，填上这个坑，产生了2个变种优化方案

#### 共享flutterview

> 图

boost在早期版本采用共享flutterview的方式，参考[Flutter新锐专家之路：混合开发篇(boost)](https://juejin.im/post/5b764acb51882532dc1812b1)。简单来说，全局持有一个FlutterView，在Activity切换时，进行view的attach、detach的操作。
> 图


但是这种实现有个缺点，由于只有一个view，跳转动画的时候，A、B两个页面展示动画就会有问题。为了解决这个问题，boost对每一个Activity保留一张截图，带来额外内存消耗。

> 1080p分辨率，ARGB_8888格式，内存占用1920*1080*4/1024/1024≈ 7.9m

> 2k分辨率，ARGB_8888格式，内存占用2560*1440*4/1024/1024≈ 14.0m

这个图片内存占用 + 在push几个页面，没几个app能够hold的住

#### 共享flutterNativeView

为了解决截图的问题，在上面的方案上做了进一步的演进，原理类似，只是共享的实例换成了FlutterNativeView。这样就不用做截图的操作，因为每个Activity都有自己的FlutterView，底层共享FlutterNativeView。

> 图

这里吐槽下Google的命名，FlutterNativeView和View一毛钱关系都没有，它只是做Android和flutter之间通信和一些状态同步的

```
//就是个转发消息、同步状态的
public class FlutterNativeView implements BinaryMessenger
```

### 抽象FlutterEngine概念

得益于闲鱼同学前期和Google同学的合作沟通，在1.12版本上。Google终于修复了这个严重的失误，进行了代码重构..([add to app 文档](https://flutter.dev/docs/development/add-to-app/android/add-flutter-screen?spm=ata.13261165.0.0.563d158eT1oPLv))

> 图

可以看到，在新的结构上，解耦了之前FlutterView和Engine之间奇怪的耦合关系，现在FlutterView就只是View，没有别的逻辑。在新的Api基础上上(io.flutter.embedding.xxx)，可以自由选择容器使用共享Engine还是新建Engine，使用方式也更加自然。

```
//初始化engine，并放到缓存中
FlutterEngine engine = new FlutterEngine(this, listener);
FlutterEngineCache.getInstance().put("my_engine_id", engine);
//共享缓存的engine
 startActivity(
     FlutterActivity.withCachedEngine("my_engine_id").build(this)
);
```

到这里，官方算是把混合栈中复用Engine的坑填上了。

# Nav跳转

解决了容器的问题，还有一个nav的问题需要解决。

> 图
我们需要一套方案，来提供nav跳转的能力。很遗憾，截止1.12版本，Google官方仍然没有提供这种能力


目前的方案是：基于plugin通信的能力，使用自定义的Nav，来驱动Flutter和Native之间页面的跳转。

> 图

