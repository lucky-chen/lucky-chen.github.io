---
title: FlutterEngine AndroidX/Support适配
categories: Flutter
date: 2020-05-25
---
# 概要

[Flutter 1.17 | 2020 首个稳定版发布！](https://mp.weixin.qq.com/s/VXNbqxpoVDJeOPkBt5_88A) 全线迁移到AndroidX,现有app迁移成本巨大(几乎不可能迁移)

- 改造Flutter engine、工具链，1.17支持support库
- 跟一下工具链`flutter create`的源码实现方式

<!-- more -->

# 背景


前不久,Google发布了[Flutter 1.17 | 2020 首个稳定版发布！](https://mp.weixin.qq.com/s/VXNbqxpoVDJeOPkBt5_88A)。按照Google的说法，__更快速流畅的动画、更小巧的应用尺寸，以及更低的内存占用__。列几个比较重要的特性:

- 移动端性能和文件体积优化
    - 在应用体积上做出了可观的改进。比如 Flutter Gallery 范例应用，9.6MB(1.17)->8.1MB(1.12)，体积减少了 18.5%
    - 快速滚动大型图片时内存占用减少了 70%
    - 在默认的导航场景下 (不包含透明图层内容的导航路径) 1.17 版的速度提升了 20%-37%。简单 iOS 动画的 CPU/GPU 占用可减少高达 40%
- Metal 将 iOS 性能提升 50% 
- 相比 1.12，解决了 6,339 个 Issue,，这是史无前例的大进展，意味着更加稳定成熟。



# 问题

因此，升级到1.17无疑是一个非常有诱惑力的选择.但是在尝试过程中碰到一个非常严重的问题:

- __新版本Flutter包括engine到工具链，全线使用AndroidX,不再兼容support__，
- 现有app几乎是不可能因为flutter升级到androidx的，风险太大，又没啥收益。

本篇文章就是阐述如何 __解决Flutter全线使用AndroidX导致现有应用无法兼容(support库)的问题__。


# 先说结论

通过修改FlutterEngine、FlutterFrameWrok的工具链，__我们已经支持编译出支持support库的1.17版本的Flutter产物，业务方不需要任何修改__，切换到新分支即可使用。


# 修改原理

原理很简单，细节是魔鬼: 把AndroidX依赖改成supprot。

先看一下flutter的架构图

![](https://pic1.zhimg.com/v2-b97521ab2a1df3b22a3f4a555cf56386_r.jpg)


这是一张运行时分层的图，实际上还有一部分编译工具链的部分。由于只是涉及AndroidX,所以本次只需要修改2个地方

- Embedder(Engine仓库中)
- 工具链(Flutter Framework仓库中)

## 修改FlutterEngine(Embedder)

与预想中的不同，Engine的修改是比较简单的，只需要回滚AndroidX的提交，处理一小部分冲突即可。
- commitid `025e2d82`，
- log`Migrate embedding to AndroidX (#17075)`

涉及30-40个文件，看起来改了一大堆，实际上逻辑很简单

- 换包名，把"import androidx.xxx."换成"import android.support.xxx"
- 修改生成的依赖文件，即`flutter_embedding_xxx.pom`中声明的依赖

## 修改工具链

工具链修改反而是比较麻烦的,主要是无法直接revert对应提交，全是冲突.因此只能根据提交手动反向改.

- commitid `4049889d9eecc8fb3eda316a5c371eeb636b2ae5`
- log `Make --androidx flag a noop in flutter create (#52340)`


有经验的老司机一看到有`build.gradle.tmpl`、`Flutter.java.tmpl`以及`create.dart`、`plugins.dart`这种关键字基本就明白了:__Flutter的工程结构是从模版生成的__，

趁着这次改动，我们可以进步探究下工具链的源码是实现:

- flutter工程是怎么创建的
- 工程结构是从哪里来的(.android .ios)

# Flutter工具链创建工程结构源码分析

flutter的创建命令如下
```
flutter create module/plugin/....
```

create对应的命令`CreateCommand`，注册在`executable.dart`的`main`函数中
```
//executable.dart
Future<void> main(List<String> args) async {

   //注册命令
  await runner.run(args, <FlutterCommand>[
    BuildCommand(verboseHelp: verboseHelp),

    //create命令，来自create.dart
    CreateCommand(),
  ];
 
}

```
当运行命令时，会找到`CreateCommand`,并运行它的`runCommand`方法


```
//create.dart
Future<FlutterCommandResult> runCommand() async {
  switch (template) {
      case FlutterProjectType.app:
        generatedFileCount += await _generateApp(relativeDir, templateContext, overwrite: overwrite);
        break;
      case FlutterProjectType.module:
        generatedFileCount += await _generateModule(relativeDir, templateContext, overwrite: overwrite);
        break;
      case FlutterProjectType.package:
        generatedFileCount += await _generatePackage(relativeDir, templateContext, overwrite: overwrite);
        break;
      case FlutterProjectType.plugin:
        generatedFileCount += await _generatePlugin(relativeDir, templateContext, overwrite: overwrite);
        break;
    }
}
```

可以看到，这里分发了几个类型的创建命令

- app
- module
- package
- plugin

以`_generatePlugin`为例

```
Future<int> _generatePlugin(...) async {
    
    //1.生成plugin的工程结构
    generatedCount += await _renderTemplate('plugin', directory, templateContext, overwrite: overwrite);
  
    //2.设置各种模版变量
    templateContext['androidIdentifier'] = _createAndroidIdentifier(organization, exampleProjectName);
    templateContext['iosIdentifier'] = _createUTIIdentifier(organization, exampleProjectName);
    
    //3.生成plugin中demo app的工程结构
    generatedCount += await _generateApp(project.example.directory, templateContext, overwrite: overwrite);
    return generatedCount;
  }
```

继续看_renderTemplate方法

```
Future<int> _renderTemplate(...) async {
     //读取模版
    final Template template = await Template.fromName(templateName, fileSystem: globals.fs);
    //根据模版和参数生成具体的工程文件
    return template.render(directory, context, overwriteExisting: overwrite);
}
```


我们ls看一下`flutter/packages/flutter_tools/templates`模版文件夹下面的目录

```
.
├── app
│   ├── README.md.tmpl
│   ├── android-java.tmpl
│   ├── android-kotlin.tmpl
│   ├── android.tmpl
│   ├── ios-objc.tmpl
│   ├── ios-swift.tmpl
│   ├── ios.tmpl
│   ├── lib
│   ├── linux.tmpl
│   ├── macos.tmpl
│   ├── projectName.iml.tmpl
│   ├── pubspec.yaml.tmpl
│   ├── test
│   ├── web
│   └── windows.tmpl
├── cocoapods
│   ├── Podfile-ios-objc
│   ├── Podfile-ios-swift
│   └── Podfile-macos
├── driver
│   └── main_test.dart.tmpl
├── module
│   ├── README.md
│   ├── android
│   ├── common
│   └── ios
├── package
│   ├── CHANGELOG.md.tmpl
│   ├── LICENSE.tmpl
│   ├── README.md.tmpl
│   ├── lib
│   ├── projectName.iml.tmpl
│   ├── pubspec.yaml.tmpl
│   └── test
└── plugin
    ├── CHANGELOG.md.tmpl
    ├── LICENSE.tmpl
    ├── README.md.tmpl
    ├── android-java.tmpl
    ├── android-kotlin.tmpl
    ├── android.tmpl
    ├── ios-objc.tmpl
    ├── ios-swift.tmpl
    ├── ios.tmpl
    ├── lib
    ├── linux.tmpl
    ├── macos.tmpl
    ├── projectName.iml.tmpl
    ├── pubspec.yaml.tmpl
    ├── test
    └── windows.tmpl
```
非常明显, __我们创建的module、plugin，android、iOS工程都是由`templates`目录下的工程模版结构生成而来__ ,挑一个`plugin/android-java.tmpl/src/main/java/androidIdentifier/pluginClass.java.tmpl`,大概扫一下内容，是不是似曾相识？

```
package {{androidIdentifier}};

{{#useAndroidEmbeddingV2}}
{{#androidX}}
import androidx.annotation.NonNull;
{{/androidX}}
{{^androidX}}
import android.support.annotation.NonNull;
{{/androidX}}

import io.flutter.embedding.engine.plugins.FlutterPlugin;
import io.flutter.plugin.common.MethodCall;
import io.flutter.plugin.common.MethodChannel;
import io.flutter.plugin.common.MethodChannel.MethodCallHandler;
import io.flutter.plugin.common.MethodChannel.Result;
import io.flutter.plugin.common.PluginRegistry.Registrar;

/** {{pluginClass}} */
public class {{pluginClass}} implements FlutterPlugin, MethodCallHandler {
  private MethodChannel channel;

  @Override
  public void onAttachedToEngine(@NonNull FlutterPluginBinding flutterPluginBinding) {
    channel = new MethodChannel(flutterPluginBinding.getFlutterEngine().getDartExecutor(), "{{projectName}}");
    channel.setMethodCallHandler(this);
  }
  public static void registerWith(Registrar registrar) {
    final MethodChannel channel = new MethodChannel(registrar.messenger(), "{{projectName}}");
    channel.setMethodCallHandler(new {{pluginClass}}());
  }

  @Override
  public void onMethodCall(@NonNull MethodCall call, @NonNull Result result) {
    if (call.method.equals("getPlatformVersion")) {
      result.success("Android " + android.os.Build.VERSION.RELEASE);
    } else {
      result.notImplemented();
    }
  }

  @Override
  public void onDetachedFromEngine(@NonNull FlutterPluginBinding binding) {
    channel.setMethodCallHandler(null);
  }
}
{{/useAndroidEmbeddingV2}}
```

很明显，`pluginClass.java.tmpl`就是plugin工程中为我们生成的`XXXPlugin.java`的模版代码,其它如`build.gradle`、`pubspct.yaml`也是类似

有了模版，那肯定有模版生成为具体的文件的代码。

- `flutter/packages/flutter_tools/lib/src/template.dart` 处理模版文件
- 渲染用的是`mustache_template`这个库中`render.dart`

看一下`template.dart`
```
class Template {
    static const String templateExtension = '.tmpl';
    static const String copyTemplateExtension = '.copy.tmpl';
    static const String imageTemplateExtension = '.img.tmpl';
    
    int render(){
        //如果是.tmpl结尾的文件，将存储的变量context(包名、版本号之类)和模版内容templateContents(pluginClass.java.tmpl)传给render，
        //生成最终的目标文件(XXXPlugin.java)
        if (sourceFile.path.endsWith(templateExtension)) {
            final String templateContents = sourceFile.readAsStringSync();
            final String renderedContents = globals.templateRenderer.renderString(templateContents, context);

            //将生成的内容，写入创建的工程文件中
            finalDestinationFile.writeAsStringSync(renderedContents);
            return;
      }
    }
}
```
没什么复杂的，只是一个模版生成而已。了解这部分原理后，其实我们可以改动很多东西。

- 初级玩法：比如可以修改`build.gradle.tmpl`，将私有仓库的地址直接写到里面，加快编译速度以及解决私有lib找不到的问题
- 进阶玩法：修改结构，加一些脚本，配合公司的打包平台，进行定制化。

```
//在模版中添加私有仓库地址
//templates/plugin/android-java.tmpl/build.gradle.tmpl

buildscript {
    repositories {
        maven { url "私有仓库地址" }
        google()
        jcenter()
    }

    dependencies {
        classpath 'com.android.tools.build:gradle:3.5.0'
    }
}

rootProject.allprojects {
    repositories {
         maven { url "私有仓库地址" }
        google()
        jcenter()
    }
}

```

# 总结


- 1.17 兼容support，改动虽多，但并不复杂，逻辑上也没有修改
- flutter tools是通过模版生成最终的工程结构
- flutter tools 其它命令实现也有迹可循，框架就在这里。