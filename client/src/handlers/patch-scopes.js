export default (store, payload) => ({
  ...store,
  scopes: {
    ...store.scopes,
    ...payload
  }
})
