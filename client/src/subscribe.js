import jc from 'json-criteria'

const allListeners = {}

export function emit(scopeId, modelName, obj) {
  if (!allListeners[scopeId]) return
  if (!allListeners[scopeId][modelName]) return
  Array.from(allListeners[scopeId][modelName]).map(fn => fn(obj))
}

export async function build(instance, fn) {
  const results = fn(scopeSelector)
  const existing = instance.subscribers

  const patch = {}

  await Promise.all(
    Object.keys(results).map(prop => {
      if (
        existing[prop] &&
        JSON.stringify(existing[prop].def) === JSON.stringify(results[prop])
      )
        return

      if (existing[prop]) existing[prop].unsubscribe()

      const { isOne, filter } = makeFilterExecutable(results[prop].filter)

      existing[prop] = subscribe(results[prop], filter, obj =>
        instance.mergePatch({ [prop]: isOne ? obj : { [obj.id]: obj } })
      )

      return (async () => {
        patch[prop] = {}
        await Promise.all(
          results[prop].scopeIds.map(async scopeId => {
            await instance.ensureUpdated(scopeId)
            const table = instance.database
              .scope(scopeId)
              .table(results[prop].modelName)

            const keys = await table.keys()

            await keys.map(async id => {
              const obj = await table.get(id)
              if (!obj.deleted && filter(obj)) {
                if (isOne) patch[prop] = obj
                else {
                  patch[prop] = patch[prop] || {}
                  patch[prop][obj.id] = obj
                }
              }
            })
          })
        )
      })()
    })
  )

  instance.mergePatch(patch)
}

const subscribe = (def, filter, cb) => {
  const { scopeIds, modelName } = def

  const unsubscribers = scopeIds.map(scopeId => {
    const fn = x => filter(x) && cb(x)

    allListeners[scopeId] = allListeners[scopeId] || {}
    allListeners[scopeId][modelName] =
      allListeners[scopeId][modelName] || new Set()
    allListeners[scopeId][modelName].add(fn)

    return () => {
      allListeners[scopeId][modelName].remove(fn)
      if (allListeners[scopeId][modelName].size === 0)
        delete allListeners[scopeId][modelName]
      if (Object.keys(allListeners[scopeId]).length === 0)
        delete allListeners[scopeId]
    }
  })

  return {
    def,
    unsubscribe: () => unsubscribers.forEach(x => x())
  }
}

const scopeSelector = instance => (...scopeIds) => {
  return Object.keys(instance.models)
    .map(key => ({
      key,
      item: modelSelector(instance)(scopeIds, key)
    }))
    .reduce((obj, { key, item }) => Object.assign(obj, { [key]: item }), {})
}

const modelSelector = (/*instance*/) => (scopeIds, modelName) => criteria => {
  let filter = criteria

  return {
    scopeIds,
    modelName,
    filter
  }
}

const makeFilterExecutable = item => {
  return typeof item === 'object'
    ? { filter: obj => jc.test(obj, item), isOne: false }
    : { filter: obj => obj.id === item, isOne: true }
}
