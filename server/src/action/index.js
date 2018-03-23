import createContext from './create-context'
import * as predefined from './predefined'

const eventsSym = Symbol()

export default class Action {
  constructor(name, resolver, models, sequelize, emitter) {
    this.name = name
    this.resolver = resolver
    this.models = models
    this.sequelize = sequelize
    this.emitter = emitter
  }

  async dispatch(payload, user, actions, transaction = null) {
    const deferCommit = Boolean(transaction)
    if (!transaction) {
      transaction = await this.sequelize.transaction({
        isolationLevel: 'READ UNCOMMITTED'
      })
      transaction[eventsSym] = []
    }

    const resolution = createContext({
      transaction,
      models: this.models,
      emit: fn => transaction[eventsSym].push(fn),
      user,
      actions: Object.entries(actions)
        .map(([key, action]) => [
          key,
          payload => action(payload, user, actions, transaction)
        ])
        .reduce(
          (obj, [key, item]) =>
            Object.assign(obj, {
              [key]: item
            }),
          {}
        )
    })

    try {
      const result = await this.resolver(payload, resolution)
      if (!deferCommit) await transaction.commit()

      transaction[eventsSym].forEach(fn =>
        fn((...args) => this.emitter.emit(...args))
      )

      return result
    } catch (error) {
      if (error instanceof Error) {
        await transaction.rollback()
        throw error
      }

      return error
    }
  }

  static initActions(sequelize, emitter, models, definition) {
    const actions = {
      ...predefined,
      ...definition
    }

    return Object.entries(actions)
      .map(([key, resolver]) => [
        key,
        new Action(key, resolver, models, sequelize, emitter)
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
