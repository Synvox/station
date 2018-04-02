import WebSocket from 'ws'
import Emitter from './emitter'
import Model from './model'
import Action from './action'
import dispatch from './dispatch'
import Connection from './connection'

export default class Server {
  constructor({ sequelize, redisUrl, uploadPath }, definition) {
    this.uploadPath = uploadPath
    this.emitter = new Emitter(redisUrl)

    this.auth = definition.auth
    this.models = Model.initModels(sequelize, definition.models)
    this.actions = Action.initActions(
      sequelize,
      this.emitter,
      uploadPath,
      this.models,
      definition.actions
    )

    this.dispatch = dispatch(this.models, this.actions)
  }

  listen(port, cb) {
    const socketServer = new WebSocket.Server({ port }, () => cb(this))

    socketServer.on('connection', conn => {
      Connection.create(this, conn)
    })
  }
}
