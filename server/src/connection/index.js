export default class Connection {
  constructor({ user, server, conn }) {
    conn.removeAllListeners()
    this.server = server
    this.conn = conn
    this.user = user
    this.once = null
    this.timeout = null
    this.scopes = {}

    this.reply = async (val, once) => {
      if (once) this.once = once
      this.conn.send(JSON.stringify(val))
    }

    const unsubscribe = server.emitter.addUser(user.id, this.reply)

    conn.on('message', str => {
      if (this.timeout) clearTimeout(this.timeout)

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
    const { data: scopes } = await this.dispatch({
      type: 'getScopes'
    })
    const { data: actions } = await this.dispatch({
      type: 'getActions'
    })
    const { data: models } = await this.dispatch({
      type: 'getModels'
    })
    const { data: users } = await this.dispatch({
      type: 'getPeers',
      payload: {
        scopes
      }
    })

    const scopeData = await this.getScopes()

    this.reply({
      type: 'INIT',
      payload: {
        user: this.user,
        users,
        actions,
        scopes: scopeData,
        models
      }
    })
  }

  async parseIncoming(msg, reply) {
    if (!msg) return
    const { id, payload: input, scopes } = msg
    this.scopes = scopes
    this.server.dispatch(input, this.user, async (payload, once) => {
      if (!payload) throw new Error('No payload specified.')
      if (payload.type) return reply(payload, once)

      const scopeData = await this.getScopes(scopes)

      reply(
        {
          id,
          type: 'REPLY',
          payload,
          scopes: scopeData
        },
        once
      )
    })
  }

  async getScopes(scopes = {}) {
    const allScopes = (await this.dispatch({
      type: 'getScopes'
    })).data

    const scopeVersionMap = {
      ...Object.keys(allScopes).reduce(
        (obj, id) => Object.assign(obj, { [id]: 0 }),
        {}
      ),
      ...scopes
    }

    const scopeData = (await Promise.all(
      Object.entries(scopeVersionMap).map(async ([scopeId, version]) => [
        scopeId,
        (await this.dispatch({
          type: 'loadScope',
          payload: {
            scopeId,
            version
          }
        })).data
      ])
    )).reduce(
      (obj, [id, patch]) =>
        Object.assign(obj, {
          [id]: patch
        }),
      {}
    )

    return scopeData
  }

  static async create(server, conn) {
    const token = await new Promise(resolve => {
      conn.once('message', t => {
        resolve(t)
      })
    })

    let user = null

    try {
      user = await server.auth(token, server.models)
    } catch (e) {}

    if (!user)
      return conn.send(
        JSON.stringify({ type: 'error', payload: 'unauthenticated' })
      )

    return new Connection({
      user,
      server,
      conn
    })
  }
}
