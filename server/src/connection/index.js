export default class Connection {
  constructor({ user, server, conn }) {
    conn.removeAllListeners()
    this.server = server
    this.conn = conn
    this.user = user
    this.once = null

    this.reply = (val, once) => {
      if (once) this.once = once
      conn.send(JSON.stringify(val))
    }

    const unsubscribe = server.emitter.addUser(user.id, this.reply)

    conn.on('pong', () => (this.alive = true))

    conn.on('message', str => {
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

  init() {
    this.server.dispatch(
      { type: 'getScopes' },
      this.user,
      ({ data: scopes }) => {
        this.server.dispatch(
          { type: 'getActions' },
          this.user,
          ({ data: actions }) => {
            this.server.dispatch(
              { type: 'getModels' },
              this.user,
              ({ data: models }) => {
                this.server.dispatch(
                  { type: 'getPeers', payload: { scopes } },
                  this.user,
                  ({ data: users }) => {
                    console.log(users)
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
                )
              }
            )
          }
        )
      }
    )
  }

  async parseIncoming(msg, reply) {
    if (!msg) return
    const { id, payload: input } = msg

    this.server.dispatch(input, this.user, (payload, once) => {
      if (!payload) throw new Error('No payload specified.')
      if (payload.type) return reply(payload, once)
      reply({ id, type: 'REPLY', payload }, once)
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
