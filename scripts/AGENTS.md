# 构建与交付

## AXIOM
1. [开发者] 修改一个库时，不应编译其他库，也不应先安装 .NET。
   - 理由：维护成本包括等待验证的时间。
2. [使用者] npm 包必须在没有本仓源码、旧仓和编译器的目录中使用。
   - 理由：只有真实安装能证明它已经是库。

## LEMMA
1. [AXIOM 1] 每个已实现子模块一个显式 fsproj；直接调用 npm Fable 编译器，不建立第二份源文件或依赖清单。
   - 推理：工程文件已经是编译输入的唯一清单。
2. [AXIOM 2] 交付验收使用实际 tarball，不用 workspace link、NODE_PATH 或源码回退。
   - 推理：链接会掩盖遗漏文件和反向依赖。

## SPEC
1. [LEMMA 1] `npm run build -- lifecycle` 与 `npm run build -- eventstore` 可独立运行；不允许源码跨工程编译。
   - 证明：`tests/build.test.mjs` 在只有该模块源码的临时目录中，实际编译并跑其全部测试；另用非法工程证明跨源引用被拒、真实编译错误不覆盖旧产物。
2. [LEMMA 2] 干净消费者安装 tarball 后完成真实落盘、重启和生命周期场景。
   - 证明：`tests/package.test.mjs` 实际 npm pack、安装到干净目录、TypeScript 正反用例、Node/Bun 真实外部效果后强杀并恢复；不使用 workspace link 或源码回退。
