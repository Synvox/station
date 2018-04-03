import React from 'react'
import * as handlers from './handlers'

let uniqueId = 0

const CHUNK_SIZE = 1024 * 500

export class Store {
  constructor(getAuth) {
    this.state = {}
    this.subscribers = new Set()
    this.callbacks = {}
    this.lockedScopes = new Map()
    this.ws = null
    this.file = null
    this.userToken = getAuth()
    this.connect()
    this.ready = () => {}
    this.isReady = new Promise(ready => {
      this.ready = () => {
        this.isReady = true
        ready()
      }
    })
    this.emitChange = () => {
      console.log('emitting change')
      this.subscribers.forEach(x => x())
    }
  }
  connect() {
    const ws = (this.ws = new WebSocket(`ws://${window.location.host}`))

    ws.onopen = () => {
      ws.send(this.userToken)
    }

    ws.onmessage = event => {
      const data = JSON.parse(event.data)
      if (!data) return
      if (data.type === 'REPLY' && this.callbacks[data.id]) {
        this.callbacks[data.id](data.payload)
      } else if (data.type === 'YIELD') {
        if (!this.file) {
          throw new Error(
            'Cannot begin an upload, no file specified. Pass a file in as a second param.'
          )
        }

        if (this.file.index * CHUNK_SIZE > this.file.size)
          return this.ws.send(JSON.stringify('END'))

        const blob = this.file.blob.slice(
          this.file.index * CHUNK_SIZE,
          (this.file.index + 1) * CHUNK_SIZE,
          this.file.blob.type
        )

        this.file.index += 1

        this.ws.send(blob)
      } else if (data.type === 'END') {
        // file transfer over.
      } else {
        if (this.isReady !== true) this.ready()
        this.reduce(data)
      }
    }

    ws.onclose = () => {
      setTimeout(() => this.connect(), 1000)
    }
  }
  reduce({ type, payload }) {
    const state = (handlers[type] || (() => this.state))(this.state, payload)

    this.state = this.transform(state)

    this.emitChange()
  }
  transformActions({ _actions: actions }) {
    return actions
      .map(name => [
        name,
        (payload, blob) =>
          this.send(
            {
              type: name,
              payload
            },
            blob
          )
      ])
      .reduce(
        (obj, [key, item]) =>
          Object.assign(obj, {
            [key]: item
          }),
        {}
      )
  }
  transformModels(state) {
    return state._models
      .map(name => [
        name,
        (...scopeIds) =>
          scopeIds
            .map(scopeId => {
              if (!state.scopes[scopeId]) {
                throw new Error(
                  `Scope ${scopeId} is not accessable to the user.`
                )
              }

              if (
                !state.scopeData[scopeId] ||
                Number(state.scopes[scopeId].version) !==
                  Number(state.scopeData[scopeId].version)
              ) {
                if (this.lockedScopes.has(scopeId))
                  throw this.lockedScopes.get(scopeId)

                const promise = new Promise((resolve, reject) => {
                  console.warn('promise send')
                  return this.send({
                    type: 'loadScope',
                    payload: {
                      scopeId: scopeId,
                      version: (
                        state.scopeData[scopeId] || {
                          version: 0
                        }
                      ).version
                    }
                  })
                    .then(resolution => {
                      console.warn('server response')
                      this.lockedScopes.delete(scopeId)
                      this.reduce({
                        type: 'PATCH_SCOPE_DATA',
                        payload: {
                          id: scopeId,
                          ...resolution
                        }
                      })

                      console.warn('reduced')
                      resolve()
                    })
                    .catch(reject)
                })

                this.lockedScopes.set(scopeId, promise)

                throw promise
              }

              return state.scopeData[scopeId].data[name]
            })
            .reduce((obj, item) => Object.assign(obj, item), {})
      ])
      .reduce(
        (obj, [key, item]) =>
          Object.assign(obj, {
            [key]: item
          }),
        {}
      )
  }
  transform(state) {
    return {
      ...state,
      actions: this.transformActions(state),
      models: this.transformModels(state)
    }
  }
  subscribe(fn) {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }
  send(message, blob) {
    return new Promise((resolve, reject) => {
      const id = (++uniqueId).toString(36)

      if (blob) {
        this.file = {
          blob,
          size: blob.size,
          index: 0
        }
      }

      this.ws.send(
        JSON.stringify({
          id,
          payload: message
        })
      )

      this.callbacks[id] = msg => {
        const { ok, data, error } = msg

        delete this.callbacks[id]

        if (blob) {
          this.file = null
        }

        if (ok) return resolve(data)
        return reject(new Error(error))
      }
    })
  }
}

class WithData extends React.Component {
  constructor(props) {
    super(props)
    const { defaultProps, parentProps } = props

    this.state = {
      mappedState:
        typeof defaultProps === 'function'
          ? defaultProps(parentProps)
          : defaultProps
    }
  }
  componentWillMount() {
    const { store } = this.props
    this.unsubscribe = store.subscribe(() => this.update())
    this.update()
  }
  componentWillReceiveProps() {
    setImmediate(() => this.update())
  }
  componentWillUnmount() {
    this.unsubscribe()
  }
  update() {
    const { mapToProps, defaultProps, parentProps, store } = this.props

    console.log('update called')

    let mappedState = null
    if (store.isReady !== true) {
      console.warn('store is not ready')
      mappedState =
        typeof defaultProps === 'function'
          ? defaultProps(parentProps)
          : defaultProps
    } else {
      try {
        console.warn('mapping')
        mappedState = mapToProps(store.state, parentProps)
        console.warn('mapping complete', mappedState)
      } catch (event) {
        console.warn('mapping failed', mappedState)
        if (!(event instanceof Promise)) throw event
        console.warn('thrown', event)
        mappedState =
          typeof defaultProps === 'function'
            ? defaultProps(parentProps)
            : defaultProps
        event
          .then(() => {
            console.warn('throw release', event)
            this.update()
          })
          .catch(error => {
            throw error
          })
      }
    }

    console.log('set state', mappedState)

    this.setState({ mappedState })
  }
  render() {
    if (this.state.mappedState == null) {
      console.log('not rendering', this.state, this)
      // setTimeout(() => this.update(), 1)
      return null
    }
    return this.props.children(this.state.mappedState)
  }
}

export function withData(mapState, defaultProps) {
  class WithDataWrapper extends React.Component {
    render() {
      const { props } = this
      return (
        <WithData
          store={props.store}
          parentProps={props}
          mapToProps={mapState}
          defaultProps={defaultProps}>
          {mappedState => this.props.children({ ...mappedState, ...props })}
        </WithData>
      )
    }
  }

  return Child => props => (
    <Consumer>
      {store => {
        return (
          <WithDataWrapper {...props} store={store}>
            {props => <Child {...props} />}
          </WithDataWrapper>
        )
      }}
    </Consumer>
  )
}

const { Provider: _Provider, Consumer } = React.createContext()
export const Provider = _Provider
