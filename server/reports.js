import { oid } from './fifo.js'
import { round2, round4, monthKey, inRange } from './money.js'

function periodFromQuery(q) {
  const mode = q.mode || 'month'
  if (mode === 'batch') {
    return { mode, sowingBatchId: q.sowingBatchId, from: q.from || null, to: q.to || null }
  }
  if (mode === 'range' || mode === 'variety') {
    return { mode, from: q.from, to: q.to, varietyId: q.varietyId || null }
  }
  const month = q.month || new Date().toISOString().slice(0, 7)
  return { mode: 'month', month, from: `${month}-01`, to: monthEnd(month) }
}

function monthEnd(month) {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${month}-${String(last).padStart(2, '0')}`
}

export async function buildReport(db, query = {}) {
  const period = periodFromQuery(query)
  const varieties = await db.collection('varieties').find({}).toArray()
  const varietyNameMap = Object.fromEntries(varieties.map((v) => [String(v._id), v.name]))

  const sowingFilter = {}
  const harvestFilter = {}
  const salesFilter = {}
  const expenseFilter = {}

  if (period.sowingBatchId) {
    try {
      sowingFilter._id = oid(period.sowingBatchId)
    } catch {
      sowingFilter._id = period.sowingBatchId
    }
    harvestFilter.sowingBatchId = period.sowingBatchId
  }

  const sowings = await db.collection('sowingBatches').find(sowingFilter).toArray()
  const harvests = await db.collection('harvests').find(harvestFilter).toArray()
  const sales = await db.collection('sales').find(salesFilter).toArray()
  const expenses = await db.collection('expenses').find(expenseFilter).toArray()
  const electricity = await db.collection('electricity').find({}).toArray()
  const purchases = await db.collection('purchases').find({ remainingKg: { $gt: 0 } }).toArray()
  const packedLots = await db.collection('packedLots').find({ boxesRemaining: { $gt: 0 } }).toArray()

  const inPeriod = (date) => {
    if (period.sowingBatchId && !period.from && !period.to) return true
    return inRange(date, period.from, period.to)
  }

  const sowingsIn = sowings.filter((s) => inPeriod(s.date))
  const harvestsIn = harvests.filter((h) => inPeriod(h.date))
  const salesIn = sales.filter((s) => {
    if (!inPeriod(s.date)) return false
    if (period.varietyId && s.varietyId !== period.varietyId) return false
    if (period.sowingBatchId && s.sowingBatchId !== period.sowingBatchId) {
      const matchAlloc = (s.allocations || []).some((a) => a.sowingBatchId === period.sowingBatchId)
      if (!matchAlloc) return false
    }
    return true
  })
  const expensesIn = expenses.filter((e) => inPeriod(e.date))

  let electricityIn = []
  if (period.mode === 'month') {
    electricityIn = electricity.filter((e) => e.month === period.month)
  } else if (period.from && period.to) {
    electricityIn = electricity.filter(
      (e) => e.month >= monthKey(period.from) && e.month <= monthKey(period.to),
    )
  } else if (period.sowingBatchId) {
    electricityIn = []
  }

  // Production Metrics in Period
  const traysSown = sowingsIn.reduce(
    (s, b) => s + b.items.reduce((t, i) => t + Number(i.trays || 0), 0),
    0,
  )
  const seedCostSown = round2(
    sowingsIn.reduce((s, b) => s + b.items.reduce((t, i) => t + Number(i.seedCost || 0), 0), 0),
  )
  const cocopeatCostSown = round2(
    sowingsIn.reduce((s, b) => s + b.items.reduce((t, i) => t + Number(i.cocopeatCost || 0), 0), 0),
  )
  const directGrowingCostSown = round2(seedCostSown + cocopeatCostSown)

  const traysHarvested = harvestsIn.reduce(
    (s, h) => s + h.items.reduce((t, i) => t + Number(i.traysHarvested || 0), 0),
    0,
  )
  const boxesPacked = harvestsIn.reduce(
    (s, h) => s + h.items.reduce((t, i) => t + Number(i.boxesPacked || 0), 0),
    0,
  )
  const packagingCostPacked = round2(
    harvestsIn.reduce((s, h) => s + h.items.reduce((t, i) => t + Number(i.packagingCost || 0), 0), 0),
  )
  const gramsHarvested = harvestsIn.reduce(
    (s, h) => s + h.items.reduce((t, i) => t + Number(i.weightGrams || 0), 0),
    0,
  )
  const avgGramsPerTray = traysHarvested > 0 ? round2(gramsHarvested / traysHarvested) : 0
  const avgBoxesPerTray = traysHarvested > 0 ? round2(boxesPacked / traysHarvested) : 0

  // Sales & COGS Metrics (Accounting: Costs matched to sold/written-off boxes)
  const regularSales = salesIn.filter((s) => s.type !== 'writeoff')
  const writeoffSales = salesIn.filter((s) => s.type === 'writeoff')

  const boxesSold = regularSales.reduce((s, r) => s + Number(r.boxes || 0), 0)
  const boxesWrittenOff = writeoffSales.reduce((s, r) => s + Number(r.boxes || 0), 0)
  const revenue = round2(regularSales.reduce((s, r) => s + Number(r.revenue || 0), 0))

  const seedCost = round2(salesIn.reduce((s, r) => s + Number(r.seedCost || 0), 0))
  const cocopeatCost = round2(salesIn.reduce((s, r) => s + Number(r.cocopeatCost || 0), 0))
  const packagingCost = round2(salesIn.reduce((s, r) => s + Number(r.packagingCost || 0), 0))
  const cogs = round2(seedCost + cocopeatCost + packagingCost)
  const grossProfit = round2(revenue - cogs)

  // Overheads
  const electricityExpense = round2(electricityIn.reduce((s, e) => s + Number(e.total || 0), 0))
  const otherExpenses = round2(expensesIn.reduce((s, e) => s + Number(e.amount || 0), 0))
  const operating = round2(electricityExpense + otherExpenses)
  const netProfit = round2(grossProfit - operating)
  const profitMargin = revenue > 0 ? round2((netProfit / revenue) * 100) : 0

  // Current Stock Valuation
  const seedStockValue = round2(
    purchases.reduce((s, p) => s + (Number(p.remainingKg) || 0) * (Number(p.pricePerKg) || 0), 0),
  )
  const packedStockBoxes = packedLots.reduce((s, l) => s + (Number(l.boxesRemaining) || 0), 0)
  const packedStockValue = round2(
    packedLots.reduce(
      (s, l) => s + (Number(l.boxesRemaining) || 0) * (Number(l.totalCostPerBox) || 0),
      0,
    ),
  )

  // Breakdown By Variety
  const byVarietyMap = {}
  for (const v of varieties) {
    const id = String(v._id)
    byVarietyMap[id] = {
      varietyId: id,
      varietyName: v.name,
      boxesSold: 0,
      boxesWrittenOff: 0,
      revenue: 0,
      seedCost: 0,
      cocopeatCost: 0,
      packagingCost: 0,
      cogs: 0,
      grossProfit: 0,
      margin: 0,
    }
  }

  for (const sale of salesIn) {
    const key = sale.varietyId
    if (!byVarietyMap[key]) {
      byVarietyMap[key] = {
        varietyId: key,
        varietyName: sale.varietyName || varietyNameMap[key] || 'Unknown',
        boxesSold: 0,
        boxesWrittenOff: 0,
        revenue: 0,
        seedCost: 0,
        cocopeatCost: 0,
        packagingCost: 0,
        cogs: 0,
        grossProfit: 0,
        margin: 0,
      }
    }
    const row = byVarietyMap[key]
    if (sale.type === 'writeoff') {
      row.boxesWrittenOff += Number(sale.boxes || 0)
    } else {
      row.boxesSold += Number(sale.boxes || 0)
    }
    row.revenue = round2(row.revenue + Number(sale.revenue || 0))
    row.seedCost = round2(row.seedCost + Number(sale.seedCost || 0))
    row.cocopeatCost = round2(row.cocopeatCost + Number(sale.cocopeatCost || 0))
    row.packagingCost = round2(row.packagingCost + Number(sale.packagingCost || 0))
    row.cogs = round2(row.seedCost + row.cocopeatCost + row.packagingCost)
    row.grossProfit = round2(row.revenue - row.cogs)
    row.margin = row.revenue > 0 ? round2((row.grossProfit / row.revenue) * 100) : 0
  }

  // Breakdown By Sowing Batch
  const byBatchMap = {}
  for (const b of sowings) {
    const id = String(b._id)
    byBatchMap[id] = {
      sowingBatchId: id,
      batchCode: b.batchCode,
      sowingDate: b.date,
      status: b.status,
      traysSown: (b.items || []).reduce((sum, i) => sum + Number(i.trays || 0), 0),
      traysHarvested: (b.items || []).reduce((sum, i) => sum + Number(i.harvestedTrays || 0), 0),
      productionCost: Number(b.totalProductionCost || (b.seedCost + b.cocopeatCost) || 0),
      boxesSold: 0,
      revenue: 0,
      cogs: 0,
      profit: 0,
    }
  }

  for (const sale of salesIn) {
    const allocations = sale.allocations || []
    if (allocations.length) {
      for (const alloc of allocations) {
        const batchKey = alloc.sowingBatchId || sale.sowingBatchId || 'unlinked'
        if (!byBatchMap[batchKey]) {
          const sowing = sowings.find((s) => String(s._id) === batchKey)
          byBatchMap[batchKey] = {
            sowingBatchId: batchKey,
            batchCode: sowing?.batchCode || 'Unlinked',
            sowingDate: sowing?.date || null,
            status: sowing?.status || '—',
            traysSown: 0,
            traysHarvested: 0,
            productionCost: 0,
            boxesSold: 0,
            revenue: 0,
            cogs: 0,
            profit: 0,
          }
        }
        const bRow = byBatchMap[batchKey]
        bRow.boxesSold += Number(alloc.boxes || 0)
        const allocRev = sale.boxes > 0 ? round2((Number(alloc.boxes) / sale.boxes) * sale.revenue) : 0
        bRow.revenue = round2(bRow.revenue + allocRev)
        bRow.cogs = round2(bRow.cogs + Number(alloc.cogs || 0))
        bRow.profit = round2(bRow.revenue - bRow.cogs)
      }
    } else {
      const batchKey = sale.sowingBatchId || 'unlinked'
      if (!byBatchMap[batchKey]) {
        const sowing = sowings.find((s) => String(s._id) === batchKey)
        byBatchMap[batchKey] = {
          sowingBatchId: batchKey,
          batchCode: sowing?.batchCode || 'Unlinked',
          sowingDate: sowing?.date || null,
          status: sowing?.status || '—',
          traysSown: 0,
          traysHarvested: 0,
          productionCost: 0,
          boxesSold: 0,
          revenue: 0,
          cogs: 0,
          profit: 0,
        }
      }
      const bRow = byBatchMap[batchKey]
      bRow.boxesSold += Number(sale.boxes || 0)
      bRow.revenue = round2(bRow.revenue + Number(sale.revenue || 0))
      bRow.cogs = round2(bRow.cogs + Number(sale.cogs || 0))
      bRow.profit = round2(bRow.revenue - bRow.cogs)
    }
  }

  return {
    period,
    production: {
      traysSown,
      seedCostSown,
      cocopeatCostSown,
      directGrowingCostSown,
      traysHarvested,
      boxesPacked,
      packagingCostPacked,
      gramsHarvested,
      avgGramsPerTray,
      avgBoxesPerTray,
      boxesSold,
      boxesWrittenOff,
    },
    pnl: {
      revenue,
      seedCost,
      cocopeatCost,
      packagingCost,
      cogs,
      grossProfit,
      electricityExpense,
      otherExpenses,
      operating,
      netProfit,
      profitMargin,
    },
    valuation: {
      seedStockValue,
      packedStockBoxes,
      packedStockValue,
    },
    byVariety: Object.values(byVarietyMap).filter((r) => r.boxesSold > 0 || r.revenue > 0 || r.cogs > 0),
    byBatch: Object.values(byBatchMap).filter((b) => b.traysSown > 0 || b.boxesSold > 0),
    sales: salesIn,
    expenses: expensesIn,
    electricity: electricityIn,
  }
}
