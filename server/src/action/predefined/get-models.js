export default async (_, { models }) => {
  const {
    Scope: _Scope,
    Sequence: _Sequence,
    User: _User,
    ...userDefined
  } = models

  return Object.entries(userDefined).map(([_, model]) => model.pluralName)
}
