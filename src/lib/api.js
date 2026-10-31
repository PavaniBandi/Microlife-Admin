async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

export const api = {
  health: () => request('/api/health'),
  dashboard: () => request('/api/dashboard'),
  varieties: () => request('/api/varieties'),
  createVariety: (body) => request('/api/varieties', { method: 'POST', body }),
  updateVariety: (id, body) => request(`/api/varieties/${id}`, { method: 'PUT', body }),
  deleteVariety: (id) => request(`/api/varieties/${id}`, { method: 'DELETE' }),
  purchases: () => request('/api/purchases'),
  createPurchase: (body) => request('/api/purchases', { method: 'POST', body }),
  inventory: () => request('/api/inventory'),
  settings: () => request('/api/settings'),
  saveSettings: (body) => request('/api/settings', { method: 'PUT', body }),
  sowings: () => request('/api/sowings'),
  createSowing: (body) => request('/api/sowings', { method: 'POST', body }),
  harvests: () => request('/api/harvests'),
  createHarvest: (body) => request('/api/harvests', { method: 'POST', body }),
  sales: () => request('/api/sales'),
  createSale: (body) => request('/api/sales', { method: 'POST', body }),
  electricity: () => request('/api/electricity'),
  saveElectricity: (month, body) =>
    request(`/api/electricity/${month}`, { method: 'PUT', body }),
  expenses: () => request('/api/expenses'),
  createExpense: (body) => request('/api/expenses', { method: 'POST', body }),
  deleteExpense: (id) => request(`/api/expenses/${id}`, { method: 'DELETE' }),
  report: (params) => request(`/api/reports?${new URLSearchParams(params)}`),
  resetData: (body = {}) => request('/api/admin/reset-data', { method: 'POST', body }),
}
