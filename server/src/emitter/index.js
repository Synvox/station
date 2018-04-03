import NRP from 'node-redis-pubsub'

export default class Emitter {
  constructor(url) {
    this.nrp = new NRP({ url })

    this.subscribers = {}

    this.nrp.on('message', this.receive.bind(this))
  }

  addUser(userId, fn) {
    this.subscribers[userId] = this.subscribers[userId] || []
    this.subscribers[userId].push(fn)
    
    return () => {
      this.subscribers[userId].splice(this.subscribers[userId].indexOf(fn), 1)
      if (this.subscribers[userId].length === 0) {
        delete this.subscribers[userId]
      }
    }
  }

  emit(event) {
    this.nrp.emit('message', event)
  }

  receive(event) {
    const { type, userId, payload } = event
    if (!this.subscribers[userId]) return

    this.subscribers[userId].forEach(fn => {
      fn({ type, payload })
    })
  }
}
