import fs from 'fs'
import path from 'path'

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
    where: {
      scopeId: {
        [Op.in]: scopes.map(s => s.id)
      }
    }
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
          type: scope.type,
          permission: {
            id: permission.id,
            role: permission.role
          }
        }))
    })
    .reduce((arr, item) => arr.concat(item), [])
}

const createFile = (file, totalSize) => {
  const stream = fs.createWriteStream(path.normalize(file), {
    flags: 'a'
  })
  let ended = false
  let size = 0
  return data =>
    new Promise((resolve, reject) => {
      if (!data) {
        if (!ended) stream.end()
        ended = true
        resolve()
      } else {
        size += data.byteLength
        if (size > totalSize) {
          return reject(
            new Error(
              `File exceeds declared size. ${size} is larger than ${totalSize}`
            )
          )
        }
        stream.write(new Buffer(data), resolve)
      }
    })
}

export default context =>
  Object.assign(context, {
    fail: async message => {
      const transaction = await context.getTransaction()
      await transaction.rollback()
      throw {
        error: message
      }
    },

    upload: async file => {
      const write = createFile(`${context.uploadPath}/${file.id}`)

      await new Promise(resolve => {
        const load = () => {
          context.reply(
            {
              type: 'YIELD'
            },
            async (binary, cancel) => {
              if (binary === 'END') {
                context.reply({
                  type: 'END'
                })
                resolve()
                await write()
              }

              if (typeof binary === 'string') return cancel()

              await write(binary)
              load()
            }
          )
        }

        load()
      })
    },

    getUserScope: async user => {
      const {
        models: { Scope, User },
        createScope,
        grant
      } = context

      let userScope = await Scope.findById(user.id)
      if (userScope) return userScope

      userScope = await createScope(user)
      await grant({ scope: userScope, role: 'admin', user: user })

      return userScope
    },

    createSequence: async scope => {
      if (!scope) throw new Error('No scope specified to createSequence')
      const {
        models: { Scope, Sequence, Permission },
        getTransaction,
        emit
      } = context

      const transaction = await getTransaction()

      const newSequence = await Sequence.create(
        {
          version: Number(scope.version) + 1,
          scopeId: scope.id
        },
        {
          transaction
        }
      )

      scope.currentSequenceId = newSequence.id
      scope.version = newSequence.version

      await scope.save({
        transaction
      })

      emit(async send => {
        const parents = await getParents({
          Scope,
          Permission,
          scopeId: scope.id
        })

        await Promise.all(
          parents.map(async parent => {
            await send({
              type: 'PATCH',
              userId: parent.userId,
              payload: {
                scopes: {
                  [parent.id]: {
                    id: parent.id,
                    version: parent.version,
                    type: parent.type,
                    permission: {
                      id: parent.permission.id,
                      role: parent.permission.role
                    }
                  }
                }
              }
            })
          })
        )
      })

      return newSequence
    },

    createScope: async (entity, parentScope, cascade) => {
      const {
        models: { Sequence, Scope, Permission },
        getTransaction,
        emit
      } = context

      const transaction = await getTransaction()

      const scope = await Scope.create(
        {
          id: entity.id ? entity.id : undefined,
          type: entity.name || entity.constructor.name,
          parentScopeId: parentScope ? parentScope.id : null,
          cascade
        },
        {
          transaction
        }
      )

      const sequence = await Sequence.create(
        {
          version: 1,
          scopeId: scope.id
        },
        {
          transaction
        }
      )

      scope.currentSequenceId = sequence.id
      scope.version = sequence.version

      await scope.save({
        transaction
      })

      emit(async send => {
        const parents = await getParents({
          Scope,
          Permission,
          scopeId: scope.id
        })

        await Promise.all(
          parents.map(async parent => {
            await send({
              type: 'PATCH',
              userId: parent.userId,
              payload: {
                scopes: {
                  [parent.id]: {
                    id: parent.id,
                    version: parent.version,
                    type: parent.type,
                    permission: {
                      id: parent.permission.id,
                      role: parent.permission.role
                    }
                  }
                }
              }
            })
          })
        )
      })

      return scope
    },

    grant: async ({ scope, role, user }) => {
      const {
        models: { Permission },
        getTransaction,
        createSequence,
        emit
      } = context

      const transaction = await getTransaction()

      const sequence = await createSequence(scope)
      const permission = await Permission.create(
        {
          scopeId: scope.id,
          role,
          userId: user.id,
          sequenceId: sequence.id
        },
        {
          transaction
        }
      )

      emit(
        async send =>
          await send({
            type: 'PATCH',
            userId: permission.userId,
            payload: {
              scopes: {
                [permission.scopeId]: {
                  id: permission.scopeId,
                  version: scope.version,
                  type: scope.type,
                  permission: {
                    id: permission.id,
                    role: permission.role
                  }
                }
              }
            }
          })
      )

      return permission
    },

    ungrant: async permission => {
      const { getTransaction, emit } = context

      const transaction = await getTransaction()

      const userId = permission.userId
      const payload = permission.scopeId

      await permission.destroy({
        transaction
      })

      emit(
        async send =>
          await send({
            type: 'REMOVE_SCOPE',
            userId,
            payload
          })
      )

      return permission
    },

    getRole: async (user, scope) => {
      const {
        models: { Permission, Scope }
      } = context
      while (scope) {
        const permission = await Permission.findOne({
          where: {
            scopeId: scope.id,
            userId: user.id
          }
        })
        if (permission) return permission.role
        if (scope.parentScopeId && scope.cascade) {
          scope = await Scope.findById(scope.parentScopeId)
        }
      }
      return null
    }
  })
