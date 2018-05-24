export default async (_, { models }) => {
  const userDefined = Object.entries(models)
    .filter(([_, model]) => model.rawAttributes.sequenceId)
    .reduce((obj, [key, value]) => Object.assign(obj, { [key]: value }), {})

  return Object.entries(userDefined).map(([_, model]) => model.pluralName)
}
