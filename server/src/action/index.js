import createContext from './create-context'
import * as predefined from './predefined'

const eventsSym = Symbol()

export default class Action {
  constructor(name, resolver, models, sequelize, emitter, uploadPath) {
    this.name = name
    this.resolver = resolver
    this.models = models
    this.sequelize = sequelize
    this.emitter = emitter
    this.uploadPath = uploadPath
  }

  async dispatch(payload, user, actions, reply, transaction = null) {
    const deferCommit = Boolean(transaction)
    if (!transaction) {
      transaction = await this.sequelize.transaction({
        isolationLevel: 'READ UNCOMMITTED'
      })
      transaction[eventsSym] = []
    }

    const resolution = createContext({
      transaction,
      uploadPath: this.uploadPath,
      emit: fn => transaction[eventsSym].push(fn),
      user,
      reply,
      models: this.models,
      actions: Object.entries(actions)
        .map(([key, action]) => [
          key,
          payload => action(payload, user, actions, reply, transaction)
        ])
        .reduce(
          (obj, [key, item]) =>
            Object.assign(obj, {
              [key]: item
            }),
          {}
        )
    })

    let result = null

    try {
      result = await this.resolver(payload, resolution)
      if (!deferCommit) await transaction.commit()
    } catch (error) {
      if (error instanceof Error) {
        await transaction.rollback()
        throw error
      }

      return error
    }

    setTimeout(() => {
      transaction[eventsSym].map(fn =>
        fn((...args) => this.emitter.emit(...args))
      )
    }, 1000)

    return result
  }

  static initActions(sequelize, emitter, uploadPath, models, definition) {
    const actions = {
      ...predefined,
      ...definition
    }

    return Object.entries(actions)
      .map(([key, resolver]) => [
        key,
        new Action(key, resolver, models, sequelize, emitter, uploadPath)
      ])
      .map(([key, action]) => [key, action.dispatch.bind(action)])
      .reduce(
        (obj, [key, item]) =>
          Object.assign(obj, {
            [key]: item
          }),
        {}
      )
  }
}
