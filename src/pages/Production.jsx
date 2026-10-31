import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { inr, kg, prettyDate, todayISO, daysAgo } from '../lib/format'
import { Button, Card, ErrorBanner, SuccessBanner, Field, Page, Table, Tabs, Badge } from '../components/ui'

export default function Production({ initialTab = 'sow', initialBatchId = '' }) {
  const [tab, setTab] = useState(initialTab)
  const [varieties, setVarieties] = useState([])
  const [sowings, setSowings] = useState([])
  const [settings, setSettings] = useState(null)
  const [inventory, setInventory] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Sowing form state
  const [sowDate, setSowDate] = useState(todayISO())
  const [sowNotes, setSowNotes] = useState('')
  const [sowItems, setSowItems] = useState([{ varietyId: '', trays: '1', gramsPerTray: '' }])

  // Harvest form state
  const [harvestBatchId, setHarvestBatchId] = useState(initialBatchId)
  const [harvestDate, setHarvestDate] = useState(todayISO())
  const [harvestLines, setHarvestLines] = useState([])
  const [soldNow, setSoldNow] = useState({
    enabled: false,
    boxes: '',
    pricePerBox: '',
    varietyId: '',
    customer: '',
  })

  const loadData = async () => {
    try {
      const [v, s, , st, inv] = await Promise.all([
        api.varieties(),
        api.sowings(),
        api.harvests(),
        api.settings(),
        api.inventory(),
      ])
      const activeVars = v.filter((x) => x.active)
      setVarieties(activeVars)
      setSowings(s)
      setSettings(st)
      setInventory(inv)

      // Initialize sowing item default variety and gramsPerTray
      setSowItems((curr) =>
        curr.map((item) => {
          const matched = activeVars.find((x) => x.id === item.varietyId) || activeVars[0]
          return {
            ...item,
            varietyId: matched?.id || '',
            gramsPerTray: item.gramsPerTray || matched?.gramsPerTray || 70,
          }
        }),
      )

      // Initialize harvest batch if not selected
      if (!harvestBatchId && s.length) {
        const open = s.find((b) => b.status !== 'harvested') || s[0]
        setHarvestBatchId(open.id)
      }
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (initialTab) setTab(initialTab)
    if (initialBatchId) setHarvestBatchId(initialBatchId)
  }, [initialTab, initialBatchId])

  // Selected batch for harvesting
  const currentBatch = useMemo(
    () => sowings.find((s) => s.id === harvestBatchId),
    [sowings, harvestBatchId],
  )

  // Populate harvest lines when batch changes
  useEffect(() => {
    if (!currentBatch) return
    const defaultPackId = settings?.packagingTypes?.[0]?.id || ''
    setHarvestLines(
      currentBatch.items.map((i) => {
        const remaining = Math.max(0, Number(i.trays || 0) - Number(i.harvestedTrays || 0))
        return {
          varietyId: i.varietyId,
          varietyName: i.varietyName,
          remainingTrays: remaining,
          traysHarvested: remaining > 0 ? remaining : 0,
          weightGrams: '',
          packagingTypeId: defaultPackId,
          boxesPacked: remaining > 0 ? remaining * 4 : 0, // typical 4 boxes/tray default estimate
        }
      }),
    )

    if (currentBatch.items.length) {
      const firstVar = varieties.find((x) => x.id === currentBatch.items[0].varietyId)
      setSoldNow((s) => ({
        ...s,
        varietyId: currentBatch.items[0].varietyId,
        pricePerBox: firstVar?.defaultSellPrice || 250,
      }))
    }
  }, [currentBatch, settings, varieties])

  // ==================== SOWING ACTIONS & LIVE COST PREVIEW ====================
  function setSowItem(idx, patch) {
    setSowItems((items) =>
      items.map((item, i) => {
        if (i !== idx) return item
        const updated = { ...item, ...patch }
        if (patch.varietyId) {
          const v = varieties.find((x) => x.id === patch.varietyId)
          if (v) updated.gramsPerTray = v.gramsPerTray || 70
        }
        return updated
      }),
    )
  }

  function addSowItem() {
    const first = varieties[0]
    setSowItems([
      ...sowItems,
      { varietyId: first?.id || '', trays: '1', gramsPerTray: first?.gramsPerTray || 70 },
    ])
  }

  function removeSowItem(idx) {
    if (sowItems.length <= 1) return
    setSowItems(sowItems.filter((_, i) => i !== idx))
  }

  // Calculate live sowing preview
  const sowingCostPreview = useMemo(() => {
    const cocoPerTray = settings?.cocopeatCostPerTray || 23.33
    let totalTrays = 0
    let totalGrams = 0
    let totalSeedCost = 0
    let stockAlert = false
    let stockAlertMessage = ''

    for (const item of sowItems) {
      const trays = Number(item.trays || 0)
      const grams = Number(item.gramsPerTray || 0)
      const needGrams = trays * grams
      totalTrays += trays
      totalGrams += needGrams

      // Check stock
      const stockEntry = inventory?.stock?.find((s) => s.varietyId === item.varietyId)
      const availableKg = stockEntry?.remainingKg || 0
      const needKg = needGrams / 1000

      if (needKg > availableKg) {
        stockAlert = true
        stockAlertMessage = `Need ${needKg.toFixed(3)} KG of ${stockEntry?.name || 'seed'}, but only ${availableKg.toFixed(3)} KG is available.`
      }

      // Estimate seed cost using FIFO batches in inventory
      let remainingToCost = needKg
      let itemSeedCost = 0
      const batches = stockEntry?.batches || []
      for (const b of batches) {
        if (remainingToCost <= 0) break
        const take = Math.min(b.remainingKg, remainingToCost)
        itemSeedCost += take * (b.pricePerKg || 0)
        remainingToCost -= take
      }
      // If stock not enough, fallback to average or 0
      if (remainingToCost > 0 && batches[0]) {
        itemSeedCost += remainingToCost * (batches[0].pricePerKg || 0)
      }
      totalSeedCost += itemSeedCost
    }

    const totalCocopeatCost = totalTrays * cocoPerTray
    const totalGrowingCost = totalSeedCost + totalCocopeatCost
    const costPerTray = totalTrays > 0 ? totalGrowingCost / totalTrays : 0

    return {
      totalTrays,
      totalGrams,
      totalSeedCost,
      totalCocopeatCost,
      totalGrowingCost,
      costPerTray,
      stockAlert,
      stockAlertMessage,
    }
  }, [sowItems, settings, inventory])

  async function handleCreateSowing(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    try {
      const itemsToSave = sowItems
        .filter((i) => i.varietyId && Number(i.trays) > 0)
        .map((i) => ({
          varietyId: i.varietyId,
          trays: Number(i.trays),
          gramsPerTray: Number(i.gramsPerTray),
        }))

      if (!itemsToSave.length) {
        throw new Error('Please enter trays to sow')
      }

      const res = await api.createSowing({
        date: sowDate,
        notes: sowNotes,
        items: itemsToSave,
      })

      setSuccess(`Batch ${res.batchCode} created successfully! Trays: ${res.items.reduce((s, i) => s + i.trays, 0)}, Direct Cost: ${inr(res.totalProductionCost || res.seedCost + res.cocopeatCost)}.`)
      setSowNotes('')
      setSowItems([{ varietyId: varieties[0]?.id || '', trays: '1', gramsPerTray: varieties[0]?.gramsPerTray || 70 }])
      await loadData()
    } catch (err) {
      setError(err.message)
    }
  }

  // ==================== HARVEST ACTIONS & LIVE COST PREVIEW ====================
  const harvestCostPreview = useMemo(() => {
    if (!currentBatch) return null
    let totalHarvestedTrays = 0
    let totalBoxesPacked = 0
    let totalAllocatedGrowingCost = 0
    let totalPackagingCost = 0

    const packTypes = settings?.packagingTypes || []
    const defaultPack = packTypes[0]

    for (const line of harvestLines) {
      const item = currentBatch.items.find((i) => i.varietyId === line.varietyId)
      if (!item) continue

      const trays = Number(line.traysHarvested || 0)
      const boxes = Number(line.boxesPacked || 0)
      totalHarvestedTrays += trays
      totalBoxesPacked += boxes

      const remainingTrays = Math.max(0, Number(item.trays || 0) - Number(item.harvestedTrays || 0))
      const remainingCost = Math.max(0, Number(item.productionCost || 0) - Number(item.allocatedProductionCost || 0))
      const allocRatio = remainingTrays <= 0 ? 0 : Math.min(1, trays / remainingTrays)
      const allocatedGrowing = remainingCost * allocRatio
      totalAllocatedGrowingCost += allocatedGrowing

      const pack = packTypes.find((p) => p.id === line.packagingTypeId) || defaultPack
      const packPrice = pack ? Number(pack.costPerBox) : 5
      totalPackagingCost += boxes * packPrice
    }

    const totalBatchHarvestCost = totalAllocatedGrowingCost + totalPackagingCost
    const costPerBox = totalBoxesPacked > 0 ? totalBatchHarvestCost / totalBoxesPacked : 0

    return {
      totalHarvestedTrays,
      totalBoxesPacked,
      totalAllocatedGrowingCost,
      totalPackagingCost,
      totalBatchHarvestCost,
      costPerBox,
    }
  }, [currentBatch, harvestLines, settings])

  async function handleCreateHarvest(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    try {
      const itemsToSave = harvestLines
        .filter((l) => Number(l.traysHarvested) > 0 || Number(l.boxesPacked) > 0)
        .map((l) => ({
          varietyId: l.varietyId,
          traysHarvested: Number(l.traysHarvested || 0),
          weightGrams: Number(l.weightGrams || 0),
          packagingTypeId: l.packagingTypeId || undefined,
          boxesPacked: Number(l.boxesPacked || 0),
        }))

      if (!itemsToSave.length) {
        throw new Error('Please enter trays harvested or boxes packed')
      }

      const res = await api.createHarvest({
        sowingBatchId: harvestBatchId,
        date: harvestDate,
        items: itemsToSave,
        soldImmediately: soldNow.enabled
          ? {
              varietyId: soldNow.varietyId,
              boxes: Number(soldNow.boxes),
              pricePerBox: Number(soldNow.pricePerBox),
              customer: soldNow.customer || 'Sold on harvest',
            }
          : undefined,
      })

      const totalBoxes = res.harvest?.items?.reduce((s, i) => s + (i.boxesPacked || 0), 0) || 0
      setSuccess(`Harvest recorded! Packed ${totalBoxes} boxes. Cost snapshot preserved on lot.`)
      await loadData()
    } catch (err) {
      setError(err.message)
    }
  }

  const openBatches = sowings.filter((s) => s.status !== 'harvested')

  return (
    <Page
      title="Production & Growing"
      subtitle="Complete crop cycle: sow trays with FIFO seed costing, harvest when ready, and calculate unit cost per packed box."
    >
      <ErrorBanner error={error} />
      <SuccessBanner message={success} />

      <Tabs
        activeTab={tab}
        onChange={setTab}
        tabs={[
          { id: 'sow', label: '1. Sow Trays', icon: '🌱' },
          { id: 'harvest', label: '2. Harvest & Pack', icon: '✂️', count: openBatches.length },
          { id: 'history', label: '3. Batch History', icon: '📋', count: sowings.length },
        ]}
      />

      {/* ==================== SUB-TAB 1: SOW TRAYS ==================== */}
      {tab === 'sow' && (
        <>
          <Card title="Start New Sowing Batch" subtitle="Select varieties and tray count. Seed stock is deducted using FIFO.">
            <form onSubmit={handleCreateSowing}>
              <div className="form-grid">
                <Field label="Sowing Date">
                  <input type="date" value={sowDate} onChange={(e) => setSowDate(e.target.value)} required />
                </Field>
                <Field label="Notes / Location">
                  <input
                    value={sowNotes}
                    onChange={(e) => setSowNotes(e.target.value)}
                    placeholder="e.g. Rack 1, Shelf B"
                  />
                </Field>
              </div>

              <div style={{ marginBottom: 12 }}>
                <strong>Trays to Sow:</strong>
              </div>

              {sowItems.map((item, idx) => (
                  <div className="form-grid line" key={idx}>
                    <Field label="Seed Variety">
                      <select
                        value={item.varietyId}
                        onChange={(e) => setSowItem(idx, { varietyId: e.target.value })}
                        required
                      >
                        {varieties.map((v) => {
                          const st = inventory?.stock?.find((s) => s.varietyId === v.id)
                          return (
                            <option key={v.id} value={v.id}>
                              {v.name} ({kg(st?.remainingKg)} available)
                            </option>
                          )
                        })}
                      </select>
                    </Field>

                    <Field label="Trays Count">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={item.trays}
                        onChange={(e) => setSowItem(idx, { trays: e.target.value })}
                        required
                      />
                    </Field>

                    <Field label="Seed Grams / Tray" hint="Standard seed rate">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={item.gramsPerTray}
                        onChange={(e) => setSowItem(idx, { gramsPerTray: e.target.value })}
                        required
                      />
                    </Field>

                    {sowItems.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        style={{ alignSelf: 'end' }}
                        onClick={() => removeSowItem(idx)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                )
              )}

              <div className="row-actions" style={{ marginBottom: 16 }}>
                <Button type="button" variant="ghost" onClick={addSowItem}>
                  + Add another variety
                </Button>
              </div>

              {/* LIVE SOWING COST PREVIEW */}
              <div className="cost-preview">
                <h4>Cost & Inventory Calculation Preview</h4>
                {sowingCostPreview.stockAlert && (
                  <div className="banner error" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                    <div>⚠️ {sowingCostPreview.stockAlertMessage}</div>
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ padding: '6px 12px', fontSize: 13, background: 'white' }}
                      onClick={() => {
                        window.location.hash = 'inventory?tab=purchase'
                      }}
                    >
                      + Buy Seed Now 🌾
                    </button>
                  </div>
                )}
                <div className="preview-grid">
                  <div className="preview-item">
                    <span>Seed Required</span>
                    <strong>{sowingCostPreview.totalGrams} g</strong>
                    <small>({(sowingCostPreview.totalGrams / 1000).toFixed(3)} KG)</small>
                  </div>
                  <div className="preview-item">
                    <span>FIFO Seed Cost</span>
                    <strong>{inr(sowingCostPreview.totalSeedCost)}</strong>
                    <small>Oldest purchase price used</small>
                  </div>
                  <div className="preview-item">
                    <span>Cocopeat Cost</span>
                    <strong>{inr(sowingCostPreview.totalCocopeatCost)}</strong>
                    <small>
                      {sowingCostPreview.totalTrays} trays × {inr(settings?.cocopeatCostPerTray || 23.33)} (from ₹{settings?.cocopeatBrickPrice || 350} brick ÷ {settings?.traysPerBrick || 15} trays)
                    </small>
                  </div>
                  <div className="preview-item">
                    <span>Total Direct Batch Cost</span>
                    <strong style={{ color: 'var(--green)' }}>{inr(sowingCostPreview.totalGrowingCost)}</strong>
                    <small>{inr(sowingCostPreview.costPerTray)} per tray</small>
                  </div>
                </div>
              </div>

              <Button type="submit" disabled={sowingCostPreview.stockAlert}>
                Create Sowing Batch
              </Button>
            </form>
          </Card>
        </>
      )}

      {/* ==================== SUB-TAB 2: HARVEST & PACK ==================== */}
      {tab === 'harvest' && (
        <>
          {sowings.length === 0 ? (
            <Card title="No Sowing Batches to Harvest" subtitle="Trays must be sown first before harvesting">
              <div style={{ textAlign: 'center', padding: '32px 16px' }}>
                <span style={{ fontSize: 44, display: 'block', marginBottom: 12 }}>🌱</span>
                <p className="muted" style={{ fontSize: 15, marginBottom: 16 }}>
                  You don't have any sowing batches in the grow room yet.
                </p>
                <Button type="button" onClick={() => setTab('sow')}>
                  + Sow Trays First
                </Button>
              </div>
            </Card>
          ) : (
            <Card
              title="Record Harvest & Packaging"
              subtitle="Record actual harvested trays and boxes packed. Growing cost is distributed across packed boxes."
            >
            <form onSubmit={handleCreateHarvest}>
              <div className="form-grid">
                <Field label="Select Sowing Batch">
                  <select
                    value={harvestBatchId}
                    onChange={(e) => setHarvestBatchId(e.target.value)}
                    required
                  >
                    {sowings.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.batchCode} · {prettyDate(s.date)} · Day {daysAgo(s.date)} · ({s.status})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Harvest Date">
                  <input
                    type="date"
                    value={harvestDate}
                    onChange={(e) => setHarvestDate(e.target.value)}
                    required
                  />
                </Field>
              </div>

              {currentBatch && (
                <div style={{ marginBottom: 16 }}>
                  <Badge variant="info">Batch {currentBatch.batchCode}</Badge>
                  <span style={{ marginLeft: 8, fontSize: 13 }} className="muted">
                    Sown on {prettyDate(currentBatch.date)} (Day {daysAgo(currentBatch.date)}) · Production Cost: {inr(currentBatch.totalProductionCost || currentBatch.seedCost + currentBatch.cocopeatCost)}
                  </span>
                </div>
              )}

              {harvestLines.map((line, idx) => (
                <div className="form-grid line" key={line.varietyId}>
                  <Field label="Variety">
                    <input readOnly value={`${line.varietyName} (${line.remainingTrays} trays left)`} />
                  </Field>

                  <Field label="Trays Harvested" hint={`Max ${line.remainingTrays}`}>
                    <input
                      type="number"
                      min="0"
                      max={line.remainingTrays}
                      value={line.traysHarvested}
                      onChange={(e) =>
                        setHarvestLines((lines) =>
                          lines.map((l, i) => (i === idx ? { ...l, traysHarvested: e.target.value } : l)),
                        )
                      }
                      required
                    />
                  </Field>

                  <Field label="Harvest Weight (Grams)" hint="Optional yield check">
                    <input
                      type="number"
                      min="0"
                      value={line.weightGrams}
                      onChange={(e) =>
                        setHarvestLines((lines) =>
                          lines.map((l, i) => (i === idx ? { ...l, weightGrams: e.target.value } : l)),
                        )
                      }
                      placeholder="e.g. 400"
                    />
                  </Field>

                  <Field label="Packaging Box Type">
                    <select
                      value={line.packagingTypeId}
                      onChange={(e) =>
                        setHarvestLines((lines) =>
                          lines.map((l, i) => (i === idx ? { ...l, packagingTypeId: e.target.value } : l)),
                        )
                      }
                    >
                      {(settings?.packagingTypes || []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.sizeGrams}g) · {inr(p.costPerBox)} / box
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Boxes Packed" hint="Boxes produced">
                    <input
                      type="number"
                      min="0"
                      value={line.boxesPacked}
                      onChange={(e) =>
                        setHarvestLines((lines) =>
                          lines.map((l, i) => (i === idx ? { ...l, boxesPacked: e.target.value } : l)),
                        )
                      }
                      required
                    />
                  </Field>
                </div>
              ))}

              {/* LIVE HARVEST COST PREVIEW */}
              {harvestCostPreview && (
                <div className="cost-preview">
                  <h4>Unit Cost Per Box Calculation</h4>
                  <div className="preview-grid">
                    <div className="preview-item">
                      <span>Trays Harvested</span>
                      <strong>{harvestCostPreview.totalHarvestedTrays} trays</strong>
                      <small>Allocated growing cost: {inr(harvestCostPreview.totalAllocatedGrowingCost)}</small>
                    </div>
                    <div className="preview-item">
                      <span>Boxes Packed</span>
                      <strong>{harvestCostPreview.totalBoxesPacked} boxes</strong>
                      <small>Packaging: {inr(harvestCostPreview.totalPackagingCost)}</small>
                    </div>
                    <div className="preview-item">
                      <span>Total Lot Cost</span>
                      <strong>{inr(harvestCostPreview.totalBatchHarvestCost)}</strong>
                      <small>Growing + Packaging</small>
                    </div>
                    <div className="preview-item">
                      <span>Calculated Cost / Box</span>
                      <strong style={{ color: 'var(--green-dark)' }}>{inr(harvestCostPreview.costPerBox)}</strong>
                      <small>COGS per 100g box</small>
                    </div>
                  </div>
                </div>
              )}

              {/* OPTIONAL QUICK SALE ON HARVEST */}
              <label className="check">
                <input
                  type="checkbox"
                  checked={soldNow.enabled}
                  onChange={(e) => setSoldNow({ ...soldNow, enabled: e.target.checked })}
                />
                Sold immediately on harvest (Quick sale)
              </label>

              {soldNow.enabled && (
                <div className="form-grid line" style={{ background: '#fdfbf7', borderColor: '#f2e8d5' }}>
                  <Field label="Variety Sold">
                    <select
                      value={soldNow.varietyId}
                      onChange={(e) => {
                        const v = varieties.find((x) => x.id === e.target.value)
                        setSoldNow({
                          ...soldNow,
                          varietyId: e.target.value,
                          pricePerBox: v?.defaultSellPrice || soldNow.pricePerBox,
                        })
                      }}
                    >
                      {harvestLines.map((l) => (
                        <option key={l.varietyId} value={l.varietyId}>
                          {l.varietyName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Boxes Sold">
                    <input
                      type="number"
                      min="1"
                      value={soldNow.boxes}
                      onChange={(e) => setSoldNow({ ...soldNow, boxes: e.target.value })}
                      required
                    />
                  </Field>
                  <Field label="Selling Price / Box">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={soldNow.pricePerBox}
                      onChange={(e) => setSoldNow({ ...soldNow, pricePerBox: e.target.value })}
                      required
                    />
                  </Field>
                  <Field label="Customer / Order">
                    <input
                      value={soldNow.customer}
                      onChange={(e) => setSoldNow({ ...soldNow, customer: e.target.value })}
                      placeholder="e.g. Cafe Greens"
                    />
                  </Field>
                </div>
              )}

              <Button type="submit">Save Harvest & Packaging</Button>
            </form>
          </Card>
          )}
        </>
      )}

      {/* ==================== SUB-TAB 3: BATCH HISTORY ==================== */}
      {tab === 'history' && (
        <Card title="Sowing Batches & Crop Lifecycle" subtitle="Track all batches from sowing to harvest">
          <Table
            rows={sowings}
            empty="No sowing batches recorded yet."
            columns={[
              { key: 'batchCode', label: 'Batch ID' },
              { key: 'date', label: 'Sown Date', render: (r) => prettyDate(r.date) },
              {
                key: 'age',
                label: 'Age',
                render: (r) => `Day ${daysAgo(r.date)}`,
              },
              {
                key: 'items',
                label: 'Trays & Harvested',
                render: (r) =>
                  r.items.map((i) => `${i.varietyName}: ${i.harvestedTrays || 0} / ${i.trays} trays`).join(', '),
              },
              {
                key: 'cost',
                label: 'Production Cost',
                render: (r) => inr(r.totalProductionCost || r.seedCost + r.cocopeatCost),
              },
              {
                key: 'status',
                label: 'Status',
                render: (r) => (
                  <Badge variant={r.status === 'harvested' ? 'success' : r.status === 'partial' ? 'warning' : 'info'}>
                    {r.status}
                  </Badge>
                ),
              },
              {
                key: 'actions',
                label: '',
                render: (r) =>
                  r.status !== 'harvested' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      style={{ padding: '6px 12px', fontSize: 13 }}
                      onClick={() => {
                        setHarvestBatchId(r.id)
                        setTab('harvest')
                      }}
                    >
                      Harvest ✂️
                    </Button>
                  ) : null,
              },
            ]}
          />
        </Card>
      )}
    </Page>
  )
}
