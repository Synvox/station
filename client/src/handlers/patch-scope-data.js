import filterDeleted from '../util/filter-deleted'
export default (store, { id, version, patch }) => ({
  ...store,
  scopeData: {
    ...store.scopeData,
    [id]: {
      ...(store.scopeData[id] || {}),
      version,
      data: {
        ...((store.scopeData[id] || {}).data || {}),
        ...Object.entries(patch)
          .map(([name, obj]) => [
            name,
            filterDeleted({
              ...(((store.scopeData[id] || {}).data || {})[name] || {}),
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
  }
})
