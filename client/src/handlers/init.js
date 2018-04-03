export default (store, payload) => ({
  scopeData: {},
  ...store,
  ...payload,
  _models: payload.models,
  _actions: payload.actions
})
