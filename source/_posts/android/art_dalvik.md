---
title: ART 与 Dalvik 区别
categories: Android
date: 2017-03-08
---


# 不同点

- 内存堆的划分
- 代码编译运行区别
- GC

<!-- more -->

# 堆划

各个堆划分功能说明

|堆|说明|
|:--|:--|
|Zygote|管理Zygote进程在启动过程中预加载和创建的各种对象|
|Active|应用程序进程分配对象|
|Large|分配大对象|
|Image|存放一些预加载的类|

>Dalvik由于没有large的划分优化，GC回收算法又是Mark-Swap,会有很多内存碎片，分配大对象时，很容易GC.

#  代码编译运行区别

|虚拟机|处理方式|
|:--|:--|
|Dalvik <2.2|Interpreter 将代码代码一条条的转译执行|
|Dalvik >=2.2|JIT 将热点代码编译成机器指令|
|Art|AOT 安装时预先编译成机器码|
|Art >=N|Interpreter+JIT+AOT|

#  GC
 
都有并发和非并发收集过程
并发收集不同点

|不同|Dalvik|ART|
|:--|:--|:--|
|回收算法| Mark-Sweep|前台GC: Mark-Sweep <br> 后台GC: Mark-Compact|
|StopWord时机|标记 root <br> 标记 dirty|标记 dirty|
|GC粒度划分|无|StickGc: Allock区 <br> PartialGc: Alloct+Large <br> FullGc:Alloct+Large+Zygote|


Dalvik 并发收集大概流程

1. 挂起
2. mark Root
3. 恢复
4. 并发mark Root持有的引用链
5. 挂起
6. mark dirty
7. 恢复
8. 回收

ART 并发收集大概流程

1. 并发mark Root
2. 并发mark Root持有的引用链
3. 挂起
4. mark dirty
5. 恢复
6. 回收

详细的收集过程参见 [老罗的博客][2]

--- 

参考：
- [老罗-Dalvik虚拟机垃圾收集（GC）过程分析][1]
- [老罗-ART运行时垃圾收集（GC）过程分析][2]
- [Android GC原理探究][3]
- [Android JVM GC那点事][4]


[1]: http://blog.csdn.net/luoshengyang/article/details/41822747
[2]: http://blog.csdn.net/luoshengyang/article/details/42555483
[3]: https://zhuanlan.zhihu.com/p/24835977
[4]: http://yunfengsa.github.io/2015/11/12/android-jvm-gc/