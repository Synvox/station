export default async ({ scopes }, { models: { Permission, User } }) => {
  const Op = Permission.sequelize.constructor.Op

  const permissions = await Permission.findAll({
    where: { scopeId: { [Op.in]: Object.keys(scopes) } }
  })

  const users = await User.findAll({
    where: { id: { [Op.in]: permissions.map(p => p.userId) } }
  })

  return users.reduce((obj, x) => Object.assign(obj, { [x.id]: x }), {})
}
