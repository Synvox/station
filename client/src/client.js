import Database from './database'
import {
  emit
} from './subscribe'
import tus from 'tus-js-client'

export default class Client {
  constructor() {
    this.remoteUrl = '/'
    this.ready = Promise.resolve(this.init())
    this.user = null
    this.schema = null
    this.scopes = null
    this.peers = null
    this.actions = null
  }

  async init() {
    await this.getBase()
    this.listen()
    return true
  }

  get(url = '', args = {}, headers = this.headers) {
    const baseArgs = {
      credentials: 'include',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        ...headers
      }
    }

    return fetch(
      `${this.remoteUrl}${url}`,
      Object.assign(baseArgs, args)
    ).then(res => {
      /* istanbul ignore next */
      if (!res.ok) throw new Error(res.statusText)
      return res.json()
    })
  }

  upload(id, file, progress = () => {}) {
    return new Promise((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint: `${this.remoteUrl}/upload`,
        retryDelays: [0, 1000, 3000, 5000],
        onError: reject,
        metadata: {
          id
        },
        headers: {
          ...this.headers,
          fileId: id
        },
        onProgress: (bytesUploaded, bytesTotal) => {
          const percentage = (bytesUploaded / bytesTotal * 100).toFixed(2)
          progress({
            bytesUploaded,
            bytesTotal,
            percentage
          })
        },
        onSuccess: () => resolve(file.id)
      })

      upload.start()
    })
  }

  async getBase() {
    let data = null
    try {
      data = await this.get()
    } catch (e) {
      return this.authenticate()
    }

    const {
      user,
      models,
      actions,
      scopes,
      peers
    } = data

    this.user = user
    this.models = models
    this.scopes = scopes
    this.peers = peers
    this.actions = actions
      .map(actionName => ({
        key: actionName,
        item: (payload) =>
          new Promise((resolve, reject) => {
            this.dispatch(actionName, payload, (err, value) => {
              if (err) return reject(err)
              resolve(value)
            })
          })
      }))
      .reduce((obj, {
        key,
        item
      }) => Object.assign(obj, {
        [key]: item
      }), {})

    const database = new Database(`user`)
    const scope = database.scope(user.id)
    this.baseTable = scope.table('base')

    await this.baseTable.set('schema', schema)
    await this.baseTable.set('scopes', scopes)
    await this.baseTable.set('peers', peers)
  }

  dispatch(type, payload, callback) {
    this.pendingActions.push({
      type,
      payload,
      callback
    })

    clearTimeout(this.disptachTimeout)

    this.disptachTimeout = setTimeout(() => {
      this.getScopeUpdates(this.pendingActions)
      this.pendingActions = []
    }, 10)
  }

  async getUpdates(actions) {
    const {
      storage
    } = this

    if (!this.scopeDbs[scopeId]) this.buildScope(scopeId, -1)

    const metaTable = this.scopeDbs[scopeId].table('metadata')
    const currentVersion = (await metaTable.get('version')) || -1

    const modifiers = actions ? {
      method: 'POST',
      body: JSON.stringify(actions)
    } : {}

    this.lock[scopeId] = true
    const json = await this.get(
      `/${scopeId}/${currentVersion}`,
      modifiers
    )

    const {
      version,
      results,
      patch,
      peers,
      scopes
    } = json

    await metaTable.set('version', Number(version))

    if (peers) {
      const baseTable = storage.table('schema')

      this.peers = {
        ...this.peers,
        ...peers
      }

      await baseTable.set('peers', this.peers)
    }

    if (scopes) {
      const baseTable = storage.table('schema')

      this.scopes = {
        ...this.scopes,
        ...scopes
      }

      Object.keys(scopes).forEach(x => this.buildScope(x, scopes[x].version))

      await baseTable.set('scopes', scopes)

      await Promise.all(
        Object.keys(scopes).map(async scopeId => {
          const metaTable = this.scopeDbs[scopeId].table('metadata')
          const currentVersion = (await metaTable.get('version')) || 0
          if (Number(currentVersion) !== Number(this.scopes[scopeId].version))
            await this.getScopeUpdates(scopeId)
        })
      )
    }

    await this.resolveChanges({
      scopeId,
      version,
      patch
    })

    delete this.lock[scopeId]

    if (actions) {
      results.forEach((res, index) => {
        actions[index].callback(res.error ? res.error : null, res)
      })
    }
  }

  async resolveModel(scopeId, modelName, emit) {
    const {
      schema,
      scopeDbs
    } = this

    if (!scopeDbs[scopeId]) return
    if (!schema.models[modelName])
      throw new Error(`Model ${modelName} does not exist in schema.`)

    const tableName = schema.models[modelName].tableName
    const table = scopeDbs[scopeId].table(tableName)
    const keys = await table.keys()

    await Promise.all(
      keys.map(async key => {
        const data = await table.get(key)
        emit(data)
      })
    )
  }

  async resolveChanges({
    scopeId,
    patch
  }) {
    const {
      schema
    } = this

    const tables = Object.keys(schema.models).map(
      key => schema.models[key].tableName
    )

    await Promise.all(
      tables.map(async tableName => {
        const table = this.scopeDbs[scopeId].table(tableName)
        await Promise.all(
          Object.keys(patch[tableName]).map(async id => {
            await table.set(id, patch[tableName][id])
          })
        )
      })
    )

    Object.keys(schema.models).forEach(modelName => {
      const tableName = schema.models[modelName].tableName
      Object.keys(patch[tableName]).forEach(id => {
        this.emit(scopeId, modelName, patch[tableName][id])
      })
    })
  }

  listen() {
    const {
      remoteUrl,
      scopeDbs
    } = this

    const es = new EventSource(`${remoteUrl}/stream`, {
      withCredentials: true
    })

    es.addEventListener('scope-update', async x => {
      const {
        scopeId,
        version
      } = JSON.parse(x.data)
      if (this.lock[scopeId]) return
      if (!scopeDbs[scopeId]) return

      const metaTable = scopeDbs[scopeId].table('metadata')
      const currentVersion = (await metaTable.get('version')) || 0

      if (currentVersion !== version) this.getScopeUpdates(scopeId)
    })

    es.addEventListener('rebuild', async () => {
      es.close()
      this.listen()
    })
  }

  emit(scopeId, modelName, data) {
    emit(scopeId, modelName, data)
  }
}
