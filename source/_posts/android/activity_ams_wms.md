---
title: Android源码之Activity与AMS、WMS联系
categories: Android
date: 2017-01-25
---

# 要点

- Activity启动过程
- Activity与AMS联系
- Activity与WMS联系

<!-- more -->


先放一张概览图，出处:[图片出处][1] 

![](http://static.zybuluo.com/qh438406812/pfhnelln1m2ds6a25m2n0gjb/20140701194427750.png)

> 代码以API 21为准

## Activity启动过程

放一张Actvity启动过程的时序图

![](/image/android/activity_start_sesquence.svg)

### startActivity

通常调用方法Context.startActivity,最后会调用到AMS的startActivity方法，调用链如下：
![Activity_Start.svg-4.5kB][3]

通过binder调用到AMS.startActivity方法后，最终会调到ActivityStackSupervisor的realStartActivityLocked方法，进入AMS进程

```
/** ActivityStackSupervisor **/
final boolean realStartActivityLocked(ActivityRecord r,ProcessRecord app, boolean andResume, boolean checkConfig)throws RemoteException {
    //将进程描述符记录在Activity描述符中
    r.app = app;
    int idx = app.activities.indexOf(r);
    //将Activity添加到进程启动的Activity列表中
    if (idx < 0) app.activities.add(r);
    //通知应用进程加载Activity
    app.thread.scheduleLaunchActivity(new Intent(r.intent), r.appToken,参数)
}
```
- app.thread是IAppliconThread的远程代理对象,实例对象存在与应用进程中。
- r.appToken在AMS是IApplicationToken的Bindr实例对象

通过过binder通信，进入App进程:
```
/** ActivityThread **/
public final void scheduleLaunchActivity(Intent intent, IBinder token,参数){
    ActivityClientRecord r = new ActivityClientRecord();
    r.token = token;
    ...
    //将记录发送给ActivityThread上的Handler,异步启动 
    queueOrSendMessage(H.LAUNCH_ACTIVITY, r);  
}
```
将数据发送给ActivityThread上的mH对象，看实现
```
private class H extends Handler {  
    public void handleMessage(Message msg) {  
        switch (msg.what) {  
            case LAUNCH_ACTIVITY: {  
                ActivityClientRecord r = (ActivityClientRecord)msg.obj;  
                //获得Activity所属包的信息
                r.packageInfo = getPackageInfoNoCheck(r.activityInfo.applicationInfo, r.compatInfo);  
                handleLaunchActivity(r, null);  
            } break;  
        }  
    }  
}     
```
Handler将逻辑转发到ActivityThread的handleLaunchActivity方法，继续看实现
```
private void handleLaunchActivity(ActivityClientRecord r, Intent customIntent) {
    //1. 初始化Activity
    Activity a = performLaunchActivity(r, customIntent);
    //2. 执行Activity的onResume函数
    handleResumeActivity(r.token, false, r.isForward,
                    !r.activity.mFinished && !r.startsNotResumed);
}
```
先看performLaunchActivity函数实现，handleResumeActivity牵扯WMS,放在后面第三节分析。

### performLaunchActivity

先看performLaunchActivity函数实现
```
private Activity performLaunchActivity(ActivityClientRecord r, Intent customIntent) {
    //1. 实例化Activity对象
    Activity activity = null;
    java.lang.ClassLoader cl = r.packageInfo.getClassLoader();
    activity = mInstrumentation.newActivity(cl, component.getClassName(), r.intent);
    //2. 为Activity创建Application对象
    Application app = r.packageInfo.makeApplication(false, mInstrumentation);
    //3. 为Activity创建ContextImpl对象
    Context appContext = createBaseContextForActivity(r, activity);
    //4. 将Activity与创建的对象关联
    activity.attach(appContext,..., r.token,app,...参数 );
    //5. 调用Activity的onCreate方法
    mInstrumentation.callActivityOnCreate(activity, r.state);
    //6. 记录Activity信息
    mActivities.put(r.token, r);  
}
```

1. 实例化Activity对象
    从r.packageInfo(LoadedApk)上记录的ClassLoader上加载class,并实例化
2. 为Activity创建Application对象
    
    ```
    public Application makeApplication(boolean forceDefaultAppClass,
        Instrumentation instrumentation) {
        //mApplication为单例，整个进程有且存在一个
        if (mApplication != null) {
            return mApplication;
        }
        //创建Application对象
        Application app = null;
        java.lang.ClassLoader cl = getClassLoader();
        ContextImpl appContext = ContextImpl.createAppContext(mActivityThread, this);
        app = mActivityThread.mInstrumentation.newApplication(cl, appClass, appContext);
        appContext.setOuterContext(app);
        retrun app;
    }
    ```
3. 为Activity创建ContextImpl对象
    
    ```
    private Context createBaseContextForActivity(ActivityClientRecord r, final Activity activity)     {
        ContextImpl appContext = ContextImpl.createActivityContext(
                this, r.packageInfo, displayId, r.overrideConfig);
        appContext.setOuterContext(activity);
        retrun appContext;
    }
    ```
4. 调用Activity的attach方法,将数据和Activity绑定
5. 通过Instrumentaion调用Activity的onCreate方法
6. 记录Activity信息

到此，Activity启动过程的主要路径分析完毕，
下面探究Activity初始化过程

---

## Activity初始化

### Activity.attach

```seq
Activity->PhoneWindow: new
Activity->ContextImpl: getSystemService
ContextImpl->SystemServiceRegistry: getSystemService
Activity->PhoneWindow: setWindowManager
PhoneWindow->WindowManagerImpl: createLocalWindowManager
```
```
/** Activity **/
final void attach(Context context,ActivityThread aThread,..., IBinder token,...,Application application ...) {
    attachBaseContext(context);
    //创建窗口
    mWindow = new PhoneWindow(this);
    mUiThread = Thread.currentThread();  
    mMainThread = aThread;
    //用于和AMS服务通信的IApplicationToken.Proxy代理对象
    mToken = token;
    //设置窗口管理器
    mWindow.setWindowManager((WindowManager)context.getSystemService(Context.WINDOW_SERVICE),mToken, ...);
}
```
ContextImpl.getSystemService

```
/**
 * Gets a system service from a given context.
*/
public static Object getSystemService(ContextImpl ctx, String name) {
    ServiceFetcher<?> fetcher = SYSTEM_SERVICE_FETCHERS.get(name);
    return fetcher != null ? fetcher.getService(ctx) : null;
}
```
以String为key从ServiceFetcher上找，看注册时的实现
```
registerService(Context.WINDOW_SERVICE, WindowManager.class,new CachedServiceFetcher<WindowManager>() {
    @Override
    public WindowManager createService(ContextImpl ctx) {
        return new WindowManagerImpl(ctx.getDisplay());
    }
});
```
最后返回的是一个WindowManagerImpl对象。
接着看mWindow.setWindowManager方法实现：
android.view.window
```
public void setWindowManager(WindowManager wm, IBinder appToken, String appName,
            boolean hardwareAccelerated) {
    mWindowManager = ((WindowManagerImpl)wm).createLocalWindowManager(this);
}
```
android.view.WindowManagerImpl
```
public WindowManagerImpl createLocalWindowManager(Window parentWindow) {
    return new WindowManagerImpl(mDisplay, parentWindow);
}
```

__说明__

- WindowManagerImpl为重量级的窗口管理器，应用程序进程中有且只有一个WindowManagerImpl实例(ServiceFetcher中缓存的对象)，它管理了应用程序进程中创建的所有PhoneWindow窗口。
- Activity并没有直接引用WindowManagerImpl实例，Android系统为每一个启动的Activity创建了一个轻量级的窗口管理器LocalWindowManager( createLocalWindowManager方法产生 )，
- 每个Activity通过LocalWindowManager来访问WindowManagerImpl

Activity、LocalWindowManage、WindowManagerImpl三者之间的关系如下图所示：

![20140630161945343.png-25.6kB][4]

到此,attach过程完毕，继续看onCrate中做了哪些事情

### Activity.onCreate

先上一张onCreate过程中的函数调用时序图
```seq
Activity->Activity: onCreate
Activity->PhoneWindow: setContentView
PhoneWindow->PhoneWindow: installDecor
PhoneWindow->DecorView: newInstance
PhoneWindow->PhoneWindow: generateLayout
```
```
public void onCreate(Bundle savedInstanceState) {  
    super.onCreate(savedInstanceState);  
    setContentView(R.layout.main_activity);  
    ...  
}  
```
在程序中，一般通过函数setContentView设置需要显示的View.
而真正的实现是在PhoneWindow的setContentView函数中
```
/** PhoneWindow **/
public void setContentView(int layoutResID) {  
    //如果窗口顶级视图对象为空，则创建窗口视图对象  
    if (mContentParent == null) {  
        installDecor();  
    } else {//否则只是移除该视图对象中的其他视图  
        mContentParent.removeAllViews();  
    }  
    //加载布局文件，并将布局文件中的所有视图对象添加到mContentParent容器中  
    mLayoutInflater.inflate(layoutResID, mContentParent);  
}  
```
第5行函数生成了一个根View: `DecorView`
DecorView中包括了标题栏以、自定义显示区域mContentParent、动作条等等内容
第10行函数将自定义的View记载到自定义显示区域mContentParent上
![20140630165258140.png-9.9kB][5]

```
private void installDecor() {  
    if (mDecor == null) {  
        //返回DecorView,继承自FrameLayout
        mDecor = generateDecor();  
        mContentParent = generateLayout(mDecor);
    }  
    if (mContentParent == null) {  
        mContentParent = generateLayout(mDecor);  
        //应用程序窗口标题栏  
        //应用程序窗口动作条  
    }  
}  
```

### 小结
1. Activity窗口对象的创建，通过attach函数来完成；
2. Activity视图对象的创建，通过setContentView函数来完成

## Activity关联Window

老规矩，献上一张时序图
![](/image/android/ancivity_handle_resume.svg)

先看handleResumeActivity函数实现
```
/** ActivityThread **/
final void handleResumeActivity(IBinder token,boolean clearHide, boolean isForward, boolean reallyResume) {
    //根据token从之前记录的信息中获取Activity信息
    ActivityClientRecord r = performResumeActivity(token, clearHide);
    final Activity a = r.activity;
    //获取Activity的window信息
    r.window = r.activity.getWindow();
    View decor = r.window.getDecorView();
    ViewManager wm = a.getWindowManager();
    //将视图对象保存到Activity的成员变量mDecor中  
    a.mDecor = decor;
    //将视图decor添加到Activity所在窗口管理器中
    wm.addView(decor, l);
}
```
WindowManagerImpl
```
public final void addView(View view, ViewGroup.LayoutParams params) {
    applyDefaultToken(params);
    mGlobal.addView(view, params, mDisplay, mParentWindow);
}
```
WindowManagerGlobal
```
public void addView(View view, ViewGroup.LayoutParams params,Display display, Window parentWindow) {
    ViewRootImpl root;
    int index = findViewLocked(view, false);
    if (index >= 0) {
        //如果已经存在，异常退出
        throw new IllegalStateException("View " + view
            + " has already been added to the window manager.");
    }
    // 为Activity创建一个ViewRootImpl对象
    root = new ViewRootImpl(view.getContext(), display);
    //记录
    mViews.add(view);
    mRoots.add(root);
    mParams.add(wparams);
    //添加view
    root.setView(view, wparams, panelParentView);
}
```

![20140630171741143.png-30.7kB][6]

### ViewRootImpl构造过程

ViewRootImpl
```
final Surface mSurface = new Surface();
final class ViewRootHandler extends Handler {
    //...
}
public ViewRootImpl(Context context, Display display) {
    //返回缓存的WindowSession
    mWindowSession = WindowManagerGlobal.getWindowSession();
    mWindow = new W(this);
    mAttachInfo = new View.AttachInfo(mWindowSession, mWindow, display, this, mHandler, this);
    mChoreographer = Choreographer.getInstance();
}
```
1. 通过WindowManagerGlobal.getWindowSession()得到IWindowSession的代理对象，用于和WMS通信
2. 创建了一个W本地Binder对象，用于WMS通知应用程序进程
3. 采用单例模式创建了一个Choreographer对象，用于统一调度窗口绘图
4. 创建ViewRootHandler对象，用于处理当前视图消息
5. 构造一个AttachInfo对象
6. 创建Surface对象，用于绘制当前视图,该Surface对象的真正创建是由WMS来完成

![20140630184739343.png-36.5kB][7]

### 视图View的添加过程

ViewRootImpl
```
public void setView(View view, WindowManager.LayoutParams attrs, View panelParentView) {
    if (mView == null) {
        mView = view;
        mAttachInfo.mRootView = view;
        // 在添加窗口前进行UI布局  
        requestLayout();
        //将窗口添加到WMS服务中
        res = sWindowSession.add(mWindow, 参数);  
        //建立消息通道
        if (mInputChannel != null) {
            //...
        }
    }
}
```

### 窗口布局-绘制过程
ViewRootImpl
```
public void requestLayout() { 
    scheduleTraversals();  
} 
void scheduleTraversals() {
    //向Choreographer注册回调
    mChoreographer.postCallback(Choreographer.CALLBACK_TRAVERSAL, mTraversalRunnable, null);
    scheduleConsumeBatchedInput();
}
```
TraversalRunnable 的run方法执行了doTraversal()函数，而doTraversal又调用performTraversals()函数.
```
private void performTraversals() { 
    //1.执行窗口测量 
    measureHierarchy(host, lp, res,  desiredWindowWidth, desiredWindowHeight); 
    //2. 向WMS服务添加窗口
    relayoutWindow(params, viewVisibility, insetsPending)
    //3. View测量
    performMeasure(childWidthMeasureSpec, childHeightMeasureSpec);  
    //3. View布局
    performLayout(); 
    //4. View绘制
    performDraw();
}
```
relayoutWindow
```
private int relayoutWindow(WindowManager.LayoutParams params, 参数) throws RemoteException {  
    mWindowSession.relayout(mWindow, mSeq, params,参数,mSurface);
}
```
performMeasure
```
//mView = DecorView
mView.measure(childWidthMeasureSpec, childHeightMeasureSpec);
```
performLayout
```
private void performLayout() { 
    //host = view
     host.layout(0, 0, host.getMeasuredWidth(), host.getMeasuredHeight());  
}
```
performDraw
```
private void performDraw() {
    draw(fullRedrawNeeded);  
}
private void draw(boolean fullRedrawNeeded) {
    //硬件渲染
    if(...){
          mAttachInfo.mHardwareRenderer.draw(mView, mAttachInfo, this);
    }else{
        //软件渲染
        drawSoftware(surface, mAttachInfo, xOffset, yOffset, scalingRequired, dirty)
    }
}
```

### 窗口添加过程

Session.java
```
public int add(IWindow window,...) {  
    return mService.addWindow(this, window,...);  
}  
```
WindowManagerService
```
public int addWindow(Session session,IWindow client, ...) {  
    //判断窗口是否已经存在  
    if (mWindowMap.containsKey(client.asBinder())) {  
        return WindowManagerImpl.ADD_DUPLICATE_ADD;  
    }
    //根据attrs.token从mWindowMap中取出应用程序窗口在WMS服务中的描述符WindowState  
    attachedWindow = windowForClientLocked(null, attrs.token, false);  
    //根据attrs.token从mTokenMap中取出应用程序窗口在WMS服务中的 WindowToken
    WindowToken token = mTokenMap.get(attrs.token); 
    //为Activity窗口创建WindowState对象  
    win = new WindowState(this, session, client, token,  attachedWindow, seq, attrs, viewVisibility);
    //设置消息通道
    win.setInputChannel(inputChannels[0]);  
    //保存
    mTokenMap.put(attrs.token, token); 
    win.attach(); 
    mWindowMap.put(client.asBinder(), win); 
}
```
WMS保存了Window的信息，如下：
|Map类型|key|value|
|:---|:---|:---|
|mWindowMap|IWindow.Proxy|WindowState|
|mTokenMap|IWindow.Proxy/Token|WindowToken|

之后，调用WindowState的attach函数

```
void attach() {  
    mSession.windowAddedLocked();  
}

void windowAddedLocked() {  
    //WMS增加一个Window记录
    if (mSurfaceSession == null) {  
        mSurfaceSession = new SurfaceSession();  
        mService.mSessions.add(this);  
    }  
    mNumWindow++;
}  
```
WMS服务端都创建的对象
1. WindowState对象，是应用程序窗口在WMS服务端的描述符；
2. Session对象，应用程序进程与WMS服务会话通道
3. SurfaceSession对象，应用程序进程与SurfaceFlinger的会话通道；

---


参考:
[Android应用程序窗口设计框架介绍][12]


[1]: http://blog.csdn.net/yangwen123/article/details/35987609
[3]: http://static.zybuluo.com/qh438406812/ec8vtvm1nxrii56j2s1rspjx/Activity_Start.svg
[4]: http://static.zybuluo.com/qh438406812/nf03z9v3wj1s6ng0s24gselw/20140630161945343.png
[5]: http://static.zybuluo.com/qh438406812/r3lfpoyfpyvu3zaiudch6qz6/20140630165258140.png
[6]: http://static.zybuluo.com/qh438406812/asl6ny1z9dekr3mguhn1vmof/20140630171741143.png
[7]: http://static.zybuluo.com/qh438406812/j93ra0h646jhiybeqvt99wx5/20140630184739343.png
[8]: http://static.zybuluo.com/qh438406812/s4zs6iurc74hk2vu5q5vg3ao/android_activity_start.svg
[9]: http://static.zybuluo.com/qh438406812/d2k4a9pi4q3atqkl9aj67v48/activity_attach.svg
[10]: http://static.zybuluo.com/qh438406812/6lryyg3a92d4qnzlahwdb0u0/activity_oncrate.svg
[11]: http://static.zybuluo.com/qh438406812/rwur0d0psj7yr1h66iothcew/handle_resume_activity.svg
[12]: http://blog.csdn.net/yangwen123/article/details/35987609