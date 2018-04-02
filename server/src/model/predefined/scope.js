import raw from './raw'

export default raw(({ Sequence, Scope, long, string, bool }) => ({
  currentSequence: Sequence()
    .nullable()
    .notConstraining(),
  parentScope: Scope().nullable(),
  cascade: bool().default(true),
  version: long()
    .default(0)
    .index(),
  type: string(),
  origin: string().nullable()
}))
