import { Catalog, readJSONFile, getJSONFilesInDir } from './catalog'
import path from 'path'

class JournalCatalog extends Catalog {
  private items: { items: { [index: string]: object } } = { items: {} }

  protected async doLoadData(): Promise<void> {
    var items: { [index: string]: object } = {}
    for (const filePath of await getJSONFilesInDir(path.join('journal'))) {
      const item = await readJSONFile(filePath)
      items[item.name] = item.item
    }

    this.items = {
      items: items
    }
  }

  protected doGetAPIResponse(): any {
    return this.items
  }
}

export default new JournalCatalog()