---
title: FlutterEngine初始化源码分析以及优化(官方PR)
categories: Flutter
date: 2019-12-15
---

# 核心点

主要分为3个部分

- 启动Engine前的准备(Platform端`Android`)
- Engine的启动(创建DartVM、相关线程、初始化相关配置)
- Engine加载Dart产物，直到执行`main.dart`中的`main`方法

给官方提交了[相关PR给官方](https://github.com/flutter/engine/pull/18047)，支持engine异步初始化

> Engine创建流程不是很合理，底层在做异步任务的时候，主线程会wait阻塞，非常影响体验。

<!-- more -->

- [support engine init async](https://github.com/flutter/engine/pull/18047)
- [adapter Android]()
- [adapter iOS]()

> flutter版本：1.12

 
# 启动流程


```java

//初始化engine
FlutterEngien engine = new FlutterEngine(...);
//加载dart代码
engine.getDartExecutor().executeDartEntrypoint(...);
```

分为2部分

- 初始化engine
- 加载、执行Dart代码

整体流程图如下
![](/image/flutter/engine_init.svg)

初始化的对象大概如下
![](/image/flutter/flutter_startup_struct.svg)

# 初始化engine

```
 /** Fully configurable {@code FlutterEngine} constructor. */
 
 public FlutterEngine(..) {
    
     //第一步: 加载flutter.so、assest下的资源(字体、debug模式的snapshot文件)
    flutterLoader.startInitialization(context.getApplicationContext());
    flutterLoader.ensureInitializationComplete(context, dartVmArgs);

     //第二步: 核心初始化函数，在native创建dartVM、相关线程
    attachToJni();

    this.dartExecutor = new DartExecutor(flutterJNI, context.getAssets());
    this.dartExecutor.onAttachedToJNI();

     //第3步：创建renderer，管理flutter到surface/texuteview 的纹理显示数据，在启动activity后，会和acitvity上的view关联
    this.renderer = new FlutterRenderer(flutterJNI);
    
    //注册各种channnel(键盘、系统事件监听)
    xxxChannel = new xxxChannel();
    
    this.platformViewsController.onAttachedToJNI();

    if (automaticallyRegisterPlugins) {
     //第5步：注册 pubspect.ymal 中依赖的plugin
      registerPlugins();
    }
  }
```


## 1、启动Engine前的准备

- 初始化vsync
- 将assest下flutter的资源copy到私有目录中
- load flutter.so
- 主线程wait等待结果


```
//FlutterLoader.java
startInitialization(){
  //初始化vsync
  VsyncWaiter
    .getInstance((WindowManager)appContext.getSystemService(Context.WINDOW_SERVICE))
    .init();
 
  Callable<InitResult> initTask = new Callable<InitResult>() {   
    //会启动一个asynctask，将assest目录下的flutter资源copy到私有目录
    ResourceExtractor resourceExtractor = initResources(appContext);
    
    System.loadLibrary("flutter");
    
    //等待资源copy完毕
    if (resourceExtractor != null) {
      resourceExtractor.waitForCompletion();
    }
  };
  initResultFuture = Executors.newSingleThreadExecutor().submit(initTask);
}
```

主线程wait, 等待整个流程执行完成

```
flutterLoader.ensureInitializationComplete(...);

```

## 2、启动engine

核心函数`attachToJni()`,辗转调用到`AndroidShellHolder`的构造函数中

```
AndroidShellHolder::AndroidShellHolder(...) {
  //创建3个线程：UI、GPU、IO
    thread_host_ = {thread_label, ThreadHost::Type::UI | ThreadHost::Type::GPU |
                                      ThreadHost::Type::IO};
    //创建callback: platform_view_android
    Shell::CreateCallback<PlatformView> on_create_platform_view = [](..) { 
    platform_view_android = std::make_unique<PlatformViewAndroid>(...);
    );
   
     
    //创建callback: Rasterizer
    Shell::CreateCallback<Rasterizer> on_create_rasterizer = [](Shell& shell) {
      return std::make_unique<Rasterizer>(shell, shell.GetTaskRunners());
    };
    
    //创建callback: IOManager
    fml::TaskRunner::RunNowOrPostTask(io_task_runner,[]() {
       auto io_manager = std::make_unique<ShellIOManager>(...);
        io_manager_promise.set_value(std::move(io_manager));
    });

  //创建engine(内部创建dart、skia环境)
    shell_ =
        Shell::Create(task_runners,             // task runners
                    GetDefaultWindowData(),   // window data
                    settings_,                // settings
                    on_create_platform_view,  // platform view create callback
                    on_create_rasterizer      // rasterizer create callback
        );

    is_valid_ = shell_ != nullptr;
}
```
主要是在初始化flutterengine运行的环境

- 3个线程(UI、GPU、IO)
- 创建3个callback: 用于初始化platform_view_android、Rasterizer、IOManager
- 创建engine

继续往下看



```
//shell.cc
std::unique_ptr<Shell> Shell::Create(){
  //创建DartVm
  auto vm = DartVMRef::Create(settings);
  //创建engine
  return Shell::Create(... , std::move(vm));
}
```
首先，会创建一个DartVM,然后调用`Shell::Create`，内部会调用到函数`CreateShellOnPlatformThread`上

```
std::unique_ptr<Shell> Shell::CreateShellOnPlatformThread(...) {
  //创建shell对象，但是还未初始化完成
  auto shell = std::unique_ptr<Shell>(new Shell(std::move(vm), task_runners, settings));

  //在gpu线程中创建rasterizer，用于将渲染结果，纹理化
  fml::TaskRunner::RunNowOrPostTask(RasterTaskRunner, [..]() {
        std::unique_ptr<Rasterizer> rasterizer(on_create_rasterizer(*shell));
        rasterizer_promise.set_value(std::move(rasterizer));
      });

    //创建platformview对象
  auto platform_view = on_create_platform_view(*shell.get());
    if (!platform_view || !platform_view->GetWeakPtr()) {
      return nullptr;
    }
  //在io线程中创建IOManager，一般是用于图片纹理上传
    fml::TaskRunner::RunNowOrPostTask(io_task_runner,[]() {
        auto io_manager = std::make_unique<ShellIOManager>(...);
        io_manager_promise.set_value(std::move(io_manager));
    });

    std::promise<std::unique_ptr<Engine>> engine_promise;
    auto engine_future = engine_promise.get_future();
    
    //创建native的engine对象
    fml::TaskRunner::RunNowOrPostTask(UITaskRunner(),[...]() mutable {
    //创建animator
    auto animator = std::make_unique<Animator>(*shell, ...));
    //创建engine
        engine_promise.set_value(
          std::make_unique<Engine>(weak_io_future.get(),...)
       )
    );

    //主线程等待io、gpu、io线程的任务都执行完，完成对shell的初始化
    if (!shell->Setup(std::move(platform_view),  //
                    engine_future.get(),       //
                    rasterizer_future.get(),   //
                    io_manager_future.get())   //
    ) {
      return nullptr;
    }
    return shell;
}
```
分为3个部分

- 使用上一步的callback，创建相应的对象
  - 在gpu线程中创建rasterizer
  - 在platform线程中创建platform_view
  - 在io线程中创建IOManager
- UI线程等待其它线程task执行完，开始创建engine
- platform线程wait(future.get)，等待其它线程都执行完，最后执行`shell->Setup`完成shell的初始化

__这里其实设计的不是很好，在Android和iOS上阻塞主线程的代价是非常大的，测试低端机这里大概会有200ms左右的阻塞,已经给官方提了PR改成异步模式__ 

- [support engine init async](https://github.com/flutter/engine/pull/18047)
- [adapter android]()
- [adapter iOS]()

我们接着看Engine的初始化

```
class Engine{
   FontCollection font_collection_;
}

Engine::Engine(...) {
  runtime_controller_ = std::make_unique<RuntimeController>(...);
}
```

- 先初始化engine上的成员`FontCollection`,__这里也是一个比较耗时的地方__
- engine的构造函数中，会去创建RuntimeController


```
RuntimeController::RuntimeController(...){
   
  auto strong_root_isolate = DartIsolate::CreateRootIsolate(...).lock();

  window->DidCreateIsolate();
}
```

RuntimeController中会创建一个DartIsolate

DartIsolate图.jpg


```
std::weak_ptr<DartIsolate> DartIsolate::CreateRootIsolate(...) {

  auto isolate_group_data = std::make_unique<std::shared_ptr<DartIsolateGroupData>>(
      std::shared_ptr<DartIsolateGroupData>(new DartIsolateGroupData(...))
  );

  auto isolate_data = std::make_unique<std::shared_ptr<DartIsolate>>(
      std::shared_ptr<DartIsolate>(new DartIsolate(...))
  );

  Dart_Isolate vm_isolate = CreateDartIsolateGroup(...);

  std::shared_ptr<DartIsolate>* root_isolate_data =
      static_cast<std::shared_ptr<DartIsolate>*>(Dart_IsolateData(vm_isolate));

  (*root_isolate_data)->SetWindow(std::move(window));

  return (*root_isolate_data)->GetWeakIsolatePtr();
}

```

在执行完后，`shel->DartVM->engine->runtimecontroller->DartIsolate`的创建。回到`CreateShellOnPlatformThread`方法中

```
fml::TaskRunner::RunNowOrPostTask(UITaskRunner(),[...]() mutable {
    //创建完shell后，通知platfrom线程
    engine_promise.set_value(
       std::make_unique<Engine>(weak_io_future.get(),...)
    )
);

//platfrom线程线程等待io、gpu、io线程的任务都执行完，完成对shell的初始化
shell->Setup( ... , engine_future.get())
                    
```
`shell->Setup`其实就是将上述执创建的engine、platform\_view、rasterizer、io\_manager等等挂到shell的成员变量上.


至此，native环境创建完毕,回到创建AndroidShellHolder的JNI函数`attachjni`入口

```
//platform_view_android_jni.cc
static jlong AttachJNI(...) {
  auto shell_holder = std::make_unique<AndroidShellHolder>(...);
  //返回AndroidShellHolder的指针
  return reinterpret_cast<jlong>(shell_holder.release());
}

//FlutterJNI.java
public void attachToNative(boolean isBackgroundView) {
  //持有AndroidShellHolder的指针
    nativePlatformViewId = nativeAttach(this, isBackgroundView);
}
```

FlutterJNI持有了AndroidshellHolder的指针，AndroidShellHolder持有了底层整个环境的变量(engine、shell、DartVm、DartIsolaate)

## 3、初始化变量

在`attachToJni`执行完后，会在平台层（Android）继续初始化上层需要的变量

```
//FlutterEngine.java
attachToJni()

//初始化DartExecutor，用于后面加载、执行dart产物
this.dartExecutor = new DartExecutor(flutterJNI, context.getAssets());
this.dartExecutor.onAttachedToJNI();

//创建renderer，管理flutter到surface/texuteview 的纹理显示数据，在启动activity后，会和acitvity上的view关联
this.renderer = new FlutterRenderer(flutterJNI);
    
//注册各种channnel(键盘、系统事件监听)
xxxChannel = new xxxChannel();

//注册 pubspect.ymal 中依赖的plugin
if (automaticallyRegisterPlugins) {
   registerPlugins();
}

```
这里主要是在初始化上层的一些环境

- DartExecutor：用于后面加载、执行dart产物
- FlutterRenderer：管理flutter到surface/texuteview 的纹理显示数据，在启动activity后，会和acitvity上的view关联
- xxxChannel：各种flutter和native通信能力，比如监听系统事件的、activity切换声明周期等等
- registerPlugins: 注册注册`pubspect.ymal`中依赖的plugin


```
private void registerPlugins() {
  Class<?> generatedPluginRegistrant =
          Class.forName("io.flutter.plugins.GeneratedPluginRegistrant");
  Method registrationMethod =
          generatedPluginRegistrant.getDeclaredMethod("registerWith", FlutterEngine.class);
    registrationMethod.invoke(null, this);
}
```
反射调用GeneratedPluginRegistrant类，注册`pubspect.ymal`中声明的插件



# 加载执行Dart代码

接着看engine初始化完后，加载执行dart代码的流程

```
engine.getDartExecutor().executeDartEntrypoint(...);

//DartExecutor.java
executeEntryPoint(...){
  flutterJNI.runBundleAndSnapshotFromLibrary(...);
}
```

经过一系列跳转，最终会执行到`DartIsolate`的`Run `函数

```

bool DartIsolate::Run(const std::string& entrypoint_name,
                      const std::vector<std::string>& args,
                      const fml::closure& on_run) {

  //entrypoint_name为"main"，指Dart代码的入口函数
  //在dart产物上，寻找key为"main"(entrypoint_name)的入口函数
  auto user_entrypoint_function =
      Dart_GetField(Dart_RootLibrary(), tonic::ToDart(entrypoint_name.c_str()));

  auto entrypoint_args = tonic::ToDart(args);

  //执行main.dart函数中的main()方法
  if (!InvokeMainEntrypoint(user_entrypoint_function, entrypoint_args)) {
    return false;
  }
  return true;
}
```

# 最后

__至此，flutter初始化完毕__

- 可以正常执行dart代码
- 进行渲染(startActivity后)
