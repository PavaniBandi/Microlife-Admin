import express from 'express'
import { getDb, serialize } from './db.js'
import { consumePackedBoxes, consumeSeed, oid } from './fifo.js'
import { round2, round4, todayISO } from './money.js'
import { buildReport } from './reports.js'

const app = express()
app.use(express.json())

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}

const DEFAULT_SETTINGS = {
  _id: 'production',
  cocopeatBrickPrice: 350,
  traysPerBrick: 15,
  packagingTypes: [
    {
      id: 'box-100g',
      name: '100g Microgreens Box',
      sizeGrams: 100,
      costPerBox: 5,
    },
  ],
}

async function getSettings(db) {
  const doc = await db.collection('settings').findOne({ _id: 'production' })
  if (!doc) {
    await db.collection('settings').updateOne(
      { _id: 'production' },
      { $set: DEFAULT_SETTINGS },
      { upsert: true },
    )
    return DEFAULT_SETTINGS
  }
  return {
    ...DEFAULT_SETTINGS,
    ...doc,
    packagingTypes: doc.packagingTypes?.length ? doc.packagingTypes : DEFAULT_SETTINGS.packagingTypes,
  }
}

function cocopeatPerTray(settings) {
  const price = Number(settings?.cocopeatBrickPrice) || 350
  const trays = Number(settings?.traysPerBrick) || 15
  if (!trays || trays <= 0) return 23.33
  return round2(price / trays)
}

async function nextBatchCode(db, date) {
  const cleanDate = (date || todayISO()).replace(/-/g, '')
  const prefix = `ML-${cleanDate}`
  const count = await db.collection('sowingBatches').countDocuments({
    batchCode: { $regex: `^${prefix}` },
  })
  return `${prefix}-${String(count + 1).padStart(3, '0')}`
}

app.get(
  '/api/health',
  asyncHandler(async (_req, res) => {
    await getDb()
    res.json({ ok: true })
  }),
)

// ==================== VARIETIES ====================
app.get(
  '/api/varieties',
  asyncHandler(async (_req, res) => {
    const db = await getDb()
    const rows = await db.collection('varieties').find({}).sort({ name: 1 }).toArray()
    res.json(serialize(rows))
  }),
)

app.post(
  '/api/varieties',
  asyncHandler(async (req, res) => {
    const db = await getDb()
    const { name, gramsPerTray = 70, defaultSellPrice = 250, active = true } = req.body
    if (!name?.trim()) {
      const err = new Error('Variety name is required')
      err.status = 400
      throw err
    }
    const doc = {
      name: name.trim(),
      gramsPerTray: Number(gramsPerTray) || 70,
      defaultSellPrice: Number(defaultSellPrice) || 250,
      active: Boolean(active),
      createdAt: new Date().toISOString(),
    }
    const result = await db.collection('varieties').insertOne(doc)
    res.status(201).json(serialize({ _id: result.insertedId, ...doc }))
  }),
)

app.put(
  '/api/varieties/:id',
  asyncHandler(async (req, res) => {
    const db = await getDb()
    const { name, gramsPerTray, defaultSellPrice, active } = req.body
    const $set = {}
    if (name != null) $set.name = String(name).trim()
    if (gramsPerTray != null) $set.gramsPerTray = Number(gramsPerTray)
    if (defaultSellPrice != null) $set.defaultSellPrice = Number(defaultSellPrice)
    if (active != null) $set.active = Boolean(active)
    await db.collection('varieties').updateOne({ _id: oid(req.params.id) }, { $set })
    const row = await db.collection('varieties').findOne({ _id: oid(req.params.id) })
    res.json(serialize(row))
  }),
)

app.delete(
  '/api/varieties/:id',
  asyncHandler(async (req, res) => {
    const db = await getDb()
    const id = req.params.id
    const used = await db.collection('purchases').findOne({ varietyId: id })
    if (used) {
      await db.collection('varieties').updateOne({ _id: oid(id) }, { $set: { active: false } })
      return res.json({ ok: true, deactivated: true })
    }
    await db.collection('varieties').deleteOne({ _id: oid(id) })
    res.json({ ok: true, deleted: true })
  }),
)

// ==================== SEED PURCHASES & INVENTORY ====================
app.get(
  '/api/purchases',
  asyncHandler(async (_req, res) => {
    const db = await getDb()
    const rows = await db.collection('purchases').find({}).sort({ date: -1, _id: -1 }).toArray()
    res.json(serialize(rows))
  }),
)

app.post(
  '/api/purchases',
  asyncHandler(async (req, res) => {
    const db = await getDb()
    const { varietyId, supplier = '', date = todayISO(), quantityKg, pricePerKg } = req.body
    if (!varietyId || !date || !quantityKg || pricePerKg == null) {
      const err = new Error('varietyId, date, quantityKg and pricePerKg are required')
      err.status = 400
      throw err
    }
    const qty = Number(quantityKg)
    const price = Number(pricePerKg)
    if (qty <= 0 || price < 0) {
      const err = new Error('Quantity must be > 0 and price cannot be negative')
      err.status = 400
      throw err
    }
    const variety = await db.collection('varieties').findOne({ _id: oid(varietyId) })
    const doc = {
      varietyId,
      varietyName: variety?.name || '',
      supplier: supplier.trim(),
      date,
      quantityKg: qty,
      remainingKg: qty,
      pricePerKg: price,
      totalValue: round2(qty * price),
      createdAt: new Date().toISOString(),
    }
    const result = await db.collection('purchases').insertOne(doc)
    await db.collection('inventoryTx').insertOne({
      type: 'purchase',
      varietyId,
      varietyName: variety?.name || '',
      purchaseId: String(result.insertedId),
      quantityKg: qty,
      pricePerKg: price,
      totalValue: doc.totalValue,
      date,
      notes: supplier,
      createdAt: new Date().toISOString(),
    })
    res.status(201).json(serialize({ _id: result.insertedId, ...doc }))
  }),
)

app.post(
  '/api/inventory/adjust',
  asyncHandler(async (req, res) => {
    const db = await getDb()
    const { varietyId, date = todayISO(), quantityKg, reason = 'adjustment', notes = '' } = req.body
    const qty = Number(quantityKg)
    if (!varietyId || !qty) {
      const err = new Error('varietyId and non-zero quantityKg are required')
      err.status = 400
      throw err
    }
    if (qty < 0) {
      await consumeSeed(db, varietyId, Math.abs(qty) * 1000)
    } else {
      const err = new Error('Positive adjustments require a purchase batch. Please record a purchase.')
      err.status = 400
      throw err
    }
    const doc = { type: reason, varietyId, quantityKg: qty, date, notes, createdAt: new Date().toISOString() }
    await db.collection('inventoryTx').insertOne(doc)
    res.status(201).json(doc)
  }),
)

app.get(
  '/api/inventory',
  asyncHandler(async (_req, res) => {
    const db = await getDb()
    const varieties = await db.collection('varieties').find({}).sort({ name: 1 }).toArray()
    const purchases = await db.collection('purchases').find({ remainingKg: { $gt: 0 } }).toArray()
    const lots = await db.collection('packedLots').find({ boxesRemaining: { $gt: 0 } }).toArray()
    const sowings = await db.collection('sowingBatches').find({ status: { $ne: 'harvested' } }).toArray()

    const stock = varieties.map((v) => {
      const batches = purchases.filter((p) => p.varietyId === String(v._id))
      const remainingKg = round4(batches.reduce((s, b) => s + (Number(b.remainingKg) || 0), 0))
      const value = round2(
        batches.reduce((s, b) => s + (Number(b.remainingKg) || 0) * (Number(b.pricePerKg) || 0), 0),
      )
      return {
        varietyId: String(v._id),
        name: v.name,
        active: v.active,
        gramsPerTray: v.gramsPerTray,
        defaultSellPrice: v.defaultSellPrice,
        remainingKg,
        value,
        batches: serialize(batches),
      }
    })

    const packed = lots.map((l) => ({
      ...serialize(l),
      varietyName: l.varietyName || varieties.find((v) => String(v._id) === l.varietyId)?.name || 'Unknown',
    }))

    const activeTrays = sowings.reduce((s, b) => {
      return (
        s +
        (b.items || []).reduce(
          (t, i) => t + Math.max(0, Number(i.trays || 0) - Number(i.harvestedTrays || 0)),
          0,
        )
      )
    }, 0)

    res.json({ stock, packed, activeTrays })
  }),
)

// ==================== SETTINGS (PRODUCTION COSTS) ====================
app.get(
  '/api/settings',
  asyncHandler(async (_req, res) => {
    const db = await getDb()
    const settings = await getSettings(db)
    res.json({
      ...settings,
      cocopeatCostPerTray: cocopeatPerTray(settings),
    })
  }),
)

app.put(
  '/api/settings',
  asyncHandler(async (req, res) => {
    const db = await getDb()
    const current = await getSettings(db)
    const next = {
      ...current,
      cocopeatBrickPrice: Number(req.body.cocopeatBrickPrice ?? current.cocopeatBrickPrice),
      traysPerBrick: Number(req.body.traysPerBrick ?? current.traysPerBrick),
      packagingTypes: req.body.packagingTypes ?? current.packagingTypes,
    }
    next.packagingTypes = (next.packagingTypes || []).map((p, idx) => ({
      id: p.id || `pack-${Date.now()}-${idx}`,
      name: p.name || 'Box',
      sizeGrams: Number(p.sizeGrams) || 100,
      costPerBox: Number(p.costPerBox) || 0,
    }))
    await db.collection('settings').updateOne(
      { _id: 'production' },
      { $set: next },
      { upsert: true },
    )
    res.json({ ...next, cocopeatCostPerTray: cocopeatPerTray(next) })
  }),
)

// ==================== SOWING ====================
app.get(
  '/api/sowings',
  asyncHandler(async (_req, res) => {
    const db = await getDb()
    const rows = await db.collection('sowingBatches').find({}).sort({ date: -1, _id: -1 }).toArray()
    res.json(serialize(rows))
  }),
)

app.post(
  '/api/sowings',
  asyncHandler(async (req, res) => {
    const db = await getDb()
    const settings = await getSettings(db)
    const cocoPerTray = cocopeatPerTray(settings)
    const { date = todayISO(), notes = '', items = [] } = req.body
    if (!items.length) {
      const err = new Error('Add at least one variety and tray count')
      err.status = 400
      throw err
    }

    const savedItems = []
    for (const item of items) {
      const variety = await db.collection('varieties').findOne({ _id: oid(item.varietyId) })
      if (!variety) {
        const err = new Error('Variety not found')
        err.status = 400
        throw err
      }
      const trays = Number(item.trays)
      if (!trays || trays <= 0) {
        const err = new Error(`Trays must be greater than 0 for ${variety.name}`)
        err.status = 400
        throw err
      }

      // FIX BUG: properly handle gramsPerTray fallback when blank or 0
      const rawGrams =
        item.gramsPerTray !== undefined && item.gramsPerTray !== null && item.gramsPerTray !== ''
          ? Number(item.gramsPerTray)
          : Number(variety.gramsPerTray || 70)
      const gramsPerTray =
        Number.isFinite(rawGrams) && rawGrams > 0 ? rawGrams : Number(variety.gramsPerTray || 70)

      const seedGrams = round4(trays * gramsPerTray)
      const consumed = await consumeSeed(db, item.varietyId, seedGrams)
      const cocopeatCost = round2(trays * cocoPerTray)
      const productionCost = round2(consumed.totalCost + cocopeatCost)

      savedItems.push({
        varietyId: item.varietyId,
        varietyName: variety.name,
        trays,
        harvestedTrays: 0,
        gramsPerTray,
        seedGrams,
        seedCost: consumed.totalCost,
        allocations: consumed.allocations,
        cocopeatCostPerTray: cocoPerTray,
        cocopeatCost,
        productionCost,
        allocatedProductionCost: 0,
      })

      await db.collection('inventoryTx').insertOne({
        type: 'consumption',
        varietyId: item.varietyId,
        varietyName: variety.name,
        quantityKg: -consumed.totalKg,
        date,
        notes: `Sown in batch: ${trays} trays (${seedGrams}g total @ ${gramsPerTray}g/tray)`,
        createdAt: new Date().toISOString(),
      })
    }

    const doc = {
      batchCode: await nextBatchCode(db, date),
      date,
      notes,
      status: 'open',
      items: savedItems,
      seedCost: round2(savedItems.reduce((s, i) => s + i.seedCost, 0)),
      cocopeatCost: round2(savedItems.reduce((s, i) => s + i.cocopeatCost, 0)),
      totalProductionCost: round2(savedItems.reduce((s, i) => s + i.productionCost, 0)),
      createdAt: new Date().toISOString(),
    }
    const result = await db.collection('sowingBatches').insertOne(doc)
    res.status(201).json(serialize({ _id: result.insertedId, ...doc }))
  }),
)

// ==================== HARVEST & PACKAGING ====================
app.get(
  '/api/harvests',
  asyncHandler(async (_req, res) => {
    const db = await getDb()
    const rows = await db.collection('harvests').find({}).sort({ date: -1, _id: -1 }).toArray()
    res.json(serialize(rows))
  }),
)

app.post(
  '/api/harvests',
  asyncHandler(async (req, res) => {
    const db = await getDb()
    const settings = await getSettings(db)
    const { sowingBatchId, date = todayISO(), items = [], soldImmediately } = req.body
    const sowing = await db.collection('sowingBatches').findOne({ _id: oid(sowingBatchId) })
    if (!sowing) {
      const err = new Error('Sowing batch not found')
      err.status = 400
      throw err
    }
    if (!items.length) {
      const err = new Error('Add harvest lines')
      err.status = 400
      throw err
    }

    const savedItems = []
    const lots = []

    for (const line of items) {
      const sowingItem = sowing.items.find((i) => i.varietyId === line.varietyId)
      if (!sowingItem) {
        const err = new Error('Variety was not part of this sowing batch')
        err.status = 400
        throw err
      }
      const traysHarvested = Number(line.traysHarvested || 0)
      const boxesPacked = Number(line.boxesPacked || 0)
      if (traysHarvested <= 0 && boxesPacked <= 0) continue

      const previouslyHarvested = Number(sowingItem.harvestedTrays || 0)
      const remainingTrays = Math.max(0, Number(sowingItem.trays) - previouslyHarvested)
      const remainingCost = Math.max(
        0,
        Number(sowingItem.productionCost) - Number(sowingItem.allocatedProductionCost || 0),
      )

      const allocRatio = remainingTrays <= 0 ? 0 : Math.min(1, traysHarvested / remainingTrays)
      const allocatedProduction = round2(remainingCost * allocRatio)

      // Packaging type & cost resolution
      const pack =
        (settings.packagingTypes || []).find((p) => p.id === line.packagingTypeId) ||
        settings.packagingTypes?.[0]
      const packagingCostPerBox = pack ? Number(pack.costPerBox) : Number(line.packagingCostPerBox || 5)
      const packagingCost = round2(boxesPacked * packagingCostPerBox)

      const seedShare =
        Number(sowingItem.productionCost) > 0
          ? round2(allocatedProduction * (Number(sowingItem.seedCost || 0) / Number(sowingItem.productionCost)))
          : 0
      const cocoShare = round2(allocatedProduction - seedShare)

      const seedCostPerBox = boxesPacked > 0 ? round4(seedShare / boxesPacked) : 0
      const cocopeatCostPerBox = boxesPacked > 0 ? round4(cocoShare / boxesPacked) : 0
      const totalCostPerBox =
        boxesPacked > 0 ? round4((allocatedProduction + packagingCost) / boxesPacked) : 0

      sowingItem.harvestedTrays = previouslyHarvested + traysHarvested
      sowingItem.allocatedProductionCost = round2(
        Number(sowingItem.allocatedProductionCost || 0) + allocatedProduction,
      )

      savedItems.push({
        varietyId: line.varietyId,
        varietyName: sowingItem.varietyName,
        traysHarvested,
        weightGrams: Number(line.weightGrams || 0),
        packagingTypeId: pack?.id || line.packagingTypeId || null,
        packagingName: pack?.name || line.packagingName || '100g Box',
        sizeGrams: pack?.sizeGrams || Number(line.sizeGrams || 100),
        boxesPacked,
        packagingCostPerBox,
        packagingCost,
        allocatedProduction,
        seedCostPerBox,
        cocopeatCostPerBox,
        totalCostPerBox,
      })

      if (boxesPacked > 0) {
        lots.push({
          sowingBatchId,
          batchCode: sowing.batchCode,
          varietyId: line.varietyId,
          varietyName: sowingItem.varietyName,
          date,
          packagingTypeId: pack?.id || null,
          packagingName: pack?.name || '100g Box',
          sizeGrams: pack?.sizeGrams || 100,
          boxesTotal: boxesPacked,
          boxesRemaining: boxesPacked,
          seedCostPerBox,
          cocopeatCostPerBox,
          packagingCostPerBox,
          totalCostPerBox,
        })
      }
    }

    const fullyHarvested = sowing.items.every((i) => Number(i.harvestedTrays || 0) >= Number(i.trays))
    sowing.status = fullyHarvested ? 'harvested' : 'partial'

    const harvestDoc = {
      sowingBatchId,
      batchCode: sowing.batchCode,
      date,
      items: savedItems,
      createdAt: new Date().toISOString(),
    }
    const result = await db.collection('harvests').insertOne(harvestDoc)
    const harvestId = String(result.insertedId)

    for (const lot of lots) {
      lot.harvestId = harvestId
      await db.collection('packedLots').insertOne(lot)
    }

    await db.collection('sowingBatches').updateOne(
      { _id: sowing._id },
      { $set: { items: sowing.items, status: sowing.status } },
    )

    let sale = null
    if (soldImmediately?.boxes && Number(soldImmediately.boxes) > 0 && soldImmediately?.varietyId) {
      const variety = await db.collection('varieties').findOne({ _id: oid(soldImmediately.varietyId) })
      const price = Number(soldImmediately.pricePerBox) || Number(variety?.defaultSellPrice) || 250
      sale = await recordSale(db, {
        date,
        varietyId: soldImmediately.varietyId,
        sowingBatchId,
        boxes: Number(soldImmediately.boxes),
        pricePerBox: price,
        customer: soldImmediately.customer || 'Sold on harvest',
        type: 'sale',
      })
    }

    res.status(201).json({ harvest: serialize({ _id: result.insertedId, ...harvestDoc }), sale })
  }),
)

// ==================== SALES & REVENUE ====================
async function recordSale(db, body) {
  const { date = todayISO(), varietyId, sowingBatchId, boxes, pricePerBox, customer = '', type = 'sale' } = body
  if (!varietyId || !date || !boxes) {
    const err = new Error('varietyId, date and boxes are required')
    err.status = 400
    throw err
  }
  const qty = Number(boxes)
  if (qty <= 0) {
    const err = new Error('Boxes must be greater than 0')
    err.status = 400
    throw err
  }

  const variety = await db.collection('varieties').findOne({ _id: oid(varietyId) })
  const consumed = await consumePackedBoxes(db, {
    varietyId,
    boxes: qty,
    sowingBatchId: sowingBatchId || undefined,
  })

  const unitPrice =
    type === 'writeoff'
      ? 0
      : Number(pricePerBox) != null && Number(pricePerBox) >= 0
        ? Number(pricePerBox)
        : Number(variety?.defaultSellPrice || 250)

  const revenue = type === 'writeoff' ? 0 : round2(qty * unitPrice)

  const doc = {
    date,
    varietyId,
    varietyName: variety?.name || '',
    sowingBatchId: consumed.allocations[0]?.sowingBatchId || sowingBatchId || null,
    boxes: qty,
    pricePerBox: unitPrice,
    revenue,
    customer,
    type,
    seedCost: consumed.seedCost,
    cocopeatCost: consumed.cocopeatCost,
    packagingCost: consumed.packagingCost,
    cogs: consumed.cogs,
    grossProfit: round2(revenue - consumed.cogs),
    allocations: consumed.allocations,
    createdAt: new Date().toISOString(),
  }
  const result = await db.collection('sales').insertOne(doc)
  return serialize({ _id: result.insertedId, ...doc })
}

app.get(
  '/api/sales',
  asyncHandler(async (_req, res) => {
    const db = await getDb()
    const rows = await db.collection('sales').find({}).sort({ date: -1, _id: -1 }).toArray()
    res.json(serialize(rows))
  }),
)

app.post(
  '/api/sales',
  asyncHandler(async (req, res) => {
    const db = await getDb()
    const sale = await recordSale(db, req.body)
    res.status(201).json(sale)
  }),
)

// ==================== ELECTRICITY (MONTHLY) ====================
app.get(
  '/api/electricity',
  asyncHandler(async (_req, res) => {
    const db = await getDb()
    const rows = await db.collection('electricity').find({}).sort({ month: -1 }).toArray()
    res.json(serialize(rows))
  }),
)

app.put(
  '/api/electricity/:month',
  asyncHandler(async (req, res) => {
    const db = await getDb()
    const month = req.params.month
    const units = Number(req.body.units) || 0
    const rate = Number(req.body.rate) || 0
    const calculated = round2(units * rate)
    const total =
      req.body.billAmount != null && req.body.billAmount !== ''
        ? Number(req.body.billAmount)
        : calculated
    const doc = {
      month,
      units,
      rate,
      calculated,
      total,
      notes: req.body.notes || '',
      updatedAt: new Date().toISOString(),
    }
    await db.collection('electricity').updateOne(
      { month },
      { $set: doc },
      { upsert: true },
    )
    res.json(doc)
  }),
)

// ==================== OTHER OPERATING EXPENSES ====================
app.get(
  '/api/expenses',
  asyncHandler(async (_req, res) => {
    const db = await getDb()
    const rows = await db.collection('expenses').find({}).sort({ date: -1, _id: -1 }).toArray()
    res.json(serialize(rows))
  }),
)

app.post(
  '/api/expenses',
  asyncHandler(async (req, res) => {
    const db = await getDb()
    const { date = todayISO(), category, amount, description = '' } = req.body
    if (!category || amount == null || Number(amount) < 0) {
      const err = new Error('category and valid amount are required')
      err.status = 400
      throw err
    }
    const doc = {
      date,
      category,
      amount: Number(amount),
      description,
      createdAt: new Date().toISOString(),
    }
    const result = await db.collection('expenses').insertOne(doc)
    res.status(201).json(serialize({ _id: result.insertedId, ...doc }))
  }),
)

app.delete(
  '/api/expenses/:id',
  asyncHandler(async (req, res) => {
    const db = await getDb()
    await db.collection('expenses').deleteOne({ _id: oid(req.params.id) })
    res.json({ ok: true })
  }),
)

// ==================== REPORTS & DASHBOARD ====================
app.get(
  '/api/reports',
  asyncHandler(async (req, res) => {
    const db = await getDb()
    const report = await buildReport(db, req.query)
    res.json(report)
  }),
)

app.get(
  '/api/dashboard',
  asyncHandler(async (_req, res) => {
    const db = await getDb()
    const month = new Date().toISOString().slice(0, 7)

    const varieties = await db.collection('varieties').find({ active: true }).sort({ name: 1 }).toArray()
    const purchases = await db.collection('purchases').find({ remainingKg: { $gt: 0 } }).toArray()
    const lots = await db.collection('packedLots').find({ boxesRemaining: { $gt: 0 } }).toArray()
    const sowings = await db.collection('sowingBatches').find({ status: { $ne: 'harvested' } }).sort({ date: -1 }).toArray()

    const stockValue = round2(
      purchases.reduce((s, p) => s + (Number(p.remainingKg) || 0) * (Number(p.pricePerKg) || 0), 0),
    )
    const packedBoxes = lots.reduce((s, l) => s + (Number(l.boxesRemaining) || 0), 0)
    const packedValue = round2(
      lots.reduce((s, l) => s + (Number(l.boxesRemaining) || 0) * (Number(l.totalCostPerBox) || 0), 0),
    )
    const activeTrays = sowings.reduce(
      (s, b) =>
        s +
        (b.items || []).reduce(
          (t, i) => t + Math.max(0, Number(i.trays || 0) - Number(i.harvestedTrays || 0)),
          0,
        ),
      0,
    )

    const stock = varieties.map((v) => {
      const remainingKg = round4(
        purchases
          .filter((p) => p.varietyId === String(v._id))
          .reduce((s, p) => s + (Number(p.remainingKg) || 0), 0),
      )
      return {
        id: String(v._id),
        name: v.name,
        remainingKg,
        gramsPerTray: v.gramsPerTray,
      }
    })

    const report = await buildReport(db, { mode: 'month', month })
    res.json({
      month,
      inventory: {
        stockValue,
        packedBoxes,
        packedValue,
        activeTrays,
        stock,
        activeBatches: serialize(sowings),
      },
      report,
    })
  }),
)

// ==================== ADMIN & DATA RESET ====================
app.post(
  '/api/admin/reset-data',
  asyncHandler(async (req, res) => {
    const db = await getDb()
    const { preserveVarieties = true } = req.body

    await Promise.all([
      db.collection('sowingBatches').deleteMany({}),
      db.collection('harvests').deleteMany({}),
      db.collection('packedLots').deleteMany({}),
      db.collection('sales').deleteMany({}),
      db.collection('purchases').deleteMany({}),
      db.collection('inventoryTx').deleteMany({}),
      db.collection('electricity').deleteMany({}),
      db.collection('expenses').deleteMany({}),
    ])

    if (!preserveVarieties) {
      await db.collection('varieties').deleteMany({})
    }

    res.json({ ok: true, message: 'All operational data cleared successfully.' })
  }),
)

app.use((err, _req, res, _next) => {
  const status = err.status || 500
  res.status(status).json({ error: err.message || 'Server error' })
})

export default app
