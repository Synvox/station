import md5 from 'md5'
import raw from './raw'

export default raw(({ string }) => ({
  email: string(),
  emailMd5: function() {
    return md5(this.getDataValue('email').toLowerCase())
  }
}))
