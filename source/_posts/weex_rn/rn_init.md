---
title: ReactNative源码-启动过程
categories: WEEX/RN
date: 2016-09-21
---


# 概述
就像大多数框架一样,ReactNative(简称RN)启动需要初始化依赖的环境和资源,抛开繁复的细节,概括为以下几点:

1.  初始化通信接口表,表中保存 _java_ 端和 _js_ 端的接口信息。
2.  初始化ReactBridge,作为 _js_ 和 _java_ 通信的桥梁，在 _java_ 端开启两个线程 _native\_modules_ 和 _js_ ,加上 _ui_ 线程，总共三个线程。
3.  加载JSbundle文件

<!-- more -->

## 流程图
画了个流程图，如下

![rn_start_01.svg-325.3kB][1]


## 几个重要类

在开始之前,先看几个重要的类,有个印象,后面看起来会轻松很多。

|class|作用|
|:-|:-|
|ReactInstanceManager|1.创建ReactContext，CatalystInstance等类 <br> 2. 解析package生成注册表 <br> 3. 配合ReactRootView管理View的创建，生命周期等功能 <br> 4. __默认实现类为__ ``ReactInstanceManagerImpl`` |
|ReactContext|RN程序自己的上下文,里面有CatalystInstance实例，可以去获得Java和JS的module。|
|ReactRootView|RN程序的根视图，Rn的入口|
|CatalystInstance|保存有js和java端的接口,内部通过ReactBridge进行通信,进行方法调用|
|ReactBridge|和jni进行通信|
|NativeModuleRegistry|Java接口的注册表|
|JavascriptModuleRegistry|JS接口的注册表|
|CoreModulePackage|提供RN核心的Java接口和js接口|
|MainReactPackage|RN帮我们封装的类,提供一些额外的Java接口和js接口，用来加载自己的接口|
|JsBundleLoader|故名思议，用于加载打包成bundle的js代码|


## 步骤分析
### step_１
按照官方的示例,入口调用为 __reactRootView.startReactApplication(...)__ ,看看这句代码干了什么
```java
//ReactRootViewRoot
public void startReactApplication(ReactInstanceManager mReactInstanceManager,String moduleName, Bundle launchOptions) {
    //...
    //初始化Rn环境
    mReactInstanceManager.createReactContextInBackground();
    //初始化UI,由于各种状态判定，第一次启动时，这句话不会执行
    //mReactInstanceManager.attachMeasuredRootView(this);
}
```

mReactInstanceManager 的类型为 ReactInstanceManager，这是一个抽象类，真正的实现类是 ReactInstanceManagerImpl
### step_2

接着看 ReactInstanceManagerImpl 的 createReactContextInBackground方法：
```
public void createReactContextInBackground() {
    mHasStartedCreatingInitialContext = true;
    recreateReactContextInBackgroundInner();
}
```
recreateReactContextInBackgroundInner会继续往下进行方法调用，忽略dev模式代码以及异常判断，最终会调用到 recreateReactContextInBackgroundFromBundleFile，
```java
private void recreateReactContextInBackgroundFromBundleFile() {
    recreateReactContextInBackground(
        new JSCJavaScriptExecutor.Factory(),
        JSBundleLoader.createFileLoader(mApplicationContext, mJSBundleFile));
}
```
这个函数创建了两个对象 
1.JSBundleLoader 提供jsBundle文件的路径,
2. 创建一个JavaScriptExecutor.Factory对象,用于初始化js端环境

### step_3
recreateReactContextInBackground 函数干了两件事
1. 创建一个ReactContextInitParams对象，包含之前创建的jsExecutorFactory, jsBundleLoader两个对象
2. 将initParams传给ReactContextInitAsyncTask，启动asyncTask,开始初始化Rn所需要的资源,

跳过step\_4 -- step\_5

### step_6
AsyncTask... 这是一道送分题啊同学们,瞅瞅干了啥
```
protected Result<ReactApplicationContext> doInBackground(ReactContextInitParams... params) {
    JavaScriptExecutor jsExecutor =params[0].getJsExecutorFactory().create(
                mJSCConfig == null ? new WritableNativeMap() :mJSCConfig.getConfigMap());
    return Result.of(createReactContext(jsExecutor, params[0].getJsBundleLoader()));
}
```
1.  回调之前创建的getJsExecutorFactory.create方法，传入初始化参数(默认为 null )，初始化native
2.  执行核心初始化函数 createReactContext<br>

### step_7 核心初始化函数

这步很重要，基本上80%的初始化都在这里，大概分为四部分：
1. 加载java和js的接口接口。
2. 初始化通信表
3. 初始化RN 环境
4. 加载bundle文件

``` java
private ReactApplicationContext createReactContext(JavaScriptExecutor jsExecutor,JSBundleLoader jsBundleLoader) {
    mSourceUrl = jsBundleLoader.getSourceUrl();
    NativeModuleRegistry.Builder nativeRegistryBuilder = new NativeModuleRegistry.Builder();
    avaScriptModulesConfig.Builder jsModulesBuilder = new JavaScriptModulesConfig.Builder();
    ReactApplicationContext reactContext = new ReactApplicationContext(mApplicationContext);
    CoreModulesPackage coreModulesPackage =new CoreModulesPackage(this, mBackBtnHandler, mUIImplementationProvider);
    //1. 加载java和js接口
    processPackage(coreModulesPackage, reactContext, nativeRegistryBuilder, jsModulesBuilder);
    for (ReactPackage reactPackage : mPackages) {
        processPackage(reactPackage, reactContext, nativeRegistryBuilder, jsModulesBuilder);
    }
    NativeModuleRegistry nativeModuleRegistry = nativeRegistryBuilder.build();
    JavaScriptModulesConfig javaScriptModulesConfig=jsModulesBuilder.build();

    NativeModuleCallExceptionHandler exceptionHandler = 
mNativeModuleCallExceptionHandler != null? mNativeModuleCallExceptionHandler:mDevSupportManager;
    //2 初始化配置
    CatalystInstanceImpl.Builder catalystInstanceBuilder = new CatalystInstanceImpl.Builder()
        .setReactQueueConfigurationSpec(ReactQueueConfigurationSpec.createDefault())
        .setJSExecutor(jsExecutor)
            .setRegistry(nativeModuleRegistry)
            .setJSModulesConfig(javaScriptModulesConfig)
            .setJSBundleLoader(jsBundleLoader)
            .setNativeModuleCallExceptionHandler(exceptionHandler);
    CatalystInstance catalystInstance= catalystInstanceBuilder.build();
    //3 初始化RN 环境
    reactContext.initializeWithInstance(catalystInstance);
    //4 加载bundle文件
    catalystInstance.runJSBundle();
    return reactContext;
}
```

在第8行和第10行分别调用了processPackage方法,唯一的区别是传入的第二个参数不同。参数的类型是ReactPackager,这是一个接口类，用于提供js和java接口。

```
//ReactPackage.java
public interface ReactPackage {

  /**
   * 返回java端暴露给js的接口集合
   */
  List<NativeModule> createNativeModules(ReactApplicationContext reactContext);
  
  /**
   * @return 返回js端暴露给JAVA端的接口集合
   */
  List<Class<? extends JavaScriptModule>> createJSModules();

  /**
   * @return 返回给js端native封装的view集合
   */
  List<ViewManager> createViewManagers(ReactApplicationContext reactContext);
}
```
&#160; &#160; &#160; &#160;接着看processPackage方法，两次调用分别传入了 coreModulesPackage 对象和 reactPackage对象，coreModules提供RN必须的一些通信接口如UIManagerModule和RCTEventEmitter等等,而reactPackage在ReactRootView.startReactApplication()则是我们自己定义的类对象，加载自定义的接口。RN的样例代码中为我们封装了一个类MainReactPackage，加载DialogModule、IntentModule、ReactVirtualTextViewManager等等。
&#160; &#160; &#160; &#160;回头继续看processPackage方法实现，也很简单，就是提取ReactPackager中提供的java和js接口并保存在对应的对象中
```
private void processPackage(ReactPackage reactPackage, ReactApplicationContext reactContext,
                        NativeModuleRegistry.Builder nativeRegistryBuilder,
                        JavaScriptModulesConfig.Builder jsModulesBuilder) {
    for (NativeModule nativeModule : reactPackage.createNativeModules(reactContext)) {
        nativeRegistryBuilder.add(nativeModule);
    }
    for (Class<? extends JavaScriptModule> jsModuleClass : reactPackage.createJSModules()) {
        jsModulesBuilder.add(jsModuleClass);
    }
}
```
数据准备好之后， 会调用 _nativeRegistryBuilder.build()_ 和 _jsModulesBuilder.build()_ 构造对象,以nativeRegistryBuilder为例：
```
 public NativeModuleRegistry build() {
        List<ModuleDefinition> moduleTable = new ArrayList<>();
        Map<Class<? extends NativeModule>, NativeModule> moduleInstances = new HashMap<>();
        int idx = 0;
        for (NativeModule module : mModules.values()) {
            ModuleDefinition moduleDef = new ModuleDefinition(idx++, module.getName(), module);
            moduleTable.add(moduleDef);
            moduleInstances.put(module.getClass(), module);
        }
    return new NativeModuleRegistry(moduleTable, moduleInstances);
}
```
代码逻辑很清晰，就是构造一张java接口表，表中保存java的modelId,mode名称，以及model的引用。举个栗子:

|id|modelName|model|
|:-|:-|:-|
|1|DialogManagerAndroid|DialogModule|
|2|IntentAndroid|IntentModule|

加载完接口之后，去干第二件事，初始化通信环境。这一步做了几件事：
1. 实例化CatalystInstanceImpl， 存储java和js接口
2. 实例化jni通信模块ReactBridge将java和js接口组织成json形式，通过jni传给native，native在传到js中去。
3. 创建两个后台线程mqt_js和mqt_native_modules，线程中使用Looper进行消息循环，在这两个线程和ui线程中各创建一个handler，保存handler的引用到对应线程中去。对应关系如下

|线程| looper| handler|
|:-|:-|:-|
|ui线程|true|handler_main_ui|
|js线程|true|handler_mqt_js|
|native_modules线程|true|handler_native_modules|

下面看具体的代码流程
首先，第25行build函数实际上是实例化CatalystInstanceImpl
```
public CatalystInstanceImpl build() {
    return new CatalystInstanceImpl(
                mReactQueueConfigurationSpec,
                mJSExecutor,
                mRegistry,
                mJSModulesConfig,
                mJSBundleLoader,
                mNativeModuleCallExceptionHandler);
}
```
继续看CatalystInstanceImpl的构造函数
```
    private CatalystInstanceImpl(
            final ReactQueueConfigurationSpec ReactQueueConfigurationSpec,
            final JavaScriptExecutor jsExecutor,
            final NativeModuleRegistry registry,
            final JavaScriptModulesConfig jsModulesConfig,
            final JSBundleLoader jsBundleLoader,
            NativeModuleCallExceptionHandler nativeModuleCallExceptionHandler) {
        //1 创建2个线程和三个handler
        mReactQueueConfiguration = ReactQueueConfigurationImpl.create(ReactQueueConfigurationSpec,
                new NativeExceptionHandler());
        mBridgeIdleListeners = new CopyOnWriteArrayList<>();
        mJavaRegistry = registry;
        mJSModuleRegistry = new JavaScriptModuleRegistry(CatalystInstanceImpl.this, jsModulesConfig);
        mJSBundleLoader = jsBundleLoader;
        mNativeModuleCallExceptionHandler = nativeModuleCallExceptionHandler;
        mTraceListener = new JSProfilerTraceListener();
        mBridge = mReactQueueConfiguration.getJSQueueThread().callOnQueue(
            new Callable<ReactBridge>() {
                @Override
                public ReactBridge call() throws Exception {
                    //2 实例化和jni通信的ReactBridge,并将Java端和js端的方法组装成json形式，传递到C++层
                    return initializeBridge(jsExecutor, jsModulesConfig);
                }
            }).get();
    }
```
看第9行代码，调用create方法，创建了三个线程的handler，并保存在对应线程的ThreadLocal中
```
   public static ReactQueueConfigurationImpl create(ReactQueueConfigurationSpec spec,
                                                     QueueThreadExceptionHandler exceptionHandler) {
    Map<MessageQueueThreadSpec, MessageQueueThreadImpl> specsToThreads = MapBuilder.newHashMap();

    MessageQueueThreadSpec uiThreadSpec = MessageQueueThreadSpec.mainThreadSpec();
    //创建一个名为"main-ui"的handler，保存在UI线程中ThreadLocal中
    MessageQueueThreadImpl uiThread =MessageQueueThreadImpl.create(uiThreadSpec, exceptionHandler);
    specsToThreads.put(uiThreadSpec, uiThread);

    MessageQueueThreadImpl jsThread = specsToThreads.get(spec.getJSQueueThreadSpec());
    if (jsThread == null) {
        //创建一个名称为mqt_js 的线程,
        // 并将Js线程中handler保存到js线程中的ThreadLocal中
        //线程中使用Lopper轮询消息，由handle人处理消息
        jsThread = MessageQueueThreadImpl.create(spec.getJSQueueThreadSpec(), exceptionHandler);
    }

    MessageQueueThreadImpl nativeModulesThread =
        specsToThreads.get(spec.getNativeModulesQueueThreadSpec());
    if (nativeModulesThread == null) {
        //创建一个名称为mqt_native_modules 的线程,
        // 并将Js线程中handler保存到mqt_native_modules线程中的ThreadLocal中
        //线程中使用Lopper轮询消息，由handler人处理消息
        nativeModulesThread =MessageQueueThreadImpl.create(spec.getNativeModulesQueueThreadSpec(), exceptionHandler);
    }
    return new ReactQueueConfigurationImpl(uiThread, nativeModulesThread, jsThread);
}
```
这步中比较重要的参数是 __spec__ 保存两个类型为MessageQueueThreadSpec的数据结构,同时，在第5行创建了一个新的MessageQueueThreadSpec，共三个对象

|对象|name|ThreadType|
|:-|:-|:-|
|uiThreadSpec|main_ui|MAIN_UI|
|mNativeModulesQueueThreadSpec|native_modules|NEW_BACKGROUND|
|mJSQueueThreadSpec|js|NEW_BACKGROUND|
分别将这三个对象进行 MessageQueueThreadImpl.create 操作，NEW_BACKGROUND 类型的会常见新的线程和handler，MAIN_UI的则只会创建ui线程的handler，最后将这三个handler保存在各自线程的ThreadLocal中，这部分代码就不贴出来了。



初始化两个线程和三个handler后，调用 initializeBridge函数，初始化ReactBridge，将模块和函数表传到jni中去
```
  private ReactBridge initializeBridge(JavaScriptExecutor jsExecutor, JavaScriptModulesConfig jsModulesConfig) {
    ReactBridge bridge = new ReactBridge(
                    jsExecutor,
                    new NativeModulesReactCallback(),
                    mReactQueueConfiguration.getNativeModulesQueueThread());
    mMainExecutorToken = bridge.getMainExecutorToken();
    bridge.setGlobalVariable(
                    "__fbBatchedBridgeConfig",
                    buildModulesConfigJSONProperty(mJavaRegistry, jsModulesConfig));
    bridge.setGlobalVariable(
                    "__RCTProfileIsProfiling",
                    Systrace.isTracing(Systrace.TRACE_TAG_REACT_APPS) ? "true" : "false");
    mJavaRegistry.notifyReactBridgeInitialized(bridge);
    return bridge;
}
```
主要看这9行代码，buildModulesConfigJSONProperty函数，将模块方法组装成json传到Jni中去，截取了函数Json返回值的一部分，是长这样的
```
{
    "remoteModuleConfig": {
        "Log": {
            "moduleID": 1,
            "supportsWebWorkers": false,
            "methods": {
                "d": {
                    "methodID": 0,
                    "type": "remote"
                },
                "i": {
                    "methodID": 1,
                    "type": "remote"
                },
                "w": {
                    "methodID": 2,
                    "type": "remote"
                },
                "e": {
                    "methodID": 3,
                    "type": "remote"
                }
            }
        },
        "NetInfo": {
            "moduleID": 2,
            "supportsWebWorkers": false,
            "methods": {
                "getCurrentConnectivity": {
                    "methodID": 0,
                    "type": "remoteAsync"
                },
                "isConnectionMetered": {
                    "methodID": 1,
                    "type": "remoteAsync"
                }
            }
        },

        "ToastAndroid": {
            "moduleID": 19,
            "supportsWebWorkers": false,
            "methods": {
                "show": {
                    "methodID": 0,
                    "type": "remote"
                }
            },
            "constants": {
                "LONG": 1,
                "SHORT": 0
            }
        },
    }
}
```
第四步 在reactContext中保持三个线程handler的引用
```
 reactContext.initializeWithInstance(catalystInstance);
 //ReactContext.java
 public void initializeWithInstance(CatalystInstance catalystInstance) {
    mCatalystInstance = catalystInstance;
    ReactQueueConfiguration queueConfig = catalystInstance.getReactQueueConfiguration();
    mUiMessageQueueThread = queueConfig.getUIQueueThread();
    mNativeModulesMessageQueueThread = queueConfig.getNativeModulesQueueThread();
    mJSMessageQueueThread = queueConfig.getJSQueueThread();
}
```
第五步 通过jni，native开始加载jsBundle
```
catalystInstance.runJSBundle();
//CatalystInstanceImpl.java
public void runJSBundle() {
   mJSBundleHasLoaded = mReactQueueConfiguration.getJSQueueThread().callOnQueue(new Callable<Boolean>() {
        @Override
        public Boolean call() throws Exception {
            mJSBundleLoader.loadScript(mBridge);
            return true;
        }
    }).get();
}
```
```
 mJSBundleLoader.loadScript(mBridge);
 //JSBundleLoader.java
 public void loadScript(ReactBridge bridge) {
    if (fileName.startsWith("assets://")) {
        bridge.loadScriptFromAssets(context.getAssets(), fileName.replaceFirst("assets://", ""));
    } else {
        bridge.loadScriptFromFile(fileName, "file://" + fileName);
    }
}
```
以loadScriptFromFile都是native方法，将bundle路径传到native，native加载JS代码和资源
```
public native void loadScriptFromAssets(AssetManager assetManager, String assetName);

public native void loadScriptFromFile(@Nullable String fileName, @Nullable String sourceURL);
```


  [1]: http://static.zybuluo.com/qh438406812/qw78oo697pzumgd5ly6af6qm/rn_start_01.svg