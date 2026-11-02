# program — 命名程序与请求期限

生产源码使用 F#，经 Fable 交付 JavaScript。公开入口 `wanxiangli/program` 导出 `Program`、`ProgramSession`、`ProgramInvocation`、`ProgramCatalog`、`Wait`。根目录 `AGENTS.md` 适用。

## AXIOM

1. [使用者] 会话内一个名字对应一次运行，恢复继续原现场。
   - 理由：重跑会重复已经发生的效果。
2. [使用者] call 停住所属程序，宿主、其他程序及已经发起的 SDK 操作继续响应。
   - 理由：漏写 await 不能绕过单命令约束。
3. [开发者] 程序状态、期限、恢复关系及成员投影各有唯一所有者。
   - 理由：多份状态和计时器会造成隐式续期、重复恢复或扩权。
4. [使用者] 程序结束、命令退出、工具响应与业务完成分别报告。
   - 理由：局部终态不能解除仍存在的义务。

## LEMMA

1. [AXIOM 1, 3; 根 LEMMA 3] Program() 提供登记入口，ProgramSession 组织会话内名称、调用重放与协作，私有 Run 拥有单次运行、暂停代际及终态结算。相同物理调用重放回执；新调用占用仍活动（运行中或 parked）的名字报 NAME_TAKEN，已结束的名字登记为新运行，旧运行回执仍按原调用重放，观察到旧运行的控制不作用于新运行。现场丢失不自动重跑。
2. [AXIOM 2, 3] call 先等此前 SDK 操作真实结清，再启动唯一命令；同步桥接不依赖调用者记得 await。排空超时不启动命令，暂停后结清或命令退出只保存事实，不自行放行续体。
3. [AXIOM 3] 工具严格接收 name/program/intent。准入时按 UTF8Bytes(intent) × 50ms 一次性确定绝对期限；call(command)、unpark(name,value?) 不创建预算。控制者及本次唤醒的所有目标共享期限，到期实际暂停；恢复控制者不隐式再次恢复目标。call 等待暂停扣减计算预算，请求期限仍推进。
4. [AXIOM 1, 4; 总规则 LEMMA 1] 私有代际隔离迟到控制。abandon 与会话关闭共用收尾，确认资源结清后才报告终态。正常展开运行原生 finally，强杀不保证它执行，已落盘效果不回滚。
5. [AXIOM 3, 4] 每个 Run 的终态 effects 经 settle 一次结算。目标状态和 effects 留在目标回执中，不冒充控制程序的新效果。生命周期审计按序等待，失败以 lifecycleError 保留，不把持久失败报告成成功。
6. [AXIOM 3] ProgramCatalog 是能力与成员投影的唯一来源。Manager 的 reviewOnly 投影、角色准入和业务门禁保持各自归属。编程内 join/dag 不存在；Wait 承接等待控制，独立 join() 的工作资格及结果来自既有业务 owner。
7. [AXIOM 1, 3, 4] ProgramInvocation 拥有一次调用的文件效果、显式读取和结算失败引用。它创建真实 FileSession，随后把原 API 和 settle 交给既有 ProgramSession；不复制运行表、文件快照或审计记录。宿主继续提供权限投影、返回值规则和原审计 ledger。

## 文件调用与结算

调用方创建 `ProgramInvocation`，从 `files` 取得真实文件成员，在原来的权限和活动租约下组装 API，再执行命名程序。构造和 API 组装不写入文件。只有 FileSession 报告实际 after 时才记录效果；before 交给原 ledger 准备记录，after 先保存效果再通知 ledger 已提交。

程序结束时，先按路径保留首次显式读取，向外层报告读取及效果路径；该观察原本可忽略的异常继续忽略。再等待原 ledger 结算，最后才检查成功返回值。效果按 rewritten、created、removed、moved 分组，各组保留发生顺序和重复项。失败不回滚文件，普通结算失败仍携带已发生的效果。

`settlementFailure` 单独携带原失败对象，运行回执只写入其 code/reason。即时调用可保留原失败引用；跨 unpark 不建立全局错误表。返回值检查抛错继续走 Run 的现有结算异常路径，不新加补偿或结果重写。

暂停保留原 FileSession、ledger 与效果集合。恢复目标使用它自己的集合，控制程序不冒领目标效果；关闭会话仍先运行原收尾，最终再结算。动态宿主能力由外层在每次成员调用时解析，不在 invocation 中冻结。审计策略、写入次序和等待规则仍归原 ledger。

## 永久依赖边界

program → runtime 是明确允许的永久单向物理基础依赖，只消费公开产物，不跨源码编译，不复制物理资源状态；runtime 不反向依赖 program。两者不声明为互不依赖的同级职责。Work、Journal、权限、评审、Ask 和业务 deliver 的所有权不因此改变。

旧 programming/sandbox/fs/process/pty/spool/time/wait 入口撤销，等待实现归 program/wait，不保留兼容别名。

## SPEC

1. [LEMMA 1, 4, 5] 名称唯一、会话隔离、调用重放、终态保留、迟到控制与单次结算由 `tests/002.test.mjs`、`004.test.mjs` 验证。
2. [LEMMA 2, 3] `tests/003.test.mjs`、`004.test.mjs` 使用真实执行进程与命令验证排空、漏 await、等待停表、控制和清理；不能用替身或形状断言代替物理事实。
3. [LEMMA 3] `tests/005.test.mjs` 验证顶层预算、共同到期、目标结束不撤销控制者期限、恢复控制者不再唤醒目标以及 intent 重放身份。
4. [LEMMA 5, 6; 根 SPEC 2] `tests/001.test.mjs`、宿主 repository-programming/capability-enforcement 与 `scripts/tests/program-package.test.mjs` 分别验证投影、真实接线、干净安装和类型。实际命令结果统一记入宿主根 AGENTS.md，不将历史通过记录当作当前门禁。

Node 与 Bun 分别验收；本节不宣称跨平台、真实模型宿主或重启恢复 JS 栈已经验证。
