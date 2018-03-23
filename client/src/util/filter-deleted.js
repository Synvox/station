export default function filterDeleted(obj) {
  if (typeof obj !== 'object' || Array.isArray(obj) || obj === null) return obj

  if (obj.deleted === true) return undefined

  return Object.keys(obj)
    .map(key => ({
      key,
      item: filterDeleted(obj[key])
    }))
    .reduce(
      (obj, { key, item }) =>
        item !== undefined ? Object.assign(obj, { [key]: item }) : obj,
      {}
    )
}
