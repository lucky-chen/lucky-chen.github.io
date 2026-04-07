---
title: 《深入理解JVM虚拟机》读书笔记——第7章 虚拟机类加载机制
categories: [JVM, VM]
date: 2016-11-27
---

# 主要内容：

- 类加载时机
- 类加载过程
- 类加载器(ClassLoader)

<!--more-->

## 类加载时机

7个阶段: 加载、验证、准备、解析、初始化、使用、卸载
![image_1b8ocreet1vun1vqg89g1a6uj449.png-74.5kB][1]

- 加载-验证-准备-初始化-卸载5个阶段顺序是固定的
- 为了支持Java的动态绑定，解析有可能会在初始化阶段之后进行。

### 触发加载阶段时机
JVM规范中没有强制规范在何种情况下开始加载这一个阶段，由虚拟机具体实现。

### 触发初始化阶段时机
1. 遇到new、getstaic、putstaic和invokestaic 4条字节码指令，对应new关键字实例化对象、读取或设置一个类的静态字段、调用一个类的静态方法。
2. 使用java.lang.reflect反射包方法对类进行反射调用
3. 初始化一个类时,父类若未初始化，则先触发父类的初始化
4. 虚拟机启动时，初始化执行的主类
5. jdk1.7 ,java.lang.MethodHandle实例解析结果REF_getStaic、REF_putStaic、REF_invokeStaic的方法句柄，冰洁句柄对应的类未初始化，则触发初始化操作

以上五种被称为对一个类的主动引用，其余引用类的方式称为被动引用，不触发初始化，例子：
>  
1. 通过子类引用父类的静态字段，不会导致子类的初始化
2. 通过数组定义引用类，不会触发此类的初始化 `Class[] array = new Class[10]`
3. 引用类的常量。常量在编译其间存入类的常量池中，本质上没有直接引用到定义常量的类，不触发初始化
    `public staic final String HELLO_WORD="hello word";`

## 类加载过程

### 加载阶段
1. 通过一个类的全限定名来获取定义此类的二进制字节流
2. 将这个字节流所代表的静态存储结构转化为方法区的运行时数据结构
3. 在内存中生成一个代表此类的java.lang.Class对象，作为方法区这个类的各种数据的入口

### 验证阶段

验证阶段是链接阶段的第一步，是为了确保Class文件的字节流符合当前虚拟机的要求。
__验证阶段的工作量在虚拟机类加载系统中占据了相当大的一部分__
可以使用 -Xverfy:none参数关闭验证阶段

1. 文件格式验证
    > 验证Class文件格式规范，并能被当前虚拟机处理,如果验证不过，抛出java.lang.VerifyError异常

    - 是否以魔数0xCAFEBABE开头
    - 主次版本是否在当前虚拟机处理范围
    - 常量池的常量中是否由不被支持的常量类型
    - 指向常量的索引值中是否有指向不存在活着不符合类型的常量
    ...
    
2. 元数据验证
    > 对字节码信息进行语义分析，保证符合Java语言规范

    - 是否有父类
    - 是否继承final类
    - 类中字段、方法是否与父类产生矛盾
    ...

3. 字节码验证
    > 分析数据流和控制流，确定程序语义是合法、符合逻辑的
    
    - 保证跳转指令不会跳到方法体以外的指令上
    - 保证方法体中的类型转换是有效的
    ...
4. 符号引用验证
    > 对类自身以外(常量池中的符号引用)的信息及进行匹配校验。发生在虚拟机将符号引用转化为直接引用的时候，转化动作在解析阶段发生。

    - 符号引用中通过字符串描述的全限定名是否能找到对应的类
    - 指定类中是否存在符合方法的字段描述符及简单名称所描述的方法和字段
    - 符合引用中的类、字段、方法的访问行是否能被当前类访问
    ...
    若验证不过，抛出java.lang.IncompatibleClassChangeError的子类，如：IlleglaAccessErroe、NoSuchFieldErroe、NoSuchMethodErroe等
    
### 准备阶段

准备阶段是正式为类变量分配内存并设置类变量初始值的阶段。

- 这一阶段进行内存分配的仅包括类变量(static 修饰的变量)。
- 这些变量所使用的内存在方法区进行分配。

初始值分配的两种情况
```
//1. 通常情况
public static int value =123 
//2. 字段的属性表中存在ConstantValue属性
public static final int value =123 
```
在此阶段后
1. value的值为0，将value赋值为123的动作在初始化阶段执行。
2. value的值为123

### 解析阶段

解析阶段是虚拟机将常量池内的符号引用替换为直接引用的过程。

- 符号引用：以一组符号来描述所引用的目标，符合可以是任何形式的字面量。符号引用与虚拟机实现的内存布局无关,引用的目标不一定已经加载到内存中
- 直接引用：可以是直接指向目标的指针、相对偏移量挥着能间接定位到目标的句柄。直接引用和虚拟机的内存布局相关,引用的目标必须存在内存中。

包括四个方面的解析

1. 类或接口的解析
2. 字段解析
3. 类方法解析
4. 接口方法解析

### 初始化阶段

初始化阶段是执行类构造器<clinit>方法的过程，真正开始执行类中定义的Java程序代码。
1. <clinit>()方法是由编译器收集类中所有类变量赋值动作和静态语句块( `static{}` )合并产生。
2. 虚拟机保证在子类的<clinit>()方法执行之前，父类的<clinit>()方法已经执行完毕
3. 由2可得，父类定义的静态语句块先于子类执行
4. <clinit>()方法对于类或者接口不是必需的
5. 执行接口的<clinit>()方法，不需要先执行父接口的<clinit>()方法，当父接口中定义的变量使用时，父接口才会初始化，接口的实现类在初始化时也不会执行接口的<clinit>()方法
6. __虚拟机会保证一个类的<clinit>()方法在多线程换进中被正确的枷锁、同步__。如果多个线程同时去初始化一个类，只有一个线程去执行这个类的<clinit>方法，其他线程阻塞等待。
    > 这也是Java单例写法中 静态类 SingleTonHodler 的实现原理
    

## 类加载器

### 类与类加载器
> 实现 "通过一个类的全限定名来获取描述此类的二进制流"动作的代码模块称为"类加载器"

对于任意一个类，都需要由加载它的类加载器和这个类本身一同确立其在Java虚拟机中的唯一性。

### 双亲委派模型

从Java虚拟机角度来看，只有两种类加载器：
1. 启动类加载器(Bootstrap ClassLoader),使用C++实现，是虚拟机自身的一部分
2. 其它加载器，由Java语言实现，独立与虚拟机外部，继承字java.lang.ClassLoader。

从Java开发角度看，三种类加载器

1. 启动类加载器(Bootstrap ClassLoader)
    - 负责从<JAVA_HOME>/lib目录和被-Xbootclasspath指定的路径中,将虚拟机识别的类库(按照文件名识别,如rt.jar)加载到虚拟机内存中。
    - 启动类加器无法被Java程序直接引用。
2. 扩展类加载器（Extension ClassLoader）
    - 负责加载<JAVA_HOME>/lib/ext目录中，或者被java.ext.dirs系统变量所指定路径中的所有类库
    - 由sun.misc.Launcher\$ExtClassLoader实现
3. 应用程序类加载器 (Application ClassLoader)
    - 负责加载用户类路径(ClassPath)上指定的类库
    - 由sun.misc.Launcher\$AppClassLoader实现

这几个类加载器之间的关系如图：
![image_1b8ol9qsf184v1bfk18o7raa198jm.png-71.6kB][2]

在双亲委派模型中，除了最顶层的启动类加载器外，其余的类加载器都必须由自己的父类加载器。

双亲委派模型工作过程:

1. 如果一个类加载器收到了类加载请求，它首先不会自己去尝试加载这个类，而是把类加载请求委派给父类加载器去完成。
2. 每一层的类加载器都把类加载请求委派给父类加载器，直到所有的类加载请求都应该传递给顶层的启动类加载器。
3. 如果顶层的启动类加载器无法完成加载请求，子类加载器尝试去加载，如果连最初发起类加载请求的类加载器也无法完成加载请求时，将会抛出ClassNotFoundException。

> 双亲委派的优点是Java类它的类加载器一起具备了一种带优先级的层次关系，越是基础的类，越是被上层的类加载器进行加载，保证了java程序的稳定运行。

实现代码：
```
protected synchronized Class<?> loadClass(String name, Boolean resolve) throws ClassNotFoundException{    
    //首先检查请求的类是否已经被加载过    
    Class c = findLoadedClass(name);    
    if (c == null){    
        try{    
            if(parent != null){
                //委派父类加载器加载    
                c = parent.loadClass(name, false);    
            }    
            else{
                //委派启动类加载器加载    
                c = findBootstrapClassOrNull(name);     
            }    
        }catch(ClassNotFoundException e){    
            //父类加载器无法完成类加载请求    
        }    
        if(c == null){
            //本身类加载器进行类加载    
            c = findClass(name);    
        }    
    }    
    if(resolve){    
        resolveClass(c);    
    }    
    return c;    
}
```

---
书籍 ：《深入理解Java虚拟机》第七章  周志明 著

  [1]: http://static.zybuluo.com/qh438406812/90ncqj9nj4zpoett29bxnidl/image_1b8ocreet1vun1vqg89g1a6uj449.png
  [2]: http://static.zybuluo.com/qh438406812/bket3ekssq7kzj5w40kgj8hf/image_1b8ol9qsf184v1bfk18o7raa198jm.png