---
title: Flutter渲染流程(二)-GPU线程工作
categories: Flutter
date: 2020-03-15
---


# 概览

- 将上一节中UI线程生成了`laytertree`，交给GPU线程的`rasterizer`
- 调用`LayerTree`的`Preroll`、`Paint`2个方法，完成所有`Layer`的绘制前准备以及绘制操作
- 将纹理化的结果，上屏

<!-- more -->

# Layer类型

绘制流程的核心基本都是围绕`Layer`进行操作，所以，首先要搞清楚`Layer`设计的定位是什么，有什么作用，才能更好的理解整段逻辑。下面这张图是native定义的`Layer`类型和结构图。

![](/image/flutter/flutter_layer_struct_native.svg)

大概有这么些个`Layer`,他们都是干什么的呢？我们先看基类`Layer`的说明

> A layer is the lowest-level rendering primitive. It represents an atomic painting command.

直译过来就是: 图层是最低级别的渲染原语,它代表一个原子绘画命令。划重点，__layer代表的是一个绘画命令，而不是字面意义上的绘制图层__

比如以往命令式进行绘制
```
final ui.SceneBuilder sceneBuilder = ui.SceneBuilder()
    //位移操作
    ..pushOffset(centerX, centerY)
    //绘制图像
    ..addPicture(ui.Offset.zero, picture)
```
对应使用`Layer`的写法
```
//创建一个位移命令的layer，对应pushOffset(centerX, centerY)
OffsetLayer offsetLayer = new OffsetLayer(offset: Offset(centerX, centerY));
rootLayer.append(offsetLayer);

//创建一个绘图命令的layer
PictureLayer pictureLayer = new PictureLayer(Rect.zero);
pictureLayer.picture = xxx;
offsetLayer.append(pictureLayer);

rootLayer.addToScene(sceneBuilder);

//这里底层会调用各种layer的方法，达到和上面命令式一样的效果
ui.window.render(sceneBuilder.build());

```
在看一眼layer里面的代码，就更清楚了
```
void ClipPathLayer::Paint(PaintContext& context) const {
  //调用SkCanvas的clipPath方法
  context.internal_nodes_canvas->clipPath(..);
}
```

所以很明显,__flutter把绘制指令分为了几类(Layer)，这些Layer中保存的实际上是对应skia绘制指令的调用__

- 位移操作类
  - TransformLayer
- 透明操作类
  - OpacityLayer
- 阴影、蒙板操作类
  - PhysicalShapeLayer
  - ShaderMaskLayer
- 裁剪操作类
  - ClipPathLayer
- 纹理操作
  - TextureLayer 
- 平台显示相关
  - PlatformViewLayer 


这一部分内容，可以参考[Flutter完整开发实战详解(二十一、 Flutter 画面渲染的全面解析)](https://juejin.im/post/5e7c8419e51d455c706ca00d)这篇文章中，关于layer的阐释，讲的非常清楚

# 流程

ok，明白了layer的作用和定位，我们回过头来，继续看GPU线程的整体工作流程

![](../out/plantuml/flutter_render_piplne3/flutter_render_piplne3.svg)


进入`rasterizer->Draw(pipeline);`

```
//rasterizer.cc
void Rasterizer::Draw(fml::RefPtr<Pipeline<flutter::LayerTree>> pipeline) {  
      //....
      raster_status = DoDraw(std::move(layer_tree));
}

RasterStatus Rasterizer::DoDraw(...) {
    DrawToSurface(*layer_tree);
}
```
跳来跳去，最终最终调用到核心函数`DrawToSurfacea`

```
//rasterizer.cc
RasterStatus Rasterizer::DrawToSurface(flutter::LayerTree& layer_tree) {
  FML_DCHECK(surface_);

  //申请一个frame
  auto frame = surface_->AcquireFrame(layer_tree.frame_size());

  //获取frame上的canvas
  auto root_surface_canvas =
      embedder_root_canvas ? embedder_root_canvas : frame->SkiaCanvas();

  //根据canvas等参数生成compositor_frame对象
  auto compositor_frame = compositor_context_->AcquireFrame(...,root_surface_canvas);

  if (compositor_frame) {
    //使用compositor_frame将layertree纹理化
    RasterStatus raster_status = compositor_frame->Raster(layer_tree, false);
    //上传给gpu
    frame->Submit();
  }
}
```
这个函数是主要的流程函数
- 向surface申请一块frame
- 根据frame上的canvas生成compositor_frame对象
- 使用compositor_frame对layertree进行纹理化操作
- 最终调用`frame->Submit`将纹理化后的数据上屏

## 明确surface_和android_surface_对象类型

首先要明确这个`surface_`是什么，初始化触发点在`NotifyCreated`中

```
//platform_view.cc
void PlatformView::NotifyCreated() {
  //in gpu task
    surface = platform_view->CreateRenderingSurface();
}

//platform_view_android.cc
std::unique_ptr<Surface> PlatformViewAndroid::CreateRenderingSurface() {
  return android_surface_->CreateGPUSurface();
}
```
好了，又蹦出来个`android_surface_`,`android_surface_`对象会在[FlutterEngine启动]()时，随着`PlatformViewAndroid`的初始化而创建

```
//platform_view_android.cc  初始化android_surface_对象

PlatformViewAndroid::PlatformViewAndroid(
      android_surface_(AndroidSurface::Create(...)) {
}
```
跟进去`Create`函数

```
//android_surface.cc
std::unique_ptr<AndroidSurface> AndroidSurface::Create(
    bool use_software_rendering) {
  if (use_software_rendering) {
    auto software_surface = std::make_unique<AndroidSurfaceSoftware>();
    return software_surface->IsValid() ? std::move(software_surface) : nullptr;
  }
#if SHELL_ENABLE_VULKAN
  auto vulkan_surface = std::make_unique<AndroidSurfaceVulkan>();
  return vulkan_surface->IsValid() ? std::move(vulkan_surface) : nullptr;
#else   // SHELL_ENABLE_VULKAN
  auto gl_surface = std::make_unique<AndroidSurfaceGL>();
  return gl_surface->IsOffscreenContextValid() ? std::move(gl_surface)
                                               : nullptr;
#endif  // SHELL_ENABLE_VULKAN
}
```

这里有一堆宏定义，根据不同的宏来确定`AndroidSurface`具体的实现方式

- AndroidSurfaceVulkan 使用Vulkan api方式
- AndroidSurfaceSoftware 软解
- AndroidSurfaceGL  一般真机的默认选择

确定了`android_surface_`的类型，继续看`CreateGPUSurface`方法返回的`surface_`是什么对象

```
//android_surface_gl.cc

std::unique_ptr<Surface> AndroidSurfaceGL::CreateGPUSurface() {
  //上文中的surface_实际上是GPUSurfaceGL对象
  auto surface = std::make_unique<GPUSurfaceGL>(this, true);
  return surface->IsValid() ? std::move(surface) : nullptr;
}
```

ok，到目前为止，我们确定了在android真机环境下`surface_`和`android_surface_`的实际类型

|对象|实际|
|:---|:---|
|surface_|GPUSurfaceGL|
|android_surface_|AndroidSurfaceGL|


## 向surface申请一块frame

进入`GPUSurfaceGL.AcquireFrame`看一下实现
```
//gpu_surface_gl.cc  

std::unique_ptr<SurfaceFrame> GPUSurfaceGL::AcquireFrame(...) {

   sk_sp<SkSurface> surface =
      AcquireRenderSurface(size, root_surface_transformation);

  SurfaceFrame::SubmitCallback submit_callback =
      [...](...) {
        return weak ? weak->PresentSurface(canvas) : false;
      };

  return std::make_unique<SurfaceFrame>(surface, submit_callback);
}

```

实际上生成了一个`SurfaceFrame`对象，并且将创建的2个比较重要的对象挂载在`SurfaceFrame`上
- SkSurface (skia的surface对象)
- SubmitCallback

## 生成compositor_frame对象

```
std::unique_ptr<ScopedFrame> CompositorContext::AcquireFrame(..) {
  return std::make_unique<ScopedFrame>(
      *this, gr_context, canvas, view_embedder, root_surface_transformation,
      instrumentation_enabled, gpu_thread_merger);
}
```
生成了一个ScopedFrame对象，保存了`gr_context`、`canvas`这些对象，不纠结具体实现，继续往下看

## 使用ScopedFrame对layertree进行纹理化操作

```
//compositor_context_.cc

flutter::RasterStatus Raster(flutter::LayerTree& layer_tree,...) {
  //... this是ScopedFrame对象
  layer_tree.Preroll(*this, ignore_raster_cache);
  //...
  layer_tree.Paint(*this, ignore_raster_cache); 
}
```
函数`Raster`的作用主要是调用LayerTree的2个函数`Preroll`和`Paint`来完成纹理化的操作

- Preroll 做一些绘制前的准备工作
- Paint  执行layer的绘制方法（执行不同类别layer中对应的skia绘制指令）

### LayerTree.Preroll
```
void LayerTree::Preroll(CompositorContext::ScopedFrame& frame,
                        bool ignore_raster_cache) {
  //...
  root_layer_->Preroll(&context, frame.root_surface_transformation());
}
```
调用`root_layer_`的Preroll方法，layer类型有很多种.假设这里的root_layer_是`ContainerLayer`

```
void ContainerLayer::Preroll(PrerollContext* context, const SkMatrix& matrix) {
  SkRect child_paint_bounds = SkRect::MakeEmpty();
  //调用子layer的Preroll方法
  PrerollChildren(context, matrix, &child_paint_bounds);
  //设置绘制边界
  set_paint_bounds(child_paint_bounds);
}
```

- 调用子layer的Preroll方法
- 根据返回结果，设置当前layer的绘制比边界

```
void ContainerLayer::PrerollChildren(PrerollContext* context,
                                     const SkMatrix& child_matrix,
                                     SkRect* child_paint_bounds) {
  for (auto& layer : layers_) {
    layer->Preroll(context, child_matrix);
  }
}
```
遍历调用子layer的Preroll方法，假设其中有一个`PictureLayer`，看下具体实现

```
//picture_layer.cc
void PictureLayer::Preroll(PrerollContext* context, const SkMatrix& matrix) {
  SkPicture* sk_picture = picture();

  if (auto* cache = context->raster_cache) {
    SkMatrix ctm = matrix;
    //矩阵Translate操作
    ctm.postTranslate(offset_.x(), offset_.y());
    cache->Prepare(context->gr_context, sk_picture, ctm,
                   context->dst_color_space, is_complex_, will_change_);
  }

  SkRect bounds = sk_picture->cullRect().makeOffset(offset_.x(), offset_.y());
  //设置绘制边界
  set_paint_bounds(bounds);
}
```

### LayerTree.Paint

在`Preroll`后，就会调用到`LayerTree`的`Paint`方法

```
void LayerTree::Paint(CompositorContext::ScopedFrame& frame,
                      bool ignore_raster_cache) const {
  if (root_layer_->needs_painting())
    root_layer_->Paint(context);
}
```

仍然以`PictureLayer`为例，看一下`Paint`方法做了什么

```
void PictureLayer::Paint(PaintContext& context) const {
  //leaf_nodes_canvas实际上是skia的SkCanvas指针
  SkAutoCanvasRestore save(context.leaf_nodes_canvas, true);

  context.leaf_nodes_canvas->translate(offset_.x(), offset_.y());
  context.leaf_nodes_canvas->drawPicture(picture());
}
```
调用SkCanvas的相关接口
- save操作
- translate偏移量操作
- drawPicture，绘制图像内容


## frame提交纹理化后的数据上屏

将`LayerTree`纹理化(raster)后,调用`frame.Submit`进行纹理上传上屏操作

```
bool SurfaceFrame::Submit() 
  submitted_ = PerformSubmit();
  return submitted_;
}

bool SurfaceFrame::PerformSubmit() {
    //submit_callback_ = PresentSurface
  submit_callback_(*this, SkiaCanvas());
}
```

submit_callback_其实是上面`GPUSurfaceGL::AcquireFrame`中生成`SurfaceFrame`时创建的callbak，

```
SurfaceFrame::SubmitCallback submit_callback =[...](...) {
    return weak ? weak->PresentSurface(canvas) : false;
};
```
继续看PresentSurface函数
```
//gpu_surface_gl.cc 
bool GPUSurfaceGL::PresentSurface(SkCanvas* canvas) {
    //将canvas上的数据flush到gpu上 （见SkCanva实现）
    onscreen_surface_->getCanvas()->flush();
    //缓存交换
    if (!delegate_->GLContextPresent()) {
        return false;
    }
    //交换surface对象，下一帧使用
    auto new_onscreen_surface =（...);
    onscreen_surface_ = std::move(new_onscreen_surface);
    return true;
}
```
### flush


//将canvas上的数据flush到gpu上
```
//SkCanvas
void SkCanvas::flush() {
    this->onFlush();
}

void SkCanvas::onFlush() {
    SkBaseDevice* device = this->getDevice();
    if (device) {
        device->flush();
    }
}
```
### GLContextPresent

交换缓存(内存-屏幕 内容)

```
//android_surface_gl.cc
bool AndroidSurfaceGL::GLContextPresent() {
  return onscreen_context_->SwapBuffers();
}

//android_context_gl.cc
bool AndroidContextGL::SwapBuffers() {
  return eglSwapBuffers(environment_->Display(), surface_);
}
```

