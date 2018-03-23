const getParents = async ({ Scope, Permission, scopeId }) => {
  const Op = Scope.sequelize.constructor.Op

  const getScopes = async scopeId => {
    const scope = await Scope.findById(scopeId)

    return [
      ...(scope.parentScopeId === null || !scope.cascade
        ? []
        : await getScopes(scope.parentScopeId)),
      scope.toJSON()
    ]
  }
  const scopes = await getScopes(scopeId)

  const getRootScope = scope => {
    if (!scope) return null
    if (scope.parentScopeId === null || !scope.cascade) return scope
    return getRootScope(scopes.find(s => s.id === scope.parentScopeId))
  }

  const permissions = await Permission.findAll({
    where: { scopeId: { [Op.in]: scopes.map(s => s.id) } }
  })

  return scopes
    .map(scope => {
      const rootScope = getRootScope(scope)
      return permissions
        .filter(p => p.scopeId === rootScope.id)
        .map(permission => ({
          id: scope.id,
          userId: permission.userId,
          version: Number(scope.version),
          permission: {
            id: permission.id,
            role: permission.role
          }
        }))
    })
    .reduce((arr, item) => arr.concat(item), [])
}

export default context =>
  Object.assign(context, {
    fail: async message => {
      await context.transaction.rollback()
      throw { error: message }
    },

    createSequence: async scope => {
      const {
        models: { Scope, Sequence, Permission },
        transaction,
        emit
      } = context

      const newSequence = await Sequence.create(
        {
          version: scope.version + 1,
          scopeId: scope.id
        },
        { transaction }
      )

      scope.currentSequenceId = newSequence.id
      scope.version = newSequence.version
      await scope.save({ transaction })

      emit(async send => {
        const parents = await getParents({
          Scope,
          Permission,
          scopeId: scope.id
        })

        parents.forEach(parent => {
          send({
            type: 'PATCH_SCOPES',
            userId: parent.userId,
            payload: {
              [parent.id]: {
                id: parent.id,
                version: parent.version,
                permission: {
                  id: parent.permission.id,
                  role: parent.permission.role
                }
              }
            }
          })
        })
      })

      return newSequence
    },

    createScope: async (entity, parentScope) => {
      const {
        models: { Sequence, Scope, Permission },
        transaction,
        emit
      } = context

      const scope = await Scope.create(
        {
          type: entity.name,
          parentScopeId: parentScope ? parentScope.id : null
        },
        { transaction }
      )

      const sequence = await Sequence.create(
        {
          version: 1,
          scopeId: scope.id
        },
        { transaction }
      )

      scope.currentSequenceId = sequence.id
      scope.version = sequence.version

      await scope.save({ transaction })

      emit(async send => {
        const parents = await getParents({
          Scope,
          Permission,
          scopeId: scope.id
        })

        parents.forEach(parent => {
          send({
            type: 'PATCH_SCOPES',
            userId: parent.userId,
            payload: {
              [parent.id]: {
                id: parent.id,
                version: parent.version,
                permission: {
                  id: parent.permission.id,
                  role: parent.permission.role
                }
              }
            }
          })
        })
      })

      return scope
    },

    grant: async ({ scope, role, user }) => {
      const { models: { Permission }, transaction, emit } = context

      const sequence = await context.createSequence(scope)
      const permission = await Permission.create(
        {
          scopeId: scope.id,
          role,
          userId: user.id,
          sequenceId: sequence.id
        },
        { transaction }
      )

      emit(send =>
        send({
          type: 'PATCH_SCOPES',
          userId: permission.userId,
          payload: {
            [permission.scopeId]: {
              id: permission.scopeId,
              version: scope.version,
              permission: {
                id: permission.id,
                role: permission.role
              }
            }
          }
        })
      )

      return permission
    },

    ungrant: async permission => {
      const { transaction, emit } = context

      const userId = permission.userId
      const payload = permission.scopeId

      await permission.destroy({ transaction })

      emit(send =>
        send({
          type: 'REMOVE_SCOPE',
          userId,
          payload
        })
      )

      return permission
    }
  })
