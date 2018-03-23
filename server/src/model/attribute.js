import { foreign_key as foreignKey, camelize, underscore } from 'inflection'
import typeMap from './type-map'

export default class Attribute {
  constructor(type, options) {
    this.name = undefined
    this.field = ''
    this.type = type
    this.options = options
    this.mappedType = typeMap[type]
    this.isNullable = false
    this.isUnique = false
    this.isIndexed = false
    this.defaultValue = null
    this.ref = null
    this.isRefConstraining = true
  }
  setName(name) {
    if (this.ref) {
      name = foreignKey(name)
    }

    this.name = camelize(name, true)
    this.field = underscore(name)
    return this
  }
  refrences(table, isRefConstraining = true) {
    this.ref = table
    this.isRefConstraining = isRefConstraining
    return this
  }
  nullable() {
    this.isNullable = true
    return this
  }
  unique() {
    this.isUnique = true
    return this
  }
  index() {
    this.isIndexed = true
    return this
  }
  notConstraining() {
    this.isRefConstraining = false
    return this
  }
  default(val) {
    this.defaultValue = val
    return this
  }
  toSequelize(Sequelize) {
    const type = Sequelize[typeMap[this.type].sql]

    return {
      type,
      field: this.field,
      allowNull: this.isNullable,
      unique: this.isUnique,
      defaultValue: this.defaultValue,
      references:
        !this.ref || !this.isRefConstraining
          ? undefined
          : {
              model: this.ref,
              key: 'id'
            }
    }
  }
}
