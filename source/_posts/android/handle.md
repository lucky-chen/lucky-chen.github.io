---
title: Android源码之Handler
categories: Android
date: 2016-08-25
---

# 主要思想
1. 通过MessageQueqe保存mesage
2. 通过looper轮询MessageQueqe
3. handler回调处理message
<!--more-->

开始看源码喽~

1. 创建Handler

    ```
    public Handler(Callback callback, boolean async) {
        mLooper = Looper.myLooper();
         if (mLooper == null) {
            throw new RuntimeException(
                "Can't create handler inside thread that has not called Looper.prepare()");
        }
        mQueue = mLooper.mQueue;
        mCallback = callback;
    }
    ```
    构造函数中,赋值了三个重要的对象 Looper、消息队列mQueue、和一个可选的callback。重点关注Looper
    ```
    public static @Nullable Looper myLooper() {
        return sThreadLocal.get();
    }
    ```
    从ThreadLocal里面取出一个Looper，如果没有会在Handler构造函数中报错。这就是为什么在新的新的线程中创建Handler，要调用Looper.prepare和Looper.loop()方法,这两个方法会初始化Looper.UI线程需要的原因是，在应用启动时候，已经做了初始化Looper的操作。
2. Looper初始化
    
    从Looper的prepare函数中看起
    ```
    private static void prepare(boolean quitAllowed) {
        sThreadLocal.set(new Looper(quitAllowed));
    }
    ```
    创建了一个Looper，并放到当前线程的ThreadLocal中去。继续看构造函数
    ```
    private Looper(boolean quitAllowed) {
        mQueue = new MessageQueue(quitAllowed);
        mThread = Thread.currentThread();
    }
    ```
    创建了一个消息队列并持有了当前线程的引用。接着看Looper的loop()函数
    ```
    public static void loop() {
        //myLooper返回的是sThreadLocal.get()
        final Looper me = myLooper();
        MessageQueue queue = me.mQueue;
        //轮询消息队列
        for (;;) {
            Message msg = queue.next(); // might block
            //调用handler的dispatchMessage方法。
            msg.target.dispatchMessage(msg);
            //回收复用
            msg.recycleUnchecked();
        }
    }
    ```
    函数很简单，不断轮询looper上的消息队列，当拿到一个message时，找到message对应的handler，调用handler的dispatchMessage方法，处理message.
    > __Handler会造成内存泄漏的原因__
    注意第7行函数，message 强引用了handler。
    这也是为什么在Activity中创建Handler的非静态内部类会造成内存泄漏的原因：
    由于非静态内部类会持有外部类的引用,形成一个引用链,message->handler->activity。
    而mesage在队列中,回收时机不确定，GC准备回收Activity时，发现还在被message间接引用，不再回收Activity对象.
    通常Activity中有着大量的对象，无法回收Activity导致这些对象也无法回收，形成严重的内存泄漏。
    建议使用弱应用，或者使用MVP等模式解耦Activity
    
3. Handler分发Message
    
    先看dispatchMessage方法
    ```
    public void dispatchMessage(Message msg) {
        if (msg.callback != null) {
            handleCallback(msg);
        } else {
            if (mCallback != null) {
                if (mCallback.handleMessage(msg)) {
                    return;
                }
            }
            handleMessage(msg);
        }
    }
    ```
    处理message有三条路。
    1). 若msg存在callBack,则使用msg上的callback
    2). 否则检查handler上的mCallback(默认为空)，不为空则使用mCallback的方法
    3). 最后调用我们熟知的handler上的handleMessage方法。
    
    >注意第二点，利用这个特性，可以干很多事。比如DroidPlugin hook了 ActivityThrad上的mH类，用与Activity的插件化
    
## Handler 发送message

handler初始化和分发消息的逻辑已经分析完毕，接下来看最后一部分-发送消息的路径.

1. sendMessage方法
    ```java
    public final boolean sendMessage(Message msg){
        return sendMessageDelayed(msg, 0);
    }
    ```
    最终会调用到sendMessageAtTime方法

2. mesage加入到MessageQueue中
    ```java
    public boolean sendMessageAtTime(Message msg, long uptimeMillis) {
        MessageQueue queue = mQueue;
        return enqueueMessage(queue, msg, uptimeMillis);
    }
    ```
    函数将message加入到messageQueue中,看下加入队列的实现

3. 入队实现
    ```
    /** MessageQueue **/
    boolean enqueueMessage(Message msg, long when) {
        //单链表+1的操作
        Message p = mMessages;
        msg.next = p;
        mMessages = msg;
        //...    
    }
    ```
    很简单，就是加个message加到队列的末尾。在回想之前Looper轮询msgQueqe的操作，整个流程都清晰了。
    
    
    
    



