---
title: 关于我
date: 2023-06-08 15:57:03
---

# 关于我

- 就职公司: 奇虎360、Alibaba淘宝技术部、ByteDance技术中台
- 技术模型: 在Android系统、跨平台框架、虚拟机、编译器、图形渲染方面有着丰富的经验和深入的理解。
- 参与项目:
    - 阿里动态组件化框架Atlas、Patch方案核心开发
    - WeexSdk核心开发
    - ALiFlutte、BDFlutter核心开发
    - Oryx跨平台响应式自渲染框架


>e-mail : qh438406812@gmail.com

# 就职经历

## 2020-至今  字节跳动 

|项目    |简介|工作内容|
|:---   |:---                     |:---                         |
|Oryx   |自研跨平台响应式开发框架   | 框架核心开发 <br>小程序原生渲染方向owner    |
|Flutter|字节flutter项目           |dart虚拟机、编译器、patch方案  |
|Compose| android compose框架     |BDCompose项目owner <br>探索compose在业务上的落地、技术改造； <br>预研kotline-native、wasm跨平台方案探索  |
|Skity  |自研矢量渲染器，类比skia      |核心开发、质量稳定性方案           |

## 2017-至今  阿里巴巴 

|项目|简介|工作内容|
|:---|:---|:---|
|[Atlas](https://alibaba.github.io/atlas/)|Atlas是伴随着手机淘宝的不断发展而衍生出来的一个动态组件化框架。<br>它主要提供了解耦化、组件化、动态性的支持。|开发阿里第2代Patch方案<br>维护Atlas框架、开源社区|
|[Weex](https://github.com/apache/incubator-weex?spm=a2c7j.-.0.0.ed23c8eevBAb0F)|Weex 是一个可以使用现代化的 Web 技术开发高性能原生应用的框架|核心开发，开源社区维护<br>WeexCore2.0升级<br>JSRuntime开发<br>性能稳定性体系化监控|
|ALiFlutter|阿里集团Flutter体方案提供|Flutter容器开发<br>Engine定制修改优化|


## 2015-2017 奇虎360 

|项目|简介|工作内容|
|:---|:---|:---|
|360手机卫士|无|程序锁功能开发|
|[DroidPlugin](https://github.com/Qihoo360/DroidPlugin)|360插件化框架|无，感兴趣自行研究|


# 技术模型

<img src="/image/about/2023_guide.png" width="600" height="810" />

## 中间件
- [网络库 Http版本协议变迁历史](https://lucky-chen.github.io/2016/08/06/network/http2/)
- [《Java多线程编程》笔记](https://lucky-chen.github.io/2017/08/06/java/concurrent_thread/)
## Framework框架
- Android
    - [插件化DroidPlugin-Activity](https://lucky-chen.github.io/2017/01/05/android/droid_plugin_activity/)
    - [插件化DroidPlugin-Service](https://lucky-chen.github.io/2017/01/20/android/droid_plugin_service/)
    - [插件化DroidPlugin-Provider](https://lucky-chen.github.io/2017/02/01/android/droid_plugin_provider/)
    - [插件化DroidPlugin-Receiver](https://lucky-chen.github.io/2017/02/07/android/droid_plugin_receiver/)
    - [Android源码之Handler](https://lucky-chen.github.io/2016/08/25/android/handle/)
    - [Android源码之进程启动过程](https://lucky-chen.github.io/2017/02/14/android/android_process_start/)
    - [Android源码之Activity与AMS、WMS联系](https://lucky-chen.github.io/2017/01/25/android/activity_ams_wms/)
    - [Android动态化容器框架Atlas-从gradle到apk](https://lucky-chen.github.io/2017/05/11/android/atlas_atlas_gradle_apk/)
    - [Android动态化容器框架Atlas之启动过程(上)](https://lucky-chen.github.io/2017/05/17/android/atlas_start_1/)
    - [Android动态化容器框架Atlas启动过程(下)](https://lucky-chen.github.io/2017/05/21/android/atlas_start_2/)
    - [Android动态化容器框架Atlas之bundle加载过程](https://lucky-chen.github.io/2017/06/05/android/atlas_bundle_load/)
- 跨平台框架
    - [ReactNative源码-启动过程](https://lucky-chen.github.io/2016/09/21/weex_rn/rn_init/)
    - [Weex架构设计思想和原理](https://lucky-chen.github.io/2018/11/21/weex_rn/weex_architecture/)
    - [跨平台渲染方案对比探究](https://lucky-chen.github.io/2019/09/21/weex_rn/crocess_platform_solution/)
    - [FlutterEngine初始化源码分析以及优化(官方PR)](https://lucky-chen.github.io/2019/12/15/flutter/flutter_engine_startup/)
    - [Flutter混合栈的实现原理](https://lucky-chen.github.io/2019/12/25/flutter/flutter_hybrid/)
    - [Compose架构模块梳理](https://lucky-chen.github.io/2023/02/15/compose/compose/)

## 内核底层

- 虚拟机
    - [Java单例-内存模型-并发](https://lucky-chen.github.io/2016/11/15/java/jvm_concurrent_singleton/)
    - [《深入理解JVM虚拟机》读书笔记——第7章 虚拟机类加载机制](https://lucky-chen.github.io/2016/11/27/java/jvm_class_load/)
    - [《深入理解JVM虚拟机》读书笔记——第2章 Java内存区域](https://lucky-chen.github.io/2016/11/06/java/jvm_mem_struct/)
    - [ART 与 Dalvik 区别](https://lucky-chen.github.io/2017/03/08/android/art_dalvik/)
    - [dart虚拟机概述]()
- 编译器
    - [Compose Compiler(1) kotlin编译架构&&KCP](https://lucky-chen.github.io/2022/12/25/compose/compiler_1/)
    - [Compose Compiler(1) Compose plugin](https://lucky-chen.github.io/2022/12/30/compose/compiler_2/)
    - [dart编译器详解](http://localhost:4000/2023/06/12/dart/dart_compiler/)

## 图形渲染

- [Flutter渲染流程(一)-UI线程工作](https://lucky-chen.github.io/2020/03/08/flutter/flutter_render_pipline/)
- [Flutter渲染流程(二)-GPU线程工作](https://lucky-chen.github.io/2020/03/15/flutter/flutter_render_pipline_1/)
- [Flutter移植嵌入式linux设备、IOT方向探索](https://lucky-chen.github.io/2022/07/15/flutter/flutter_iot/)
- todo [图形学原理 : 矢量渲染skity架构和原理](www) 
    - skia/impller/skity
    - Gl Vk metal
