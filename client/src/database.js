const DELIMITER = '~'

const webStorage = storage => ({
  get: key => Promise.resolve(JSON.parse(storage.getItem(key))),
  set: (key, item) => Promise.resolve(storage.setItem(key, item)),
  keys: () => Promise.resolve(Object.keys(storage)),
  remove: key => Promise.resolve(storage.removeItem(key))
})

class Database {
  constructor(name, adapter = webStorage(sessionStorage)) {
    this.name = name
    this.adapter = adapter
    this.ready = Promise.resolve(adapter.open(name))
  }

  scope(name) {
    return new Scope(name, this)
  }
}

class Scope {
  constructor(id, database) {
    this.id = id
    this.database = database
    this.ready = database.ready
  }
  table(name) {
    return new Table(name, this)
  }
}

class Table {
  constructor(name, scope) {
    this.name = name
    this.scope = scope
    this.ready = scope.ready
  }

  async get(key) {
    await this.ready
    const result = await this.database.adapter.get(
      [this.scope.database.name, this.scope.name, this.name, key].join(
        DELIMITER
      )
    )
    if (result === undefined) return null
    return result
  }

  async set(key, value) {
    await this.ready
    return await this.database.adapter.set(
      [this.scope.database.name, this.scope.name, this.name, key].join(
        DELIMITER
      ),
      value
    )
  }

  async keys() {
    await this.ready
    const prefix = [this.scope.database.name, this.scope.name, this.name].join(
      DELIMITER
    )
    return Object.keys(await this.database.adapter.keys())
      .filter(key => key.startsWith(prefix))
      .map(key => key.slice(prefix.length))
  }

  async delete() {
    await Promise.all(
      Object.keys(await this.database.adapter.keys())
        .filter(key =>
          key.startsWith(
            [this.scope.database.name, this.scope.name, this.name].join(
              DELIMITER
            )
          )
        )
        .map(async key => await this.database.adapter.remove(key))
    )
  }
}

export default Database
