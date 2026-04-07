---
title: 插件化DroidPlugin-Provider
categories: Android
date: 2017-02-01
---

## 主要思想
1. host预先申请若干stubProvider
2. hook ams，插件查询provider时，返回stubProVider
3. 在 stubProvider 中操控插件的providr对象

<!-- more -->

## Provider 查询

1. 源码关键路径分析

    getContext().getContentResolver().XXX最终会调用到ActivityThread的acquireProvider方法
    
    ```
    public final IContentProvider acquireProvider( Context c, String auth ...）{
        final IContentProvider provider = acquireExistingProvider(c, auth, userId, stable);
        if (provider != null) {
            return provider;
        }
        //查询AMS
        holder = ActivityManagerNative.getDefault().getContentProvider(
                    getApplicationThread(), auth, userId, stable);
        return holder.provider;
    }
    ```
    
    系统先到调用acquireExistingProvider方法查询，如果有返回。没有，查询AMS。很明显，acquireExistingProvider方法应该是查了缓存

    ```
    public final IContentProvider acquireExistingProvider(）{
        //果然只查了个缓存。
        final ProviderClientRecord pr = mProviderMap.get(key);
        if (pr == null) return null;
        IContentProvider provider = pr.mProvider;
        return provider;
    }
    ```
    
    > 这里有两种hook方案，一种是DroidPlugin的方法，hook掉AMS的getContentProvider方法，另外是把插件的provider信息直接放到缓存mProviderMap中。
    以hook掉AMS的getContentProvider方法为准
2. hook AMS getContentProvider

    在IActivityManagerHookHandle类中登记hook方法:
    ```
    protected void init() {
        sHookedMethodHandlers.put("getContentProvider", new getContentProvider(mHostContext));
    }
    ```
    看hook方案的实现
    ```
    protected boolean beforeInvoke(Object receiver, Method method, Object[] args){
        String authority=(String) args[1];
        //找到插件的provider记录
        mTargetProvider = PluginManager.getInstance().resolveContentProvider(PluginProcessManager.getCurrentVUid(), name, 0);
        //分配一个provider坑
        mStubProvider = PluginManager.getInstance().selectStubProviderInfo(mTargetProvider, name);
        //替换参数中的，让系统启动 stubProvider
        args[index] = mStubProvider.authority;
    }
    ```
## stubProvider 实现

1. onCreate

    ```
    先看增删改查的出处理
    /** AbstractContentProviderStub **/
    public Cursor query(Uri uri, String[] projection,
                        String selection, String[] selectionArgs, String sortOrder) {
        String targetAuthority = uri.getQueryParameter(Env.EXTRA_TARGET_AUTHORITY);
        //拿到插件provider的对象
        ContentProviderClient client = getContentProviderClient(targetAuthority);
        //返回插件provider的执行结果
        return client.query(buildNewUri(uri, targetAuthority), projection, selection, selectionArgs, sortOrder);
    }
    ```
    
    继续看getContentProviderClient函数
    
    ```
    private synchronized ContentProviderClient getContentProviderClient(final String     targetAuthority) {
        ContentProviderClient client = sClients.get(targetAuthority);
        if (client != null) {
            return client;
        }
        //..
    }

    ```
    sClient是一个map,很明显，这又是一个cache。cache中存储了插件provider的信息。继续看存储信息的时机。

2. 加载provider信息
    在PluginProcessManager类中，有个preLoadApk方法
    
    ```
    private static void preLoadApk(Context hostContext, String packageName) {
        Application application = applicationMap.get(packageName);
        installContentProviders(hostContext, application, packageName);
    }
    ```
    
    根据插件的packageName拿到插件的Application，继续看installContentProviders方法
    
    ```
    private static void installContentProviders(Context hostContext, Application app, String packageName) {
        //获得stubProvider引用
        AbstractContentProviderStub proxy = AbstractContentProviderStub.getProxyInstance();
        //插件pkgInfo
        PackageInfo pkgInfo = PluginManager.getInstance().getPackageInfo(packageName, PackageManager.GET_PROVIDERS);
        for (ProviderInfo providerInfo : pkgInfo.providers) {
            //获取满足条件的插件的providr
            ContentProviderClient localProvider = app.getContentResolver().acquireContentProviderClient(providerInfo.authority);
            //绑定stubProvider
            proxy.installClient(providerInfo, localProvider);
        }
    }
    
    ```
    
    AbstractContentProviderStub.getProxyInstance()返回的是stubProvider的引用
    
    ```
    /** AbstractContentProviderStub **/
    public boolean onCreate() {
        sProxy = this;
    }
    
    public static AbstractContentProviderStub getProxyInstance() {
        return sProxy;
    }
    ```
    
    最后，看proxy.installClient方法，方法只将插件的provider放到缓存中
    
    ```
    public void installClient(ProviderInfo info, ContentProviderClient provider) {
        sClients.put(info.authority, provider);
    }
    ```
    
    至此，provider插件化分析完毕

## 小结

1. 在插件加载时，程序缓存了插件pkg信息
2. 插件查询provider时，返回一个预先申请好的stubProvider
3. 将stubProvider与插件的provider绑定在一起，由stubProvider操控插件的provider


---

参考：
1. [Android插件化原理解析——ContentProvider的插件化](http://weishu.me/2016/07/12/understand-plugin-framework-content-provider)
2. [老罗-Android应用程序组件Content Provider的启动过程源代码分析](http://blog.csdn.net/luoshengyang/article/details/6963418)
3. [DroidPlugin Github]( https://github.com/Qihoo360/DroidPlugin)


