export default async ({ scopeId, version }, { models, user }) => {
  const userDefined = Object.entries(models)
    .filter(([_, model]) => model.rawAttributes.sequenceId)
    .reduce((obj, [key, value]) => Object.assign(obj, { [key]: value }), {})

  const { Permission, Scope, Sequence } = models

  const Op = Scope.sequelize.constructor.Op
  const scope = await Scope.findById(scopeId)
  if (!scope) throw new Error(`Scope not found (${scopeId})`)

  const getPermission = async scope => {
    let permission = await Permission.findOne({
      where: { userId: user.id, scopeId: scope.id }
    })

    return (
      permission ||
      (scope.cascade && scope.parentScopeId
        ? await getPermission(await Scope.findById(scope.parentScopeId))
        : null)
    )
  }

  const permission = await getPermission(scope)

  if (!permission) throw new Error('Not authorized')

  const sequences = await Sequence.findAll({
    where: {
      scopeId: scope.id,
      version: {
        [Op.and]: {
          [Op.ne]: version,
          [Op.between]: [Number(version), Number(scope.version)]
        }
      }
    }
  })

  const sequenceIds = sequences.map(x => x.id)

  const chunkSize = 50
  const data = {}

  for (let i = 0; i < sequenceIds.length; i += chunkSize) {
    let ids = sequenceIds.slice(i, i + chunkSize)

    const slice = (await Promise.all(
      Object.entries(userDefined).map(async ([_, model]) => {
        const items =
          ids.length === 0
            ? {}
            : (await model.findAll({
                where: {
                  sequenceId: {
                    [Op.in]: ids
                  }
                }
              })).reduce(
                (obj, item) => Object.assign(obj, { [item.id]: item.toJSON() }),
                {}
              )
        return [
          model.pluralName,
          Object.keys(items).length === 0 ? undefined : items
        ]
      })
    ))
      .filter(([_, item]) => item)
      .reduce((obj, [key, item]) => Object.assign(obj, { [key]: item }), {})

    for (let key in slice) {
      if (!data[key]) data[key] = {}
      Object.assign(data[key], slice[key])
    }
  }

  return {
    version: Number(scope.version),
    data,
    id: scopeId,
    type: scope.type,
    permission: {
      id: permission.id,
      role: permission.role
    }
  }
}
