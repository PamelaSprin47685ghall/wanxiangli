export const event = (id, parents = [], payload = {}) => ({
  id,
  stream: 'job/main',
  type: 'JobRequested',
  parents: [...parents].sort(),
  payload,
  payloadRefs: [],
})

export const hex = (character) => character.repeat(40)

// 固定种子的线性同余发生器：可复跑，不依赖第三方属性测试库。
export const random = (seed) => {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}
