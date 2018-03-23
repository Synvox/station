export default class Connection {
  constructor({ user, server, conn }) {
    conn.removeAllListeners()
    this.server = server
    this.conn = conn
    this.user = user
    this.alive = true

    const reply = val => {
      conn.send(JSON.stringify(val))
    }

    const unsubscribe = server.emitter.addUser(user.id, reply)

    conn.on('pong', () => (this.alive = true))

    conn.on('message', str => {
      this.parseIncoming(JSON.parse(str), reply)
    })

    reply({ type: 'USER', payload: user })

    this.server.dispatch({ type: 'getScopes' }, this.user, payload => {
      reply({
        type: 'PATCH_SCOPES',
        payload: payload.data
      })
    })

    this.server.dispatch({ type: 'getActions' }, this.user, payload => {
      reply({
        type: 'ACTIONS',
        payload: payload.data
      })
    })

    this.server.dispatch({ type: 'getModels' }, this.user, payload => {
      reply({
        type: 'MODELS',
        payload: payload.data
      })
    })

    conn.on('close', () => {
      unsubscribe()
    })
  }

  async parseIncoming(msg, reply) {
    if (!msg) return
    const { id, payload: input } = msg

    this.server.dispatch(input, this.user, payload => {
      reply({ id, type: 'REPLY', payload })
    })
  }

  static create(server, conn) {
    return new Promise(resolve => {
      conn.once('message', t => {
        resolve(t)
      })
    })
      .then(token => {
        return server.auth(token, server.models)
      })
      .then(user => {
        return new Connection({ user, server, conn })
      })
      .catch(e => {
        throw e
      })
  }
}
