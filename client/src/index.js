import React from 'react'
import createContext from 'create-react-context'
import filterDeleted from './util/filter-deleted'

let uniqueId = 0

const CHUNK_SIZE = 1024 * 500

export class Store {
  constructor(getAuth) {
    this.state = {}
    this.subscribers = new Set()
    this.callbacks = {}
    this.lockedScopes = new Set()
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
    this.emitChange = () => this.subscribers.forEach(x => x())
  }
  connect() {
    const ws = (this.ws = new WebSocket('ws://localhost:8080'))

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
    const state = ({
      INIT: (store, payload) => ({
        scopeData: {},
        ...store,
        ...payload
      }),
      PATCH_SCOPES: (store, payload) => ({
        ...store,
        scopes: {
          ...store.scopes,
          ...payload
        }
      }),
      PATCH_SCOPE_DATA: (store, { id, version, patch }) => ({
        ...store,
        scopeData: {
          ...store.scopeData,
          [id]: {
            ...(store.scopeData[id] || {}),
            version,
            data: {
              ...((store.scopeData[id] || {}).data || {}),
              ...Object.entries(patch)
                .map(([name, obj]) => [
                  name,
                  filterDeleted({
                    ...(((store.scopeData[id] || {}).data || {})[name] || {}),
                    ...obj
                  })
                ])
                .reduce(
                  (obj, [key, item]) =>
                    Object.assign(obj, {
                      [key]: item
                    }),
                  {}
                )
            }
          }
        }
      })
    }[type] || (() => this.state))(this.state, payload)

    this.state = this.transform(state)

    this.emitChange()
  }
  transformActions(actions) {
    return actions
      .map(name => [
        name,
        (payload, blob) => {
          return this.send(
            {
              type: name,
              payload
            },
            blob
          )
        }
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
    return state.models
      .map(name => [
        name,
        (...scopeIds) =>
          scopeIds
            .map(scopeId => {
              if (!state.scopes[scopeId])
                throw new Error(
                  `Scope ${scopeId} is not accessable to the user.`
                )
              if (
                !state.scopeData[scopeId] ||
                Number(state.scopes[scopeId].version) !==
                  Number(state.scopeData[scopeId].version)
              ) {
                if (this.lockedScopes.has(scopeId)) return {}
                this.lockedScopes.add(scopeId)
                throw new Promise((resolve, reject) => {
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
                      this.reduce({
                        type: 'PATCH_SCOPE_DATA',
                        payload: {
                          id: scopeId,
                          ...resolution
                        }
                      })
                      this.lockedScopes.delete(scopeId)

                      return this.state.scopeData[scopeId].data[name] || {}
                    })
                    .catch(reject)
                })
              }

              if (
                !state.scopeData[scopeId] ||
                !state.scopeData[scopeId].data[name]
              )
                return {}
              return state.scopeData[scopeId].data[name] || {}
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
      ...this.transformActions(state.actions),
      ...this.transformModels(state)
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

const { Provider: _Provider, Consumer } = createContext()

function shallowCompare(a, b) {
  for (let i in a) if (!(i in b)) return false
  for (let i in b) if (a[i] !== b[i]) return false
  return true
}

class WithData extends React.Component {
  constructor(props) {
    super(props)
    const { defaultProps = () => {}, parentProps } = props

    this.state = defaultProps(parentProps)
  }
  componentWillMount() {
    const { store } = this.props
    this.unsubscribe = store.subscribe(() => this.update())
  }
  componentWillUnmount() {
    this.unsubscribe()
  }
  update() {
    const {
      mapToProps,
      defaultProps = () => {},
      parentProps,
      store
    } = this.props

    let mappedState = null
    if (store.isReady !== true) {
      mappedState = defaultProps(parentProps)
    } else {
      try {
        mappedState = mapToProps(store.state, parentProps)
      } catch (event) {
        if (!(event instanceof Promise)) throw event
        mappedState = defaultProps(parentProps)
        event
          .then(() => {
            this.update()
          })
          .catch(error => {
            throw error
          })
      }
    }

    if (!shallowCompare(mappedState, this.state)) {
      this.setState(mappedState)
    }
  }
  render() {
    return this.props.children(this.state)
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

export const Provider = _Provider
