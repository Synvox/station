import Station from '../src'
import Sequelize from 'sequelize'

// const sequelize = new Sequelize({
//   dialect: 'sqlite',
//   operatorsAliases: false,
//   logging: console.log,
//   define: {
//     timestamps: false
//   }
// })

const sequelize = new Sequelize(
  'postgres://ryan:@localhost:5432/station_test',
  {
    operatorsAliases: false,
    // eslint-disable-next-line
    logging: undefined, //console.log,
    define: {
      timestamps: false
    }
  }
)

const userId = '1cbee1cb-b63c-4089-9d6a-54625cd16172'

new Station(
  {
    sequelize,
    redis: `redis://localhost:6379`,
    uploadPath: '/Users/ryan/temp/uploads'
  },
  {
    auth: async (token, { User }) => User.findById(token),
    models: {
      Domain: () => ({}),
      Profile: ({ User }) => ({
        user: User()
      }),
      Topic: ({ string }) => ({
        name: string()
      })
    },
    actions: {
      createTopic: async (
        { scopeId, name },
        { models: { Topic, Scope }, transaction, createSequence, createScope }
      ) => {
        const domainScope = await Scope.findById(scopeId)
        const sequence = await createSequence(domainScope)
        const scope = await createScope(Topic, domainScope)

        return await Topic.create(
          {
            id: scope.id,
            name,
            sequenceId: sequence.id
          },
          { transaction }
        )
      },
      upload: async (
        { scopeId, name, type, size },
        { models: { File, Scope }, transaction, createSequence, upload }
      ) => {
        const domainScope = await Scope.findById(scopeId)
        const sequence = await createSequence(domainScope)

        const file = await File.create(
          {
            name,
            type,
            size,
            sequenceId: sequence.id
          },
          { transaction }
        )

        await upload(file)

        return file
      }
    }
  }
).listen({port: 8080}, async ({ dispatch, models }) => {
  const { Scope, Domain, User, Permission } = models
  await sequelize.sync({ force: true })

  const scope = await Scope.create({ type: Domain.name })
  const user = await User.create({ id: userId, email: 'ryan@allred.xyz' })

  await Permission.create({
    scopeId: scope.id,
    userId: user.id,
    role: 'admin'
  })

  dispatch(
    {
      type: 'createTopic',
      payload: {
        scopeId: scope.id,
        name: 'a'
      }
    },
    user,
    x => {
      // eslint-disable-next-line
      console.log(JSON.stringify(x, null, 2))

      dispatch(
        {
          type: 'getScopes',
          payload: {
            // scopeId: scope.id,
            // version: 0
          }
        },
        user,
        // eslint-disable-next-line
        x => console.log(JSON.stringify(x, null, 2))
      )
    }
  )
})
