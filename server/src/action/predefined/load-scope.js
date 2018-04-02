export default async ({ scopeId, version }, { models }) => {
  const { Scope, Sequence, User: _User, ...userDefined } = models

  const Op = Scope.sequelize.constructor.Op

  const scope = await Scope.findById(scopeId)

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

  const patch = (await Promise.all(
    Object.entries(userDefined).map(async ([key, model]) => {
      const items =
        sequenceIds.length === 0
          ? {}
          : (await model.findAll({
              where: {
                sequenceId: {
                  [Op.in]: sequenceIds
                }
              }
            })).reduce(
              (obj, item) => Object.assign(obj, { [item.id]: item.toJSON() }),
              {}
            )
      return {
        [model.pluralName]: Object.keys(items).length === 0 ? undefined : items
      }
    })
  )).reduce((obj, item) => Object.assign(obj, item), {})

  return {
    version: Number(scope.version),
    patch
  }
}
