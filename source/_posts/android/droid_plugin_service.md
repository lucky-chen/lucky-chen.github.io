---
title: 插件化DroidPlugin-Service
categories: Android
date: 2017-01-20
---
# 主要思想

1. 注册若干个stubService
2. 插件启动service时，启动一个stubService.
3. 在stubService中模仿service生命周期，调用插件service的生命周期函数。

<!-- more -->

## DroidPlugin实现

start/bind service最终仍然是通过AM代理调用。所以hook AM的startService/binService方法。AM hook实现在activity插件化中以给出，不再赘述。
以bindService为例：
在init方法中进行hook方法登记

```
/** IActivityManagerHookHandle **/
protected void init() {
    sHookedMethodHandlers.put("bindService", new bindService(mHostContext));
}
```

真正hook点是beforeInvoke方法，在这个方法中

```
protected boolean beforeInvoke(Object receiver, Method method, Object[] args) throws Throwable {
    int index = searchInstance(args, Intent.class, 0);
    Intent intent = (Intent) args[index];
    //替换service信息
    replaceFirstServiceIntentOfArgs(args);
    return super.beforeInvoke(receiver, method, args);
}

```
见参数intent中service替换为stubService，并且携带插件service的数据信息
```
private static ServiceInfo replaceFirstServiceIntentOfArgs(Object[] args) throws RemoteException {
    int intentOfArgIndex = findFirstIntentIndexInArgs(args);
    if (args != null && args.length > 1 && intentOfArgIndex >= 0) {
        Intent intent = (Intent) args[intentOfArgIndex];
        //从预先注册的servie中寻找一个空闲的service坑
        ServiceInfo proxyService = PluginManager.getInstance().selectStubServiceInfo(serviceInfo);
        //替换intent上的数据，让AMS启动坑Service数据，并将插件service信息传递过去
        if (proxyService != null) {
            Intent newIntent = new Intent();
            //替换需要启动的service
            newIntent.setClassName(proxyService.packageName, proxyService.name);
            newIntent.setAction(serviceInfo.name);
            //携带数据
            newIntent.putExtra(Env.EXTRA_TARGET_INTENT, new Intent(intent));
            newIntent.putExtra(Env.EXTRA_TARGET_INFO_OBJECT, serviceInfo);
            //替换处理过的intent
            args[intentOfArgIndex] = newIntent;
            return serviceInfo;
        }
    }
    return null;
}
```
stubService基类为ServiceStubImpl,实现了对插件servie的分发调用

在onStartCommand方法中，初始化了插件service，并且模仿service生命周期函数，调用插件service的onCreate()、onStartCommand()方法。

```
public int onStartCommand(Intent intent, int flags, int startId) {
    IntentMaker intentMaker = IntentMaker.fromTypedServerIntent(intent);
    if (localService.service == null) {
        //创建插件service对象
        localService.service = this.localActivityService.createService(intentMaker,     localService);
    }
    //调用插件service的onStartCommand函数
    int onStartCommand = localService.service.onStartCommand(一堆参数);
    return onStartCommand;
}
```
createService方法从插件的classLoader中加载class，并初始化插件service,调用插件servicce的onCreate方法。
```
public final android.app.Service createService(IntentMaker intentMaker, LocalService localService) {
    ComponentName componentName = intentMaker.mComponentName;
    Application application = getApplication(intentMaker.mComponentInfo, null);
    //从插件中的加载service class
    service = (android.app.Service) application.getClassLoader().loadClass(componentName.getClassName()).newInstance();
    //对service进行必要的初始化
    Service.attach.invoke(service,一堆参数);
    service.onCreate();
}
```
在onCreate和onStartCommand函数后，执行到onBind函数。onBind主题函数很简单，执行插件service的onBind方法，返回执行结果即可

```
public IBinder onBind(Intent intent) {
        intentMaker.intent.setExtrasClassLoader(localService.service.getClassLoader());
        IBinder binder = localService.service.onBind(intentMaker.intent);
        return new BindService(intentMaker.mComponentName, binder).asBinder();
}
```
至此，关于DroidPlugin Service插件化的实现已经分析完毕。可以看到主题思想很精妙，但是穿插大量的源码知识，还需要多加学习。

---
参考：
1. [Android 插件化原理解析——Service的插件化](http://weishu.me/2016/05/11/understand-plugin-framework-service/)
2. [老罗-Android应用程序绑定服务（bindService）的过程源代码分析](http://blog.csdn.net/luoshengyang/article/details/6745181)
3. [DroidPlugin Github]( https://github.com/Qihoo360/DroidPlugin)



