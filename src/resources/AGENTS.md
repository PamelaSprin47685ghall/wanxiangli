# resources — 双语语义资源管理与槽位隔离

独立 npm 入口 `wanxiangli/resources`。在总流程中，本模块负责管理系统面向模型的文本资源，确保所选语言（`en` 或 `zh-CN`）严格成对发行、读取时按所选语言无降级呈现，并通过 InstalledResourceSlot 隔离进程内资源实例。

## 状态所有权
- **Resources** 负责资源包根定位、路径安全上溯与模板占位符解析。
- **ProviderLanguageStore** 独占持有会话语言偏好阶梯（显式环境 → 宿主配置 → 环境探测 → English）。
- **InstalledResourceSlot** 独占持有已安装资源的单一引用，杜绝散落的可变全局变量。

## AXIOM
1. [使用者] 面向模型的文本要成对发行；读取时只认所选语言，缺所选语言就报错，绝不拿另一种语言顶替。
    - 理由：用户选了哪种语言就看到哪种语言，静默替换会让模型收到混合语言导致输出漂移。
2. [发行] 每个语义资源在发行物里都要备齐全部声明语种，且各语种模板携带同一占位符集合。

## LEMMA
1. [AXIOM 1] 读取只读取所选语种的文件，缺失时报 `package resource missing`，禁止静默回退到另一语种。
2. [AXIOM 1] 面向模型的散文随当前语言装载；工具名、协议字段与命令保持原样不翻译。
3. [AXIOM 1] 路径解析基于包自身绝对位置上溯定位，不依赖当前工作目录。
4. [AXIOM 2] `InstalledResourceSlot` 在未安装时严格 fail-closed，以明确错误提示拒绝；多槽相互隔离。

## SPEC（调用方流程）

1. **安全资源读取**：
   - 传入资源相对路径与目标语言读取模板。若该语言资源缺失，明确报错；成功读出后执行占位符替换。
2. **语言阶梯判定**：
   - 通过 `providerLanguageStore` 获取当前有效语言偏好，非法输入直接拒绝，不静默降级为默认语言。
3. **资源槽管理 (InstalledResourceSlot)**：
   - 系统初始化时安装全局资源到单例槽（`runtimeResourcesSlot`、`providerResourcesSlot`、`proseResourcesSlot`）；未安装调用 `require()` 立即抛出明确异常。
