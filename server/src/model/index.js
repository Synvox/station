import { tableize } from 'inflection'
import Attribute from './attribute'
import typeMap from './type-map'
import * as predefined from './predefined'

export default class Model {
  constructor(sequelize, name, attributes, raw) {
    this.sequelize = sequelize
    this.name = name
    this.tableName = tableize(name)
    this.attributes = attributes
    this.raw = raw
    this.sequelizeModel = this.toSequelize()
  }

  toSequelize() {
    const Sequelize = this.sequelize.constructor

    const attributes = Object.entries(this.attributes)
      .filter(([_, item]) => typeof item !== 'function')
      .reduce(
        (obj, [key, item]) =>
          Object.assign(obj, {
            [key]: item.toSequelize(Sequelize)
          }),
        {
          id: {
            type: Sequelize['UUID'],
            primaryKey: true,
            defaultValue: Sequelize.UUIDV4
          },
          ...(this.raw
            ? {}
            : {
                deleted: {
                  type: Sequelize['BOOLEAN'],
                  defaultValue: false
                },
                sequenceId: {
                  type: Sequelize['UUID'],
                  field: 'sequence_id',
                  references: {
                    model: 'sequences',
                    key: 'id'
                  }
                }
              })
        }
      )

    const getters = Object.entries(this.attributes)
      .filter(([_, item]) => typeof item === 'function')
      .reduce(
        (obj, [key, item]) =>
          Object.assign(obj, {
            [key]: item.toSequelize(Sequelize)
          }),
        {}
      )

    const indexes = [
      ...(!this.raw ? ['deleted'] : []),
      ...Object.entries(this.attributes)
        .map(([_, item]) => item)
        .filter(item => item.type === 'id')
        .map(item => item.field)
    ].map(field => ({ fields: [field], method: 'BTREE' }))

    return this.sequelize.define(this.name, attributes, {
      indexes,
      tableName: this.tableName,
      freezeTableName: true,
      getterMethods: {
        ...getters
      }
    })
  }

  static build(fn) {
    return (sequelize, name, models) => {
      const prox = new Proxy(
        {},
        {
          get: (_, prop) => {
            if (typeMap[prop]) {
              return (...options) => new Attribute(prop, options)
            } else if (models[prop]) {
              return (...options) => {
                const attr = new Attribute('id', options)
                attr.refrences(models[prop].tableName)
                return attr
              }
            } else throw new Error(`Type ${prop} is not defined`)
          }
        }
      )

      const attributes = fn(prox)

      const instance = new Model(
        sequelize,
        name,
        Object.entries(attributes).reduce((obj, [key, item]) => {
          item.setName(key)
          return Object.assign(obj, {
            [item.name]: item
          })
        }, {}),
        Boolean(fn.raw)
      )

      models[name] = instance

      return instance
    }
  }

  static initModels(sequelize, definition) {
    const models = {
      ...predefined,
      ...definition
    }

    const modelMap = Object.entries(models).reduce(
      (obj, [key]) =>
        Object.assign(obj, {
          [key]: { tableName: tableize(key) }
        }),
      {}
    )

    return Object.entries(models)
      .map(([key, value]) => [
        key,
        Model.build(value)(sequelize, key, modelMap).sequelizeModel
      ])
      .reduce(
        (obj, [key, item]) =>
          Object.assign(obj, {
            [key]: item
          }),
        {}
      )
  }
}
