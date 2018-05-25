export default class Connection {
  constructor({ user, server, conn, scopes }) {
    conn.removeAllListeners()
    this.server = server
    this.conn = conn
    this.user = user
    this.once = null
    this.timeout = null
    this.scopes = scopes

    this.reply = async (val, once) => {
      if (once) this.once = once
      this.conn.send(JSON.stringify(val))
    }

    const unsubscribe = server.emitter.addUser(user.id, async () => {
      this.conn.send(
        JSON.stringify({
          type: 'PATCH',
          payload: { scopes: await this.getScopes() }
        })
      )
    })

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
        actionNames: actions,
        scopes: scopeData,
        modelDefs: models
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

      // const scopeData = await this.getScopes(scopes)

      reply(
        {
          id,
          type: 'REPLY',
          payload
          // scopes: scopeData
        },
        once
      )
    })
  }

  async getScopes(scopes = this.scopes) {
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

    for (let scopeId in scopeVersionMap) {
      const version = scopeVersionMap[scopeId]
      if (version === allScopes[scopeId].version)
        delete scopeVersionMap[scopeId]
    }

    const scopeData = (await Promise.all(
      Object.entries(scopeVersionMap).map(async ([scopeId, version]) => [
        scopeId,
        // allScopes[scopeId] // @todo reenable this
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

    this.scopes = Object.entries(scopeData)
      .map(([id, { version }]) => [id, version])
      .reduce((obj, [key, val]) => Object.assign(obj, { [key]: val }), {})

    return scopeData
  }

  static async create(server, conn) {
    const { token, scopes } = await new Promise(resolve => {
      conn.once('message', t => {
        resolve(JSON.parse(t))
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
      scopes,
      user,
      server,
      conn
    })
  }
}
