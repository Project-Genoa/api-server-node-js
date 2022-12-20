import * as crypto from 'crypto'

export default class GUIDUtils {
  static validateGUID(guid: unknown): guid is string {
    if (typeof guid != 'string') {
      return false
    }
    if (!guid.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
      return false
    }
    return true
  }

  static requireValidGUID(guid: unknown): asserts guid is string {
    if (!this.validateGUID(guid)) {
      throw new Error('invalid GUID')
    }
  }

  static async generateGUID(): Promise<string> {
    // TODO: implement proper time-based algorithm or whatever is appropriate
    var guid: string = ''
    for (const length of [4, 2, 2, 2, 6]) {
      const bytes = await crypto.randomBytes(length)
      const part = bytes.toString('hex')
      if (guid != '') {
        guid = guid + '-' + part
      }
      else {
        guid = part
      }
    }
    return guid
  }
}