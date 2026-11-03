/** 主工作树；现存输入明确非 Git 时返回自身。缺失输入须由直接父目录成功查询 Git。 */
export declare function primaryDirectory(workspace: string): Promise<string>
/** 与异步入口采用相同定位规则；即时查询，不使用异步缓存。 */
export declare function primaryDirectorySync(workspace: string): string
/** 检查宿主给定的状态目录，返回规范路径；不创建。 */
export declare function checkStateDirectory(stateRoot: string): string
/** 创建宿主给定的状态目录及自身 .gitignore；不修改 Git 配置。 */
export declare function initializeStateDirectory(stateRoot: string): string
