import { ObjectId } from 'mongodb'
import { round2, round4 } from './money.js'

export async function consumeSeed(db, varietyId, gramsNeeded) {
  const kgNeeded = round4(Number(gramsNeeded) / 1000)
  if (kgNeeded <= 0) return { allocations: [], totalKg: 0, totalCost: 0 }

  const batches = await db
    .collection('purchases')
    .find({ varietyId, remainingKg: { $gt: 0 } })
    .sort({ date: 1, _id: 1 })
    .toArray()

  // 1. Verify total available stock first to prevent partial/corrupted deductions
  const totalAvailable = round4(batches.reduce((sum, b) => sum + (Number(b.remainingKg) || 0), 0))
  if (totalAvailable < kgNeeded - 0.0001) {
    const shortBy = round4(kgNeeded - totalAvailable)
    const err = new Error(
      `Not enough seed stock. Need ${kgNeeded} KG (${gramsNeeded} g), but only ${totalAvailable} KG is available (short by ${shortBy} KG). Please record a seed purchase first.`,
    )
    err.status = 400
    throw err
  }

  let remaining = kgNeeded
  const allocations = []
  const updates = []

  for (const batch of batches) {
    if (remaining <= 0.00001) break
    const available = Number(batch.remainingKg) || 0
    if (available <= 0) continue

    const take = Math.min(available, remaining)
    const cost = round2(take * Number(batch.pricePerKg))
    allocations.push({
      purchaseId: String(batch._id),
      kg: round4(take),
      pricePerKg: Number(batch.pricePerKg),
      cost,
    })
    const newRemaining = round4(available - take)
    updates.push({ id: batch._id, remainingKg: Math.max(0, newRemaining) })
    remaining = round4(remaining - take)
  }

  // 2. Commit batch deductions only after full verification passes
  for (const u of updates) {
    await db.collection('purchases').updateOne(
      { _id: u.id },
      { $set: { remainingKg: u.remainingKg } },
    )
  }

  const totalCost = round2(allocations.reduce((s, a) => s + a.cost, 0))
  return { allocations, totalKg: kgNeeded, totalCost }
}

export async function consumePackedBoxes(db, { varietyId, boxes, sowingBatchId }) {
  const query = { varietyId, boxesRemaining: { $gt: 0 } }
  if (sowingBatchId) query.sowingBatchId = sowingBatchId

  const lots = await db
    .collection('packedLots')
    .find(query)
    .sort({ date: 1, _id: 1 })
    .toArray()

  const needBoxes = Number(boxes)
  if (needBoxes <= 0) {
    const err = new Error('Boxes must be greater than 0')
    err.status = 400
    throw err
  }

  // 1. Verify available boxes first
  const totalAvailable = lots.reduce((s, l) => s + (Number(l.boxesRemaining) || 0), 0)
  if (totalAvailable < needBoxes) {
    const err = new Error(
      `Not enough packed boxes${sowingBatchId ? ' for this batch' : ''}. Need ${needBoxes}, but only ${totalAvailable} available.`,
    )
    err.status = 400
    throw err
  }

  let remaining = needBoxes
  const allocations = []
  const updates = []

  for (const lot of lots) {
    if (remaining <= 0) break
    const available = Number(lot.boxesRemaining) || 0
    if (available <= 0) continue

    const take = Math.min(available, remaining)
    allocations.push({
      packedLotId: String(lot._id),
      sowingBatchId: lot.sowingBatchId,
      harvestId: lot.harvestId,
      boxes: take,
      seedCost: round2(take * (Number(lot.seedCostPerBox) || 0)),
      cocopeatCost: round2(take * (Number(lot.cocopeatCostPerBox) || 0)),
      packagingCost: round2(take * (Number(lot.packagingCostPerBox) || 0)),
      cogs: round2(take * (Number(lot.totalCostPerBox) || 0)),
    })
    updates.push({ id: lot._id, take })
    remaining -= take
  }

  // 2. Commit lot deductions
  for (const u of updates) {
    await db.collection('packedLots').updateOne(
      { _id: u.id },
      { $inc: { boxesRemaining: -u.take } },
    )
  }

  return {
    allocations,
    seedCost: round2(allocations.reduce((s, a) => s + a.seedCost, 0)),
    cocopeatCost: round2(allocations.reduce((s, a) => s + a.cocopeatCost, 0)),
    packagingCost: round2(allocations.reduce((s, a) => s + a.packagingCost, 0)),
    cogs: round2(allocations.reduce((s, a) => s + a.cogs, 0)),
  }
}

export function oid(id) {
  try {
    return new ObjectId(id)
  } catch {
    const err = new Error('Invalid id')
    err.status = 400
    throw err
  }
}
