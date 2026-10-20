import { Ablation } from '../../../dist/ablation/Ablation.js'

export { Ablation }
export const node = (id, extra = {}) => ({ id, package: id, kind: 'package', ...extra })
export const slice = (id, pkg, parent = pkg) => ({ id, package: pkg, kind: 'slice', parent })
