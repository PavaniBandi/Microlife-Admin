import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { inr } from '../lib/format'
import { Button, Card, ErrorBanner, SuccessBanner, Field, Page } from '../components/ui'

export default function Settings() {
  const [settings, setSettings] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [pack, setPack] = useState({ name: '100g Box', sizeGrams: 100, costPerBox: '5' })

  const loadData = () =>
    api
      .settings()
      .then((s) => {
        setSettings(s)
        setError('')
      })
      .catch((e) => setError(e.message))

  useEffect(() => {
    loadData()
  }, [])

  async function saveCocopeat(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    try {
      const next = await api.saveSettings(settings)
      setSettings(next)
      setSuccess('Cocopeat settings saved! Calculated cost per tray updated.')
    } catch (err) {
      setError(err.message)
    }
  }

  async function addPackagingType(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    try {
      const packagingTypes = [
        ...(settings.packagingTypes || []),
        {
          id: `pack-${Date.now()}`,
          name: pack.name,
          sizeGrams: Number(pack.sizeGrams) || 100,
          costPerBox: Number(pack.costPerBox) || 5,
        },
      ]
      const next = await api.saveSettings({ ...settings, packagingTypes })
      setSettings(next)
      setPack({ name: '', sizeGrams: 100, costPerBox: '' })
      setSuccess(`Packaging type "${pack.name}" added!`)
    } catch (err) {
      setError(err.message)
    }
  }

  async function removePackagingType(id) {
    if ((settings.packagingTypes || []).length <= 1) {
      setError('You need at least one packaging type configured.')
      return
    }
    setError('')
    setSuccess('')
    try {
      const packagingTypes = settings.packagingTypes.filter((p) => p.id !== id)
      const next = await api.saveSettings({ ...settings, packagingTypes })
      setSettings(next)
      setSuccess('Packaging type removed.')
    } catch (err) {
      setError(err.message)
    }
  }

  if (!settings) {
    return (
      <Page title="Production Cost Settings">
        <ErrorBanner error={error} />
      </Page>
    )
  }

  const calculatedCocoPerTray =
    settings.traysPerBrick > 0
      ? (Number(settings.cocopeatBrickPrice || 0) / Number(settings.traysPerBrick)).toFixed(2)
      : '0.00'

  return (
    <Page
      title="Production Cost Settings"
      subtitle="Configure standard cocopeat and packaging costs. Changing these settings applies only to new batches; historical batch costs are preserved."
    >
      <ErrorBanner error={error} />
      <SuccessBanner message={success} />

      <div className="grid-2">
        {/* Cocopeat Configuration */}
        <Card
          title="Cocopeat Input Cost"
          subtitle="Cocopeat brick price divided by trays supported gives per-tray cost"
        >
          <form onSubmit={saveCocopeat}>
            <div className="form-grid">
              <Field label="Cocopeat Brick Price (₹)" hint="Cost per compressed brick">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={settings.cocopeatBrickPrice}
                  onChange={(e) =>
                    setSettings({ ...settings, cocopeatBrickPrice: e.target.value })
                  }
                  required
                />
              </Field>

              <Field label="Trays Supported per Brick" hint="Yield in trays">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={settings.traysPerBrick}
                  onChange={(e) =>
                    setSettings({ ...settings, traysPerBrick: e.target.value })
                  }
                  required
                />
              </Field>
            </div>

            {/* Live Calculation Preview */}
            <div className="cost-preview" style={{ margin: '14px 0' }}>
              <h4>Cocopeat Cost Per Tray</h4>
              <div className="preview-grid">
                <div className="preview-item">
                  <span>Brick Price</span>
                  <strong>{inr(settings.cocopeatBrickPrice)}</strong>
                </div>
                <div className="preview-item">
                  <span>Trays / Brick</span>
                  <strong>{settings.traysPerBrick} trays</strong>
                </div>
                <div className="preview-item">
                  <span>Calculated Cost / Tray</span>
                  <strong style={{ color: 'var(--green-dark)' }}>
                    {inr(calculatedCocoPerTray)}
                  </strong>
                  <small>{inr(settings.cocopeatBrickPrice)} ÷ {settings.traysPerBrick}</small>
                </div>
              </div>
            </div>

            <Button type="submit">Save Cocopeat Settings</Button>
          </form>
        </Card>

        {/* Packaging Types Configuration */}
        <Card
          title="Packaging / Box Costs"
          subtitle="Configure box types and unit packaging cost (default ₹5 per 100g box)"
        >
          <form onSubmit={addPackagingType}>
            <div className="form-grid">
              <Field label="Box Name">
                <input
                  value={pack.name}
                  onChange={(e) => setPack({ ...pack, name: e.target.value })}
                  placeholder="e.g. 100g Clamshell Box"
                  required
                />
              </Field>

              <Field label="Size (Grams)">
                <input
                  type="number"
                  min="1"
                  value={pack.sizeGrams}
                  onChange={(e) => setPack({ ...pack, sizeGrams: e.target.value })}
                  required
                />
              </Field>

              <Field label="Unit Cost per Box (₹)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={pack.costPerBox}
                  onChange={(e) => setPack({ ...pack, costPerBox: e.target.value })}
                  placeholder="e.g. 5.00"
                  required
                />
              </Field>
            </div>

            <Button type="submit" variant="ghost" style={{ marginBottom: 16 }}>
              + Add Packaging Type
            </Button>
          </form>

          <div style={{ marginTop: 8 }}>
            <strong>Active Packaging Types:</strong>
            <ul className="list">
              {(settings.packagingTypes || []).map((p) => (
                <li key={p.id}>
                  <div>
                    <strong>{p.name}</strong>
                    <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                      Size: {p.sizeGrams} g · Unit Cost: <b>{inr(p.costPerBox)}</b>
                    </div>
                  </div>
                  <Button
                    variant="danger"
                    type="button"
                    style={{ padding: '4px 10px', fontSize: 12 }}
                    onClick={() => removePackagingType(p.id)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <Card
        title="Historical Cost Preservation Guarantee"
        subtitle="Snapshot Costing Policy"
        style={{ marginTop: 16 }}
      >
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          MicroLife preserves historical unit costs on every sowing batch and packed lot. If you change the cocopeat brick price from ₹350 to ₹400 or packaging from ₹5 to ₹6, all previous batches and harvest lots retain their exact original snapshot costs. Only batches created after the change will use the updated rates.
        </p>
      </Card>

      <Card
        title="Database Maintenance"
        subtitle="Clear test records or reset operational data"
        style={{ marginTop: 16 }}
      >
        <p className="muted" style={{ margin: '0 0 16px 0', fontSize: 14 }}>
          Need a fresh start? This will delete all sowing batches, harvests, packed stock, sales, seed purchases, electricity, and expense records, while keeping your seed varieties and cost settings intact.
        </p>
        <Button
          type="button"
          variant="danger"
          onClick={async () => {
            if (!confirm('Are you sure you want to clear all batches, sales, and purchases? This cannot be undone.')) return
            try {
              await api.resetData({ preserveVarieties: true })
              setSuccess('All operational batches, sales, purchases, and expenses have been cleared! Database is completely fresh.')
            } catch (err) {
              setError(err.message)
            }
          }}
        >
          🗑️ Clear All Operational Data (Reset Batches & Sales)
        </Button>
      </Card>
    </Page>
  )
}
