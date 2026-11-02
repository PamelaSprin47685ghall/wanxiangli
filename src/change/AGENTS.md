# Change

`wanxiangli/change` 管一项变更进入固定目标的生命周期。它接收已经确定的作业、工作树和目标身份，不决定修改内容是否值得发布，不读取具体宿主消息或模型配置。物理 Git、资源、Journal 与 Relay 由既有参与者提供；事实编码和用户文案留在产品连接层。

`ChangeHistory` 唯一持有作业与工作树效果记录。每次 apply 返回新历史，查询给出独立 DTO；候选、冲突、变基记录和发布 claim 分开保留，不压成一个最新阶段。重复创建不覆盖，未知作业的普通事实不新建作业，终局记录保留并不再更新。PublishClaimed 仍先检查已有 rebased，再检查 commit，即使作业已终局也保留这一拒绝顺序；不增加 target 或 expectedHead 的检查。

工作树请求与创建回执按原有顺序重放。已有请求不被第二次请求替换，已有 created 不被另一条 created 覆盖。byname 空白时采用 agent；名称查询 trim 并忽略大小写，多个匹配按作业身份顺序取第一项。

持久化仍由 Journal 负责。History 本身不创建工作树、不运行 Git、不发 Manager 请求，也不把已经登记的 claim 当作发布成功。发布流程必须先核对实际目标；已经落地而尚未补记的发布不能再次 fast-forward。发布后清理失败要保留已发布结果。

`ChangeJob` 拥有候选、变基、短发布锁、claim→快进→Published 的协作顺序，以及恢复后的续行。Git 与 Relay 只提供已有动作，不能通过一个回调把整段发布算法藏回主体。准备候选失败且没有冲突时，仍保留原来的第二次准备。Continue 先真正续行，再等下一信号；变基和续行在发布锁外。

锁内重读目标与工作树 HEAD，确认被固定的候选后先追加 claim，再快进，再追加 Published。只有精确的 `target ref moved` 进入原来的 CAS 错失路径。恢复先比较已落地候选，再比较期望目标；已落地只补事实，不能重做快进。锁先释放，随后终止资源并释放工作树。发布后资源清理失败保留 PublishedPendingCleanup；终态重启按原语义只清理。

`ChangeRuntime` 拥有准入和发布任务的在途组合。请求中的作业 id、路径、分支与名字由产品层确定；库不制造宿主会话 payload。先检查目标干净、记录 WorktreeCreateRequested，再调用真实 worktrees 对象。只有未确认的 Requested 才查询物理工作树；Created 直接接回原资源。确认写入失败释放刚取得的对象，原写入错误不被释放返回的错误覆盖。持久模式标记 durable 后，Manager 创建失败保留资源供恢复；非持久模式释放。

调用方提供日志事实转换、Git/工作树、Relay、门租约与现有结果邮箱；库不复制邮箱或资源状态。异常中的取消身份与原文本由类型桥解释，不把普通拒绝当取消；门的 Release 异常仍传播到原外层捕获范围。审计与 Work/Relay 的语义均不在本次调整范围。
