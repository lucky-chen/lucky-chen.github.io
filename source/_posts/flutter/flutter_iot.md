---
title: Flutter移植嵌入式linux设备、IOT方向探索
categories: Flutter
date: 2022-7-15
---


# 背景

iot有着很广阔的场景: [艾瑞咨询-积基“数”本、重塑产业：中国物联网行业研究报告-220129](https://pdf.dfcfw.com/pdf/H3_AP202202071545436398_1.pdf). 智慧城市、车联网、智慧零售、智能家居、智能工厂. 

 <!-- more -->

![](/image/flutter_iot/iot_bussness.PNG)


- 自动售货机
- 政府政务办理机器
- 医院挂号、缴费、检查报告机 (浙一)
- 车载“科技感”大联屏

越来越方便、随处可见、智能化的设备, 它们的技术方案是什么?
flutter这种技术方案,是否能运用在这些场景之中?

Flutter目前在PC、移动端和web领域站稳跟脚,稳步发展,但是在iot领域, 存在感还不太强. 
![](/image/flutter_iot/flutter_tech.svg)


# IOT场景调研

## 行业case

- Toyota 车载屏幕
  - 技术方案
    - before: 嵌入式linux
    - 船新版本: Custom Flutter Engine Embedders
    - [Flutter Showcase | Toyota](https://flutter.dev/showcase/toyota)
  - 收益
    - 性能
    - ui动效体验
    - 开发体验
- 梅赛德斯奔驰超联屏
  - QT
- 医疗
  - [QT](https://www.qt.io/zh-cn/qt-in-medical)

## 小结:嵌入式/iot UI框架技术方案

- 嵌入式linux + QT        (传统开发出身)
- 性能好点的跑Android (移动互联出身)
- 其它 : 天猫精灵 (js 世界) 

# Flutter IOT方向探索

- 前期技术探索阶段
- 打卡机实现阶段

![](/image/flutter_iot/flutter_iot_explore.jpg)

## 技术探索阶段

- Flutter on Android 
- Flutter on Linux :
  - PC 
  - 嵌入式

### Linux图形栈

嵌入式和pc在图形栈是什么样子的, 后期如何选择合适的方案?
flutter-gtk
![](/image/flutter_iot/flutter_gtk.png)
linux_graphic

![](/image/flutter_iot/linux_graphic_stack.png)


- GTK: Unix-like系統下开发图形界面的应用程序的主流开发工具之一
- 显示服务器(Display Server):
  - X11 : 1984年由MIT研发,历史悠久. Server/Client模型,但是由于通信效率、以及老旧设计问题,逐渐被wayland替代  X Window的前生今世
  - Wayland:  揭开Wayland的面纱 Compositor/Client模型。(现代化渲染模型),
gtk4将显示后端由x11迁移到wayland,gtk5考虑放弃支持x11
- xxGl : opengl库
- Drm: DRM subsystem in Linux直接渲染管理器。
- Framebuffer: fbdev 的 API ，用于管理显卡的 framebuffer (LCD屏幕显示内存映射)
- Evdev: 管理输入设备:鼠标、键盘、触摸屏, 一般通过libinput库监听各种设备转化后的标准事件.

#### X Window System

X是规范,不是具体的某个软件, 现在大部分的 distribution使用的X都是由 Xorg 基金会所提供的 X11 软件 . 不是UNIX或Linux内核的一部分，而是用户态的软件组件，用户在系统上可以选择启用或禁用X。
- [X Window System介绍](https://wizardforcel.gitbooks.io/vbird-linux-basic-4e/content/202.html)
- [Linux 图形界面的显示原理是什么](https://www.zhihu.com/question/321725817)

X11采用了client/server的架构，整个图形视窗系统主要分为3个部分： 
- `XClient`（X客户端）。X Client也叫X应用程序，负责实现程序逻辑，在收到设备事件后计算出绘图数据，由于本身没有绘制能力，只能向`XServer`发送绘制请求和绘图，告诉X Server在哪里绘制一个什么样的图形。X Client可以和X Server在同一个主机上，也可以通过TCP/IP网络连接。 (Xlib及其替代者XCB)
- `XServer`（X服务器）。X Server一方面负责和设备驱动交互，监听显示器和键盘鼠标，另一方面响应`XClient`需求传递键盘、鼠标事件、（通过设备驱动）绘制图形文字等。
- Compositor:(合成器)或者叫Window Manager。多个X Client程序并不知道彼此的存在，需要一个管理者统一协调，即Window Manager，它掌管各X Client的Window（窗口）视觉外观，如形状、排列、移动、重叠渲染等. Window Manager并非X Server的一部分，而是一个特殊的X Client程序。(`Metacity、Mutter、KWin、 vtwm、Xfwm、Compiz`)

```c++
   XDrawLine(display_, x_window_, x_gc_, 0, 0, 50, 50);
```
![](/image/flutter_iot/x_11.png)

- 优点:
  - 模块化设计, X Client和X Server相互独立，并不需要了解彼此所处的硬件、软件环境。
  - 90年代初期，gpu还没普及, “X终端机（X terminal）”，专门部署X Server，将远端UNIX主机上的图形界面程序显示出来，这也正是MIT研发X的初衷之一。
- 缺点:
  - 频繁的通信, ui太浪费性能
  - Xorg大管家管事太多，除了管理input，所有的绘图请求、窗口管理、窗口合成都必须要与Xorg进行交互，导致Xorg上存在性能瓶颈。根源还在于Xorg的架构太复杂。

![](/image/flutter_iot/x11_demo.png)

#### Wayland

Wayland是一个新的图形窗口系统方案，一套旨在取代X的新规范。与X最大的不同是，Wayland将X中的Server和窗口管理器整合到一起作为服务端，称为合成器（Compositor），架构上只分了客户端和合成器两大部件.
> 2008年，红帽公司（RedHat）的开发者Kristian Høgsberg利用业余时间搞起了Wayland项目，2010年Wayland加入了http://Freedesktop.org项目

- 客户端（Wayland Client），直接计算各自界面的渲染缓冲数据，客户端程序需要和渲染库（如OpenGL）链接。 
- 合成器（Wayland Compositor），汇总所有客户端的渲染数据，实现各界面窗口“合成”，最后交给显示驱动绘图。 Wayland项目提供了两套底层库libwayland-server和libwayland-client，简化图形程序开发，还给了一个Compositor参考实现——Weston。
![](/image/flutter_iot/wayland.png)

#### DRM

DRM 的诞生就是用来处理多个程序对 Video Card 资源的协同使用问题。DRM 获得对 Video Card 的独占访问权限，它负责初始化和维护命令队列、Video RAM 以及其他相关的硬件资源，要使用 GPU 的程序将请求发送给 DRM，由 DRM 作为仲裁来避免冲突。

![](/image/flutter_iot/drm.png)

#### FrameBuffer

https://en.wikipedia.org/wiki/Linux_framebuffer

Linux抽象出FrameBuffer这个设备来供用户态进程实现直接写屏, 可以看成是显示内存的一个映像，将其映射到进程地址空间之后，就可以直接进行读写操作，而写操作可以立即反应在屏幕上。这种操作是抽象的，统一的，用户不必关心物理显存的位置、换页机制等等具体细节，这些都是由Framebuffer设备驱动来完成的，

![](/image/flutter_iot/frame_buffer.png)

到此,对linux底层图形栈有了全面的了解.

### Custom Flutter 移植

官方实现了对linux(gtk)的支持,像ubuntu这类pc系统可以正常run起来. 但是对嵌入式Linux的支持不成熟，ui渲染、库支持、交叉编译工具链、包体积、内存等需要修改定制，sony在官方api的基础上,开源了一个项目,支持flutter 嵌入式.
- 官方定制说明 [Custom Flutter Engine Embedders](https://github.com/flutter/flutter/wiki/Custom-Flutter-Engine-Embedders) 
- sony开源项目[flutter-embedded-linux](https://github.com/sony/flutter-embedded-linux)

#### Flutter架构

![](/image/flutter_iot/flutter_platform_specific.png)

平台无关: 跨平台
- dart业务代码
- Flutter framework(Dart)
- Flutter engine 
- DartVM
- 渲染

[embedders接口](https://github.com/flutter/engine/blob/main/shell/platform/embedder/embedder.h)

```c++
typedef struct {
  //启动、销毁、初始化
  FlutterEngineRunFnPtr Run;
  FlutterEngineShutdownFnPtr Shutdown;
  FlutterEngineInitializeFnPtr Initialize;
  //平台发送event事件给flutter
  FlutterEngineSendPointerEventFnPtr SendPointerEvent;
  FlutterEngineSendKeyEventFnPtr SendKeyEvent;
  //PlatformMessage
  FlutterEngineSendPlatformMessageFnPtr SendPlatformMessage;
  FlutterEnginePlatformMessageCreateResponseHandleFnPtr
  //外接纹理
  FlutterEngineRegisterExternalTextureFnPtr RegisterExternalTexture;
  //task
  FlutterEnginePostRenderThreadTaskFnPtr PostRenderThreadTask;
  //...
} FlutterEngineProcTable;
```

特定平台代码 (移植工作)
- 渲染支持 (显示后端)
- Event (输入设备事件)
- 扩展能力(Plugin、外接纹理)
- 生命周期管理(engine/window/view)

#### Sony开源项目

![](/image/flutter_iot/flutter_embeder_elinux.png)

- lifecycle

```c++
FlutterELinuxEngine::RunWithEntrypoint(...){
    embedder_api_.Run(&renderer_config, ...);
}

bool FlutterELinuxEngine::Stop() {
     embedder_api_.Shutdown(engine_);
}
```
- event

```c++
void FlutterELinuxEngine::SendPointerEvent(...) {
   embedder_api_.SendPointerEvent(engine_, &event, 1);
}
```

- plugin/Texture

```c++
bool FlutterELinuxEngine::SendPlatformMessage(){
    embedder_api_.PlatformMessageCreateResponseHandle(...);
}

bool FlutterELinuxEngine::RegisterExternalTexture(int64_t texture_id) {
  embedder_api_.RegisterExternalTexture(engine_, texture_id);
}
```

- render

```c++
FlutterELinuxEngine::RunWithEntrypoint(...){
    auto renderer_config = GetRendererConfig();
    embedder_api_.Run(&renderer_config, ...);
}
```

1. 完成对flutter实例的管理, 启动销毁、渲染更新、事件发送、平台插件能力提供.
2. 在具体渲染上屏的时候，选择对应的display backend(wayland、x11、gbm、egl)
  产物

![](/image/flutter_iot/flutter_elinux_artifics.png)

## 技术实现

- 技术需求:
  -  flutter嵌入式linux支持
- 业务场景:嵌入式linux
  - 软件开发技术诉求
    - 当前qt方案, 大量c++代码(驱动、视频库), 未来可能切换到Android设备
    - 希望一套代码跨端(ui+逻辑)
  - 硬件孱弱, 运行性能要求
    - 4核 or 1核
    - 512m内存
    - 没有gpu
- 问题
  - 开发版型号未定,硬件性能不确定
  - 不确定是哪种渲染方式 Gtk ? x11 ? wayland? 
  - 确定没有gpu, 必须实现软解方案

### 第一步 mock环境,预先获得数据

#### 摸清楚当前硬解方案的性能x11 wayland  drm

硬件:
- 树莓派2w 
- 480x640
数据:

|       |fps    |内存       |cpu (core 4)   |
|:---   |:---   |:--        |:--    |
|x11    |30     |flutter-45% xorg-5%|300%   |
|wayland|:---   |35.1%      |5%   |
|drm    |50-60  |:--        |:--            |


- x11数据太差
- wayland数据像是bug( 可能是使用姿势问题)
- drm数据超出预期
x11/wayland 是多app窗口形式, drm是独占屏幕模式

#### 适配x11和wayland 软解的成本

skia自身支持软解, 去熟悉flutter、elinux-flutter、以及图形api(x11/wayland), 写代码串联run起来.
![](/image/flutter_iot/flutter_elinx_soft_render.svg)

- FLUTTER 源码,flutter通过skia 软解获取纹理数据

```c++
/skia申请bacbuffer
sk_sp<SkSurface> EmbedderSurfaceSoftware::AcquireBackingStore(){
  SkImageInfo info =SkImageInfo::Make(...);
  sk_surface_ = SkSurface::MakeRaster(info, nullptr);
}

bool EmbedderSurfaceSoftware::PresentBackingStore(){
    //消费buffer 纹理数据
    backing_store->peekPixels(&pixmap)
    //通过embderapi透传出去
    software_dispatch_table_.software_present_backing_store(
      pixmap.addr(),      //
      pixmap.rowBytes(),  //
      pixmap.height()     //
  );
}
```

- elinux-flutter调用embderapi, 注册渲染数据回调

```c++
//软件解码,传过来skia解码后的bitmap
FlutterRendererConfig GetSoftwareRendererConfig(){
  FlutterRendererConfig config = {};
  config.type = kSoftware;
  config.software.surface_present_callback = [](...) {
    host->view()->PresentSoftwareBitmap(allocation,row_bytes,height);
  };
  return config;
}

//通过xlib上屏纹理数据 (wayland类似)
bool ELinuxWindowX11::OnBitmapSurfaceUpdated(...){
  //...
  auto img = XCreateImage(display_,x_visual_,deps,ZPixmap,0,data,width,height,32,0);
  XPutImage(display_,x_window_,x_gc_,img,0,0,0,0,width,height);
}



//硬件解码,走opengl
FlutterRendererConfig GetRendererConfig() {
    FlutterRendererConfig config = {};
    config.type = kOpenGL;
    config.open_gl.make_current =  [](...) -> bool {
        return host->view()->MakeCurrent();
    }
}

typedef struct {
  size_t struct_size;
  BoolCallback make_current;
  BoolCallback clear_current;
  BoolCallback present;
  UIntCallback fbo_callback;
  BoolCallback make_resource_current;
  bool fbo_reset_after_present;
  TransformationCallback surface_transformation;
  ProcResolver gl_proc_resolver;
  TextureFrameCallback gl_external_texture_frame_callback;
  UIntFrameInfoCallback fbo_with_frame_info_callback;
} FlutterOpenGLRendererConfig;

```
实现了x11/wayland下的软件解码成本不大, 但是最终没有采用这个方式

- 在实现X11和wayland的软件解码的同时,同时验证的硬件解码的性能数据不太理想: x11 fps 20左右, wayland卡成ppt
- 沟通了合作方的技术方案
  - app是全屏独占模式,x11和wayland是窗口模式
  - 走的是定制化framebuffer, 不走x11 or wayland 
- 继续研究fb下的实现



### 第二步 正式开发FB

根据业务的硬件和软件情况: 没有GPU,定制显示到framebuffer上. 确定做flutter在嵌入式上直接显示到framebuffer的方案

![](/image/flutter_iot/flutter_embeder_linux_softrender.png)

- 渲染framebuffer
- 事件-evdev

#### Framebuffer开发介绍

![](/image/flutter_iot/elinux_embedding_for_flutter.png)

- 红色为Flutter-elinux运行时扩展framebuffer的核心链路代码
- 蓝色是和flutter embder交互的接口
- 橘色为使用linux本地能力的代码 (渲染+event)

![](/image/flutter_iot/flutter_elunx_fb_flow.svg)

- 创建对应渲染后端对应的窗口

```c++
 std::unique_ptr<flutter::WindowBindingHandler> window_wrapper =

#if defined(DISPLAY_BACKEND_TYPE_DRM_GBM)
      std::make_unique<flutter::ELinuxWindowDrm<flutter::NativeWindowDrmGbm>>(
          view_properties);
          
#elif defined(DISPLAY_BACKEND_TYPE_DRM_EGLSTREAM)
      std::make_unique<
          flutter::ELinuxWindowDrm<flutter::NativeWindowDrmEglstream>>(
          view_properties);
          
#elif defined(DISPLAY_BACKEND_TYPE_X11)
      std::make_unique<flutter::ELinuxWindowX11>(view_properties);
      
#elif defined(DISPLAY_BACKEND_TYPE_WAYLAND)
      std::make_unique<flutter::ELinuxWindowWayland>(view_properties);
      
#elif defined(DISPLAY_BACKEND_TYPE_FRAME_BUFFER)
      std::make_unique<flutter::ELinuxWindowFrameBuffer>(view_properties);
#endif

```

- 核心逻辑

```c++
NativeWindowFrameBuffer::NativeWindowFrameBuffer(...) {
    //打开fb设备文件
    m_fbfd_ = open("/dev/fb0", O_RDWR);
    //获取fb屏幕信息
    ioctl(m_fbfd_, FBIOGET_VSCREENINFO, &m_vinfo_);
    //映射内存
    fb_base = (unsigned char*)mmap(0, screen_size * 2, PROT_READ | PROT_WRITE,
                                   MAP_SHARED, m_fbfd_, 0); 
    //获取支持的lcd格式: rgba8888...                               
     rgb = findFormat();
    //设置tty为KD_GRAPHICS模式,防止终端刷新,导致画面闪烁
    openDev()                                                                                         
}

//软解纹理数据更新
bool NativeWindowFrameBuffer::OnBitmapSurfaceUpdated(...){
    //...
    lcd_draw(fb_base,data);
}

//事件处理 监听linux的libinput库
int ELinuxWindowFrameBuffer::OninputEvent(...) {
  switch (event_type) {
      case LIBINPUT_EVENT_KEYBOARD_KEY:
       //转换event后,通过embederapi发给flutter
        OnKeyEvent(event);
        break;
      case LIBINPUT_EVENT_TOUCH_DOWN:
        OnTouchDown(event); 
        break;
      default:
        break;
  }
```

##### 问题1  处理纹理数据到framebuffer时间过长 

OnBitmapSurfaceUpdated 函数耗时过长, 40-50ms左右 1000/50 = 20 fps?
```c++
bool NativeWindowFrameBuffer::OnBitmapSurfaceUpdated(...){
    //START
    for (x = 0; x < m_vinfo_.xres; x++){
        for (y = 0; y < m_vinfo_.yres; y++){
          //rgba8888->rgb565
          lcd_put_pixel(fb_base, x, y, allocation);
        }
    }
    //END
}
```
- 纹理数据的像素格式转换为fb驱动支持的格式: rgba8888->rgb565
- cpu浪费: 
  - flutter调用skia时, 软解默认写死是rgba8888格式,lcd 不一定需要这么高规格: rgb565, skia调用cpu绘制、纹理化数据的操作,浪费性能
  - Framebuffer 消费 数据时,额外对每个像素做一次格式降级,cpu浪费+1. rgba8888->rgb565
- 内存浪费
  - rgb565(16位),rgba8888 32位. 2倍内存

解决方法: 
  - 预先获得格式,让skia按传入格式处理, 
  - framebuffer消费时直接memcpy就完了

![](/image/flutter_iot/skia_rgba.png)

- cp纹理数据到buffer

```c++
 bool NativeWindowFrameBuffer::OnBitmapSurfaceUpdated(..data){
   //... check
   memcpy(fb_base_void, data, sizeof(char) * m_vinfo_.xres * m_vinfo_.yres * 2);
 }
```

- framebuffer消费数据耗时 50ms->4.1ms
- 纹理内存减半 pixmap_data_size : 4m -> 2m

![](/image/flutter_iot/memory_rgba.png)

#### 问题2: 画面撕裂

- 上半部分苹果,下半部分香蕉

![](/image/flutter_iot/dislplay_apple_banana.png)

- 单缓冲 (1080p屏幕比较明显)

![](/image/flutter_iot/display_single_buffer.gif)

- 双缓冲

```c++
void NativeWindowFrameBuffer::SwapBuffers() {
   //切换buffer
   m_vinfo_.yoffset = m_buffer_index_ * m_vinfo_.yres;
   //显示buffer内容
   ioctl(m_fbfd_, FBIOPAN_DISPLAY, &m_vinfo_);
   m_buffer_index_ = (m_buffer_index_ + 1) % 2;
   m_backbuffer = m_framebuffer + m_buffer_index_ * m_page_size_;
   //vsync
   ioctl(m_fbfd_, FBIO_WAITFORVSYNC, &dummy);
}
```

前台buffer展示, 后台buffer写数据. 轮流切换

![](/image/flutter_iot/display_double_buffer.png)

- 三缓冲: Android  4.1黄油计划(Project Butter)

目前实现到双缓冲,3缓冲还未支持 [Android显示系统之——多缓冲和Vsync](https://github.com/huanzhiyazi/articles/issues/28)

- cpu等待一个vsync(16ms),浪费

![](/image/flutter_iot/display_jank_double_buffer.png)

- 没有什么是buffer解决不了的,如果不够,那就再加1个!

![](/image/flutter_iot/display_jank_three_buffer.png)

### 数据汇总


|树莓派数据| CPU占用%|内存占用%(512)|fps|
|:--|:--|:--|:--|
|静止|99.77|7.94||
|滑动|126||50-60, 转场20-30|



# 总结

## 目前方案情况
- Core : 核心链路功能完善, 需要做性能优化
- Cli:      将arm64交叉编译构建能力合入
- Deps: 空白. 相关嵌入式上的生态能力补充. widgets、plugin、动态化

![](/image/flutter_iot/flutter_elinux_plan.svg)

在扩展flutter-elinux项目后, 目前flutter针对复杂的linux终端设备类型, 不管从硬件类型还是软件方案,基本可以做到全覆盖:
- 官方:  linux pc发行版完全体  gtk
- 嵌入式: 
  - 硬解 opengl && 软解skia
  - 显示后端: 
    - 轻量版 :        窗口模式.        x11、wayland 
    - 究极精简版:  全屏独占模式 DRM、Framebuffer

## 场景探索


也就是说,从技术上来说, iot、嵌入式设备上gui方案, flutter在技术上是完全支持,不存在技术障碍,有场景基本可以拎包就上.
和QT目前的状态有点相似, QT作为老牌方案,目前应用已经非常广泛, 见官方宣传图,涉及多个领域和设备类型. 
[图片]
既然QT能做,能力相似的Flutter也能做. 并且相比于QT,Fluter有着天然的跨端能力(一套dart代码跨n个端), 更简单的开发语言(dart vs c++), 这是QT无法比拟的. Flutter Linux 调研 
类似领域/场景,Why Not Try Flutter?