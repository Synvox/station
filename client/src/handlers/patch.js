import filterDeleted from '../util/filter-deleted'

export default (store, payload) => ({
  ...payload,
  ...store,
  user: payload.user || store.user,
  users: payload.users || store.users,
  scopes: {
    ...(store.scopes || {}),
    ...Object.entries(payload.scopes || {})
      .map(([id, scope]) => ({
        [id]: {
          ...((store.scopes || {})[id] || {}),
          ...scope,
          data: !(scope.data || ((store.scopes || {})[id] || {}).data)
            ? null
            : {
                ...(((store.scopes || {})[id] || {}).data || {}),
                ...Object.entries(scope.data || {})
                  .map(([name, obj]) => [
                    name,
                    filterDeleted({
                      ...((((store.scopes || {})[id] || {}).data || {})[name] ||
                        {}),
                      ...obj
                    })
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
      }))
      .reduce((obj, patch) => Object.assign(obj, patch), {})
  }
})
