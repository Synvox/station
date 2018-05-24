import raw from './raw'

export default raw(({ User, string, json }) => ({
  user: User(),
  hash: string(),
  data: json()
}))
