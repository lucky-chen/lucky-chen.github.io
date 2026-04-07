---
title: Http版本协议变迁历史
categories: NetWork
date: 2016-08-06
---

# 概览

|版本|底层协议|特性|备注|
|:---|:---|:---|:---|
|1.x|tcp|更多的缓存控制策略<br>请求范围设置(断点续传)<br>新增了错误状态响应码<br>Host头处理，传递主机名<br>支持长连接|:---|
|https|tcp+tls|需要证书<br>TLS加密传输协议<br>|:---|
|2.0|tcp+tls|二进制格式<br>多路复用<br>header压缩<br>服务端推送|:---|
|3.0|udp|减少了TCP三次握手及TLS握手时间<br>连接迁移<br>线头阻塞(HOL)问题的解决更为彻底|:---|


<!--more-->

# Http 1.x

## 报文格式

请求报文

![](/image/network/http_request.png)


响应报文

![](/image/network/http_response.png)


## 链接过程

- 建立一个TCP套接字连接(__3次握手__)
- 客户端向服务器发送一个文本的请求报文
- 服务器响应报文: 解析请求，定位请求资源。服务器将资源复本写到TCP套接字，由客户端读取
- 释放连接TCP连接:
    - 若connection 模式为close，则服务器主动关闭TCP连接，客户端被动关闭连接，释放TCP连接; (__4次挥手__)
    - 若connection 模式为keepalive，则该连接会保持一段时间，在该时间内可以继续接收请求;


# Http 2.0

- 特性
    - 二进制报文
    - 链接多路复用
    - 头部压缩
    - Server Push
- 相关文档
    - [协议文档]( http://httpwg.org/specs/rfc7540.html)
    - [速度对比](https://l-zhi.com:8081/item1.html)
    - [har](http://www.softwareishard.com/har/viewer/)

## 概念

- 流(Stream): 交互处理单元，表达一次完整的资源请求-响应数据交换流程
- 帧(Frame)：交换数据的基本单位，一个流有一到多个帧

## 报文

![http2.png-190.3kB][3]

HTTP/2 采用二进制格式传输数据，数据的单位是Frame,Frame的格式如下:
```
 +-----------------------------------------------+
 |                 Length (24)                   |
 +---------------+---------------+---------------+
 |   Type (8)    |   Flags (8)   |
 +-+-------------+---------------+-------------------------------+
 |R|                 Stream Identifier (31)                      |
 +=+=============================================================+
 |                   Frame Payload (0...)                      ...
 +---------------------------------------------------------------+
```
报文解释

- Length 24: Frame Payload的大小,2M
- Type: Frame类型  `DATA/HEADERS/PRIORITY/PUSH_PROMISE`
- Flags 8 `END_STREAM/END_HEADERS/PADDED/PRIORITY`
- R 1 保留位
- Stream Identifier 31 数据流id
- Frame Payload 0... 数据内容


## 多路复用

解决1.x 线头阻塞(Head-of-Line Blocking)问题，提高网路请求速度

![201504182058.png-168.7kB][1]


## Server Push

![http2-server-push.png-157.6kB][4]

- HTTP 2.0 连接后，客户端与服务器交换SETTINGS 帧，借此可以限定双向并发的流的最大数量。因此，客户端可以限定推送流的数量，或者通过把这个值设置为0 而完全禁用服务器推送。
- 所有推送的资源都遵守同源策略。换句话说，服务器不能随便将第三方资源推送给客户端，而必须是经过双方确认才行。
- PUSH_PROMISE：所有服务器推送流都由PUSH_PROMISE 发端，服务器向客户端发出的有意推送所述资源的信号。客户端接收到PUSH_PROMISE 帧之后，可以视自身需求选择拒绝这个流
- 几点限制：
    - 服务器必须遵循请求- 响应的循环，只能借着对请求的响应推送资源
    - PUSH_PROMISE 帧必须在返回响应之前发送，以免客户端出现竞态条件。

## 流：

- frame
- 属性
    - 优先级
    - 状态（生命周期）
    - 标识符
- 管理行为
    - 流量控制
    - 并发流数量

> Stream States

```
         
                             +--------+
                     send PP |        | recv PP
                    ,--------|  idle  |--------.
                   /         |        |         \
                  v          +--------+          v
           +----------+          |           +----------+
           |          |          | send H /  |          |
    ,------| reserved |          | recv H    | reserved |------.
    |      | (local)  |          |           | (remote) |      |
    |      +----------+          v           +----------+      |
    |          |             +--------+             |          |
    |          |     recv ES |        | send ES     |          |
    |   send H |     ,-------|  open  |-------.     | recv H   |
    |          |    /        |        |        \    |          |
    |          v   v         +--------+         v   v          |
    |      +----------+          |           +----------+      |
    |      |   half   |          |           |   half   |      |
    |      |  closed  |          | send R /  |  closed  |      |
    |      | (remote) |          | recv R    | (local)  |      |
    |      +----------+          |           +----------+      |
    |           |                |                 |           |
    |           | send ES /      |       recv ES / |           |
    |           | send R /       v        send R / |           |
    |           | recv R     +--------+   recv R   |           |
    | send R /  `----------->|        |<-----------'  send R / |
    | recv R                 | closed |               recv R   |
    `----------------------->|        |<----------------------'
                             +--------+

       send:   endpoint sends this frame
       recv:   endpoint receives this frame

       H:  HEADERS frame (with implied CONTINUATIONs)
       PP: PUSH_PROMISE frame (with implied CONTINUATIONs)
       ES: END_STREAM flag
       R:  RST_STREAM frame
```
## 头部压缩

减少需要传输的header大小

- 建立索引表，表示常用的请求
- 字符串进行压缩

|Index|Index|Index|
|:-|:-|:-|
|1	|authority||	
|2	|method	|GET|
|3	|method	|POST|
|4	|path|	/|
|5	|path	|/index.html|
|6	|scheme	|http|
|7	|scheme	|https|
|8	|status	|200|
|...|...|...|
|58|user-agent||
|...|...|...|
|61|www-authenticate||

缓存常用数据,保存在动态表里

![hpack.png-148.4kB][2]

```
<----------  Index Address Space ---------->
<-- Static  Table -->  <-- Dynamic Table -->
+---+-----------+---+  +---+-----------+---+
| 1 |    ...    | s |  |s+1|    ...    |s+k|
+---+-----------+---+  +---+-----------+---+
                       ^                   |
                       |                   V
                 Insertion Point      Dropping Point
```

# Http3.0

- 对线头阻塞(HOL)问题的解决更为彻底
- 切换网络时的连接保持


|机制|2.0问题|3.0方案|备注|
|:---|:---|:---|:---|
|自定义连接机制|tcp连接是由四元组标识的，分别是源ip、源端口、目的端口，一旦一个元素发生变化时，就会断开重连，重新连接|使用udp协议，不再以四元组标识，而是以一个64位的随机数作为ID来标识。 |:---|
|自定义重传机制|tcp超时的采样存在不准确的问题（原始包和重传包ack区分）|QUIC也有个序列号，是递增的|:---|
|无阻塞的多路复用|tcp协议在处理包时是有严格顺序的，当其中一个数据包遇到问题，TCP连接需要等待这个包完成重传之后才能继续进行.(前面stream2的帧没有收到，后面stream1的帧也会因此堵塞)|QUIC是基于UDP的，一个连接上的多个stream之间没有依赖|:---|
|自定义流量控制|TCP协议中，接收端的窗口的起始点是下一个要接收并且ACK的包，即便后来的包都到了，放在缓存里面，窗口也不能右移，就会导致后面的到了，也有可能超时重传，浪费带宽|QUIC的ACK是基于offset的，每个offset的包来了，进了缓存，就可以应答，应答后就不会重发|:---|


# 附录

- [HTTP的前世今生（HTTP1.1，HTTPS，SPDY，HTTP2.0，QUIC，HTTP3.0）](https://zhuanlan.zhihu.com/p/90438293)
- [HTTP1.0、HTTP2.0、HTTP 3.0及HTTPS简要介绍](https://blog.csdn.net/glpghz/article/details/106063833)
- [HTTP协议超级详解](https://www.cnblogs.com/an-wen/p/11180076.html)
- [HTTP3.0(QUIC的实现机制)](https://www.cnblogs.com/chenjinxinlove/p/10104854.html)


[1]: http://static.zybuluo.com/qh438406812/sj9s2vcx169ttt4z604mt7sj/201504182058.png
[2]: http://static.zybuluo.com/qh438406812/tjkln37060z1ng8cgs1xatxc/hpack.png
[3]: http://static.zybuluo.com/qh438406812/92dwizpb3rzlf66gz90hm58b/http2.png
[4]: http://static.zybuluo.com/qh438406812/stm3cxid5pe8ayrgasicbw59/http2-server-push.png