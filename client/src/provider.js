import React, { Fragment } from 'react'
import { withContext } from 'recompose'
import PropTypes from 'prop-types'

export default withContext({ station: PropTypes.object }, ({ client }) => ({
  kilosClient: client
}))(({ children }) => <Fragment>{children}</Fragment>)
