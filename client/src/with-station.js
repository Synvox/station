import { Component, createElement } from 'react'
import { compose, getContext } from 'recompose'
import PropTypes from 'prop-types'
import {build} from './subscribe'

import filterDeleted from './util/filter-deleted'

class WithData extends Component {
  constructor(props) {
    super(props)
    this.state = {
      data: {}
    }

    this.client = props.kilosClient
    this.subscribers = {}
    this.database = this.client.database
    this.models = this.client.models

    const { defaults, unsubscribe } = this.buildSubscribers()

    this.unsubscribe = () => unsubscribe()
    this.getDefaults = () => defaults
  }
  componentWillUnmount() {
    this.unsubscribe()
  }
  setData(data) {
    this.setState({ data })
  }
  mergePatch(change) {
    const { setData } = this
    const { data } = this.state
    let state = Object.assign({}, data)

    for (let key in change) {
      const item = change[key]

      !state[key]
        ? (state[key] = item)
        : (state[key] = Object.assign({}, state[key], item))
    }

    state = filterDeleted(state)

    setData(state)
  }
  getProps() {
    return {
      user: this.client.user || null,
      schema: this.client.schema || null,
      scopes: this.client.scopes || null,
      users: this.client.peers || null,
      actions: this.client.actions || null,
      upload: this.client.upload.bind(this.client),
      ...this.getDefaults(),
      ...this.state.data
    }
  }
  buildSubscribers() {
    build(this, this.getQuery())
  }
}

const withClient = compose(getContext({ kilosClient: PropTypes.object }))

export default getQuery => wrappedComponent => {
  class Wrapper extends WithData {
    getQuery() {
      return getQuery
    }
    render() {
      return createElement(wrappedComponent, this.getProps())
    }
  }

  return withClient(Wrapper)
}
