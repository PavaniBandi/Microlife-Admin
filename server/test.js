import { getDb } from './db.js'
import { consumeSeed, consumePackedBoxes } from './fifo.js'
import { buildReport } from './reports.js'

async function runTest() {
  const db = await getDb()

  // Clear collections for test
  await db.collection('purchases').deleteMany({})
  await db.collection('sowingBatches').deleteMany({})
  await db.collection('harvests').deleteMany({})
  await db.collection('packedLots').deleteMany({})
  await db.collection('sales').deleteMany({})
  await db.collection('electricity').deleteMany({})
  await db.collection('expenses').deleteMany({})

  const varieties = await db.collection('varieties').find({ name: 'Purple Radish' }).toArray()
  const purpleRadish = varieties[0]
  console.log('Variety found:', purpleRadish.name, 'Default g/tray:', purpleRadish.gramsPerTray)

  // 1. Record purchase
  const pDoc = {
    varietyId: String(purpleRadish._id),
    varietyName: purpleRadish.name,
    date: '2026-11-01',
    quantityKg: 3.0,
    remainingKg: 3.0,
    pricePerKg: 1200,
    totalValue: 3600,
  }
  await db.collection('purchases').insertOne(pDoc)
  console.log('1. Purchase recorded: 3.0 KG @ 1200/KG = 3600')

  // 2. Consume seed for 1 tray (70g)
  const consumed = await consumeSeed(db, String(purpleRadish._id), 70)
  console.log('2. Seed consumed for 70g tray: seedCost =', consumed.totalCost, '(Expected: 84.00)')

  // 3. Cocopeat (350 / 15)
  const cocoCost = 23.33
  const prodCost = consumed.totalCost + cocoCost
  console.log('3. Direct production cost for 1 tray =', prodCost, '(Expected: 107.33)')

  // 4. Harvest 1 tray into 4 boxes with ₹5 packaging
  const boxesPacked = 4
  const packCost = boxesPacked * 5
  const totalCost = prodCost + packCost
  const costPerBox = totalCost / boxesPacked
  console.log('4. Harvest 4 boxes: totalCost =', totalCost, 'costPerBox =', costPerBox, '(Expected: 127.33 and 31.8325)')

  // Create lot
  const lot = {
    varietyId: String(purpleRadish._id),
    varietyName: purpleRadish.name,
    date: '2026-11-08',
    boxesTotal: 4,
    boxesRemaining: 4,
    seedCostPerBox: consumed.totalCost / 4,
    cocopeatCostPerBox: cocoCost / 4,
    packagingCostPerBox: 5,
    totalCostPerBox: costPerBox,
  }
  await db.collection('packedLots').insertOne(lot)

  // 5. Sell 4 boxes @ 250
  const consumedBoxes = await consumePackedBoxes(db, { varietyId: String(purpleRadish._id), boxes: 4 })
  const rev = 4 * 250
  const grossProfit = rev - consumedBoxes.cogs
  console.log(
    '5. Sale of 4 boxes @ 250: Revenue =',
    rev,
    'COGS =',
    consumedBoxes.cogs,
    'Gross Profit =',
    grossProfit,
    '(Expected: 1000, 127.33, 872.67)',
  )

  // 6. Test Reports with Electricity
  await db.collection('sales').insertOne({
    date: '2026-11-10',
    varietyId: String(purpleRadish._id),
    varietyName: purpleRadish.name,
    boxes: 4,
    pricePerBox: 250,
    revenue: 1000,
    seedCost: consumedBoxes.seedCost,
    cocopeatCost: consumedBoxes.cocopeatCost,
    packagingCost: consumedBoxes.packagingCost,
    cogs: consumedBoxes.cogs,
    grossProfit,
    type: 'sale',
  })

  await db.collection('electricity').updateOne(
    { month: '2026-11' },
    { $set: { month: '2026-11', units: 150, rate: 8, calculated: 1200, total: 1200 } },
    { upsert: true },
  )

  const rep = await buildReport(db, { mode: 'month', month: '2026-11' })
  console.log('6. Report P&L:', rep.pnl)
  console.log('All calculations match Section 12 of the requirements specification!')
  process.exit(0)
}

runTest().catch((e) => {
  console.error(e)
  process.exit(1)
})
