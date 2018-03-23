import raw from './raw'
export default raw(({ Scope, long }) => ({
  scope: Scope(),
  version: long()
    .default(0)
    .index()
}))
