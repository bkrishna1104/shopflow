// ShopFlow web UI — plain JavaScript, no framework, no build step.
// Every call goes to /api/* on web-ui (the BFF), never directly to a service.

const $ = (id) => document.getElementById(id);
const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS_LABEL = { PAID: 'Paid', PAYMENT_FAILED: 'Payment failed', PENDING: 'Pending' };

const state = { users: [], products: [], userId: null };

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  let body = null;
  try { body = await res.json(); } catch { /* empty or non-JSON body */ }
  return { status: res.status, ok: res.ok, body, version: res.headers.get('x-upstream-version') };
}

function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 4500);
}

function rememberUser(id) {
  try { localStorage.setItem('shopflow.userId', String(id)); } catch { /* storage unavailable */ }
}
function recalledUser() {
  try { return Number(localStorage.getItem('shopflow.userId')) || null; } catch { return null; }
}

// ---------- Customers ----------
async function loadUsers(selectId) {
  const r = await api('/users');
  if (!r.ok) return toast('Could not load customers. Is user-service running?', true);
  state.users = r.body;
  const wanted = selectId ?? recalledUser();
  state.userId = state.users.some((u) => u.id === wanted) ? wanted : state.users[0]?.id ?? null;
  $('customer').innerHTML = state.users
    .map((u) => `<option value="${u.id}" ${u.id === state.userId ? 'selected' : ''}>${esc(u.name)} (${esc(u.email)})</option>`)
    .join('');
}

$('customer').addEventListener('change', (e) => {
  state.userId = Number(e.target.value);
  rememberUser(state.userId);
  refreshHistory();
});

const dialog = $('customer-dialog');
$('new-customer-btn').addEventListener('click', () => { $('customer-error').textContent = ''; dialog.showModal(); });
$('customer-cancel').addEventListener('click', () => dialog.close());
$('customer-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  const r = await api('/users', { method: 'POST', body: JSON.stringify(data) });
  if (!r.ok) { $('customer-error').textContent = r.body?.error ?? `Could not create customer (HTTP ${r.status})`; return; }
  dialog.close();
  e.target.reset();
  rememberUser(r.body.id);
  await loadUsers(r.body.id);
  refreshHistory();
  toast(`Customer created: ${r.body.name}`);
});

// ---------- Products ----------
async function loadProducts() {
  const r = await api('/products');
  if (!r.ok) { $('products').innerHTML = '<li class="history-empty">Products are unavailable right now. Check product-service.</li>'; return; }
  state.products = r.body;
  $('products').innerHTML = state.products.map((p) => {
    const level = p.stock === 0 ? 'out' : p.stock <= 10 ? 'low' : '';
    const stockText = p.stock === 0 ? 'Out of stock' : `${p.stock} in stock`;
    return `
      <li class="product">
        <div>
          <div class="product-name">${esc(p.name)}</div>
          <div class="product-meta">
            <span class="stock-bar ${level}" aria-hidden="true"><span style="width:${Math.max(4, Math.min(p.stock / 100, 1) * 100)}%"></span></span>
            <span>${stockText}</span>
          </div>
        </div>
        <div class="price">${rupees(p.price_paise)}</div>
        <form class="buy" data-product="${p.id}">
          <input id="qty-${p.id}" type="number" name="quantity" min="1" max="${Math.max(p.stock, 1)}" value="1" aria-label="Quantity of ${esc(p.name)}" ${p.stock === 0 ? 'disabled' : ''}>
          <button class="btn-primary" type="submit" ${p.stock === 0 ? 'disabled' : ''}>Buy</button>
        </form>
      </li>`;
  }).join('');
}

$('products').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.userId) return toast('Create a customer first.', true);
  const form = e.target;
  const button = form.querySelector('button');
  const productId = Number(form.dataset.product);
  const quantity = Number(form.quantity.value);
  button.disabled = true;
  button.textContent = 'Buying…';
  try {
    const r = await api('/orders', { method: 'POST', body: JSON.stringify({ user_id: state.userId, product_id: productId, quantity }) });
    handleOrderResult(r, productId, quantity);
  } catch {
    toast('Could not reach the shop. Is web-ui running?', true);
  } finally {
    button.disabled = false;
    button.textContent = 'Buy';
    await Promise.all([loadProducts(), refreshHistory()]);
  }
});

function handleOrderResult(r, productId, quantity) {
  const product = state.products.find((p) => p.id === productId);
  if (r.status === 201 || r.status === 402 || (r.body?.status === 'PAYMENT_FAILED')) {
    printReceipt(r.body, product, r.version);
    if (r.status === 201) toast(`Order #${r.body.id} paid.`);
    else toast(`Order #${r.body.id}: ${r.body.failure_reason ?? 'payment failed'}. Stock was put back.`, true);
    return;
  }
  if (r.status === 409) {
    const available = r.body?.details?.available;
    return toast(`Only ${available ?? 'a few'} left of ${product?.name ?? 'this product'}. You asked for ${quantity}.`, true);
  }
  toast(r.body?.error ? `Order not placed: ${r.body.error}.` : `Order not placed (HTTP ${r.status}).`, true);
}

function printReceipt(order, product, version) {
  const status = order.status === 'PAID' ? 'paid' : 'declined';
  const label = order.status === 'PAID' ? 'PAID' : 'PAYMENT FAILED';
  const when = new Date(order.created_at ?? Date.now()).toLocaleString('en-IN');
  $('receipt-area').innerHTML = `
    <div class="receipt">
      <div class="receipt-head">SHOPFLOW<br>Order #${order.id}</div>
      <div class="receipt-foot" style="text-align:center">${esc(when)}</div>
      <hr>
      <div class="receipt-row"><span>${esc(product?.name ?? `Product ${order.product_id}`)}</span></div>
      <div class="receipt-row"><span>${order.quantity} × ${rupees(order.total_paise / order.quantity)}</span><span>${rupees(order.total_paise)}</span></div>
      <hr>
      <div class="receipt-row receipt-total"><span>TOTAL</span><span>${rupees(order.total_paise)}</span></div>
      <div class="receipt-status ${status}">${label}</div>
      ${order.failure_reason ? `<div class="receipt-foot">${esc(order.failure_reason)}. Your stock reservation was released.</div>` : ''}
      ${order.payment_id ? `<div class="receipt-row receipt-foot"><span>Payment</span><span>#${order.payment_id}</span></div>` : ''}
      <div class="receipt-row receipt-foot"><span>Handled by</span><span>order-service ${esc(version ?? '?')}</span></div>
    </div>`;
}

// ---------- History ----------
async function refreshHistory() {
  if (!state.userId) return;
  const [orders, inbox] = await Promise.all([
    api(`/orders?user_id=${state.userId}`),
    api(`/notifications?user_id=${state.userId}`),
  ]);
  const name = (id) => state.products.find((p) => p.id === id)?.name ?? `Product ${id}`;

  $('orders').innerHTML = !orders.ok
    ? '<li class="history-empty">Orders are unavailable right now.</li>'
    : orders.body.length === 0
      ? '<li class="history-empty">No orders yet. Buy something from the list.</li>'
      : orders.body.slice(0, 6).map((o) => `
          <li>
            <span class="order-id">#${o.id}</span>
            <span>${o.quantity} × ${esc(name(o.product_id))}<br><small>${rupees(o.total_paise)}</small></span>
            <span class="chip ${o.status}">${STATUS_LABEL[o.status] ?? o.status}</span>
          </li>`).join('');

  $('inbox').innerHTML = !inbox.ok
    ? '<li class="history-empty">Messages are unavailable right now.</li>'
    : inbox.body.length === 0
      ? '<li class="history-empty">No messages yet. You get a receipt after each paid order.</li>'
      : inbox.body.slice(0, 4).map((n) => `
          <li>${esc(n.message)}<time datetime="${esc(n.created_at)}">${n.channel === 'SMS' ? 'SMS' : 'Email'}, sent ${new Date(n.created_at).toLocaleString('en-IN')}</time></li>`).join('');
}

// ---------- Services strip ----------
async function refreshServices() {
  try {
    const r = await api('/status');
    if (!r.ok) throw new Error();
    $('services').innerHTML = r.body.map((s) => `
      <li>
        <span class="dot ${s.ok ? '' : 'down'}" aria-hidden="true"></span>
        <span>${esc(s.service)}</span>
        <span class="svc-version">${s.ok ? esc(s.version) : 'down'}</span>
        ${s.ok ? `<span class="svc-ms">${s.latencyMs} ms</span>` : ''}
      </li>`).join('');
  } catch {
    $('services').innerHTML = '<li><span class="dot down" aria-hidden="true"></span>web-ui is not responding</li>';
  }
}

// ---------- Start ----------
await Promise.all([loadUsers(), loadProducts()]);
await refreshHistory();
await refreshServices();
setInterval(refreshServices, 5000);
