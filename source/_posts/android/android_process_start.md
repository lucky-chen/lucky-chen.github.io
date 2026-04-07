---
title: Android源码之进程启动过程
categories: Android
date: 2017-02-14
---


# 概要

- API21
- AMS 启动进程
- Zygote fork进程
- 应用端初始化

上一张调用流程的时序图: 
![](/image/android/android_process_start.svg)

<!-- more -->

在启动四大组件时,会检查组件所在的进程是否运行，否则启动该组件指定的进程。
先上一张流程图，以startActivity举例。
在之前 [Android源码之Activity启动过程][2] 中提到,AMS启动Activity时，会执行到startSpecificActivityLocked方法,调用startProcessLocked启动进程

## AMS启动进程处理

- 1 AMS.startProcessLocked
    ```
    //info = ApplicationInfo
    app = newProcessRecordLocked(info, processName, isolated, isolatedUid);
    entryPoint = "android.app.ActivityThread";
    Process.start(entryPoint,app.processName, uid, uid, gids, ...);
    ```
    可以看到这个函数主要是准备相关的数据。

    - 创建一个进程相关的数据记录。
    - entryPoint值为 `android.app.ActivityThread` ，表明新进程的入口类。
        这个参数会一路传下去，在Zygote fork进程后，子进程会加载ActivityThread类的main方法。
    - 调用Process.start创建进程

- 2 Process.start

    start方法直接调用startViaZygote，看实现
    ```
    ProcessStartResult start(...){
        startViaZygote(...)
    }

    private static ProcessStartResult startViaZygote(final String processClass,final String niceName,..){
        ArrayList<String> argsForZygote = new ArrayList<String>();
        argsForZygote.add("--runtime-init");
        argsForZygote.add(processClass);
        //...
        zygoteSendArgsAndGetResult(...,argsForZygote)
    }
    ```
    startViaZygote方法很简单，将传入的以及默认的参数重新拼装,以 `List<String>` 形式往下调用

- 3 Process.zygoteSendArgsAndGetResult

    ```
    private static ProcessStartResult zygoteSendArgsAndGetResult(ZygoteState zygoteState, ArrayList<String> args){
        final BufferedWriter writer = zygoteState.writer;
        final DataInputStream inputStream = zygoteState.inputStream;
        int sz = args.size();
        for (int i = 0; i < sz; i++) {
            String arg = args.get(i);
            writer.write(arg);
            writer.newLine();
        }
        writer.flush();
        ProcessStartResult result = new ProcessStartResult();
        result.pid = inputStream.readInt();
        return result;
    }
    ```
    有两个重要的变量
    - zygoteState.writer
    - zygoteState.inputStream

    由名知意，这是一个输入/输入流。ZygoteInit在main函数中注册了一个SocketServer，之后不断监听输入、输出,进行处理。
函数逻辑很简单：通过Socket方式将之前准备的参数指令传送给ZygoteInit，由ZygoteInit进行处理。

## Zygote 处理
- 8 先看ZygoteInit的mian函数
    
    ```
    public static void main(String argv[]) {
        try {
            //1. 打开Socket
            registerZygoteSocket(socketName);
            preload();
            //2. 监听输入输出
            runSelectLoop(abiList);
            //3. 关闭
            closeServerSocket();
        } catch (MethodAndArgsCaller caller) {
            //4. 执行反射ActivityThread方法
            caller.run();
        } catch (RuntimeException ex) {
            //...
        }
    }
    ```
    我们不去纠结1、3步的具体实现，只要知道在函数中开启了一个Socket服务，并在适合的时机关闭。
重点关注2、4两步
    在第二步中，进行了子进程的fork操作，并将进程信息以异常的形式抛上来。
第四步,捕获到进程信息后，执行run方法

- 4 先看第二步runSelectLoop实现

    ```
    private static void runSelectLoop(String abiList){
        ArrayList<FileDescriptor> fds = new ArrayList<FileDescriptor>();
        ArrayList<ZygoteConnection> peers = new ArrayList<ZygoteConnection>();
        FileDescriptor[] fdArray = new FileDescriptor[4];
        fds.add(sServerSocket.getFileDescriptor());
        while (true) {
            index = selectReadable(fdArray);
            if (index < 0) {
                throw new RuntimeException("Error in select()");
            } else if (index == 0) {
                //接收到一个Socket连接
                ZygoteConnection newPeer = acceptCommandPeer(abiList);
                peers.add(newPeer);
                fds.add(newPeer.getFileDescriptor());
            } else {
                //处理连接
                done = peers.get(index).runOnce();
                //后续清理...
            } 
        }
    }
    ```
    函数中开启了一个死循环，不断获取socket上的连接。
    当接收到一个连接 ZygoteConnection 后，先存到一个List中
    在下次循环时，调用ZygoteConnection的runOnce方法

- 5 runOnce
    
    ```
    /** ZygoteConnection **/
    boolean runOnce() throws ZygoteInit.MethodAndArgsCaller {
        args = readArgumentList();
        parsedArgs = new Arguments(args);
        pid = Zygote.forkAndSpecialize(parsedArgs.uid, parsedArgs.gid, ...parsedArgs.niceName, ..);
        if (pid == 0) {
            handleChildProc(parsedArgs, descriptors, childPipeFd, newStderr);
        }else{
            handleParentProc
        }
    }
    ```
    在第2行代码中，解析之前一路传下来的参数，而参数中包含了入口类等各种信息。
    第四行代码,由函数名可知，__进行了进程的fork操作__。
    第5行和第7行判断当前属于哪个进程。
    当pid=0时，进入子进程的处理流程handleChildProc
- 6 handleChildProc

    ```
    /** ZygoteInit **/
    private void handleChildProc(Arguments parsedArgs,...)throws ZygoteInit.MethodAndArgsCaller){
        cloader = new PathClassLoader(parsedArgs.classpath,ClassLoader.getSystemClassLoader());
        ZygoteInit.invokeStaticMain(cloader, className, mainArgs);
    }
    ```
    创建了一个ClassLoader，ClassLoader指向待启动应用的代码
    执行ZygoteInit.invokeStaticMain方法。

- 7 invokeStaticMain

    ```
    /** ZygoteInit **/
    static void invokeStaticMain(ClassLoader loader,String className, String[] argv)throws ZygoteInit.MethodAndArgsCaller {
        Class<?> cl = loader.loadClass(className);
        Method m = cl.getMethod("main", new Class[] { String[].class });
        throw new ZygoteInit.MethodAndArgsCaller(m, argv);
    }
    ```
    参数className是之前一路传下来的 `android.app.ActivityThread` 。
    函数通过应用的ClassLoader,反射到代码中ActivityThread的main函数对象
    最后，创建一个MethodAndArgsCaller对象，以异常形式抛出。
    在时序图的第8步中，ZygoteInit的main方法中catch了这个异常，执行了run方法
- 9 run
    
    ZygoteInit.MethodAndArgsCaller
    ```
    public void run() {
        mMethod.invoke(null, new Object[] { mArgs });
    }
    ```
    方法很简单，反射执行方法。
    我们知道这个mMethod实际上指向的是应用ActivityThread的main方法。
    进入应用端，看ActivityThread的main方法实现。


## 应用端处理

- 10 main
    
    ```
    /** ActivityThread **/
    public static void main(String[] args) {
        Looper.prepareMainLooper();
        ActivityThread thread = new ActivityThread();
        thread.attach(false);
        Looper.loop();
    }
    ```
    main方法包括三部分
    - Looper.prepareMainLooper
    - thread.attach
    - Looper.loop
    
- 11 prepareMainLooper
    ```
    /** Looper **/
    public static void prepare() {
        sThreadLocal.set(new Looper());
    }
    ```
    创建一个Loper对象，并保存到当前线程的ThreadLocal中
    
- 12 attach
    
    ```
    /** ActivityThread **/
    ActivityManager mgr = ActivityManagerNative.getDefault();
    mgr.attachApplication(mAppThread);
    mInstrumentation = new Instrumentation();
    mInitialApplication = context.mPackageInfo.makeApplication(true, null);
    mInitialApplication.onCreate();
    ```
    第三行代码，通过binder调用,将进程的Binder关联到ASM中
    创建Application对象，并调用我们熟悉的的onCreate方法
    探究Application对象的创建过程
- 13 attachApplication
- 14 attachApplicationLocked
    
    ```
    /** AMS **/
    private final boolean attachApplicationLocked(IApplicationThread thread,int pid) {
        List<ProviderInfo> providers =  generateApplicationProvidersLocked(app) ;
        thread.bindApplication(processName, appInfo, ...)
    }
    ```
    在AMS中，做了很多事，其中收集了App的Provider信息,再次通过binder调用到App端的进程中
    
- 15 bindApplication

    ```
    /** ActivityThread **/
    public final void bindApplication(String processName, ApplicationInfo appInfo ...){
        AppBindData data = new AppBindData();
        data.processName = processName;
        data.appInfo = appInfo;
        data.providers = providers;
        //...
        sendMessage(H.BIND_APPLICATION, data);
    }
    ```
    组装AMS端传过来的数据，发送到Handler上，我们知道，这个Handler是Actvith上的mH对象，在handleMessage方法中又分发到了ActivityThread上的handleBindApplication中
    
- 16,17 handleBindApplication
    
    ```
    private void handleBindApplication(AppBindData data) {
        mInstrumentation = new Instrumentation();
        Application app = data.info.makeApplication(data.restrictedBackupMode, null);
        List<ProviderInfo> providers = data.providers;
        if (providers != null) {
            installContentProviders(app, providers);
        }
        mInstrumentation.callApplicationOnCreate(app);
    }
    ```
    在方法中干了三件事
    - 创建Application对象(18)
    - 初始化Provider (本篇文章不关心)
    - 调用mInstrumentation.callApplicationOnCreate (21)
    
- 18 makeApplication

    ```
    /** LoadedApk **/
    public Application makeApplication(boolean forceDefaultAppClass,Instrumentation instrumentation) {
        if (mApplication != null) {
            return mApplication;
        }
        String appClass = mApplicationInfo.className;
        java.lang.ClassLoader cl = getClassLoader();
        ContextImpl appContext = ContextImpl.createAppContext(mActivityThread, this);
        app = mActivityThread.mInstrumentation.newApplication(cl, appClass, appContext);
        appContext.setOuterContext(app);
    }
    ```
    成员变量appClass为Application的全限定名，默认为android.app.Application。
    或者是在manifest中注册的自定义Application全限定名。
    在第8行中，为Application创建打了一个ContextImpl
    调用Instrumention的newApplication方法初始化Application

- 19 createAppContext
    ```
    public Application newApplication(ClassLoader cl, String className, Context context){
        //函数调用
        return newApplication(cl.loadClass(className), context);
    }
    static public Application newApplication(Class<?> clazz, Context context){
        Application app = (Application)clazz.newInstance();
        app.attach(context);
        return app;
    }
    ```
    可以看到，newApplication函数中，创建了Application对象，并调用了attach方法。
    > 由此可知，在App层面，attach方法进程启动过程中所能接触到的最早的时机。
    

- 20 略
- 21 callApplicationOnCreate
    
    ```
    public void callApplicationOnCreate(Application app) {
        app.onCreate();
    }
    ```
    很简单，调用了我们经常接触到的Application的onCreate方法
- 22 略
- 23 loop
    
    ```
    /** Looper **/
    public static void loop() {
        Looper me = myLooper();
        MessageQueue queue = me.mQueue;
        while (true) {
            Message msg = queue.next(); // might block
            if (msg != null) {
                 msg.target.dispatchMessage(msg);
            }
            msg.recycle();
        }
    }
    ```
    可以看到，最后在UI线程中开启一个死循环，不断轮询消息，并做分发处理。
    
至此，应用进程启动过程分析完毕


  [1]: http://static.zybuluo.com/qh438406812/0jfd9hhh33c7fc69hbwpoe99/android_process_start.svg
  [2]: https://lucky-chen.github.io/2017/01/25/android-activity-ams-wms/