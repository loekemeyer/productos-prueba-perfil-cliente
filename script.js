'use strict';

/***********************
 * SUPABASE CONFIG
 ***********************/
const SUPABASE_URL = 'https://kwkclwhmoygunqmlegrg.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3a2Nsd2htb3lndW5xbWxlZ3JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MjA2NzUsImV4cCI6MjA4NTA5NjY3NX0.soqPY5hfA3RkAJ9jmIms8UtEGUc4WpZztpEbmDijOgU';

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

/***********************
 * GOOGLE SHEETS (APPS SCRIPT)
 ***********************/
const SHEETS_WEBAPP_URL =
  'https://script.google.com/macros/s/AKfycby2LCHETP7mdN1En4mNtUaPRP-Aij6meoReh_-X_DnAI3BoF41HoXVfF5p-Oet97HAg/exec'; // termina en /exec
const SHEETS_SECRET = 'Damian.10.2026.WEB';

/***********************
 * UI CONSTANTS
 ***********************/
const WEB_ORDER_DISCOUNT = 0.025; // 2.5% siempre
const BASE_IMG = `${SUPABASE_URL}/storage/v1/object/public/products-images/`;
const IMG_VERSION = '2026-02-06-2'; // cambiá esto cuando actualices imágenes

/***********************
 * ORDEN FIJO (como pediste)
 ***********************/
const CATEGORY_ORDER = [
  'Abrelatas',
  'Peladores',
  'Sacacorchos',
  'Cortadores',
  'Ralladores',
  'Coladores',
  'Afiladores',
  'Utensilios',
  'Pinzas',
  'Destapadores',
  'Tapon Vino',
  'Repostería',
  'Madera',
  'Mate',
  'Accesorios',
  'Vidrio',
  'Cuchillos de untar',
  'Contenedores',
];

const UTENSILIOS_SUB_ORDER = [
  'Madera',
  'Silicona',
  'Nylon Premium',
  'Inoxidable',
  'Nylon',
];

/***********************
 * STATE
 ***********************/
let products = []; // productos cargados
let currentSession = null; // sesión supabase
let isAdmin = false; // admin flag
let customerProfile = null; // {id, business_name, dto_vol, ...}

const cart = []; // [{ productId: uuidString, qtyCajas }]

// Entrega desde DB (slots 1..25)
let deliveryChoice = { slot: '', label: '' };

let sortMode = 'category'; // category | bestsellers | price_desc | price_asc

// Filtros UI (DESKTOP / estado aplicado)
let filterAll = true; // "Todos" ON por default
let filterCats = new Set(); // acumulativo
let searchTerm = ''; // buscador

// ===== Mobile Filters (pendientes) =====
let pendingFilterAll = true;
let pendingFilterCats = new Set();

/***********************
 * DOM HELPERS
 ***********************/
function $(id) {
  return document.getElementById(id);
}

function formatMoney(n) {
  return Math.round(Number(n || 0)).toLocaleString('es-AR');
}

function headerTwoLine(text) {
  const parts = String(text || '').trim().split(/\s+/);
  if (parts.length >= 2) {
    return `<span class="split-2line">${parts[0]}<br>${parts
      .slice(1)
      .join(' ')}</span>`;
  }
  return String(text || '');
}

function splitTwoWords(text) {
  const parts = String(text || '').trim().split(/\s+/);
  if (parts.length === 2) {
    return `<span class="split-2line">${parts[0]}<br>${parts[1]}</span>`;
  }
  return String(text || '');
}

function setOrderStatus(message, type = '') {
  const el = $('orderStatus');
  if (!el) return;

  el.classList.remove('ok', 'err');
  if (type) el.classList.add(type);
  el.textContent = message || '';
}

/***********************
 * MOBILE MENU
 ***********************/
function toggleMobileMenu(forceOpen) {
  const menu = $('mobileMenu');
  const btn = $('hamburgerBtn');
  if (!menu || !btn) return;

  const willOpen =
    typeof forceOpen === 'boolean'
      ? forceOpen
      : !menu.classList.contains('open');

  menu.classList.toggle('open', willOpen);
  menu.setAttribute('aria-hidden', willOpen ? 'false' : 'true');
  btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
}

function closeMobileMenu() {
  toggleMobileMenu(false);
}

function closeMobileUserMenu() {
  const m = $('mobileUserMenu');
  if (!m) return;

  m.classList.remove('open');
  m.setAttribute('aria-hidden', 'true');
}

function toggleMobileUserMenu() {
  const m = $('mobileUserMenu');
  if (!m) return;

  const willOpen = !m.classList.contains('open');
  m.classList.toggle('open', willOpen);
  m.setAttribute('aria-hidden', willOpen ? 'false' : 'true');
}

window.closeMobileUserMenu = closeMobileUserMenu;

/***********************
 * SECTIONS
 ***********************/
function showSection(id) {
  document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));

  const el = $(id);
  if (el) el.classList.add('active');

  closeCategoriesMenu();
  closeUserMenu();
  closeMobileMenu();
  closeFiltersOverlay();
  closeMobileUserMenu();
}

function goToProductsTop() {
  showSection('productos');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/***********************
 * CUIT -> EMAIL INTERNO
 ***********************/
function normalizeCUIT(cuit) {
  return String(cuit || '').trim().replace(/\s+/g, '');
}

function cuitDigits(cuit) {
  return normalizeCUIT(cuit).replace(/\D/g, '');
}

function cuitToInternalEmail(cuit) {
  const digits = cuitDigits(cuit);
  if (!digits) return '';
  return `${digits}@cuit.loekemeyer`;
}

/***********************
 * LOGIN MODAL
 ***********************/
function openLogin() {
  setOrderStatus('');

  const err = $('loginError');
  if (err) {
    err.style.display = 'none';
    err.innerText = '';
  }

  $('loginModal')?.classList.add('open');
  $('loginModal')?.setAttribute('aria-hidden', 'false');
}

function closeLogin() {
  $('loginModal')?.classList.remove('open');
  $('loginModal')?.setAttribute('aria-hidden', 'true');
}

async function login() {
  const cuit = ($('cuitInput')?.value || '').trim();
  const password = ($('passInput')?.value || '').trim();

  if (!cuit || !password) {
    const err = $('loginError');
    if (err) {
      err.innerText = 'Completá CUIT y contraseña.';
      err.style.display = 'block';
    }
    return;
  }

  const email = cuitToInternalEmail(cuit);
  if (!email) {
    const err = $('loginError');
    if (err) {
      err.innerText = 'CUIT inválido.';
      err.style.display = 'block';
    }
    return;
  }

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    const err = $('loginError');
    if (err) {
      err.innerText = 'CUIT o contraseña incorrectos.';
      err.style.display = 'block';
    }
    return;
  }

  currentSession = data.session || null;

  closeLogin();

  // limpiar búsqueda
  searchTerm = '';
  const ns = $('navSearch');
  if (ns) ns.value = '';

  await refreshAuthState();
  await loadProductsFromDB();

  renderCategoriesMenu();
  renderCategoriesSidebar();
  renderProducts();
  updateCart();
  syncPaymentButtons();
}

/***********************
 * LOGOUT
 ***********************/
async function logout() {
  if (window.__isLoggingOut) return;
  window.__isLoggingOut = true;

  try {
    const signOutPromise = supabaseClient.auth.signOut().catch(() => {});
    await Promise.race([signOutPromise, new Promise((r) => setTimeout(r, 1200))]);

    Object.keys(localStorage)
      .filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
      .forEach((k) => localStorage.removeItem(k));

    Object.keys(sessionStorage)
      .filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
      .forEach((k) => sessionStorage.removeItem(k));

    currentSession = null;
    isAdmin = false;
    customerProfile = null;
    deliveryChoice = { slot: '', label: '' };

    if ($('customerNote')) $('customerNote').innerText = '';
    if ($('helloNavBtn')) $('helloNavBtn').innerText = '';
    if ($('loginBtn')) $('loginBtn').style.display = 'inline';
    if ($('userBox')) $('userBox').style.display = 'none';

    closeUserMenu();
    resetShippingSelect();

    // reset filtros
    filterAll = true;
    filterCats.clear();
    searchTerm = '';
    setSearchInputValue('');

    renderCategoriesMenu();
    renderCategoriesSidebar();
    renderProducts();
    updateCart();

    showSection('productos');

    setTimeout(() => location.reload(), 50);
  } catch (e) {
    console.error('logout error:', e);
    setOrderStatus('No se pudo cerrar sesión. Probá recargando la página.', 'err');
    window.__isLoggingOut = false;
  }
}

/***********************
 * AUTH/PROFILE HELPERS
 ***********************/
async function refreshAuthState() {
  const { data } = await supabaseClient.auth.getSession();
  currentSession = data.session || null;

  if (!currentSession) {
    isAdmin = false;
    customerProfile = null;
    deliveryChoice = { slot: '', label: '' };

    if ($('loginBtn')) $('loginBtn').style.display = 'inline';
    if ($('userBox')) $('userBox').style.display = 'none';
    if ($('ctaCliente')) $('ctaCliente').style.display = 'inline-flex';
    if ($('helloNavBtn')) $('helloNavBtn').innerText = '';
    if ($('customerNote')) $('customerNote').innerText = '';
    if ($('menuMyOrders')) $('menuMyOrders').style.display = 'none';

    resetShippingSelect();
    return;
  }

  const { data: adminRow, error: adminErr } = await supabaseClient
    .from('admins')
    .select('auth_user_id')
    .eq('auth_user_id', currentSession.user.id)
    .maybeSingle();

  isAdmin = !!adminRow && !adminErr;

  const { data: custRow } = await supabaseClient
    .from('customers')
    .select(
      'id,business_name,dto_vol,cod_cliente,cuit,direccion_fiscal,localidad,vend,mail'
    )
    .eq('auth_user_id', currentSession.user.id)
    .maybeSingle();

  customerProfile = custRow || null;

  if ($('loginBtn')) $('loginBtn').style.display = 'none';
  if ($('userBox')) $('userBox').style.display = 'inline-flex';
  if ($('ctaCliente')) $('ctaCliente').style.display = 'none';

  const name = (customerProfile?.business_name || '').trim();
  if ($('helloNavBtn')) $('helloNavBtn').innerText = name ? `Hola, ${name} !` : 'Hola!';

  if ($('menuMyOrders')) $('menuMyOrders').style.display = isAdmin ? 'none' : 'block';

  const note = $('customerNote');
  if (note) {
    if (!currentSession) note.innerText = '';
    else if (isAdmin) note.innerText = 'Modo Administrador';
    else note.innerText = 'Ya está aplicado tu Dto x Volumen';
  }

  await loadDeliveryOptions();
}

function getDtoVol() {
  if (isAdmin) return 0;
  return Number(customerProfile?.dto_vol || 0);
}

function unitYourPrice(listPrice) {
  const dto = getDtoVol();
  return Number(listPrice || 0) * (1 - dto);
}

/***********************
 * MÉTODO DE PAGO
 ***********************/
function getPaymentDiscount() {
  const sel = $('paymentSelect');
  if (!sel) return 0;

  const v = parseFloat(sel.value);
  return isNaN(v) ? 0 : v;
}

function getPaymentMethodText() {
  const sel = $('paymentSelect');
  if (!sel) return '';

  const opt = sel.options[sel.selectedIndex];
  return opt?.textContent ? opt.textContent.trim() : '';
}

function setPaymentByValue(val) {
  const sel = $('paymentSelect');
  if (!sel) return;

  sel.value = String(val);
  syncPaymentButtons();
  updateCart();
}

function syncPaymentButtons() {
  const sel = $('paymentSelect');
  const wrap = $('paymentButtons');
  if (!sel || !wrap) return;

  const current = String(sel.value);
  wrap.querySelectorAll('.pay-btn').forEach((btn) => {
    btn.classList.toggle('active', String(btn.dataset.value) === current);
  });
}

/***********************
 * PRODUCTS (DB/RPC)
 ***********************/
async function loadProductsFromDB() {
  const logged = !!currentSession;

  if (!logged) {
  // Público: intenta RPC
  const { data, error } = await supabaseClient.rpc('get_products_public_sorted', {
  sort_mode: sortMode,
  });

  if (!error && Array.isArray(data) && data.length) {
    products = data.map((p) => ({
      id: p.id,
      cod: p.cod,
      category: p.category || 'Sin categoría',
      subcategory: p.subcategory,
      ranking: p.ranking == null || p.ranking === '' ? null : Number(p.ranking),
      orden_catalogo: p.orden_catalogo == null || p.orden_catalogo === '' ? null : Number(p.orden_catalogo),
      description: p.description,
      list_price: p.list_price,
      uxb: p.uxb,
      images: Array.isArray(p.images) ? p.images : [],
    }));
    return;
  }

  // ✅ Fallback: consulta directa (requiere policy SELECT para anon)
  if (error) console.warn('Public RPC failed, fallback to direct select:', error);

  const { data: rows, error: err2 } = await supabaseClient
    .from('products')
    .select('id,cod,category,subcategory,ranking,orden_catalogo,description,list_price,uxb,images')
    .eq('active', true);

  if (err2) {
    console.error('Public select failed:', err2);
    products = [];
    return;
  }

  products = (rows || []).map((p) => ({
    id: p.id,
    cod: p.cod,
    category: p.category || 'Sin categoría',
    subcategory: p.subcategory,
    ranking: p.ranking == null || p.ranking === '' ? null : Number(p.ranking),
    orden_catalogo: p.orden_catalogo == null || p.orden_catalogo === '' ? null : Number(p.orden_catalogo),
    description: p.description,
    list_price: p.list_price,
    uxb: p.uxb,
    images: Array.isArray(p.images) ? p.images : [],
  }));

  return;
}

  // ✅ LOGUEADO: orden también según sortMode (para que no “parezca” que no ordena)
  let q = supabaseClient
    .from('products')
    .select(
      'id,cod,category,subcategory,ranking,orden_catalogo,description,list_price,uxb,images,active'
    )
    .eq('active', true);

  if (sortMode === 'bestsellers') {
    q = q.order('ranking', { ascending: true, nullsFirst: false });
 } else if (sortMode === 'price_desc') {
  q = q.order('category', { ascending: true });
  q = q.order('list_price', { ascending: false, nullsFirst: false });
  q = q.order('orden_catalogo', { ascending: true, nullsFirst: false });
} else if (sortMode === 'price_asc') {
  q = q.order('category', { ascending: true });
  q = q.order('list_price', { ascending: true, nullsFirst: false });
  q = q.order('orden_catalogo', { ascending: true, nullsFirst: false });
}
 else {
    // category (como lo tenías)
    q = q.order('category', { ascending: true });
    q = q.order('orden_catalogo', { ascending: true, nullsFirst: false });
    q = q.order('description', { ascending: true });
  }

  const { data, error } = await q;

  if (error) {
    console.error('Error loading products:', error);
    products = [];
    return;
  }

  products = (data || []).map((p) => ({
    id: p.id,
    cod: p.cod,
    category: p.category || 'Sin categoría',
    subcategory:
      p.subcategory && String(p.subcategory).trim()
        ? String(p.subcategory).trim()
        : null,
    ranking:
      p.ranking === null || p.ranking === undefined || p.ranking === ''
        ? null
        : Number(p.ranking),
    orden_catalogo:
      p.orden_catalogo === null ||
      p.orden_catalogo === undefined ||
      p.orden_catalogo === ''
        ? null
        : Number(p.orden_catalogo),
    description: p.description,
    list_price: p.list_price,
    uxb: p.uxb,
    images: Array.isArray(p.images) ? p.images : [],
    active: !!p.active,
  }));
}

/***********************
 * CATEGORÍAS HELPERS (orden fijo + fallback)
 ***********************/
function getOrderedCategoriesFrom(list) {
  const presentCats = new Set(
    list
      .map((p) => String(p.category || '').trim())
      .filter(Boolean)
  );

  const inOrder = CATEGORY_ORDER.filter((cat) => presentCats.has(cat));

  const extras = Array.from(presentCats)
    .filter((cat) => !CATEGORY_ORDER.includes(cat))
    .sort((a, b) => a.localeCompare(b, 'es'));

  return [...inOrder, ...extras];
}

function slugifyCategory(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]/g, '');
}

function normalizeText(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function getSortComparator() {
  return (a, b) => {
    const aOrd =
      a.orden_catalogo === null || a.orden_catalogo === undefined
        ? 999999
        : Number(a.orden_catalogo);
    const bOrd =
      b.orden_catalogo === null || b.orden_catalogo === undefined
        ? 999999
        : Number(b.orden_catalogo);

    const aRank =
      a.ranking === null || a.ranking === undefined ? 999999 : Number(a.ranking);
    const bRank =
      b.ranking === null || b.ranking === undefined ? 999999 : Number(b.ranking);

    const aPrice =
      a.list_price === null || a.list_price === undefined
        ? -1
        : Number(a.list_price);
    const bPrice =
      b.list_price === null || b.list_price === undefined
        ? -1
        : Number(b.list_price);

    if (sortMode === 'bestsellers') {
      return (
        (aRank - bRank) ||
        (aOrd - bOrd) ||
        String(a.description || '').localeCompare(String(b.description || ''), 'es')
      );
    }

    if (sortMode === 'price_desc') {
      return (
        (bPrice - aPrice) ||
        (aOrd - bOrd) ||
        String(a.description || '').localeCompare(String(b.description || ''), 'es')
      );
    }

    if (sortMode === 'price_asc') {
      const aP = aPrice < 0 ? 999999999 : aPrice;
      const bP = bPrice < 0 ? 999999999 : bPrice;

      return (
        (aP - bP) ||
        (aOrd - bOrd) ||
        String(a.description || '').localeCompare(String(b.description || ''), 'es')
      );
    }

    return (
      (aOrd - bOrd) ||
      String(a.description || '').localeCompare(String(b.description || ''), 'es')
    );
  };
}

/***********************
 * DROPDOWN CATEGORÍAS (desktop)
 ***********************/
function closeCategoriesMenu() {
  const menu = $('categoriesMenu');
  if (menu) menu.classList.remove('open');
}

function toggleCategoriesMenu() {
  const menu = $('categoriesMenu');
  if (!menu) return;

  const open = menu.classList.contains('open');
  closeUserMenu();
  menu.classList.toggle('open', !open);
}

function renderCategoriesMenu() {
  const menu = $('categoriesMenu');
  if (!menu) return;

  const ordered = getOrderedCategoriesFrom(products);

  menu.innerHTML = `
    <div>
      <label class="dd-toggle-row dd-chip">
        <span>Todos los artículos</span>
        <input type="checkbox" id="ddToggleAll" ${filterAll ? 'checked' : ''}>
      </label>

      <div class="dd-sep"></div>

      <div class="dd-cats-grid">
        ${ordered
          .map(
            (cat) => `
              <label class="dd-chip">
                <span>${cat}</span>
                <input
                  type="checkbox"
                  class="dd-toggle-cat"
                  data-cat="${cat}"
                  ${filterCats.has(cat) ? 'checked' : ''}
                >
              </label>
            `
          )
          .join('')}
      </div>
    </div>
  `;

  const ddAll = $('ddToggleAll');
  if (ddAll) {
    ddAll.addEventListener('change', () => {
      filterAll = ddAll.checked;
      if (filterAll) filterCats.clear();
      if (!filterAll && filterCats.size === 0) filterAll = true;

      renderCategoriesMenu();
      renderCategoriesSidebar();
      renderProducts();
    });
  }

  menu.querySelectorAll('.dd-toggle-cat').forEach((inp) => {
    inp.addEventListener('change', () => {
      const cat = inp.dataset.cat;
      if (inp.checked) filterCats.add(cat);
      else filterCats.delete(cat);

      if (filterCats.size > 0) filterAll = false;
      if (filterCats.size === 0) filterAll = true;

      renderCategoriesMenu();
      renderCategoriesSidebar();
      renderProducts();
    });
  });
}

/***********************
 * SIDEBAR CATEGORÍAS (desktop)
 ***********************/
function renderCategoriesSidebar() {
  const list = $('categoriesSidebarList');
  if (!list) return;

  const ordered = getOrderedCategoriesFrom(products);

  list.innerHTML = `
    <label class="toggle-row ${filterAll ? 'active' : ''}">
      <span class="toggle-text">Todos los artículos</span>
      <input type="checkbox" id="toggleAll" ${filterAll ? 'checked' : ''}>
      <span class="toggle-ui"></span>
    </label>

    <div class="toggle-sep"></div>

    ${ordered
      .map(
        (cat) => `
          <label class="toggle-row ${filterCats.has(cat) ? 'active' : ''}">
            <span class="toggle-text">${cat}</span>
            <input
              type="checkbox"
              class="toggle-cat"
              data-cat="${cat}"
              ${filterCats.has(cat) ? 'checked' : ''}
            >
            <span class="toggle-ui"></span>
          </label>
        `
      )
      .join('')}
  `;

  const all = $('toggleAll');
  if (all) {
    all.addEventListener('change', () => {
      filterAll = all.checked;
      if (filterAll) filterCats.clear();
      if (!filterAll && filterCats.size === 0) filterAll = true;

      renderCategoriesSidebar();
      renderCategoriesMenu?.();
      renderProducts();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  list.querySelectorAll('.toggle-cat').forEach((inp) => {
    inp.addEventListener('change', () => {
      const cat = inp.dataset.cat;
      if (inp.checked) filterCats.add(cat);
      else filterCats.delete(cat);

      if (filterCats.size > 0) filterAll = false;
      if (filterCats.size === 0) filterAll = true;

      renderCategoriesSidebar();
      renderCategoriesMenu?.();
      renderProducts();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

/***********************
 * USER MENU
 ***********************/
function closeUserMenu() {
  const menu = $('userMenu');
  if (!menu) return;
  menu.classList.remove('open');
  menu.setAttribute('aria-hidden', 'true');
}

function toggleUserMenu() {
  const menu = $('userMenu');
  if (!menu) return;

  const open = menu.classList.contains('open');
  closeCategoriesMenu();
  menu.classList.toggle('open', !open);
  menu.setAttribute('aria-hidden', (!open) ? 'false' : 'true');
}

/***********************
 * PERFIL (UI)
 ***********************/
function waLink(msg) {
  const text = encodeURIComponent(String(msg || '').trim());
  return `https://wa.me/5491131181021?text=${text}`;
}

async function loadMyOrdersUI(limit = 3, targetId = 'myOrdersRecentBox', showMoreButton = true) {
  const box = $(targetId);
  if (!box) return;

  if (!currentSession || !customerProfile?.id) {
    box.innerHTML = 'Iniciá sesión para ver tus pedidos.';
    return;
  }

  box.innerHTML = 'Cargando…';

  const { data, error } = await supabaseClient
    .from('orders')
    .select('id,created_at,status,total,payment_method')
    .eq('customer_id', customerProfile.id)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Number(limit) || 3));

  if (error) {
    box.innerHTML = 'No se pudieron cargar los pedidos.';
    return;
  }

  const rows = (data || []);
  if (!rows.length) {
    box.innerHTML = 'Todavía no tenés pedidos.';
    return;
  }

  box.innerHTML = `
    <div style="display:grid; gap:10px;">
      ${rows
        .map(
          (o) => `
            <div class="order-card">
              <div class="order-row">
                <div><strong>N°:</strong> ${String(o.id).slice(0, 8).toUpperCase()}</div>
                <div><strong>Fecha:</strong> ${
                  o.created_at ? new Date(o.created_at).toLocaleString('es-AR') : '—'
                }</div>
              </div>

              <div class="order-row">
                <div><strong>Estado:</strong> ${o.status || '—'}</div>
                <div><strong>Total:</strong> $${formatMoney(o.total)}</div>
              </div>

              <div style="display:flex; justify-content:flex-end; margin-top:8px;">
                <button type="button" class="order-repeat" onclick="repeatOrder('${o.id}')">
                  Repetir pedido
                </button>
              </div>
            </div>
          `
        )
        .join('')}
    </div>
  `;

  // (El botón "Ver más" vive en HTML; acá sólo lo ocultamos si no hace falta)
  const moreBtn = $('btnOrdersMore');
  if (moreBtn) moreBtn.style.display = showMoreButton ? 'inline-flex' : 'none';
}

async function loadMyOrdersFullUI() {
  const box = $('myOrdersBox');
  if (!box) return;

  if (!currentSession || !customerProfile?.id) {
    box.innerHTML = 'Iniciá sesión para ver tus pedidos.';
    return;
  }

  box.innerHTML = 'Cargando…';

  const { data, error } = await supabaseClient
    .from('orders')
    .select('id,created_at,status,total,payment_method')
    .eq('customer_id', customerProfile.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    box.innerHTML = 'No se pudieron cargar los pedidos.';
    return;
  }

  const rows = (data || []);
  if (!rows.length) {
    box.innerHTML = 'Todavía no tenés pedidos.';
    return;
  }

  box.innerHTML = `
    <div style="display:grid; gap:10px;">
      ${rows
        .map(
          (o) => `
            <div class="order-card">
              <div class="order-row">
                <div><strong>N°:</strong> ${String(o.id).slice(0, 8).toUpperCase()}</div>
                <div><strong>Fecha:</strong> ${
                  o.created_at ? new Date(o.created_at).toLocaleString('es-AR') : '—'
                }</div>
              </div>

              <div class="order-row">
                <div><strong>Estado:</strong> ${o.status || '—'}</div>
                <div><strong>Total:</strong> $${formatMoney(o.total)}</div>
              </div>

              <div style="display:flex; justify-content:flex-end; margin-top:8px;">
                <button type="button" class="order-repeat" onclick="repeatOrder('${o.id}')">
                  Repetir pedido
                </button>
              </div>
            </div>
          `
        )
        .join('')}
    </div>
  `;
}

async function loadMyAddressesUI() {
  const box = $('myAddressesBox');
  if (!box) return;

  if (!currentSession || !customerProfile?.id) {
    box.innerHTML = 'Iniciá sesión para ver tus sucursales.';
    return;
  }

  box.innerHTML = 'Cargando…';

  const { data, error } = await supabaseClient
    .from('customer_delivery_addresses')
    .select('slot,label')
    .eq('customer_id', customerProfile.id)
    .order('slot', { ascending: true });

  if (error) {
    box.innerHTML = 'No se pudieron cargar las sucursales.';
    return;
  }

  const rows = (data || []);
  if (!rows.length) {
    box.innerHTML = 'No tenés sucursales cargadas.';
    return;
  }

  box.innerHTML = `
    <div style="display:grid; gap:8px;">
      ${rows.map(r => `
        <div style="border:1px solid #eee; border-radius:10px; padding:10px;">
          <strong>${r.slot}:</strong> ${r.label || ''}
        </div>
      `).join('')}
    </div>
  `;
}

async function changePasswordUI() {
  const s = $('passStatus');
  const p1 = ($('newPass1')?.value || '').trim();
  const p2 = ($('newPass2')?.value || '').trim();

  if (!s) return;
  s.textContent = '';

  if (!currentSession) {
    s.textContent = 'Tenés que iniciar sesión.';
    return;
  }

  if (!p1 || p1.length < 6) {
    s.textContent = 'La contraseña debe tener al menos 6 caracteres.';
    return;
  }

  if (p1 !== p2) {
    s.textContent = 'Las contraseñas no coinciden.';
    return;
  }

  const { error } = await supabaseClient.auth.updateUser({ password: p1 });

  if (error) {
    s.textContent = 'No se pudo cambiar la contraseña.';
    return;
  }

  s.textContent = 'Contraseña actualizada.';
  if ($('newPass1')) $('newPass1').value = '';
  if ($('newPass2')) $('newPass2').value = '';
}


/***********************
 * PERFIL: MODALES + ACCORDIONS + REPETIR PEDIDO
 ***********************/
function openPassModal() {
  const m = $('passModal');
  if (!m) return;
  m.classList.add('open');
  m.setAttribute('aria-hidden', 'false');
  const st = $('passStatus');
  if (st) st.textContent = '';
  if ($('newPass1')) $('newPass1').value = '';
  if ($('newPass2')) $('newPass2').value = '';
}

function closePassModal() {
  const m = $('passModal');
  if (!m) return;
  m.classList.remove('open');
  m.setAttribute('aria-hidden', 'true');
}

function openOrdersModal() {
  const m = $('ordersModal');
  if (!m) return;
  m.classList.add('open');
  m.setAttribute('aria-hidden', 'false');
  loadMyOrdersFullUI();
}

function closeOrdersModal() {
  const m = $('ordersModal');
  if (!m) return;
  m.classList.remove('open');
  m.setAttribute('aria-hidden', 'true');
}

window.openPassModal = openPassModal;
window.closePassModal = closePassModal;
window.openOrdersModal = openOrdersModal;
window.closeOrdersModal = closeOrdersModal;

function initProfileAccordions() {
  document.querySelectorAll('.profile-acc-head').forEach((btn) => {
    if (btn.__accInit) return;
    btn.__accInit = true;

    btn.addEventListener('click', () => {
      const key = btn.dataset.acc;
      const body = document.getElementById('accBody_' + key);
      if (!body) return;

      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));

      if (expanded) body.setAttribute('hidden', '');
      else body.removeAttribute('hidden');
    });
  });
}

async function repeatOrder(orderId) {
  try {
    if (!currentSession) { openLogin(); return; }
    if (!orderId) return;

    setOrderStatus('Cargando pedido para repetir…');

    const { data, error } = await supabaseClient
      .from('order_items')
      .select('product_id,cajas')
      .eq('order_id', orderId);

    if (error) {
      setOrderStatus('No se pudo repetir el pedido (items).', 'err');
      return;
    }

    const rows = (data || []);
    if (!rows.length) {
      setOrderStatus('Ese pedido no tiene renglones.', 'err');
      return;
    }

    // Reemplaza el carrito actual
    cart.splice(0, cart.length);

    rows.forEach((r) => {
      const pid = String(r.product_id);
      const cajas = Math.max(0, Number(r.cajas || 0));
      if (!pid || cajas <= 0) return;
      cart.push({ productId: pid, qtyCajas: cajas });
    });

    // Asegurar productos cargados
    if (!products || !products.length) await loadProductsFromDB();

    renderProducts();
    updateCart();

    closeOrdersModal();
    showSection('carrito');
    setOrderStatus('Pedido cargado en el carrito. Revisalo y confirmá.', 'ok');
  } catch (e) {
    console.error('repeatOrder error:', e);
    setOrderStatus('No se pudo repetir el pedido.', 'err');
  }
}
window.repeatOrder = repeatOrder;


async function openProfile() {
  if (!currentSession) { openLogin(); return; }
  showSection('perfil');

  // Datos perfil (arriba)
  if ($('pf_business')) $('pf_business').innerText = (customerProfile?.business_name || '—').trim() || '—';
  if ($('pf_codcliente')) $('pf_codcliente').innerText = (customerProfile?.cod_cliente || '—').trim() || '—';
  if ($('pf_cuit')) $('pf_cuit').innerText = (customerProfile?.cuit || '—').trim() || '—';
  if ($('pf_mail')) $('pf_mail').innerText = (customerProfile?.mail || '—').trim() || '—';
  if ($('pf_dto')) $('pf_dto').innerText = ((Number(customerProfile?.dto_vol || 0) * 100).toFixed(1).replace('.', ',') + '%');

  initProfileAccordions();

  // Contenidos (por defecto NO desplegados, pero dejamos precargado)
  await loadMyOrdersUI(3, 'myOrdersRecentBox', true);
  await loadMyAddressesUI();
}
window.openProfile = openProfile;

/***********************
 * BUSCADOR
 ***********************/
function setSearchInputValue(val) {
  const inp = $('productsSearch');
  if (inp) inp.value = val || '';
}

function getFilteredProducts() {
  if (searchTerm && String(searchTerm).trim()) {
    const term = normalizeText(searchTerm);

    return products.filter((p) => {
      const hay = [p.cod, p.description].map(normalizeText).join(' ');
      return hay.includes(term);
    });
  }

  let list = products.slice();
  if (!filterAll) {
    list = list.filter((p) => filterCats.has(String(p.category || '').trim()));
  }
  return list;
}

/***********************
 * RENDER PRODUCTS  ✅ (FIX SORT REAL)
 ***********************/
function renderProducts() {
  const container = $('productsContainer');
  if (!container) return;

  container.innerHTML = '';

  const logged = !!currentSession;
  const list =
    typeof getFilteredProducts === 'function' ? getFilteredProducts() : products;

  if (!list.length) {
    container.innerHTML = `
      <div style="padding:24px 40px; color:#666; font-size:14px;">
        Sin resultados${
          typeof searchTerm === 'string' && searchTerm.trim()
            ? ` para "${String(searchTerm).trim()}"`
            : ''
        }.
      </div>
    `;
    return;
  }

  const buildCard = (p) => {
    const pid = String(p.id);
    const codSafe = String(p.cod || '').trim();

    const imgSrc = `${BASE_IMG}${encodeURIComponent(codSafe)}.jpg?v=${encodeURIComponent(
      IMG_VERSION
    )}`;
    const imgFallback = 'img/no-image.jpg';

    const tuPrecio = logged ? unitYourPrice(p.list_price) : 0;
    const isNuevo =
      p.ranking === null || p.ranking === undefined || String(p.ranking).trim() === '';

    const inCart = cart.find((i) => String(i.productId) === String(pid));
    const qty = inCart ? Number(inCart.qtyCajas || 0) : 0;
    const totalUni = qty * Number(p.uxb || 0);

    return `
      <div class="product-card" id="card-${pid}">
        ${isNuevo ? '<div class="badge-nuevo">NUEVO</div>' : ''}

        <img
          id="img-${pid}"
          src="${imgSrc}"
          alt="${String(p.description || '')}"
          onerror="this.onerror=null;this.src='${imgFallback}'"
        >

        <div class="card-top">
          <div class="card-row">
            <div class="card-cod">Cod: <span>${codSafe}</span></div>
            <div class="card-uxb">UxB: <span>${p.uxb}</span></div>
          </div>

          <div class="card-desc">${String(p.description || '')}</div>

          <div class="${logged ? '' : 'price-hidden'} card-prices">
            <div class="card-price-line">
              Precio Lista: <strong>$${formatMoney(p.list_price)}</strong>
            </div>
            <div class="card-price-line">
              Tu Precio: <strong>$${formatMoney(tuPrecio)}</strong>
            </div>
          </div>

          <div class="${logged ? 'price-hidden' : ''} card-prices">
            <div class="price-locked">Inicia sesión para ver precios</div>
          </div>
        </div>

        ${
          qty <= 0
            ? `
              <button class="add-btn" id="add-${pid}" onclick="addFirstBox('${pid}')">
                Agregar al pedido
              </button>
            `
            : `
              <div class="card-cartbar" id="qty-${pid}">
                <div class="cartbar-top">
                  <div class="cartbar-label">Subtotal</div>
                  <div class="cartbar-subtotal">
                    <strong class="cartbar-subv">
                      $${formatMoney(
                        logged ? unitYourPrice(p.list_price) * (qty * Number(p.uxb || 0)) : 0
                      )}
                    </strong>
                    <span class="cartbar-iva">+ IVA</span>
                  </div>
                </div>

                <div class="cartbar-controls">
                  <div class="cartbar-left">
                    <div class="cartbar-stepper">
                      <button type="button" class="step-btn" onclick="changeQty('${pid}', -1)">−</button>
                      <input
                        class="step-input"
                        type="number"
                        min="1"
                        step="1"
                        value="${qty}"
                        inputmode="numeric"
                        onchange="manualQty('${pid}', this.value)"
                      >
                      <button type="button" class="step-btn" onclick="changeQty('${pid}', 1)">+</button>
                    </div>

                    <button type="button" class="chip chip-5" onclick="changeQty('${pid}', 5)">+5</button>
                  </div>
                </div>

                <div class="cartbar-units">
                  Unidades: <strong>${formatMoney(totalUni)}</strong>
                </div>

                <button type="button" class="remove-btn remove-compact" onclick="removeItem('${pid}')">
                  Quitar
                </button>
              </div>
            `
        }
      </div>
    `;
  };

   // ✅ SOLO bestsellers en grilla global (opcional)
if (sortMode === 'bestsellers') {
  let items = [...list];
  items.sort(getSortComparator());

  container.innerHTML = `
    <div class="products-grid">
      ${items.map(buildCard).join('')}
    </div>
  `;
  return;
}

// ✅ Para price_asc / price_desc: NO global.
// Sigue el render por categorías (más abajo) y ordena dentro de cada categoría.

  // ✅ Modo category (bloques por categoría)
  const cats = getOrderedCategoriesFrom(list);

  cats.forEach((category) => {
    const block = document.createElement('div');
    block.className = 'category-block';

    const catId = `cat-${slugifyCategory(category)}`;

    let items = list.filter(
      (p) => String(p.category || '').trim() === String(category).trim()
    );

    // category: ordenar dentro de cada categoría
    items = items.sort(getSortComparator());

    if (!items.length) return;

    let cardsHtml = '';

    if (String(category).trim().toLowerCase() === 'utensilios') {
      const groups = new Map();

      items.forEach((p) => {
        const key =
          p.subcategory && String(p.subcategory).trim() ? String(p.subcategory).trim() : 'Otros';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(p);
      });

      const present = Array.from(groups.keys());
      const fixed = UTENSILIOS_SUB_ORDER.filter((s) => present.includes(s));

      const extras = present
        .filter((s) => s !== 'Otros' && !UTENSILIOS_SUB_ORDER.includes(s))
        .sort((a, b) => a.localeCompare(b, 'es'));

      const hasOtros = present.includes('Otros');
      const subcatsOrdered = [...fixed, ...extras, ...(hasOtros ? ['Otros'] : [])];

      cardsHtml = subcatsOrdered
        .map((sub) => {
          const prods = groups.get(sub) || [];
          prods.sort(getSortComparator());

          const subtitle = `
            <div style="
              grid-column: 1 / -1;
              font-size: 26px;
              font-weight: bold;
              margin: 40px 40px 20px;
              border-bottom: 1px solid #ddd;
              padding-bottom: 6px;
              background: #fff;
            ">${sub}</div>
          `;

          const cards = prods.map(buildCard).join('');
          return subtitle + cards;
        })
        .join('');
    } else {
      cardsHtml = items.map(buildCard).join('');
    }

    block.innerHTML = `
      <h2 class="category-title" id="${catId}">${category}</h2>
      <div class="products-grid">
        ${cardsHtml}
      </div>
    `;

    container.appendChild(block);
  });

  if (!container.children.length) {
    container.innerHTML = `
      <div style="padding:24px 40px; color:#666; font-size:14px;">
        Sin resultados${
          typeof searchTerm === 'string' && searchTerm.trim()
            ? ` para "${String(searchTerm).trim()}"`
            : ''
        }.
      </div>
    `;
  }
}

/***********************
 * MOBILE FILTERS OVERLAY
 ***********************/
function openFiltersOverlay() {
  const ov = $('filtersOverlay');
  if (!ov) return;

  pendingFilterAll = filterAll;
  pendingFilterCats = new Set(filterCats);

  renderFiltersOverlayUI();

  ov.classList.add('open');
  ov.setAttribute('aria-hidden', 'false');
}

function closeFiltersOverlay() {
  const ov = $('filtersOverlay');
  if (!ov) return;

  ov.classList.remove('open');
  ov.setAttribute('aria-hidden', 'true');
}

function applyPendingFilters() {
  filterAll = pendingFilterAll;
  filterCats = new Set(pendingFilterCats);

  renderCategoriesMenu();
  renderCategoriesSidebar();
  renderProducts();

  closeFiltersOverlay();
}

function cancelPendingFilters() {
  closeFiltersOverlay();
}

function renderFiltersOverlayUI() {
  const grid = $('filtersGrid');
  if (!grid) return;

  const ordered = getOrderedCategoriesFrom(products);
  const isOn = (cat) => pendingFilterCats.has(cat);

  grid.innerHTML = `
    <button type="button" class="mf-btn ${pendingFilterAll ? 'on' : ''}" data-all="1">
      Todos los artículos
    </button>

    ${ordered
      .map(
        (cat) => `
          <button type="button" class="mf-btn ${isOn(cat) ? 'on' : ''}" data-cat="${cat}">
            ${cat}
          </button>
        `
      )
      .join('')}
  `;

  grid.querySelectorAll('.mf-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const isAll = btn.dataset.all === '1';
      const cat = btn.dataset.cat;

      if (isAll) {
        pendingFilterAll = true;
        pendingFilterCats.clear();
      } else {
        pendingFilterAll = false;

        if (pendingFilterCats.has(cat)) pendingFilterCats.delete(cat);
        else pendingFilterCats.add(cat);

        if (pendingFilterCats.size === 0) {
          pendingFilterAll = true;
        }
      }

      renderFiltersOverlayUI();
    });
  });
}

/***********************
 * DELIVERY OPTIONS (DB)
 ***********************/
function resetShippingSelect() {
  const sel = $('shippingSelect');
  if (!sel) return;

  sel.innerHTML = `<option value="" selected>Elegir</option>`;
  deliveryChoice = { slot: '', label: '' };
}

async function loadDeliveryOptions() {
  const sel = $('shippingSelect');
  if (!sel) return;

  resetShippingSelect();

  if (!currentSession || !customerProfile?.id) return;

  const { data, error } = await supabaseClient
    .from('customer_delivery_addresses')
    .select('slot,label')
    .eq('customer_id', customerProfile.id)
    .order('slot', { ascending: true });

  if (error) {
    console.error('delivery options error:', error);
    return;
  }

  (data || []).forEach((row) => {
    const opt = document.createElement('option');
    opt.value = String(row.slot);
    opt.textContent = `${row.slot}: ${row.label}`;
    opt.dataset.label = row.label || '';
    sel.appendChild(opt);
  });

  updateCart();
}

/***********************
 * CART
 ***********************/
function addFirstBox(productId) {
  if (!currentSession) {
    openLogin();
    return;
  }

  const existing = cart.find((i) => i.productId === productId);
  if (existing) existing.qtyCajas += 1;
  else {
    cart.push({ productId, qtyCajas: 1 });
    toggleControls(productId, true);
  }

  updateCart();
  renderProducts();
}

function changeQty(productId, delta) {
  const item = cart.find((i) => i.productId === productId);
  if (!item) return;

  item.qtyCajas += delta;

  if (item.qtyCajas <= 0) {
    removeItem(productId);
    return;
  }

  const input = document.querySelector(`#qty-${CSS.escape(productId)} input`);
  if (input) input.value = item.qtyCajas;

  updateCart();
  renderProducts();
}

function manualQty(productId, value) {
  const qty = Math.max(0, parseInt(value, 10) || 0);

  const item = cart.find((i) => i.productId === productId);
  if (!item) return;

  if (qty <= 0) {
    removeItem(productId);
    return;
  }

  item.qtyCajas = qty;
  updateCart();
  renderProducts();
}

function removeItem(productId) {
  const idx = cart.findIndex((i) => i.productId === productId);
  if (idx >= 0) cart.splice(idx, 1);

  toggleControls(productId, false);
  updateCart();
  renderProducts();
}

function toggleControls(productId, show) {
  const addBtn = $(`add-${productId}`);
  const qtyWrap = $(`qty-${productId}`);

  if (addBtn) addBtn.style.display = show ? 'none' : 'inline-block';
  if (qtyWrap) qtyWrap.style.display = show ? 'block' : 'none';
}

function calcTotals() {
  const logged = !!currentSession;
  const paymentDiscount = getPaymentDiscount();

  let subtotal = 0;

  if (logged) {
    cart.forEach((item) => {
      const p = products.find((x) => String(x.id) === String(item.productId));
      if (!p) return;

      const totalUni = item.qtyCajas * Number(p.uxb || 0);
      subtotal += unitYourPrice(p.list_price) * totalUni;
    });
  }

  let totalNoDiscount = 0;
  cart.forEach((item) => {
    const p = products.find((x) => String(x.id) === String(item.productId));
    if (!p) return;

    const totalUni = item.qtyCajas * Number(p.uxb || 0);
    totalNoDiscount += Number(p.list_price || 0) * totalUni;
  });

  const webDiscountValue = subtotal * WEB_ORDER_DISCOUNT;
  const afterWeb = subtotal - webDiscountValue;

  const paymentDiscountValue = afterWeb * paymentDiscount;
  const finalTotal = afterWeb - paymentDiscountValue;

  const totalDiscounts = Math.max(0, totalNoDiscount - finalTotal);

  return {
    logged,
    paymentDiscount,
    subtotal,
    totalNoDiscount,
    webDiscountValue,
    paymentDiscountValue,
    finalTotal,
    totalDiscounts,
  };
}

function updateCart() {
  const cartDiv = $('cart');
  if (!cartDiv) return;

  const t = calcTotals();

  if (!cart.length) {
    cartDiv.innerHTML = `<div style="padding:14px; text-align:center; color:#666;">Carrito vacío</div>`;
  } else {
    let rows = '';

    cart.forEach((item) => {
      const p = products.find((x) => String(x.id) === String(item.productId));
      if (!p) return;

      const totalCajas = item.qtyCajas;
      const totalUni = totalCajas * Number(p.uxb || 0);

      const tuPrecioUnit = t.logged ? unitYourPrice(p.list_price) : 0;
      const lineTotal = t.logged ? tuPrecioUnit * totalUni : 0;

      rows += `
        <tr>
          <td><strong>${String(p.cod || '')}</strong></td>
          <td class="desc">${splitTwoWords(p.description)}</td>
          <td>${formatMoney(totalCajas)}</td>
          <td>${formatMoney(totalUni)}</td>
          <td>${t.logged ? '$' + formatMoney(tuPrecioUnit) : '—'}</td>
          <td><strong>${t.logged ? '$' + formatMoney(lineTotal) : '—'}</strong></td>
        </tr>
      `;
    });

    cartDiv.innerHTML = `
      <table class="cart-table">
        <colgroup>
          <col class="cod">
          <col class="desc">
          <col class="cajas">
          <col class="uni">
          <col class="tp">
          <col class="total">
        </colgroup>

        <thead>
          <tr>
            <th>${headerTwoLine('Cod')}</th>
            <th>${headerTwoLine('Descripción')}</th>
            <th>${headerTwoLine('Total Cajas')}</th>
            <th>${headerTwoLine('Total Uni')}</th>
            <th>${headerTwoLine('Tu Precio')}</th>
            <th>${headerTwoLine('Total $')}</th>
          </tr>
        </thead>

        <tbody>${rows}</tbody>
      </table>
    `;
  }

  $('subtotal') && ($('subtotal').innerText = formatMoney(t.subtotal));
  $('webDiscountValue') && ($('webDiscountValue').innerText = formatMoney(t.webDiscountValue));
  $('paymentDiscountValue') &&
    ($('paymentDiscountValue').innerText = formatMoney(t.paymentDiscountValue));
  $('total') && ($('total').innerText = formatMoney(t.finalTotal));

  if ($('pedidoTotalHeader')) $('pedidoTotalHeader').innerText = formatMoney(t.finalTotal);

  if ($('paymentDiscountPercent')) {
    $('paymentDiscountPercent').innerText = (t.paymentDiscount * 100).toFixed(0) + '%';
  }

  $('totalNoDiscount') && ($('totalNoDiscount').innerText = formatMoney(t.totalNoDiscount));
  $('totalDiscounts') && ($('totalDiscounts').innerText = formatMoney(t.totalDiscounts));

  let count = 0;
  cart.forEach((i) => (count += i.qtyCajas));
  $('cartCount') && ($('cartCount').innerText = count);
  $('mobileCartCount') && ($('mobileCartCount').innerText = count);

  const btn = $('submitOrderBtn');
  if (btn) {
    const mustChooseDelivery = !deliveryChoice.slot;
    const canConfirm = !!currentSession && cart.length > 0 && !mustChooseDelivery;

    btn.disabled = !canConfirm;

    if (!!currentSession && cart.length > 0 && mustChooseDelivery) {
      setOrderStatus('Elegí una opción de Entrega para poder confirmar el pedido.', 'err');
    } else if (btn.disabled === false) {
      setOrderStatus('');
    }
  }
}

/***********************
 * SEND TO SHEETS + SUBMIT ORDER
 ***********************/
async function sendOrderToSheets({ codCliente, vend, condicionPago, sucursalEntrega, items }) {
  if (!SHEETS_WEBAPP_URL || !SHEETS_SECRET) return;

  const payload = {
    secret: SHEETS_SECRET,
    cod_cliente: String(codCliente || '').trim(),
    vend: String(vend || '').trim(),
    condicion_pago: String(condicionPago || '').trim(),
    sucursal_entrega: String(sucursalEntrega || '').trim(),
    items: (items || []).map((it) => ({
      cod_art: String(it.cod_art || '').trim(),
      cajas: Number(it.cajas || 0),
      uxb: Number(it.uxb || 0),
    })),
  };

  await fetch(SHEETS_WEBAPP_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });
}

async function withTimeout(promise, ms, label = 'timeout') {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`Timeout (${ms}ms) en ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(t);
  }
}

function debugStep(txt) {
  console.log('[ORDER]', txt);
  setOrderStatus(txt, '');
}

async function submitOrder() {
  try {
    setOrderStatus('');

    if (window.__submittingOrder) return;
    window.__submittingOrder = true;

    if (!currentSession) {
      openLogin();
      return;
    }

    if (isAdmin) {
      setOrderStatus('Modo Administrador: no se puede confirmar pedidos desde esta vista.', 'err');
      return;
    }

    if (!customerProfile?.id) {
      setOrderStatus('No se encontró el perfil del cliente.', 'err');
      return;
    }

    if (!cart.length) {
      setOrderStatus('Carrito vacío.', 'err');
      return;
    }

    if (!deliveryChoice.slot) {
      setOrderStatus('Elegí una opción de Entrega para poder confirmar el pedido.', 'err');
      return;
    }

    const btn = $('submitOrderBtn');
    if (btn) btn.disabled = true;

    const t = calcTotals();

    const orderPayload = {
      auth_user_id: currentSession.user.id,
      customer_id: customerProfile.id,
      status: 'pendiente',
      payment_method: getPaymentMethodText(),
      payment_discount: Number(t.paymentDiscount || 0),
      web_discount: WEB_ORDER_DISCOUNT,
      subtotal: Number(t.subtotal || 0),
      total: Number(t.finalTotal || 0),
    };

    if (typeof debugStep === 'function') debugStep('Confirmando pedido… (cabecera)');

    const res = await supabaseClient.from('orders').insert(orderPayload).select('id').single();

    const orderRow = res.data;
    const orderErr = res.error;

    if (orderErr || !orderRow?.id) {
      const msg =
        orderErr?.message || orderErr?.details || orderErr?.hint || JSON.stringify(orderErr || {});
      setOrderStatus(`No se pudo confirmar el pedido (cabecera): ${msg}`, 'err');
      if (btn) btn.disabled = false;
      return;
    }

    const orderId = orderRow.id;

    const itemsPayload = cart
      .map((item) => {
        const p = products.find((x) => String(x.id) === String(item.productId));
        if (!p) return null;

        const cajas = Number(item.qtyCajas || 0);
        const uxb = Number(p.uxb || 0);

        const unitList = Number(p.list_price || 0);
        const unitYour = Number(unitYourPrice(p.list_price) || 0);

        const lineTotal = unitYour * (cajas * uxb);

        return {
          order_id: orderId,
          product_id: p.id,
          cajas,
          uxb,
          unit_list_price: unitList,
          unit_your_price: unitYour,
          line_total: lineTotal,
        };
      })
      .filter(Boolean);

    if (typeof debugStep === 'function') debugStep('Confirmando pedido… (renglones)');

    const { error: itemsErr } = await withTimeout(
      supabaseClient.from('order_items').insert(itemsPayload),
      45000,
      'insert order_items'
    );

    if (itemsErr) {
      const msg =
        itemsErr?.message || itemsErr?.details || itemsErr?.hint || JSON.stringify(itemsErr || {});
      setOrderStatus(`Pedido creado pero fallaron los renglones: ${msg}`, 'err');
      if (btn) btn.disabled = false;
      return;
    }

    sendOrderToSheets({
      codCliente: customerProfile?.cod_cliente,
      vend: customerProfile?.vend || '',
      condicionPago: getPaymentMethodText(),
      sucursalEntrega: deliveryChoice?.label || '',
      items: itemsPayload.map((it) => ({
        cod_art: products.find((p) => String(p.id) === String(it.product_id))?.cod || '',
        cajas: it.cajas,
        uxb: it.uxb,
      })),
    }).catch((e) => console.warn('Sheets error:', e));

    cart.splice(0, cart.length);
    products.forEach((p) => toggleControls(String(p.id), false));

    updateCart();
    setOrderStatus(`Pedido confirmado. N°: ${String(orderId).slice(0, 8).toUpperCase()}`, 'ok');
  } catch (e) {
    const msg =
      e && (e.message || e.toString()) ? e.message || e.toString() : 'Error desconocido';
    setOrderStatus(`Error confirmando el pedido: ${msg}`, 'err');
  } finally {
    window.__submittingOrder = false;
    const btn = $('submitOrderBtn');
    if (btn) btn.disabled = false;
  }
}

async function openMyOrders() {
  await openProfile();
}
window.openMyOrders = openMyOrders;

function openChangePassword() {
  if (!currentSession) { openLogin(); return; }
  openPassModal();
  closeUserMenu();
}
window.openChangePassword = openChangePassword;

/***********************
 * INIT (arranque de la web) — CORREGIDO ✅
 ***********************/
document.addEventListener('DOMContentLoaded', async () => {
  // Exponer funciones al HTML (onclick)
  window.showSection = showSection;
  window.goToProductsTop = goToProductsTop;
  window.openLogin = openLogin;
  window.closeLogin = closeLogin;
  window.login = login;
  window.logout = logout;

  window.addFirstBox = addFirstBox;
  window.changeQty = changeQty;
  window.manualQty = manualQty;
  window.removeItem = removeItem;
  window.updateCart = updateCart;
  window.submitOrder = submitOrder;

  // =============================
  // SORT (desktop botones + selects + mobile) ✅ ÚNICO BLOQUE
  // =============================
  function applySortUI() {
    const wrap = $('desktopSortButtons');
    if (wrap) {
      wrap.querySelectorAll('.ds-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.sort === sortMode);
      });
    }

    const s1 = $('sortSelect');
    if (s1) s1.value = sortMode;

    const s2 = $('mobileSortSelect');
    if (s2) s2.value = sortMode;
  }

  async function setSortMode(next) {
    sortMode = String(next || 'category');
    applySortUI();

    await loadProductsFromDB();
    renderProducts();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  $('desktopSortButtons')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.ds-btn');
    if (!btn) return;
    await setSortMode(btn.dataset.sort);
  });

  $('sortSelect')?.addEventListener('change', async (e) => {
    await setSortMode(e.target.value);
  });

  $('mobileSortSelect')?.addEventListener('change', async (e) => {
    await setSortMode(e.target.value);
  });

  applySortUI();

  // CUIT live format
  function formatCUITLive(value) {
    const d = String(value || '').replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 10) return `${d.slice(0, 2)}-${d.slice(2)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
  }

  const cuitEl = $('cuitInput');
  if (cuitEl) {
    cuitEl.addEventListener('input', (e) => {
      const el = e.target;
      const start = el.selectionStart;
      const before = el.value;

      el.value = formatCUITLive(el.value);

      const diff = el.value.length - before.length;
      const next = (start ?? el.value.length) + diff;
      el.setSelectionRange(next, next);
    });
  }

  // Menú categorías
  $('categoriesBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleCategoriesMenu();
  });

  // ✅ MENÚ USUARIO DESKTOP
  const profileBtnEl = $('profileBtn');
  const helloBtnEl = $('helloNavBtn');
  const userMenuEl = $('userMenu');

  if (profileBtnEl) {
    profileBtnEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleUserMenu();
    });
  }

  if (helloBtnEl) {
    helloBtnEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleUserMenu();
    });
  }

  // Pago (botones)
  $('paymentButtons')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.pay-btn');
    if (!btn) return;
    setPaymentByValue(btn.dataset.value);
  });

  // Pago (select)
  $('paymentSelect')?.addEventListener('change', () => {
    syncPaymentButtons();
    updateCart();
  });

  // Mobile: carrito -> Pedido
  $('mobileCartBtn')?.addEventListener('click', () => {
    showSection('carrito');
  });

  // Mobile: avatar -> dropdown (si no logueado => login)
  $('mobileProfileBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentSession) {
      openLogin();
      return;
    }
    toggleMobileUserMenu();
  });

  // PERFIL: botones
  $('btnAddAddress')?.addEventListener('click', () => {
    const name = (customerProfile?.business_name || '').trim();
    const cod = (customerProfile?.cod_cliente || '').trim();
    const msg = `Hola! Soy ${name}${cod ? ` (Cod Cliente ${cod})` : ''}. Quiero agregar una sucursal de entrega.`;
    window.open(waLink(msg), '_blank', 'noopener');
  });

  $('btnReportError')?.addEventListener('click', () => {
    const name = (customerProfile?.business_name || '').trim();
    const cod = (customerProfile?.cod_cliente || '').trim();
    const msg = `Hola! Soy ${name}${cod ? ` (Cod Cliente ${cod})` : ''}. Quiero avisar que hay un error en la web mayorista.`;
    window.open(waLink(msg), '_blank', 'noopener');
  });

  $('btnOpenPassModal')?.addEventListener('click', () => openPassModal());
  $('btnSavePass')?.addEventListener('click', () => changePasswordUI());
  $('btnOrdersMore')?.addEventListener('click', () => openOrdersModal());

  // Entregas
  const shipSel = $('shippingSelect');
  if (shipSel) {
    deliveryChoice = { slot: shipSel.value || '', label: '' };

    shipSel.addEventListener('change', () => {
      const opt = shipSel.options[shipSel.selectedIndex];
      deliveryChoice.slot = shipSel.value || '';
      deliveryChoice.label = opt?.dataset?.label || opt?.textContent || '';
      updateCart();
    });
  }

  // Click afuera: cerrar menús desktop (robusto)
  document.addEventListener('click', (e) => {
    const catBtn = $('categoriesBtn');
    const catMenu = $('categoriesMenu');

    const clickInsideCat =
      (catBtn && catBtn.contains(e.target)) || (catMenu && catMenu.contains(e.target));

    const clickInsideUser =
      (profileBtnEl && profileBtnEl.contains(e.target)) ||
      (helloBtnEl && helloBtnEl.contains(e.target)) ||
      (userMenuEl && userMenuEl.contains(e.target));

    if (!clickInsideCat) closeCategoriesMenu();
    if (!clickInsideUser) closeUserMenu();

    // mobile user menu close
    const mMenu = $('mobileUserMenu');
    const mBtn = $('mobileProfileBtn');
    if (mMenu && mBtn) {
      const insideM = mMenu.contains(e.target) || mBtn.contains(e.target);
      if (!insideM) closeMobileUserMenu();
    }
  });

  // Buscador NAV
  const navSearch = $('navSearch');
  if (navSearch) {
    navSearch.addEventListener('input', () => {
      searchTerm = String(navSearch.value || '').trim();
      renderProducts();
    });
  }

  // Mobile filtros overlay
  $('openFiltersBtn')?.addEventListener('click', () => openFiltersOverlay());
  $('filtersCancelBtn')?.addEventListener('click', () => cancelPendingFilters());
  $('filtersApplyBtn')?.addEventListener('click', () => applyPendingFilters());

  $('filtersOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'filtersOverlay') closeFiltersOverlay();
  });

  // Cargar sesión inicial y productos
  const { data } = await supabaseClient.auth.getSession();
  currentSession = data.session || null;

  await refreshAuthState();
  await loadProductsFromDB();

  renderCategoriesMenu();
  renderCategoriesSidebar();
  renderProducts();
  updateCart();
  syncPaymentButtons();

  // Reactividad login/logout
  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentSession = session;

    searchTerm = '';
    const ns = $('navSearch');
    if (ns) ns.value = '';

    await refreshAuthState();
    await loadProductsFromDB();

    renderCategoriesMenu();
    closeCategoriesMenu();

    renderCategoriesSidebar();
    renderProducts();
    updateCart();

    syncPaymentButtons();
  });
});

