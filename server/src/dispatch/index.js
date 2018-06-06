export default (models, actions) => (input, user, reply) => {
  const { type, payload } = input

  if (!actions[type])
    return reply({
      ok: false,
      error: `No action named "${type}"`
    })

  actions[type](payload, user, actions, reply)
    .then(data =>
      reply({
        ok: true,
        data
      })
    )
    .catch(e => {
      // eslint-disable-next-line
      console.error(e, e.trace)
      if (e instanceof Error) {
        return reply({
          ok: false,
          error: 'Server Error'
        })
      } else {
        return reply({
          ok: false,
          error: e
        })
      }
    })
}
