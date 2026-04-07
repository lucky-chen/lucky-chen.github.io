---
title: Weex架构设计思想和原理
categories: WEEX/RN
date: 2018-11-21
---


# Weex架构原理

- JSFRAM 负责和JS框架(`VUE/RAX`)交互，生成DomTree，将数据传给WeexCore
- WeexCore 有3部分 
	- JSSide:  运行在JS进程中，负责jsbinding、创建、管理js的vm、context
	- CoreSide: 运行在主进程中，负责layout以及将`RenderTree`以命令形式交给Platform绘制
	- IPC: 跨进程通信
- Platform(Android/iOS)
	- 将`RenderTree`转化为平台对应的`ViewTree`,进行渲染
	- native能力调用提供
- JSRuntime: 底层封装`JSC/V8`接口，`WeexCore`使用`JSRuntime`和`jsengine`通信

Weex架构图如下

<!-- more -->
![](/image/weex/weex_architecture.svg)

## 流程

从一个例子说起
```
render(){
    <div>
        <div>
            <text>hello</text>
        </div>
        <div>
            <img src="xxx"></img>
        </div>
    </div>
}
```

## 渲染流程

### JS世界

上述的的demo代码，

- 会触发框架`Rax`的dom构建操作，
- 构建dom会调用到W3C标准的`DomApi`
- `DomApi`实际上是挂载到了weex的`jsfm`上
- `jsfm`持有一颗dom树

```
    div
div     div
text    img
```

`JSFM` 在更新dom树时，会将更新指令序列化成json，同步给weexcore，比如上述结构，会生成类似下面指令，

```
//add div
{"action":"addElement","type":"div","id":1}
//将text add 到上面的div上
{"action":"addElement","type":"text","id":2 ,"parent":1, "attr":{"value":"hello"}}
//。。。
```

然后通过事先binding好的js函数`callAddElement(...)`,传给weexcore

### WeexCore-JSSide

WeexCore的js端，在启动时，就通过`JSRuntime`向`JSEngine`binding了若干native函数,比如`addElement`
```
//weex_global_binding.cpp
CLASS_METHOD_CALLBACK(WeexGlobalBinding, callAddElement)
```
在收到这个命令后，会直接通过`IPC`将命令转给主进程的接收者。

注意，__weex当前模式是双进程方案__

- JSEngine、js代码、WeexCore-JSSide运行在JS进程中
- LayoutEninge、WeexCore-CoreSide、Platform相关运行在主进程中

### IPC通信

。。。


### WeexCore-CoreSide

主进程注册了`IPC的listener`
```
static std::unique_ptr<IPCResult> HandleCallAddElement(IPCArguments *arguments){
  //..
  WeexCoreManager::Instance()->script_bridge()->core_side()->AddElement(...)
);


void CoreSideInScript::AddElement(...) {
  RenderManager::GetInstance()->AddRenderObject(...);
}
```
最终会将渲染命令交给`RenderManager`

```
bool RenderManager::AddRenderObject(...) {
  RenderPageBase *page = GetPage(page_id);
  if (page->is_platform_page()) {
      RenderObject *child = Wson2RenderObject(data, page_id, 
      page->AddRenderObject(parent_ref, index, child);
}

bool RenderPage::AddRenderObject(const std::string &parent_ref,
                                 int insert_posiotn, RenderObject *child) {

  //添加到rendertree上，并且触发layoutengine进行laoyout
  parent->AddRenderObject(insert_posiotn, child);
  //向platform端，发送渲染指令
  SendAddElementAction(child, parent, insert_posiotn, false);  
  return true;
}

```

`RenderManager`中将节点添加到`RenderTree`中，然后向platform端发送渲染指令

### Platform

以Android为例，上层收到指令后，

- 首先将根据节点信息，生成`WXComponent`,
- 然后根据`Component`上的信息，生成对应的view（img、text）
- 将view add到`viewtree`上
- 下一帧显示

```
//GraphicActionAddElement.java
public void executeAction() {
    super.executeAction();
    //添加到component树上
    parent.addChild(child, mIndex);
    //根据component创建对应的view，并且添加到viewtree上
    parent.createChildViewAt(mIndex);
    child.applyLayoutAndEvent(child);
    child.bindData(child);
}
```

你看，逻辑其实很简单，一点都不复杂。


## Api能力调用

和渲染流程类似

```
JSApi->JSFM->WeexCoreJSSide->IPC->WeexCoreCoreSide->Platform->Module
```
这里就不细讲了。


# Weex/RN这类方案的优/缺点

## 优点

- 将前端世界和Native世界无缝结合了起来，前端同学可以使用JS快速迭代业务
- 借助JS天生的动态能力，动态发版赋予电商类需要快速迭代业务发版难、发版慢的问题
- 性能远远强于H5,比较接近native的体验。

## 缺点

- __三端不一致问题(JS、iOS、Android)__，三个世界各有个的开发理念，强行融合必然会产生冲突。这是这类方案在基因上就有的问题,无法彻底解决。
- __维护成本问题，链路太长,技术栈太多__。一旦除了问题，就需要前端同学、native同学(Android、iOS)一起攻关，费时费力。

...