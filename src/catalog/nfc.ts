import { Catalog, readJSONFile, getJSONFilesInDir } from './catalog'
import path from 'path'

class NFCCatalog extends Catalog {
  private tags: object[] = []

  protected async doLoadData(): Promise<void> {
    var tags = []
    for (const filePath of await getJSONFilesInDir(path.join('nfc'))) {
      const tag = await readJSONFile(filePath)
      tags.push(tag)
    }

    this.tags = tags
  }

  protected doGetAPIResponse(): any {
    return this.tags
  }
}

export default new NFCCatalog()