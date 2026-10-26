import {
  Ablation,
  AblationToolMapStore,
  ablationToolMapStore,
  AblationFactMapStore,
  ablationFactMapStore,
  AblationGateState,
  ablationGateState,
  AblationConfig,
  ablationConfig,
} from '../../../dist/ablation/Ablation.js'

export {
  Ablation,
  AblationToolMapStore,
  ablationToolMapStore,
  AblationFactMapStore,
  ablationFactMapStore,
  AblationGateState,
  ablationGateState,
  AblationConfig,
  ablationConfig,
}

export const node = (id, extra = {}) => ({ id, package: id, kind: 'package', ...extra })
export const slice = (id, pkg, parent = pkg) => ({ id, package: pkg, kind: 'slice', parent })
