---
title: Flutter渲染流程(一)-UI线程工作
categories: Flutter
date: 2020-03-08
---

# 概览

这一部分的主要工作是`WidgetTree`转化成`LayerTree`，主要分为下面几个阶段

![](https://user-gold-cdn.xitu.io/2018/8/8/16517c804ab5e799?imageView2/0/w/1280/h/960/format/webp/ignore-error/1)


- Animate: 首先执行动画，这个过程可能会改变状态state
- Build:  重新build脏节点的widget（状态改变）
- Layout: 对脏节点进行重新的layout
- Paint: 脏节点重新绘制
- 更新layertree，提交给gpu线程

流程还是比较清晰、容易理解的

<!-- more -->

# 流程源码

![](/image/flutter/flutter_piple_line2_group.svg)


## 流程入口

一般更新是通过`setState`函数触发，经过一系列流程之后，调用到`Window.cc`的`BeginFrame`,开始进行渲染

- `setState`经过一些列调用,调用到`window.scheduleFrame`
- `scheduleFrame`会注册一个vsync
- 在下次vsync到来后，进过一些列调用到`window.cc`上的BeginFrame方法


```
//window.cc
void Window::BeginFrame(fml::TimePoint frameTime) {

  tonic::DartInvokeField(library_.value(), "_beginFrame",...);

  UIDartState::Current()->FlushMicrotasksNow();

  tonic::DartInvokeField(library_.value(), "_drawFrame", {});
}

```
- `_beginFrame`对应dart上`window`对象的`onBeginFrame`方法
- `onDrawFrame`对应dart上`window`对象的`_handleBeginFrame`方法

在`SchedulerBinding`初始化时，分别指向了`_handleBeginFrame`和`_handleDrawFrame`上。

```
//SchedulerBinding
void ensureFrameCallbacksRegistered() {
  window.onBeginFrame ??= _handleBeginFrame;
  window.onDrawFrame ??= _handleDrawFrame;
}
```

## Animate过程

进入`handleBeginFrame`方法

```
//SchedulerBinding
void handleBeginFrame(Duration rawTimeStamp) {
      final Map<int, _FrameCallbackEntry> callbacks = _transientCallbacks;
      callbacks.forEach((int id, _FrameCallbackEntry callbackEntry) {
        //执行动画回调
        if (!_removedIds.contains(id))
          _invokeFrameCallback(...);
      });
}
```
拿到所有注册的动画callbac，依次执行。这个过程中

- 可能会修改widget的状态(state)
- 可能会有一些future代码，挂载到Microtasks队列上

在执行完`handleBeginFrame`方法后，`window.cc`中会执行`FlushMicrotasksNow`将产生的`Microtask`统统执行。

## drawFrame核心流程函数

接着看`drawFrame`方法

```
// lib/src/widgets/binding.dart
void drawFrame() {
  buildOwner.buildScope(renderViewElement);
  //执行`RendererBinding`核心的渲染流程函数`drawFrame`中
  super.drawFrame();
  //...
  buildOwner.finalizeTree();
}
```
关注`RendererBinding`核心的渲染流程函数`drawFrame`

```
//RendererBinding
void drawFrame() {
    pipelineOwner.flushLayout();
    pipelineOwner.flushCompositingBits();
    pipelineOwner.flushPaint();
    renderView.compositeFrame(); // this sends the bits to the GPU
    pipelineOwner.flushSemantics(); // this also sends the semantics to the OS.
}  
```

所以，这里整个流程是这样的
- build阶段
  - buildOwner.buildScope
- layout阶段
  - flushLayout 从新进行布局计算标记为dirty的renderobject
  - flushCompositingBits 更新有dirty标记的renderobject的合成位
- paint阶段
  - flushPaint 重绘标记为dirty的renderobject，这一步会生成layer
- 生成scene阶段，
  - compositeFrame layertree会转成Scene并且发送给gpu
  - flushSemantics 更新dirty的renderboject的语义
- 回收阶段
  - buildOwner.finalizeTree 

## Build阶段

### 主流程函数

```
//framework.dart
void buildScope(Element context,...){
  int dirtyCount = _dirtyElements.length;
  int index = 0;

  //重新构建dirty的element
  while (index < dirtyCount) {
    _dirtyElements[index].rebuild();
  }

  //清楚dirty标记位
  for (final Element element in _dirtyElements) {
    element._inDirtyList = false;
    _dirtyElements.clear();
  } 
}
```

- 执行dirty节点的`rebuild`函数，构建一个新的`Widget`
- 构建完后，清除dirty节点标记。

### 标记Diry时机

节点是在什么时候被标记为dirty呢？

```
//framework.dart
setState(...){
    _element.markNeedsBuild();
}
```
而`markNeedsBuild`会调用到`BuildOwner`的`scheduleBuildFor`方法
```
//BuildOwner
void scheduleBuildFor(Element element) {
    //dirty 标记。
    _dirtyElements.add(element); 
    element._inDirtyList = true;
}
```

### Rebuild过程

```
//framework.dart
class Element{
  void rebuild() {
     performRebuild();
  }

  void performRebuild() {
    Widget built;
    //重新执行了widget
    built = build();
    _child = updateChild(_child, built, slot);
  }
}
```
build函数即是我们在`Widget`中经常打交道的
```
Widget build(BuildContext context) {
  //...
}
```
可以看到,由于状态的改变，重新构建了一个新的`Widget`


## Layout阶段

### flushLayout

build阶段后，会执行到`RendererBinding`的`drawFrame函数`，触发`flushLayout`

```
//pipelineOwner
void flushLayout() {
  //对应工具链Layout阶段耗时
  Timeline.startSync('Layout', ...);
  
  while (_nodesNeedingLayout.isNotEmpty) {
    for (RenderObject node in dirtyNodes) {
      if (node._needsLayout && node.owner == this)
        node._layoutWithoutResize();
    }
  }
}

//RenderObject
void _layoutWithoutResize() {
    //进行lalyout操作
    performLayout();
    //标记需要更新语义
    markNeedsSemanticsUpdate();
    _needsLayout = false;
    //标记需要重绘
    markNeedsPaint();
}
```

以`RenderFlex`为例，看下`performLayout`实际的工作
```
//flex.dart
void performLayout() {
  if (flex > 0) {
    totalFlex += childParentData.flex;
    lastFlexChild = child;
  }else{
      BoxConstraints innerConstraints;
        if (crossAxisAlignment == CrossAxisAlignment.stretch) {
          switch (_direction) {
            case Axis.horizontal:
              break;
            case Axis.vertical:
              break;
          }
        } else {
          switch (_direction) {
            case Axis.horizontal:
              break;
            case Axis.vertical:
              break;
          }
        }
        child.layout(innerConstraints, parentUsesSize: true);
  }
    //...
}
```
不用去细究具体的实现，从代码关键字中可以看出来，这是在按照[Flex 布局](http://www.ruanyifeng.com/blog/2015/07/flex-grammar.html)的规范，对节点进行布局计算，其它的组件也是类似。


### flushCompositingBits


在执行完`performLayout`后，继续执行`flushCompositingBits`函数

```
//pipelineOwner
void flushCompositingBits() {
    //对应工具链 compositing bits阶段耗时

    Timeline.startSync('Compositing bits');
    //遍历需要更新的节点，进行位合成
    for (RenderObject node in _nodesNeedingCompositingBitsUpdate) {
      if (node._needsCompositingBitsUpdate && node.owner == this)
        node._updateCompositingBits();
    }
    _nodesNeedingCompositingBitsUpdate.clear();
}
```

在`_layoutWithoutResize`方法中，会调用`markNeedsSemanticsUpdate`标记`_needsSemanticsUpdate`标志，这里会遍历标记的的`RenderObject`,进行更新`_updateCompositingBits`

```
//RenderObject
void _updateCompositingBits() {
   //遍历自节点，更新标志位
    visitChildren((RenderObject child) {
      child._updateCompositingBits();
      //如果自节点为true，当前节点也设置为true
      if (child.needsCompositing)
        _needsCompositing = true;
    });
    //如果有这2个标志，也设置为true
    if (isRepaintBoundary || alwaysNeedsCompositing)
      _needsCompositing = true;
 
  }
```

`needsCompositing`这个标志，有什么作用呢？__如果`needsCompositing`为true，都会创建一个新的`Layer`__。

以`TransformLayer`为例，

```
TransformLayer pushTransform(bool needsCompositing...) {

    if (needsCompositing) {
      final TransformLayer layer = oldLayer ?? TransformLayer();
      pushLayer(layer,...);
      return layer;
    } else {
      canvas
        ..save()
        ..transform(effectiveTransform.storage);
      canvas.restore();
      return null;
    }
  }
```

这个标志位如果位true，会生成一个新的`Layer`进行操作，否则直接调用`Canvas`api操作。


##  Paint阶段

在`_layoutWithoutResize`函数中，对dirty节点进行了`markNeedsPaint`操作，表示当前节点需要重绘。之后流程调用到`flushPaint`函数

```
void flushPaint() {
    //对应工具链中paint过程耗时
    Timeline.startSync('Paint', arguments: timelineWhitelistArguments);

    //遍历dirynode，如果在树上，进行重绘，否则跳过
    for (RenderObject node in dirtyNodes) {
        if (node._needsPaint && node.owner == this) {
          if (node._layer.attached) {
            PaintingContext.repaintCompositedChild(node);
          } else {
            node._skippedPaintingOnLayer();
          }
        }
    } 
}
```
遍历dirtyNodes，调用`repaintCompositedChild`进行重绘

```
//PaintingContext
static void _repaintCompositedChild(RenderObject child,...}) {
    OffsetLayer childLayer = child._layer;
    if (childLayer == null) {
      child._layer = childLayer = OffsetLayer();
    } else {
      childLayer.removeAllChildren();
    }
    child._paintWithContext(childContext, Offset.zero);
}
void _paintWithContext(PaintingContext context, Offset offset) {
  paint(context, offset);
}
```
重绘前，清空`_layer`上的子节点，辗转调用到`RenderObject`的`paint`方法。为了说明问题，我们以`image`为例：

```
//image.dart
@override
void paint(PaintingContext context, Offset offset) {
    paintImage(
      canvas: context.canvas,
      rect: offset & size,
      image: _image,
      scale: _scale,
      colorFilter: _colorFilter,
      fit: _fit,
      alignment: _resolvedAlignment,
      centerSlice: _centerSlice,
      repeat: _repeat,
      flipHorizontally: _flipHorizontally,
      invertColors: invertColors,
      filterQuality: _filterQuality,
    );
  }

```
看各种参数基本可以猜出来，最终会调用`canvas`的方法，根据各种参数`rect`、`filterQuality`将`image`绘制出来。
> canvas.drawImg(...);


## 生成scene

继续执行`renderView.compositeFrame()`

```
//view.dart
void compositeFrame() {
    //对应工具链 Compositing 阶段耗时
    Timeline.startSync('Compositing', ...);

    //将layer转换成scene
    //会在dart和engine层(c++)创建对应的 builder和scene
    final ui.SceneBuilder builder = ui.SceneBuilder();
    final ui.Scene scene = layer.buildScene(builder);
 
    //调用render接口，将scene发送给gpu线程
    _window.render(scene);
    scene.dispose();
  }
```

- 第1步，将layer转化成scene
- 第2步，将scene发送给`_window`对象

### Layer转化成scene

`RenderView`继承自`RenderObject`,layer是`RenderObject`上的`_layer`对象
```
class RenderObject{
  ContainerLayer _layer;
}
```
跟进`ContainerLayer`的`buildScene`方法

```
//ContainerLayer
ui.Scene buildScene(ui.SceneBuilder builder) {
 
  addToScene(builder);
  final ui.Scene scene = builder.build();
  return scene;
}
```
继续跟进`addToScene`

```
//ContainerLayer
void addToScene(...) {
    addChildrenToScene(builder, layerOffset);
}

void addChildrenToScene(ui.SceneBuilder builder, [ Offset childOffset = Offset.zero ]) {
    Layer child = firstChild;
    while (child != null) {
      if (childOffset == Offset.zero) {
        child._addToSceneWithRetainedRendering(builder);
      } else {
        child.addToScene(builder, childOffset);
      }
      child = child.nextSibling;
    }
}
```
花里胡哨写了一大堆，，其实就是在遍历`ContainerLayer`上的子`Layer`，调用子`Layer`的`addToScene方法`.

我们以`PictureLayer`为例
```
//PictureLayer
void addToScene(ui.SceneBuilder builder, [ Offset layerOffset = Offset.zero ]) {
    builder.addPicture(layerOffset, picture, isComplexHint: isComplexHint, willChangeHint: willChangeHint);
}
```
`addPicture`方法，最终会辗转调用到native的`scene_builde.cc`上的
```
//scene_builder.cc
void SceneBuilder::addPicture(double dx,
                              double dy,
                              Picture* picture,
                              int hints) {
  auto layer = std::make_unique<flutter::PictureLayer>(
      offset, UIDartState::CreateGPUObject(picture->picture()), ...);
  current_layer_->Add(std::move(layer));
}
```
创建了一个`PictureLayer`,添加到`scene_builder`持有的`current_layer_`自节点上。

其它操作类似
```
//scene_builder.cc
#define FOR_EACH_BINDING(V)                         \
  V(SceneBuilder, pushOffset)                       \
  V(SceneBuilder, pushTransform)                    \
  V(SceneBuilder, pushClipRect)                     \
  V(SceneBuilder, pushClipRRect)                    \
  V(SceneBuilder, pushClipPath)                     \
  V(SceneBuilder, pushOpacity)                      \
  V(SceneBuilder, pushColorFilter)                  \
  V(SceneBuilder, pushBackdropFilter)               \
  V(SceneBuilder, pushShaderMask)                   \
  V(SceneBuilder, pushPhysicalShape)                \
  V(SceneBuilder, pop)                              \
  V(SceneBuilder, addPlatformView)                  \
  V(SceneBuilder, addRetained)                      \
  V(SceneBuilder, addPicture)                       \
  V(SceneBuilder, addTexture)                       \
  V(SceneBuilder, build)
```

到这一步后，会将所有生成的`xxLayer`挂载到native对象`SceneBuilder`上的`current_layer_`对象中。

### 将scene发送给`_window`对象

继续执行`window.render(scene)`方法

```
//window.cc
void Render(Dart_NativeArguments args) {
  //获取上面创建的scene在native的指针
  Scene* scene =
      tonic::DartConverter<Scene*>::FromArguments(args, 1, exception);
  //client 实际上是engine
  UIDartState::Current()->window()->client()->Render(scene);
}

//engine.cc
void Engine::Render(std::unique_ptr<flutter::LayerTree> layer_tree) {
  animator_->Render(std::move(layer_tree));
}

//Animator.cc
void Animator::Render(std::unique_ptr<flutter::LayerTree> layer_tree) {
  producer_continuation_.Complete(std::move(layer_tree));
  //delegate_实际指向的是shell
  delegate_.OnAnimatorDraw(layer_tree_pipeline_);
}
```
一路辗转调用，最终执行到`shell`的`OnAnimatorDraw`方法上，方法很简单，将生成`LayerTree`抛给GPU线程进行栅格化上屏操作(下一节关注)

```
//shell.cc
// |Animator::Delegate|
void Shell::OnAnimatorDraw(fml::RefPtr<Pipeline<flutter::LayerTree>> pipeline) {
  task_runners_.GetGPUTaskRunner()->PostTask([...]() {
        if (rasterizer) {
           //gpu线程进行栅格化操作
          rasterizer->Draw(pipeline);
        }
      });
}
```

### flushSemantics

`drawFrame`函数借着执行`flushSemantics`

```
//rendering.object.dart
void flushSemantics() {
    //对应工具链Semantics部分
    Timeline.startSync('Semantics');
    
    for (RenderObject node in nodesToProcess) {
        //遍历更新需要重新语义化的RenderObject
        if (node._needsSemanticsUpdate && node.owner == this)
          node._updateSemantics();
    }
    _semanticsOwner.sendSemanticsUpdate();   
}
```

## finalizeTree阶段

继续看最后一步`finalizeTree`函数

```
//BuildOwner  framework.dart
void finalizeTree() {
    Timeline.startSync('Finalize tree', ...);
  
    //遍历调用element的unmount函数
    _inactiveElements._unmountAll(); // this unregisters the GlobalKeys
}

//_InactiveElements
void _unmountAll() {
    elements.reversed.forEach(_unmount);
}

void _unmount(Element element) {
  element.visitChildren((Element child) {
    _unmount(child);
  });
  element.unmount();
}
```
其实就是遍历`Element`，调用他们的`unmount`函数,解注册对应`Widget`上的key

```
 void unmount() {
    final Key key = _widget.key;
    if (key is GlobalKey) {
      key._unregister(this);
    }
  }
```

# 最后

第一部分ui线程工作完毕