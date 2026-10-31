import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { inr, kg, prettyDate, todayISO } from '../lib/format'
import { Button, Card, ErrorBanner, SuccessBanner, Field, Page, Table, Tabs, Badge } from '../components/ui'

export default function Inventory({ initialTab = 'stock' }) {
  const [tab, setTab] = useState(initialTab)
  const [varieties, setVarieties] = useState([])
  const [purchases, setPurchases] = useState([])
  const [inventory, setInventory] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // New Variety Form
  const [newVar, setNewVar] = useState({ name: '', gramsPerTray: '70', defaultSellPrice: '250' })

  // Purchase Form
  const [purchaseForm, setPurchaseForm] = useState({
    varietyId: '',
    supplier: '',
    date: todayISO(),
    quantityKg: '',
    pricePerKg: '',
  })

  const loadData = async () => {
    try {
      const [v, p, inv] = await Promise.all([api.varieties(), api.purchases(), api.inventory()])
      setVarieties(v)
      setPurchases(p)
      setInventory(inv)
      if (!purchaseForm.varietyId && v.length) {
        setPurchaseForm((f) => ({ ...f, varietyId: v[0].id }))
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
  }, [initialTab])

  // Edit Variety State
  const [editingVar, setEditingVar] = useState(null)

  // Save new seed variety
  async function handleAddVariety(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    try {
      await api.createVariety({
        name: newVar.name,
        gramsPerTray: Number(newVar.gramsPerTray) || 70,
        defaultSellPrice: Number(newVar.defaultSellPrice) || 250,
      })
      setSuccess(`Variety "${newVar.name}" added successfully!`)
      setNewVar({ name: '', gramsPerTray: '70', defaultSellPrice: '250' })
      await loadData()
    } catch (err) {
      setError(err.message)
    }
  }

  // Update existing variety
  async function handleUpdateVariety(e) {
    e.preventDefault()
    if (!editingVar) return
    setError('')
    setSuccess('')
    try {
      await api.updateVariety(editingVar.id, {
        name: editingVar.name,
        gramsPerTray: Number(editingVar.gramsPerTray),
        defaultSellPrice: Number(editingVar.defaultSellPrice),
      })
      setSuccess(`Variety "${editingVar.name}" updated successfully!`)
      setEditingVar(null)
      await loadData()
    } catch (err) {
      setError(err.message)
    }
  }

  // Delete variety
  async function handleDeleteVariety(v) {
    if (!confirm(`Are you sure you want to remove "${v.name}"? If it has purchase or sowing history, it will be deactivated to preserve historical audit logs.`)) return
    setError('')
    setSuccess('')
    try {
      const res = await api.deleteVariety(v.id || v.varietyId)
      if (res.deactivated) {
        setSuccess(`"${v.name}" has purchase history and was deactivated.`)
      } else {
        setSuccess(`"${v.name}" was permanently deleted.`)
      }
      await loadData()
    } catch (err) {
      setError(err.message)
    }
  }

  // Toggle variety active status
  async function toggleVariety(v) {
    try {
      await api.updateVariety(v.id || v.varietyId, { ...v, active: !v.active })
      await loadData()
    } catch (err) {
      setError(err.message)
    }
  }

  // Save purchase
  async function handleSavePurchase(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    try {
      const res = await api.createPurchase({
        ...purchaseForm,
        quantityKg: Number(purchaseForm.quantityKg),
        pricePerKg: Number(purchaseForm.pricePerKg),
      })
      const v = varieties.find((x) => x.id === purchaseForm.varietyId)
      setSuccess(
        `Recorded purchase of ${kg(res.quantityKg)} ${v?.name || ''} @ ${inr(res.pricePerKg)}/KG (Total: ${inr(res.totalValue)}). Stock updated!`,
      )
      setPurchaseForm((f) => ({
        ...f,
        quantityKg: '',
        pricePerKg: '',
        supplier: '',
      }))
      await loadData()
    } catch (err) {
      setError(err.message)
    }
  }

  const purchaseValuePreview =
    Number(purchaseForm.quantityKg || 0) * Number(purchaseForm.pricePerKg || 0)

  const nameOf = (id) => varieties.find((v) => v.id === id)?.name || id

  return (
    <Page
      title="Seed Inventory & Varieties"
      subtitle="Manage seed varieties, seed rates per tray, and track all purchase batches with FIFO traceability."
    >
      <ErrorBanner error={error} />
      <SuccessBanner message={success} />

      <Tabs
        activeTab={tab}
        onChange={setTab}
        tabs={[
          { id: 'stock', label: '1. Seed Stock & Varieties', icon: '🌾', count: varieties.length },
          { id: 'purchase', label: '2. Record Seed Purchase', icon: '➕' },
          { id: 'batches', label: '3. Purchase Batches (FIFO)', icon: '📦', count: purchases.length },
        ]}
      />

      {/* ==================== SUB-TAB 1: STOCK & VARIETIES ==================== */}
      {tab === 'stock' && (
        <>
          <div className="grid-2">
            <Card
              title="Add New Variety"
              subtitle="Configure seed grams required per tray and default box selling price"
            >
              <form className="form-grid" onSubmit={handleAddVariety}>
                <Field label="Variety Name">
                  <input
                    value={newVar.name}
                    onChange={(e) => setNewVar({ ...newVar, name: e.target.value })}
                    placeholder="e.g. Red Cabbage"
                    required
                  />
                </Field>
                <Field label="Seed Grams / Tray" hint="Standard seed rate">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={newVar.gramsPerTray}
                    onChange={(e) => setNewVar({ ...newVar, gramsPerTray: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Default Selling Price / Box (₹)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={newVar.defaultSellPrice}
                    onChange={(e) => setNewVar({ ...newVar, defaultSellPrice: e.target.value })}
                    required
                  />
                </Field>
                <Button type="submit">+ Add Variety</Button>
              </form>
            </Card>

            <Card
              title="Quick Seed Stock Summary"
              subtitle="Real-time balance calculated from FIFO purchase batches"
            >
              <ul className="kv">
                {(inventory?.stock || []).map((s) => (
                  <li key={s.varietyId}>
                    <div>
                      <span>{s.name}</span>
                      <small className="muted" style={{ display: 'block' }}>
                        Value: {inr(s.value)}
                      </small>
                    </div>
                    <b>{kg(s.remainingKg)}</b>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {editingVar && (
            <Card
              title={`Edit Variety: ${editingVar.name}`}
              subtitle="Update seed rate per tray or default selling price"
              actions={
                <Button type="button" variant="ghost" onClick={() => setEditingVar(null)}>
                  Cancel
                </Button>
              }
            >
              <form className="form-grid" onSubmit={handleUpdateVariety}>
                <Field label="Variety Name">
                  <input
                    value={editingVar.name}
                    onChange={(e) => setEditingVar({ ...editingVar, name: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Seed Grams / Tray">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={editingVar.gramsPerTray}
                    onChange={(e) => setEditingVar({ ...editingVar, gramsPerTray: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Default Selling Price / Box (₹)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editingVar.defaultSellPrice}
                    onChange={(e) => setEditingVar({ ...editingVar, defaultSellPrice: e.target.value })}
                    required
                  />
                </Field>
                <Button type="submit">Save Changes</Button>
              </form>
            </Card>
          )}

          <Card
            title="Configured Varieties & Inventory Balances"
            subtitle="Standard tray rates are used by default when creating a sowing batch"
            actions={
              <Button type="button" variant="ghost" onClick={() => setTab('purchase')}>
                + Record Purchase
              </Button>
            }
          >
            <Table
              rows={inventory?.stock || []}
              empty="No varieties found. Add one above."
              columns={[
                { key: 'name', label: 'Variety Name' },
                {
                  key: 'remainingKg',
                  label: 'Seed Stock',
                  render: (r) => (
                    <div>
                      <b>{kg(r.remainingKg)}</b>
                      {r.remainingKg < 0.2 ? (
                        <div style={{ marginTop: 2 }}>
                          <Badge variant="warning">Low stock</Badge>
                        </div>
                      ) : null}
                    </div>
                  ),
                },
                { key: 'value', label: 'Stock Value', render: (r) => inr(r.value) },
                {
                  key: 'gramsPerTray',
                  label: 'g / Tray',
                  render: (r) => `${r.gramsPerTray || 70} g`,
                },
                {
                  key: 'defaultSellPrice',
                  label: 'Default Sell Price',
                  render: (r) => inr(r.defaultSellPrice || 250),
                },
                {
                  key: 'active',
                  label: 'Status',
                  render: (r) => (
                    <Badge variant={r.active ? 'success' : 'default'}>
                      {r.active ? 'Active' : 'Inactive'}
                    </Badge>
                  ),
                },
                {
                  key: 'action',
                  label: '',
                  render: (r) => (
                    <div className="row-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        style={{ padding: '4px 8px', fontSize: 13 }}
                        onClick={() => {
                          const v = varieties.find((x) => x.id === (r.id || r.varietyId))
                          setEditingVar({
                            id: r.id || r.varietyId,
                            name: r.name,
                            gramsPerTray: r.gramsPerTray || v?.gramsPerTray || 70,
                            defaultSellPrice: r.defaultSellPrice || v?.defaultSellPrice || 250,
                          })
                        }}
                      >
                        Edit ✏️
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        style={{ padding: '4px 8px', fontSize: 13 }}
                        onClick={() => toggleVariety(r)}
                      >
                        {r.active ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        style={{ padding: '4px 8px', fontSize: 13 }}
                        onClick={() => handleDeleteVariety(r)}
                      >
                        Delete 🗑️
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          </Card>
        </>
      )}

      {/* ==================== SUB-TAB 2: RECORD PURCHASE ==================== */}
      {tab === 'purchase' && (
        <Card
          title="Record Seed Purchase"
          subtitle="Each purchase is preserved as an individual FIFO batch so price changes never alter prior costs"
        >
          <form onSubmit={handleSavePurchase}>
            <div className="form-grid">
              <Field label="Seed Variety">
                <select
                  value={purchaseForm.varietyId}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, varietyId: e.target.value })}
                  required
                >
                  {varieties.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Purchase Date">
                <input
                  type="date"
                  value={purchaseForm.date}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, date: e.target.value })}
                  required
                />
              </Field>

              <Field label="Quantity (KG)">
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={purchaseForm.quantityKg}
                  onChange={(e) =>
                    setPurchaseForm({ ...purchaseForm, quantityKg: e.target.value })
                  }
                  placeholder="e.g. 3.0"
                  required
                />
              </Field>

              <Field label="Price per KG (₹)">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={purchaseForm.pricePerKg}
                  onChange={(e) =>
                    setPurchaseForm({ ...purchaseForm, pricePerKg: e.target.value })
                  }
                  placeholder="e.g. 1200"
                  required
                />
              </Field>

              <Field label="Supplier / Invoice (Optional)">
                <input
                  value={purchaseForm.supplier}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, supplier: e.target.value })}
                  placeholder="e.g. Seed Supplier Co."
                />
              </Field>
            </div>

            {/* LIVE PURCHASE PREVIEW */}
            <div className="cost-preview">
              <h4>Purchase Valuation Preview</h4>
              <div className="preview-grid">
                <div className="preview-item">
                  <span>Quantity</span>
                  <strong>{kg(purchaseForm.quantityKg || 0)}</strong>
                  <small>{((Number(purchaseForm.quantityKg) || 0) * 1000).toFixed(0)} grams</small>
                </div>
                <div className="preview-item">
                  <span>Price per KG</span>
                  <strong>{inr(purchaseForm.pricePerKg || 0)} / KG</strong>
                  <small>
                    {inr((Number(purchaseForm.pricePerKg) || 0) / 1000)} per gram
                  </small>
                </div>
                <div className="preview-item">
                  <span>Total Purchase Value</span>
                  <strong style={{ color: 'var(--green-dark)' }}>
                    {inr(purchaseValuePreview)}
                  </strong>
                  <small>Added to inventory</small>
                </div>
              </div>
            </div>

            <Button type="submit">Save Purchase Batch</Button>
          </form>
        </Card>
      )}

      {/* ==================== SUB-TAB 3: PURCHASE BATCHES ==================== */}
      {tab === 'batches' && (
        <Card
          title="Purchase Batch Traceability (FIFO)"
          subtitle="Every purchase retains its original price. Seed is deducted from the oldest remaining batch first."
        >
          <Table
            rows={purchases}
            empty="No purchases recorded yet."
            columns={[
              { key: 'date', label: 'Purchase Date', render: (r) => prettyDate(r.date) },
              { key: 'varietyName', label: 'Variety', render: (r) => r.varietyName || nameOf(r.varietyId) },
              { key: 'quantityKg', label: 'Bought', render: (r) => kg(r.quantityKg) },
              {
                key: 'remainingKg',
                label: 'Remaining',
                render: (r) => (
                  <span style={{ fontWeight: 600, color: r.remainingKg > 0 ? 'var(--green-dark)' : 'var(--muted)' }}>
                    {kg(r.remainingKg)}
                  </span>
                ),
              },
              { key: 'pricePerKg', label: 'Price / KG', render: (r) => inr(r.pricePerKg) },
              { key: 'totalValue', label: 'Batch Value', render: (r) => inr(r.totalValue) },
              { key: 'supplier', label: 'Supplier', render: (r) => r.supplier || '—' },
            ]}
          />
        </Card>
      )}
    </Page>
  )
}
