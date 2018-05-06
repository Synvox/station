const MAX_REQUESTS = 100
const RESET_PERIOD = 1000 * 60

export default class Connection {
  constructor({ user, server, conn }) {
    conn.removeAllListeners()
    this.server = server
    this.conn = conn
    this.user = user
    this.once = null
    this.subscriptions = {}
    this.timeout = null
    this.rateLimit = MAX_REQUESTS

    this.reply = async (val, once) => {
      if (once) this.once = once
      conn.send(JSON.stringify(val))
    }

    const unsubscribe = server.emitter.addUser(user.id, this.reply)

    conn.on('message', str => {
      if (this.timeout) clearTimeout(this.timeout)

      this.timeout = setTimeout(
        () => (this.rateLimit = MAX_REQUESTS),
        RESET_PERIOD
      )

      this.rateLimit -= 1

      if (this.rateLimit <= 0) {
        this.reply({ type: 'ERROR', message: 'Rate limit reached' })
        return
      }

      if (typeof str === 'string') str = JSON.parse(str)

      let cancel = false
      const once = this.once
      if (once) once(str, () => (cancel = true))

      if (this.once && !cancel) {
        if (this.once === once) this.once = null
      } else {
        this.parseIncoming(str, this.reply)
      }
    })

    this.init()

    conn.on('close', () => {
      unsubscribe()
    })
  }

  dispatch(payload) {
    return new Promise(resolve => {
      this.server.dispatch(payload, this.user, resolve)
    })
  }

  async init() {
    const { data: scopes } = await this.dispatch({ type: 'getScopes' })
    const { data: actions } = await this.dispatch({ type: 'getActions' })
    const { data: models } = await this.dispatch({ type: 'getModels' })
    const { data: users } = await this.dispatch({
      type: 'getPeers',
      payload: { scopes }
    })
    this.reply({
      type: 'INIT',
      payload: {
        user: this.user,
        scopes,
        users,
        actions,
        models
      }
    })
  }

  async parseIncoming(msg, reply) {
    if (!msg) return
    const { id, payload: input, scopes } = msg
    this.server.dispatch(input, this.user, async (payload, once) => {
      if (!payload) throw new Error('No payload specified.')
      if (payload.type) return reply(payload, once)

      const scopeData = !scopes
        ? undefined
        : (await Promise.all(
            Object.entries(scopes).map(async ([scopeId, version]) => [
              scopeId,
              (await this.dispatch({
                type: 'loadScope',
                payload: { scopeId, version, userId: this.user.id }
              })).data
            ])
          )).reduce(
            (obj, [id, patch]) => Object.assign(obj, { [id]: patch }),
            {}
          )

      reply({ id, type: 'REPLY', payload, scopes: scopeData }, once)
    })
  }

  static async create(server, conn) {
    const token = await new Promise(resolve => {
      conn.once('message', t => {
        resolve(t)
      })
    })

    const user = await server.auth(token, server.models)
    return new Connection({ user, server, conn })
  }
}
