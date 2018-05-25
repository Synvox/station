import createContext from './create-context'
import * as predefined from './predefined'

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
    let tx = transaction

    let emits = []

    const resolution = createContext({
      getTransaction: async () => {
        if (!tx) {
          tx = await this.sequelize.transaction({
            isolationLevel: 'READ UNCOMMITTED'
          })
        }
        return tx
      },
      uploadPath: this.uploadPath,
      emit: x => emits.push(x),
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
      if (!deferCommit && tx) await tx.commit()
    } catch (error) {
      if (error instanceof Error) {
        if (tx) await tx.rollback()
        throw error
      }

      return error
    }

    await Promise.all(
      emits.map(async x => {
        await x(y => this.emitter.emit(y))
      })
    )

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
