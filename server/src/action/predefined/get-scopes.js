const flatten = arr =>
  arr.reduce(
    (flat, arr) => flat.concat(Array.isArray(arr) ? flatten(arr) : arr),
    []
  )

async function getChildScopes({ Scope, scope, role, user, permissionId }) {
  const childScopes = await Scope.findAll({
    where: { parentScopeId: scope.id, cascade: true }
  })

  const defs = await Promise.all(
    childScopes.map(async scope => {
      const children = await getChildScopes({
        Scope,
        scope,
        role,
        user,
        permissionId
      })
      return [
        {
          id: scope.id,
          version: Number(scope.version),
          type: scope.type,
          permission: {
            id: permissionId,
            role
          }
        },
        ...children
      ]
    })
  )

  return defs
}

export default async (_, { models: { Permission, Scope }, user }) => {
  const query = { userId: user.id }

  const permissions = await Permission.findAll({ where: query })

  const scopes = flatten(
    await Promise.all(
      permissions.map(async ({ id, scopeId, role }) => {
        const scope = await Scope.find({ where: { id: scopeId } })
        const children = await getChildScopes({
          Scope,
          scope,
          user,
          role,
          permissionId: id
        })
        return [
          {
            id: scope.id,
            version: Number(scope.version),
            type: scope.type,
            permission: {
              id,
              role
            }
          },
          ...children
        ]
      })
    )
  ).reduce((obj, { id, isPrimary, ...props }) => {
    return !obj[id] || isPrimary
      ? Object.assign(obj, { [id]: { id, isPrimary, ...props } })
      : obj
  }, {})

  return scopes
}
