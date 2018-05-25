import React from 'react'
import { createStore } from 'redux'
import { createProvider, connect } from 'react-redux'

import * as handlers from './handlers'
const CHUNK_SIZE = 1024 * 500
const STORE_KEY = 'stationStore'
let send = null

const socket = (() => {
  const fns = {}
  return {
    on: (event, fn) => {
      if (fns[event]) throw new Error(`Handler for ${event} already exists.`)
      fns[event] = fn
    },
    emit: async (event, msg, send) => {
      if (!fns[event]) return
      const returned = await fns[event](msg, send)
      return returned
    }
  }
})()

socket.on('INIT', async obj => {
  const transformed = transform(obj)

  for (let [_, scope] of Object.entries(transformed.scopes)) {
    scope.local = scope.version
  }

  await socket.emit('PATCH', transformed)
})

{
  let file = null

  socket.on('YIELD', (_, send) => {
    if (!file) {
      throw new Error(
        'Cannot begin an upload, no file specified. Pass a file in as a second param.'
      )
    }

    if (file.index * CHUNK_SIZE > file.size) return send(JSON.stringify('END'))

    const blob = file.file.slice(
      file.index * CHUNK_SIZE,
      (file.index + 1) * CHUNK_SIZE,
      file.type
    )

    file.index += 1

    send(blob)
  })

  socket.on('UPLOAD:START', def => {
    file = def
  })

  socket.on('UPLOAD:END', () => {
    file = null
  })
}

{
  const locked = new Map()
  socket.on('PATCH', async patch => {
    // if (patch.scopes) {
    //   for (let [_, scope] of Object.entries(patch.scopes)) {
    //     await socket.emit('LOAD_SCOPE', scope)
    //   }
    // }

    store.dispatch({
      type: 'PATCH',
      payload: patch
    })

    return patch
  })

  socket.on('LOAD_SCOPE', async scope => {
    const { scopes = {} } = store.getState()
    if (
      !scopes[scope.id] ||
      scopes[scope.id].data === null ||
      scopes[scope.id].local !== scope.version
    ) {
      const promise =
        locked.get(scope.id) ||
        send({
          type: 'loadScope',
          payload: {
            scopeId: scope.id,
            version:
              (
                scopes[scope.id] || {
                  version: 0
                }
              ).version || 0
          }
        })

      locked.set(scope.id, promise)
      const data = await promise

      locked.delete(scope.id)

      scope.version = data.version
      scope.local = data.version
    }
    return scope
  })

  socket.on('SUBSCRIBE_SCOPES', async (...scopeIds) => {
    const { scopes = {} } = store.getState()
    const patches = await Promise.all(
      scopeIds.filter(x => x).map(async scopeId => {
        const scope = scopes[scopeId]
          ? scopes[scopeId]
          : {
              id: scopeId
            }

        await socket.emit('LOAD_SCOPE', scope)
        return {
          [scopeId]: scope
        }
      })
    )
    await socket.emit('PATCH', {
      scopes: patches.reduce((obj, item) => Object.assign(obj, item), {})
    })
  })
}

const Station = async (location, getAuth, unauthorizedCb) => {
  const userToken = await getAuth()
  await createTransport(location, userToken, unauthorizedCb)
  return store.getState().actions
}

const getScopeVersionMap = () => {
  const scopes = store.getState().scopes || {}
  const scopeVersionMap = Object.entries(scopes)
    .map(([id, { version }]) => [id, version])
    .reduce(
      (obj, [key, item]) =>
        Object.assign(obj, {
          [key]: item
        }),
      {}
    )
  return scopeVersionMap
}

const createTransport = (location, userToken, unauthorizedCb) =>
  new Promise(resolve => {
    let isReady = false
    let callbacks = {}
    let uniqueId = 0
    let ws = null

    const connect = () => {
      ws = new WebSocket(location)

      ws.onopen = () => {
        ws.send(
          JSON.stringify({ token: userToken, scopes: getScopeVersionMap() })
        )
      }

      ws.onmessage = async event => {
        const data = JSON.parse(event.data)

        if (data.type === 'error' && data.payload === 'unauthenticated')
          return unauthorizedCb(data)

        if (!data) return

        if (data.id) {
          return callbacks[data.id](data)
        }

        await socket.emit(data.type, data.payload, x => ws.send(x))

        if (!isReady) {
          isReady = true
          resolve()
        }
      }

      ws.onclose = () => {
        setTimeout(() => connect(), 1000)
      }
    }

    send = (message, { file } = {}) =>
      new Promise((resolve, reject) => {
        const id = (++uniqueId).toString(36)

        if (file) {
          socket.emit('UPLOAD:START', {
            file,
            size: file.size,
            index: 0
          })
        }

        const scopeVersionMap = getScopeVersionMap()

        ws.send(
          JSON.stringify({
            id,
            payload: message,
            scopes: scopeVersionMap
          })
        )

        callbacks[id] = async ({
          payload: { ok, data, error },
          scopes: scopeData
        }) => {
          delete callbacks[id]

          if (file) socket.emit('UPLOAD:END')

          if (scopeData) {
            socket.emit('PATCH', {
              scopes: scopeData
            })
          }

          if (ok !== false) {
            resolve(data)
          } else reject(new Error(error))
        }
      })

    connect()
  })

const transform = patch => ({
  ...patch,
  actions: !patch.actionNames
    ? {}
    : patch.actionNames
        .map(name => [
          name,
          (payload, { file, scopes = [] } = {}) =>
            send(
              {
                type: name,
                payload
              },
              {
                file,
                scopes
              }
            )
        ])
        .reduce(
          (obj, [key, item]) =>
            Object.assign(obj, {
              [key]: item
            }),
          {}
        ),
  models: !patch.modelDefs
    ? {}
    : patch.modelDefs
        .map(name => [
          name,
          (...scopeIds) =>
            scopeIds
              .reduce((a, b) => a.concat(b), [])
              .map(scopeId => {
                if (!store.getState().scopes[scopeId])
                  return new Promise(() => {})
                const scopes = store.getState().scopes

                try {
                  return scopes[scopeId].data[name]
                } catch (_) {
                  throw socket.emit('SUBSCRIBE_SCOPES', scopeId)
                }
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
})

let defaultState = {}

// try {
//   defaultState = transform(JSON.parse(localStorage['station-storage']))
// } catch (e) {
//   console.log(e)
//   /*noop*/
// }

const store = createStore((state = defaultState, { type, payload }) => {
  return (handlers[type] || (() => state))(state, payload)
})

// {
//   let timeout = null
//   store.subscribe(() => {
//     clearTimeout(timeout)
//     timeout = setTimeout(() => {
//       requestAnimationFrame(() => {
//         localStorage['station-storage'] = JSON.stringify(store.getState())
//       })
//     }, 1000)
//   })
// }

const ReduxProvider = createProvider(STORE_KEY)

const Provider = props => <ReduxProvider {...props} store={store} />

const withData = (mapStateToProps, alternative) => Component =>
  connect(
    (state, props) => {
      try {
        const mappedState = mapStateToProps(state, props)
        return mappedState
      } catch (e) {
        if (e instanceof Promise) {
          return {
            __connectFailed: {}
          }
        }
        throw e
      }
    },
    undefined,
    undefined,
    {
      storeKey: STORE_KEY
    }
  )(
    class extends React.Component {
      static getDerivedStateFromProps(props, state) {
        if (props.__connectFailed) return state
        return props
      }
      render() {
        const state = this.state || this.props
        if (state.__connectFailed) {
          return alternative || null
        }
        return <Component {...state} />
      }
    }
  )

export { Provider, withData, Station }
