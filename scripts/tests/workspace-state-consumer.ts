import { primaryDirectory, primaryDirectorySync, checkStateDirectory, initializeStateDirectory } from 'wanxiangli/workspace-state'

const asyncDirectory: Promise<string> = primaryDirectory('/workspace')
const syncDirectory: string = primaryDirectorySync('/workspace')
const checked: string = checkStateDirectory('/workspace/.Herdchestra')
const initialized: string = initializeStateDirectory('/workspace/.Herdchestra')
void asyncDirectory; void syncDirectory; void checked; void initialized
// @ts-expect-error workspace 与已有状态根均须明确给出字符串。
void primaryDirectory(null)
// @ts-expect-error 没有放宽错误回退的 mode 矩阵。
void primaryDirectory('/workspace', { mode: 'legacy' })
// @ts-expect-error 初始化不接受业务回调。
void initializeStateDirectory('/workspace/.Herdchestra', () => {})
