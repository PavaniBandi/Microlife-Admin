import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { inr, prettyDate, todayISO, pct } from '../lib/format'
import { Button, Card, ErrorBanner, SuccessBanner, Field, Page, Table, Tabs, Badge } from '../components/ui'

export default function Sales({ initialTab = 'record' }) {
  const [tab, setTab] = useState(initialTab)
  const [varieties, setVarieties] = useState([])
  const [sowings, setSowings] = useState([])
  const [sales, setSales] = useState([])
  const [packed, setPacked] = useState([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [form, setForm] = useState({
    date: todayISO(),
    varietyId: '',
    sowingBatchId: '',
    boxes: '',
    pricePerBox: '',
    customer: '',
    type: 'sale',
  })

  const loadData = async () => {
    try {
      const [v, s, sa, inv] = await Promise.all([
        api.varieties(),
        api.sowings(),
        api.sales(),
        api.inventory(),
      ])
      setVarieties(v)
      setSowings(s)
      setSales(sa)
      setPacked(inv.packed || [])

      if (!form.varietyId && v.length) {
        setForm((f) => ({
          ...f,
          varietyId: v[0].id,
          pricePerBox: v[0].defaultSellPrice || '250',
          boxes: '',
        }))
      }
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Available packed boxes for selected variety and batch
  const availableLots = useMemo(() => {
    return packed.filter((p) => {
      if (form.varietyId && p.varietyId !== form.varietyId) return false
      if (form.sowingBatchId && p.sowingBatchId !== form.sowingBatchId) return false
      return p.boxesRemaining > 0
    })
  }, [packed, form.varietyId, form.sowingBatchId])

  const totalAvailableBoxes = useMemo(() => {
    return availableLots.reduce((s, l) => s + (l.boxesRemaining || 0), 0)
  }, [availableLots])

  // Live Sale Revenue & Profit Preview
  const salePreview = useMemo(() => {
    const qty = Number(form.boxes || 0)
    const unitPrice = form.type === 'writeoff' ? 0 : Number(form.pricePerBox || 0)
    const revenue = form.type === 'writeoff' ? 0 : qty * unitPrice

    // Estimate COGS using FIFO on available lots
    let remainingToCost = qty
    let estimatedCogs = 0
    for (const lot of availableLots) {
      if (remainingToCost <= 0) break
      const take = Math.min(lot.boxesRemaining || 0, remainingToCost)
      estimatedCogs += take * (lot.totalCostPerBox || 0)
      remainingToCost -= take
    }

    const grossProfit = revenue - estimatedCogs
    const margin = revenue > 0 ? (grossProfit / revenue) * 100 : 0
    const stockShort = qty > totalAvailableBoxes

    return {
      qty,
      revenue,
      estimatedCogs,
      grossProfit,
      margin,
      stockShort,
    }
  }, [form, availableLots, totalAvailableBoxes])

  async function handleSaveSale(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    try {
      if (salePreview.stockShort) {
        throw new Error(
          `Not enough packed stock. Only ${totalAvailableBoxes} boxes available for this variety.`,
        )
      }

      const res = await api.createSale({
        ...form,
        boxes: Number(form.boxes),
        pricePerBox: Number(form.pricePerBox),
        sowingBatchId: form.sowingBatchId || undefined,
      })

      setSuccess(
        form.type === 'writeoff'
          ? `Recorded write-off of ${res.boxes} boxes. Stock updated.`
          : `Sale recorded successfully! Revenue: ${inr(res.revenue)}, Gross Profit: ${inr(res.grossProfit)}.`,
      )

      setForm((f) => ({
        ...f,
        boxes: '1',
        customer: '',
      }))
      await loadData()
    } catch (err) {
      setError(err.message)
    }
  }

  const nameOf = (id) => varieties.find((v) => v.id === id)?.name || id

  return (
    <Page
      title="Sales & Packed Stock"
      subtitle="Fulfill customer orders, sell packed boxes, and recognize revenue and profit on sale date."
    >
      <ErrorBanner error={error} />
      <SuccessBanner message={success} />

      <Tabs
        activeTab={tab}
        onChange={setTab}
        tabs={[
          { id: 'record', label: '1. Record Sale / Dispatch', icon: '🛒' },
          { id: 'packed', label: '2. Packed Stock in Storage', icon: '📦', count: packed.reduce((s, p) => s + (p.boxesRemaining || 0), 0) },
          { id: 'history', label: '3. Sales History', icon: '📜', count: sales.length },
        ]}
      />

      {/* ==================== SUB-TAB 1: RECORD SALE ==================== */}
      {tab === 'record' && (
        <Card title="Record Customer Sale or Stock Write-Off" subtitle="Revenue is recognized only when a sale is recorded.">
          <form onSubmit={handleSaveSale}>
            <div className="form-grid">
              <Field label="Sale Date">
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  required
                />
              </Field>

              <Field label="Variety">
                <select
                  value={form.varietyId}
                  onChange={(e) => {
                    const v = varieties.find((x) => x.id === e.target.value)
                    setForm({
                      ...form,
                      varietyId: e.target.value,
                      pricePerBox: v?.defaultSellPrice || form.pricePerBox,
                    })
                  }}
                  required
                >
                  {varieties.map((v) => {
                    const inStock = packed
                      .filter((p) => p.varietyId === v.id)
                      .reduce((s, p) => s + (p.boxesRemaining || 0), 0)
                    return (
                      <option key={v.id} value={v.id}>
                        {v.name} ({inStock} boxes in stock)
                      </option>
                    )
                  })}
                </select>
              </Field>

              <Field label="Batch Source" hint="Optional, defaults to oldest batch (FIFO)">
                <select
                  value={form.sowingBatchId}
                  onChange={(e) => setForm({ ...form, sowingBatchId: e.target.value })}
                >
                  <option value="">Any Batch (FIFO - Oldest first)</option>
                  {sowings.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.batchCode} · {prettyDate(s.date)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Boxes to Sell" hint={`Available in stock: ${totalAvailableBoxes} boxes`}>
                <input
                  type="number"
                  min="1"
                  max={totalAvailableBoxes || undefined}
                  value={form.boxes}
                  onChange={(e) => setForm({ ...form, boxes: e.target.value })}
                  placeholder={totalAvailableBoxes > 0 ? 'e.g. 2' : '0 boxes available'}
                  disabled={totalAvailableBoxes === 0}
                  required
                />
              </Field>

              {form.type === 'sale' && (
                <Field label="Selling Price / Box (₹)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.pricePerBox}
                    onChange={(e) => setForm({ ...form, pricePerBox: e.target.value })}
                    placeholder="250"
                    required
                  />
                </Field>
              )}

              <Field label="Customer / Order Note">
                <input
                  value={form.customer}
                  onChange={(e) => setForm({ ...form, customer: e.target.value })}
                  placeholder="e.g. Green Cafe / Order #104"
                />
              </Field>

              <Field label="Transaction Type">
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  <option value="sale">Regular Sale</option>
                  <option value="writeoff">Write-off Unsold / Spoiled</option>
                </select>
              </Field>
            </div>

            {totalAvailableBoxes === 0 && (
              <div
                className="banner error"
                style={{
                  margin: '12px 0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 10,
                }}
              >
                <div>
                  📦 <strong>No packed boxes in storage for {nameOf(form.varietyId)}.</strong> Harvest and pack trays in Production before recording a sale.
                </div>
                <button
                  type="button"
                  className="btn ghost"
                  style={{ padding: '6px 12px', fontSize: 13, background: 'white' }}
                  onClick={() => {
                    window.location.hash = 'production?tab=harvest'
                  }}
                >
                  Go to Harvest & Pack →
                </button>
              </div>
            )}

            {/* LIVE REVENUE & PROFIT PREVIEW (ORDER CALCULATOR) */}
            <div className="cost-preview">
              <h4>Order Calculator (Preview for this transaction)</h4>
              {salePreview.stockShort && totalAvailableBoxes > 0 && (
                <div className="banner error" style={{ marginBottom: 12 }}>
                  ⚠️ Not enough packed boxes in stock. Need {form.boxes}, but only {totalAvailableBoxes} available.
                </div>
              )}
              <div className="preview-grid">
                <div className="preview-item">
                  <span>Available Stock</span>
                  <strong>{totalAvailableBoxes} boxes</strong>
                  <small>For {nameOf(form.varietyId)}</small>
                </div>
                <div className="preview-item">
                  <span>Estimated Revenue</span>
                  <strong style={{ color: 'var(--green)' }}>{inr(salePreview.revenue)}</strong>
                  <small>{Number(form.boxes || 0)} boxes × {inr(form.type === 'writeoff' ? 0 : form.pricePerBox || 0)}</small>
                </div>
                <div className="preview-item">
                  <span>Cost of Goods (COGS)</span>
                  <strong>{inr(salePreview.estimatedCogs)}</strong>
                  <small>Seed + Coco + Pack cost</small>
                </div>
                <div className="preview-item">
                  <span>Gross Profit</span>
                  <strong style={{ color: salePreview.grossProfit >= 0 ? 'var(--green-dark)' : 'var(--danger)' }}>
                    {inr(salePreview.grossProfit)}
                  </strong>
                  <small>{pct(salePreview.margin)} gross margin</small>
                </div>
              </div>
            </div>

            <Button
              type="submit"
              disabled={
                salePreview.stockShort ||
                totalAvailableBoxes === 0 ||
                !form.boxes ||
                Number(form.boxes) <= 0
              }
            >
              {form.type === 'writeoff' ? 'Confirm Stock Write-off' : 'Save Sale Record'}
            </Button>
          </form>
        </Card>
      )}

      {/* ==================== SUB-TAB 2: PACKED STOCK ==================== */}
      {tab === 'packed' && (
        <Card
          title="Packed Boxes Waiting to Sell"
          subtitle="Inventory of packed boxes with preserved unit costs per lot"
          actions={
            <Button
              type="button"
              variant="ghost"
              onClick={() => setTab('record')}
            >
              + Sell Boxes
            </Button>
          }
        >
          <Table
            rows={packed}
            empty="No packed boxes in storage. Harvest and pack trays in Production."
            columns={[
              { key: 'batchCode', label: 'Batch' },
              { key: 'varietyName', label: 'Variety' },
              { key: 'date', label: 'Packed Date', render: (r) => prettyDate(r.date) },
              { key: 'packagingName', label: 'Box Type', render: (r) => `${r.packagingName || '100g Box'} (${r.sizeGrams || 100}g)` },
              { key: 'boxesRemaining', label: 'Boxes Left', render: (r) => <b>{r.boxesRemaining} / {r.boxesTotal}</b> },
              { key: 'totalCostPerBox', label: 'Cost / Box', render: (r) => inr(r.totalCostPerBox) },
              {
                key: 'value',
                label: 'Total Value',
                render: (r) => inr((r.boxesRemaining || 0) * (r.totalCostPerBox || 0)),
              },
              {
                key: 'action',
                label: '',
                render: (r) => (
                  <Button
                    type="button"
                    variant="ghost"
                    style={{ padding: '6px 12px', fontSize: 13 }}
                    onClick={() => {
                      setForm((f) => ({
                        ...f,
                        varietyId: r.varietyId,
                        sowingBatchId: r.sowingBatchId,
                      }))
                      setTab('record')
                    }}
                  >
                    Sell 🛒
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      )}

      {/* ==================== SUB-TAB 3: SALES HISTORY ==================== */}
      {tab === 'history' && (
        <Card title="Sales & Dispatch History" subtitle="Audit log of all sales and write-offs">
          <Table
            rows={sales}
            empty="No sales recorded yet."
            columns={[
              { key: 'date', label: 'Date', render: (r) => prettyDate(r.date) },
              {
                key: 'type',
                label: 'Type',
                render: (r) => (
                  <Badge variant={r.type === 'writeoff' ? 'danger' : 'success'}>
                    {r.type === 'writeoff' ? 'Write-off' : 'Sale'}
                  </Badge>
                ),
              },
              { key: 'varietyName', label: 'Variety', render: (r) => r.varietyName || nameOf(r.varietyId) },
              { key: 'customer', label: 'Customer / Note', render: (r) => r.customer || '—' },
              { key: 'boxes', label: 'Boxes' },
              { key: 'pricePerBox', label: 'Price / Box', render: (r) => inr(r.pricePerBox) },
              { key: 'revenue', label: 'Revenue', render: (r) => <b>{inr(r.revenue)}</b> },
              { key: 'cogs', label: 'COGS', render: (r) => inr(r.cogs) },
              {
                key: 'grossProfit',
                label: 'Gross Profit',
                render: (r) => (
                  <span style={{ color: (r.grossProfit ?? (r.revenue - r.cogs)) >= 0 ? 'var(--green)' : 'var(--danger)', fontWeight: 600 }}>
                    {inr(r.grossProfit ?? (r.revenue - r.cogs))}
                  </span>
                ),
              },
            ]}
          />
        </Card>
      )}
    </Page>
  )
}
