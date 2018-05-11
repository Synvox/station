import NRP from 'node-redis-pubsub'

export default class Emitter {
  constructor(url) {
    this.nrp = new NRP({ url })

    this.users = {}

    this.nrp.on('message', this.receive.bind(this))
  }

  addUser(userId, fn) {
    this.users[userId] = this.users[userId] || []
    this.users[userId].push(fn)

    return () => {
      this.users[userId].splice(this.users[userId].indexOf(fn), 1)
      if (this.users[userId].length === 0) {
        delete this.users[userId]
      }
    }
  }

  emit(event) {
    this.nrp.emit('message', event)
  }

  receive(event) {
    const { type, userId, payload } = event

    if (this.users[userId])
      this.users[userId].forEach(fn => fn({ type, payload }))
  }
}
