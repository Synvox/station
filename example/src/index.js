import React from 'react'
import ReactDOM from 'react-dom'
import './index.css'
import App from './app'
import { Provider, Store } from './client'
import registerServiceWorker from './registerServiceWorker'

const store = new Store(() => '1cbee1cb-b63c-4089-9d6a-54625cd16172')

ReactDOM.render(
  <Provider value={store}>
    <App />
  </Provider>,
  document.getElementById('root')
)

registerServiceWorker()
