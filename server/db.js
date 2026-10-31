import fs from 'node:fs'
import path from 'node:path'
import { MongoClient, ObjectId } from 'mongodb'

let client
let db

const INITIAL_VARIETIES = [
  { name: 'Purple Radish', gramsPerTray: 70, defaultSellPrice: 250, active: true },
  { name: 'Pink Radish', gramsPerTray: 70, defaultSellPrice: 250, active: true },
  { name: 'Mustard', gramsPerTray: 50, defaultSellPrice: 250, active: true },
  { name: 'Bok Choy', gramsPerTray: 50, defaultSellPrice: 250, active: true },
]

const INITIAL_SETTINGS = {
  _id: 'production',
  cocopeatBrickPrice: 350,
  traysPerBrick: 15,
  packagingTypes: [
    { id: 'box-100g', name: '100g Microgreens Box', sizeGrams: 100, costPerBox: 5 },
  ],
}

// Memory / JSON file fallback if MongoDB Atlas is unreachable or offline
class LocalCollection {
  constructor(name, getStore, saveStore) {
    this.name = name
    this.getStore = getStore
    this.saveStore = saveStore
  }

  _docs() {
    const store = this.getStore()
    if (!store[this.name]) store[this.name] = []
    return store[this.name]
  }

  _match(doc, query = {}) {
    for (const [key, val] of Object.entries(query)) {
      if (key === '_id') {
        const docId = String(doc._id)
        const qId = String(val?._id || val)
        if (docId !== qId) return false
        continue
      }
      if (val !== null && typeof val === 'object') {
        if ('$gt' in val && !(doc[key] > val.$gt)) return false
        if ('$gte' in val && !(doc[key] >= val.$gte)) return false
        if ('$lt' in val && !(doc[key] < val.$lt)) return false
        if ('$lte' in val && !(doc[key] <= val.$lte)) return false
        if ('$ne' in val && doc[key] === val.$ne) return false
        if ('$regex' in val && !new RegExp(val.$regex).test(String(doc[key] || ''))) return false
        continue
      }
      if (doc[key] !== val) return false
    }
    return true
  }

  find(query = {}) {
    const list = this._docs().filter((d) => this._match(d, query))
    return {
      sort(sortSpec = {}) {
        const sorted = [...list].sort((a, b) => {
          for (const [k, dir] of Object.entries(sortSpec)) {
            const va = a[k]
            const vb = b[k]
            if (va < vb) return dir === -1 ? 1 : -1
            if (va > vb) return dir === -1 ? -1 : 1
          }
          return 0
        })
        return {
          toArray: async () => sorted.map((d) => ({ ...d })),
        }
      },
      toArray: async () => list.map((d) => ({ ...d })),
    }
  }

  async findOne(query = {}) {
    const doc = this._docs().find((d) => this._match(d, query))
    return doc ? { ...doc } : null
  }

  async insertOne(doc) {
    const list = this._docs()
    const inserted = {
      _id: doc._id || new ObjectId(),
      ...doc,
    }
    list.push(inserted)
    this.saveStore()
    return { insertedId: inserted._id }
  }

  async insertMany(docs) {
    const ids = []
    for (const d of docs) {
      const res = await this.insertOne(d)
      ids.push(res.insertedId)
    }
    return { insertedIds: ids }
  }

  async updateOne(query, update, options = {}) {
    const list = this._docs()
    const idx = list.findIndex((d) => this._match(d, query))
    if (idx === -1) {
      if (options.upsert) {
        const base = query._id ? { _id: query._id } : { _id: new ObjectId() }
        const next = { ...base }
        if (update.$set) Object.assign(next, update.$set)
        list.push(next)
        this.saveStore()
        return { upsertedId: next._id, matchedCount: 0, modifiedCount: 1 }
      }
      return { matchedCount: 0, modifiedCount: 0 }
    }
    const current = list[idx]
    if (update.$set) Object.assign(current, update.$set)
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) {
        current[k] = (Number(current[k]) || 0) + Number(v)
      }
    }
    this.saveStore()
    return { matchedCount: 1, modifiedCount: 1 }
  }

  async deleteOne(query) {
    const list = this._docs()
    const idx = list.findIndex((d) => this._match(d, query))
    if (idx !== -1) {
      list.splice(idx, 1)
      this.saveStore()
      return { deletedCount: 1 }
    }
    return { deletedCount: 0 }
  }

  async deleteMany(query = {}) {
    const list = this._docs()
    const initial = list.length
    const remaining = list.filter((d) => !this._match(d, query))
    const store = this.getStore()
    store[this.name] = remaining
    this.saveStore()
    return { deletedCount: initial - remaining.length }
  }

  async countDocuments(query = {}) {
    return this._docs().filter((d) => this._match(d, query)).length
  }

  async createIndex() {
    return true
  }
}

function createLocalDb() {
  const dataDir = path.resolve(process.cwd(), '.data')
  const filePath = path.join(dataDir, 'microlife-store.json')
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  let store = null
  function getStore() {
    if (!store) {
      if (fs.existsSync(filePath)) {
        try {
          store = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        } catch {
          store = {}
        }
      } else {
        store = {}
      }
    }
    return store
  }

  function saveStore() {
    try {
      fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8')
    } catch (e) {
      console.error('Failed to write local database store:', e)
    }
  }

  const collections = new Map()
  return {
    collection(name) {
      if (!collections.has(name)) {
        collections.set(name, new LocalCollection(name, getStore, saveStore))
      }
      return collections.get(name)
    },
  }
}

async function seedInitialData(targetDb) {
  try {
    const settings = await targetDb.collection('settings').findOne({ _id: 'production' })
    if (!settings) {
      // First time setup only: initialize default settings and starter varieties
      await targetDb.collection('settings').updateOne(
        { _id: 'production' },
        { $set: { ...INITIAL_SETTINGS, seededAt: new Date().toISOString() } },
        { upsert: true },
      )

      const count = await targetDb.collection('varieties').countDocuments({})
      if (count === 0) {
        for (const v of INITIAL_VARIETIES) {
          await targetDb.collection('varieties').insertOne({
            ...v,
            createdAt: new Date().toISOString(),
          })
        }
      }
    }
  } catch (err) {
    console.warn('Initial seeding warning:', err.message)
  }
}

export async function getDb() {
  if (db) return db

  const uri = process.env.MONGODB_URI
  if (uri && process.env.USE_LOCAL_DB !== 'true') {
    try {
      const connectPromise = (async () => {
        const c = new MongoClient(uri, {
          serverSelectionTimeoutMS: 2000,
          connectTimeoutMS: 2000,
        })
        await c.connect()
        return c
      })()

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection timed out')), 2000)
      )

      client = await Promise.race([connectPromise, timeoutPromise])
      db = client.db(process.env.MONGODB_DB || 'microlife_admin')
      await db.collection('purchases').createIndex({ varietyId: 1, date: 1 })
      await db.collection('electricity').createIndex({ month: 1 }, { unique: true })
      await seedInitialData(db)
      return db
    } catch (err) {
      console.warn(`MongoDB unavailable (${err.message}). Using persistent local store fallback.`)
    }
  }

  db = createLocalDb()
  await seedInitialData(db)
  return db
}

export function serialize(doc) {
  if (!doc) return doc
  if (Array.isArray(doc)) return doc.map(serialize)
  if (doc._id) {
    const { _id, ...rest } = doc
    return { id: String(_id), ...rest }
  }
  return doc
}
