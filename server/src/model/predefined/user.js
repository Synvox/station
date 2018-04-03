import md5 from 'md5'
import raw from './raw'

export default raw(({ string }) => ({
  email: string(),
  firstName: string(),
  lastName: string(),
  emailMd5: function() {
    return md5(this.getDataValue('email').toLowerCase())
  }
}))
