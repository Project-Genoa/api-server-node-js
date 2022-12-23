import { Catalog, readJSONFile, getJSONFilesInDir } from './catalog'
import path from 'path'

// TODO: type definition for catalog structure

class ItemsCatalog extends Catalog {
  private items: { efficiencyCategories: { [index: string]: object }, items: object[] } = { efficiencyCategories: {}, items: [] }
  private itemMap: { [index: string]: object } = {}

  protected async doLoadData(): Promise<void> {
    var efficiencyCategories: { [index: string]: object } = {}
    for (const filePath of await getJSONFilesInDir(path.join('items', 'efficiency_categories'))) {
      const category = await readJSONFile(filePath)
      efficiencyCategories[category.name] = { efficiencyMap: category.efficiencyMap }
    }

    var items = []
    var itemMap: { [index: string]: object } = {}
    for (const filePath of await getJSONFilesInDir(path.join('items'))) {
      const item = await readJSONFile(filePath)
      items.push(item)
      itemMap[item.id] = item
    }

    this.items = {
      efficiencyCategories: efficiencyCategories,
      items: items
    }

    this.itemMap = itemMap
  }

  protected doGetAPIResponse(): any {
    return this.items
  }

  getItem(guid: string): any {
    return this.itemMap[guid]
  }

  isItemStackable(guid: string): boolean {
    return (this.itemMap[guid] as { stacks: boolean }).stacks ?? false
  }
}

export default new ItemsCatalog()