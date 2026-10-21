# 构建与交付

## AXIOM
1. [开发者] 修改一个库时，不应编译其他库，也不应先安装 .NET。
   - 理由：维护成本包括等待验证的时间。
2. [使用者] npm 包必须在没有本仓源码、旧仓和编译器的目录中使用。
   - 理由：只有真实安装能证明它已经是库。

## LEMMA
1. [AXIOM 1] 每个已实现子模块一个显式 fsproj；直接调用 npm Fable 编译器，不建立第二份源文件清单。组合通过公开 ESM 入口使用参与者，构建不内联兄弟库。
   - 推理：工程文件已经是编译输入的唯一清单。
2. [AXIOM 2] 交付验收使用实际 tarball，不用 workspace link、NODE_PATH 或源码回退。
   - 推理：链接会掩盖遗漏文件和反向依赖。
3. [AXIOM 2; LEMMA 1] 公开入口由已实现模块推出：每个带 fsproj 的模块恰好一个 exports 项，指向 build 脚本产出的入口文件，类型声明在 files 白名单里；没有指向不存在模块的入口。
   - 推理：多人并行加模块时，exports、files 与 fsproj 是三处手写清单；任何一处漏写，开发期 `file:` 链接仍能用，安装包却缺文件或缺类型。
4. [AXIOM 1; LEMMA 1] 构建按模块增量：模块的编译输入是 fsproj 文本、其显式列出的源文件、工具链版本（Fable 编译器、Fable 运行库、esbuild、Node 主版本）与构建脚本本身。输入摘要未变、且 `dist/<name>` 与上次记录的逐文件摘要一致时跳过该模块；`--force` 或 `WANXIANGLI_BUILD_FORCE=1` 全部重编。产物不得含进程号等非输入信息，同样输入得到同样字节。
   - 推理：fsproj 已是唯一输入清单，摘要可以完整覆盖它；产物逐文件核对使被改动或被换掉的 dist 不会被误认成缓存。摘要记录在 `.build-stamps/`，仅在产物原子替换成功后写入。

此条约束独立发行验收，不禁止宿主在开发期通过 submodule 和 `file:wanxiangli` 消费源码依赖。任何打包所得 `.tgz` 都只能是临时构建产物，永远不得进入 Git。开发接线的通过不能代替发行包验收。

## SPEC
1. [LEMMA 1] `npm run build -- lifecycle`、`eventstore`、`assembly`、`process`、`trace`、`session` 可分别运行；不允许源码跨工程编译。assembly 的运行依赖由公开入口及类型声明表达，不靠 ProjectReference 或私有 dist 路径。process、trace、session 不依赖其他职责或 SQLite。
   - 证明：`tests/build.test.mjs` 在只有该模块源码的临时目录中，实际编译并跑其全部测试；另用非法工程证明跨源引用被拒、真实编译错误不覆盖旧产物。
2. [LEMMA 2] 干净消费者安装 tarball 后完成真实落盘、重启和生命周期场景。
   - 证明：`tests/package.test.mjs` 实际 npm pack、安装到干净目录、TypeScript 正反用例、Node/Bun 真实外部效果后强杀并恢复；不使用 workspace link 或源码回退。
3. [LEMMA 1, 2; 根 LEMMA 7] 基础 Work 与持久组合兑现相同领域规则，但分别标明 Applied 与 Committed；拆除 C 后基础能力保留，不声称持久保证保留。
   - 证明：`tests/contracts.test.mjs` 共用的领域断言在两种整体上通过；`tests/build.test.mjs` 在只有 lifecycle 源码、没有其他实例和服务替身的目录运行其全部测试。
4. [LEMMA 1, 2] 第二刀必须在第一刀缺席时完成真实物理能力验收，新增能力不扩张第一刀接口。
   - 证明：`tests/build.test.mjs` 单独编译 process 并运行其全部测试，检查不覆盖其他产物；`tests/process-package.test.mjs` 安装后删掉第一刀文件再运行 Node/Bun 消费者，覆盖真实 stdin、大输出和进程组信号。没有给构建脚本增加特殊分支。
5. [LEMMA 1, 2] 第三刀的基础轨迹在前两刀缺席时仍可独立消费；与存储合作的字节保证以真实提交及重启证明，不把内存 Appended 当作 durable 成功。
   - 证明：`tests/trace-package.test.mjs` 实际安装包、TypeScript 正反用例、Node/Bun 保持 SQLite 连接打开时强杀及重启；随后删除前两刀产物，Trace 单独捕获和恢复仍通过。`tests/build.test.mjs` 的隔离构建与产物保留检查覆盖第三刀；不改变现有构建脚本。
6. [LEMMA 1, 2] 第四刀在前三刀缺席时保持独立，组合层另证明持久预留、物理收尾与 Work 退休的先后关系。
   - 证明：`tests/ownership-package.test.mjs` 在实际 tarball 上运行 Node/Bun 的物理进程阻塞退休、协调进程 SIGKILL 恢复，随后删除前三刀产物与类型做单独消费和 TypeScript 正反用例。`tests/ownership-composition.test.mjs` 覆盖真实提交竞争；构建脚本没有新增专用流程。
7. [根 AXIOM 2, 3] Git 只保存源码、规则与构建描述，不保存 `.tgz` 包。旧的 tarball 例外撤销。
   - 证明：`tests/repository.test.mjs` 检查实际 Git 索引与历史，2026-10-20 在 0.9.0 上执行通过。
8. [LEMMA 3] exports、files 与已实现模块三者一致。
   - 证明：`tests/exports.test.mjs`；删掉一个模块的入口、漏掉一个类型声明、或留一个指向已删模块的入口，分别实测报红（CUT-33 证据）。
9. [LEMMA 4] 未改动的模块不重编，改动的模块重编，篡改过的产物重编，`--force` 全部重编；缓存产物与强制重编产物逐字节相同。
   - 证明：`tests/build.test.mjs` 的 SPEC[build-002]：未改动跳过、改源码重编、改回再重编、篡改产物重编、`--force` 全部重编，缓存产物与冷构建、强制重编逐字节相同。
