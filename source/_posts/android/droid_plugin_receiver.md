---
title: 插件化DroidPlugin-Receiver
categories: Android
date: 2017-02-07
---

# 主要思想
1. 拦截动态广播的注册和发送，cache广播信息
2. cache插件的静态广播，在stubReceiver中操控插件的receiver
3. 模仿AMS,自己管理receiver
<!--more-->

## 注册过程处理

### 静态广播缓存

1. 从插件安装看起
    ```
    /** **/
    static int installPackageFromSys(PackageInfo packageInfo, IPackageInstallCallback     callback) {
        InstallerInner.InstallerData installerData = new InstallerInner.InstallerData(参数);
        InstallerInner.installBlockingQueue.offer(installerData);
        return PackageManagerCompat.INSTALL_SUCCEEDED;
    }
    ```

2. InstallerInner安装过程
    ```
    public void run() {
        installerData = installBlockingQueue.take();
        doInstaller(installerData);
    }
    ```
    继续看doInstaller函数
    ```
    public int doInstallPackageFromSys(PackageInfo packageInfo, IPackageInstallCallback callback){
        PluginPackageParser parser = new PluginPackageParser(mContext, packageInfo);
        mPluginCache.put(parser.getPackageName(), parser);
        return PackageManagerCompat.INSTALL_SUCCEEDED;
    }
    ```
    函数将pkgIngo上的数据封装为一个parser对象，并且以包名为key缓存在一个map中,接下来看parer的操作。
3. PluginPackageParser
    ```
    public PluginPackageParser(Context hostContext, PackageInfo appInfo){
        mPluginFile = new File(appInfo.applicationInfo.sourceDir);
        mParser = PackageParser.newPluginParser(hostContext);
        //解析apk文件
        mParser.parsePackage(mPluginFile, 0);
        mPackageName = mParser.getPackageName();
        //拿到apk中所有的静态Receiver信息
        List datas = mParser.getReceivers();
        for (Object data : datas) {
            ComponentName componentName = new ComponentName(mPackageName, mParser.readNameFromComponent(data));
            //将receiver数据放入缓存
            mReceiversObjCache.put(componentName, data);
            ActivityInfo value = mParser.generateReceiverInfo(data, 0);
            mReceiversInfoCache.put(componentName, value);
            //将reviever的filters放入缓存
            List<IntentFilter> filters = mParser.readIntentFilterFromComponent(data);
            mReceiverIntentFilterCache.put(componentName, new ArrayList<>(filters));
        }
        //.. activity cache
        //.. service cache
        //.. provider cache
        
    } 
    ```
    函数很简单，就是解析APK，然后将manifist中静态注册的四大组件信息给缓存起来。
### 动态广播hook
1. 注册广播源码 
    ```
    private Intent registerReceiverInternal(BroadcastReceiver receiver,IntentFilter filter, 参数) {
        return ActivityManagerNative.getDefault().registerReceiver(receiver,一堆参数);
    }
    
    ```
    注册过程最终还是通过AMS，所以继续hook AMS的registerReceiver方法即可。
2. hook过程 
    ```
    /** IActivityManagerHookHandle **/
    protected void init() {
        sHookedMethodHandlers.put("registerReceiver", new registerReceiver(mHostContext));
    }
    
    ```
    继续看hook后，具体做的处理
    ```
    protected boolean beforeInvoke(Object receiver, Method method, Object[] args){
        String callerPackage = (String) args[1];
        //.. 截取参数
        //注册到自身的服务进程中
        PluginManager.getInstance().registerReceiver(callerPackage, (IntentFilter) args[index + 2],iIntentReceiver, broadcastReceiver.getClass().getName(),permission);
    }
    ```
    PluginManger最终调用到BroadcastCenter的addRegisterReceiver方法中
    ```
    public void addRegisterReceiver(int pid, IBinder intentReceiver, String receiverName，参数){
        BroadcastItem item = new BroadcastItem();
        item.setPid(pid);
        item.setPackageName(packageName);
        item.setTargetProcessName(targetProcessName);
        item.setIntentFilter(intentFilter);
        item.setReceiverName(receiverName);
        item.setIntentReceiver(intentReceiver);
        item.setPermiss(permiss);
        //存储动态注册的receiver信息
        registerList.add(item);
    }
    
    ```
    绕了半天，其实就是将动态注册的广播的数据做一个封装，然后缓存起来，就这么回事。
## 发送广播处理

之前的操作中，已经将静态注册的广播和动态注册的广播缓存起来。接下来继续看当发送广播时的处理.

### 静态广播发送
1. 以WIFI_STATE_CHANGED为例，manifist定义
    ```
    <receiver
    android:name="com.dopen.sysbroadcast.NetStatReceiver"
    android:process=":CoreService">
    <intent-filter android:priority="0x7fffffff">
        <action android:name="android.net.wifi.WIFI_STATE_CHANGED" />
        <action android:name="android.net.conn.CONNECTIVITY_CHANGE" />
        <action android:name="android.intent.action.ANY_DATA_STATE" />
        <action android:name="android.net.wifi.STATE_CHANGE" />
    </intent-filter>
</receiver>

    ```
2. 继续看NetStatReceiver的实现
    
    ```
public class NetStatReceiver extends BroadcastReceiver {
    public void onReceive(Context context, Intent intent) {
        //...
        PluginManager.getInstance().broadcastIntent(..., cloneIntent, null,param,null);
        }
    }

    ```
PluginManager 经过层层调用，最终调用到BroadcastCenter的broadcastIntent方法

3. BroadcastCenter 
    
    ```
    public int broadcastIntent(final int vUid, Intent intent, String resolvedType, List<ResolveInfo> resolveInfos, Bundle param, String[] permissions) {
        Message msg = Message.obtain();
        msg.what = EventHandler.BROADCAST_INTENT_MSG;
        BroadcastData broadcastData = new BroadcastData();
        //.. 
        msg.obj = broadcastData;
        sendHandler.sendMessage(msg);
        return 0;
        
    }
    
    ```
    Handler在收到BROADCAST_INTENT_MSG消息后，会调用processNextBroadcast方法，在这个方法里面真正的执行静态广播和动态广播的发送,我们先看静态广播的部分
4. processNextBroadcas处理静态广播
    ```
    private void processNextBroadcast(Message msg) {
        BroadcastData broadcastData = (BroadcastData)msg.obj;
        //..参数处理
        //查询静态注册broadcastReceiver
        resolveInfos = pluginManagerImpl.resolveReceiver(参数);
        //处理静态注册的广播
        List<BroadcastCenter.BroadcastItem> staticItems = new ArrayList<>();
        for (ResolveInfo resolveInfo : resolveInfos) {
            BroadcastCenter.BroadcastItem item = new BroadcastCenter.BroadcastItem();
            item.setReceiverName(resolveInfo.activityInfo.name);
            //...
            staticItems.add(item);
        }
        // 发送广播
        for (int i = 0; i < staticItems.size(); i++) {
            item = staticItems.get(i);
            //找到一个坑Receiver
            ActivityInfo stubReceiver = activityManagerService.selectStubReceiverInfo(tmpVar);
            Intent lItent = new Intent();
            lItent.setClassName(stubReceiver.packageName, stubReceiver.name);
            //携带插件receiver的信息
            lItent.putExtra(Env.EXTRA_TARGET_RECEIVER, item.getReceiverName());
            lItent.putExtra(Env.EXTRA_TARGET_RECEIVER_PACKAGENAME, item.getPackageName());
            //启动坑reveiver
            context.sendBroadcast(lItent);
        }
    }
    
    ```
5. ReceiverStub的处理
    在onReceive函数中只是执行了dispatcherReceiver方法
    ```
    public void dispatcherReceiver(Context context, Intent intent) {
        //拿到插件receiver的信息
        String receiverName = stubIntent.getStringExtra(Env.EXTRA_TARGET_RECEIVER);
        String packageName = stubIntent.getStringExtra(Env.EXTRA_TARGET_RECEIVER_PACKAGENAME);
        ComponentName targetComponentName = new ComponentName(packageName, receiverName);
        //拿到插件的ClassLoader
        pluginClassLoader = PluginProcessManager.getPluginClassLoader(targetComponentName.getPackageName());
        //实例化插件Receiver
        Class<?> targetReceiverClass = pluginClassLoader.loadClass(receiverName);
        BroadcastReceiver receiver = (BroadcastReceiver) targetReceiverClass.newInstance();
        //执行插件reciever的onReceive函数
        receiver.onReceive(pluginApplication.getApplicationContext(), targetIntent);
    }
    
    ```
    至此，静态广播的处理分析完毕。
6. 小结
    1). 缓存插件静态广播
    2). 在Host中注册若干stubReceiver和真正需要的静态广播
    3). 触发host静态广播时,匹配插件receiver，并启动一个stubReceiver
    4). 在stubReceiver中实例化插件receiver,并执行onReceive生命周期函数。

### 动态广播发送
1. 继续hook AM
    ```
    /** IActivityManagerHookHandle **/
    protected void init() {
        sHookedMethodHandlers.put("broadcastIntent",new broadcastIntent(mHostContext));
    }
    
    ```
    看hook的实现
    ```
    protected boolean beforeInvoke(Object receiver, Method method, Object[] args){
        //参数处理
        PluginManager.getInstance().broadcastIntent(PluginProcessManager.getCurrentVUid(), intent, null, param,permissions);
    }
    
    ```
    又调用了PluginManager的broadcastIntent方法，在静态广播发送一节，我们已经分析过，最终会执行到processNextBroadcast方法。前面已经看过该方法对静态广播的处理，接下来，即系分析对动态广播的处理。
2. processNextBroadcas处理动态广播
    ```
    private void processNextBroadcast(Message msg) {
        BroadcastData broadcastData = (BroadcastData)msg.obj;
        String packageName = broadcastData.packageName;
        //..参数处理
        //查询动态注册过的广播
        List<BroadcastCenter.BroadcastItem> dynamicItems = queryBroadcastItem(packageName, intent,permissions);
        //发送动态广播
        for(int i = 0; i < dynamicItems.size(); i++) {
            item = dynamicItems.get(i);
            sendDynamicBroadcast(item, broadcastData);
        }
    }
    
    ```
3. 插件动态广播执行入口hook
    sendDynamicBroadcast函数通过一系列的反射，最终拿到了插件receiver的远程binderProx，用于执行binderProx上的performReceive方法。这个点，刚好是FrameWork中调度receiver起始点。
    ```
    private void sendDynamicBroadcast(BroadcastCenter.BroadcastItem item,BroadcastData broadcastData) {
        Intent intent = broadcastData.intent;
        Class<?> iIntentReceiverClass = Class.forName("android.content.IIntentReceiver$Stub$Proxy");
        Class<?> iIntentReceiverClass1 = Class.forName("android.content.IIntentReceiver$Stub");
        performReceiverMethod = iIntentReceiverClass.getDeclaredMethod("performReceive", 参数);
        Method asInterfaceMethod = iIntentReceiverClass1.getDeclaredMethod("asInterface", IBinder.class);
        Object iIntentReceiver = asInterfaceMethod.invoke(null, item.getIntentReceiver());
        //调度插件动态注册的receiver
        performReceiverMethod.invoke(iIntentReceiver, intent,参数);
    }
     
    ```
    
    到这一步，动态注册的receiver也处理完毕。
    
4. 附加AMS 调度recevie的源码
    在AMS匹配完毕receiver后，最终会调度到由APP端提供给AMS的binder代理对象IIntentReceiver的performReceive方法
    ```
    public void performReceive(Intent intent,参数) {
        Args args = new Args(intent, 参数);
        mActivityThread.post(args)) 
    }
    
    ```
    mActivityThread向UI线程post一个任务，看Args中的实现
    ```
    /** Args **/
    public void run() {
        final BroadcastReceiver receiver = mReceiver;
        //加载receiver 
        ClassLoader cl =  mReceiver.getClass().getClassLoader();
        //执行onReceive
        receiver.onReceive(mContext, intent)
    }
    
    ```
    之后就是常见的receiver的onReceive函数执行了。

---
参考：
1. [Android插件化原理解析——广播的管理](http://weishu.me/2016/05/11/understand-plugin-framework-service/)
2. [老罗-Android系统中的广播（Broadcast）机制简要介绍和学习计划](http://blog.csdn.net/luoshengyang/article/details/6730748)
3. [老罗-Android应用程序注册广播接收器（registerReceiver）的过程分析](http://blog.csdn.net/luoshengyang/article/details/6737352)
4. [老罗-Android应用程序发送广播（sendBroadcast）的过程分析](http://blog.csdn.net/luoshengyang/article/details/6744448)
5. [DroidPlugin Github]( https://github.com/Qihoo360/DroidPlugin)