import fs from 'fs'
import path from 'path'

const getObservers = async ({ Scope, Permission, scope }) => {
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

  const scopes = await getScopes(scope.id)

  const permissions = await Permission.findAll({
    where: {
      scopeId: {
        [Op.in]: scopes.map(s => s.id)
      }
    }
  })

  return [...new Set(permissions.map(p => p.userId))]
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

    notify: async scope => {
      const {
        models: { Scope, Permission },
        emit
      } = context

      emit(async send => {
        const obs = await getObservers({
          Scope,
          Permission,
          scope: scope
        })

        obs.forEach(o => send({ userId: o, scopeId: scope.id }))
      })
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
        models: { Scope },
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
        models: { Sequence },
        getTransaction,
        notify
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

      await notify(scope)

      return newSequence
    },

    createScope: async (entity, parentScope, cascade) => {
      const {
        models: { Sequence, Scope },
        getTransaction,
        notify
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

      await notify(scope)

      return scope
    },

    grant: async ({ scope, role, user }) => {
      const {
        models: { Permission },
        getTransaction,
        createSequence,
        notify
      } = context

      const transaction = await getTransaction()

      const sequence = await createSequence(scope)
      const existing = await Permission.findOne({
        where: {
          scopeId: scope.id,
          userId: user.id
        }
      })
      if (existing) return existing

      const permission = await Permission.create(
        {
          scopeId: scope.id,
          role,
          userId: user.id,
          sequenceId: sequence.id
        },
        { transaction }
      )

      await notify(scope)

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
