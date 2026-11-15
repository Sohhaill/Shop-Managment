// ====== SUPABASE CONFIG (same values as app.js) ======
const SUPABASE_URL = "https://bebarpebjfqbulerwava.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_to_DWINIxZjm4nB6HdSaUQ_JO5K577U";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ====== SETTINGS (easy to change) ======
const CURRENCY = "Rs";            // shown before every amount
const LOW_STOCK = 5;              // quantity at or below this shows a low-stock warning
const KEEP_DAYS = 30;             // how far back the date picker goes (SQL cleanup also uses 30)
const IMAGE_BUCKET = "product-images";
const MAX_IMAGE_SIDE = 400;       // product images are shrunk to this size (they show ~165px wide, 400 is sharp even on phones)
const IMAGE_QUALITY = 0.7;        // 0 to 1: lower = smaller file (0.7 still looks good for product photos)
const LOGO_MAX_SIDE = 300;        // the shop logo is shown small, 300px is enough for the screen and the PDF
const IMAGE_CACHE = "31536000";   // seconds. File names never repeat, so browsers may keep images for a year (less download)
const SHOP_NAME = "My Shop";       // used on the bill only if no shop name is saved in Shop Info
const SHOP_ADDRESS = "";          // optional line under the shop name on the bill
const SHOP_PHONE = "";            // optional phone number on the bill

// ====== STATE ======
let currentUser = null;
let products = [];
let todaySales = [];
let activeProduct = null;   // product shown in the add-to-sale popup
let editingProduct = null;  // product being edited (null = adding new)

// ====== HELPERS ======
const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function money(n) {
  return CURRENCY + " " + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Local date as YYYY-MM-DD (not UTC, so "today" matches the shop's clock)
function localDate(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

let toastTimer;
function toast(text, type = "success") {
  const t = $("toast");
  t.textContent = text;
  t.className = "toast " + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 3000);
}

function formMsg(id, text, type = "error") {
  const box = $(id);
  box.textContent = text;
  box.className = "message " + type;
}

function imageUrl(path) {
  return supabaseClient.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

function makeThumb(p, size = "") {
  const name = (p && (p.name || p.product_name)) || "?";
  if (p && p.image_path) {
    const img = el("img", "thumb " + size);
    img.alt = name;
    img.loading = "lazy";
    img.src = imageUrl(p.image_path);
    return img;
  }
  return el("div", "thumb thumb-ph " + size, name.charAt(0).toUpperCase());
}

function goLogin() {
  window.location.href = "index.html";
}

// ====== MODALS ======
function openModal(id) { $(id).classList.remove("hidden"); }
function closeModal(id) {
  $(id).classList.add("hidden");
  if (id === "pinModal") cancelPin();      // a closed PIN popup counts as "cancelled"
  if (id === "entryModal") entryPin = null; // forget the PIN when the entry popup closes
  if (id === "balanceModal") balancePin = null; // same for the Balance edit popup
}

document.querySelectorAll(".modal").forEach((m) => {
  m.addEventListener("click", (e) => {
    if (e.target === m || e.target.hasAttribute("data-close")) closeModal(m.id);
  });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.querySelectorAll(".modal").forEach((m) => closeModal(m.id));
});

// ====== TABS ======
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    $("view-" + btn.dataset.view).classList.remove("hidden");
    if (btn.dataset.view === "sales") loadSalesForDate();
    if (btn.dataset.view === "khata") loadKhata();
    if (btn.dataset.view === "balance") loadBalances();
    if (btn.dataset.view === "lowstock") loadProducts(); // fresh numbers every time the tab opens
    if (btn.dataset.view === "pin") loadPinStatus();
    if (btn.dataset.view === "shopinfo") fillShopForm();
  });
});

// ====== PRODUCTS: LOAD + RENDER ======
async function loadProducts() {
  const { data, error } = await supabaseClient.from("products").select("*").order("name");
  if (error) return toast(error.message, "error");
  products = data;
  renderGrid();
  renderBillGrid();
  renderProductsTable();
  renderLowStock();
}

// Home: product cards with search
function renderGrid() {
  const q = $("searchBox").value.trim().toLowerCase();
  const list = products.filter((p) => p.name.toLowerCase().includes(q));
  const grid = $("productGrid");
  grid.innerHTML = "";

  const empty = $("gridEmpty");
  empty.classList.toggle("hidden", list.length > 0);
  empty.textContent = products.length ? "No products found." : "No products yet. Add some in Manage Products.";

  list.forEach((p) => grid.appendChild(productCard(p, () => openSaleModal(p))));
}

// One product card (used on Home and in Generate Bill)
function productCard(p, onAdd, label = "Add") {
  const card = el("div", "product-card");
  card.appendChild(makeThumb(p));
  card.appendChild(el("div", "p-name", p.name));
  card.appendChild(el("div", "p-price", money(p.price)));

  const stock = el("div", "p-stock", p.quantity > 0 ? "In stock: " + p.quantity : "Out of stock");
  if (p.quantity <= 0) stock.classList.add("out");
  else if (p.quantity <= LOW_STOCK) stock.classList.add("low");
  card.appendChild(stock);

  const btn = el("button", "add-btn", p.quantity > 0 ? label : "Out of stock");
  btn.type = "button";
  btn.disabled = p.quantity <= 0;
  btn.addEventListener("click", onAdd);
  card.appendChild(btn);
  return card;
}
$("searchBox").addEventListener("input", renderGrid);

// Manage Products: table
function renderProductsTable() {
  const body = $("productsBody");
  body.innerHTML = "";
  $("productsEmpty").classList.toggle("hidden", products.length > 0);

  products.forEach((p) => {
    const tr = document.createElement("tr");

    const tdImg = document.createElement("td");
    tdImg.appendChild(makeThumb(p, "small"));
    tr.appendChild(tdImg);

    const cells = [
      [p.name, ""],
      [money(p.price), ""],
      [String(p.quantity), p.quantity <= 0 ? "out" : p.quantity <= LOW_STOCK ? "low" : ""],
      [p.description || "-", "desc"],
    ];
    cells.forEach(([text, cls]) => tr.appendChild(el("td", cls, text)));

    const tdAct = el("td", "actions");
    const edit = el("button", "act-btn", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => openProductModal(p));
    const del = el("button", "act-btn danger", "Delete");
    del.type = "button";
    del.addEventListener("click", () => deleteProduct(p, del));
    tdAct.appendChild(edit);
    tdAct.appendChild(del);
    tr.appendChild(tdAct);

    body.appendChild(tr);
  });
}

// ====== ADD TO SALE POPUP ======
function openSaleModal(p) {
  activeProduct = p;
  const wrap = $("smImg");
  wrap.innerHTML = "";
  wrap.appendChild(makeThumb(p, "big"));

  $("smName").textContent = p.name;
  $("smDesc").textContent = p.description || "No description";
  $("smStock").textContent = p.quantity;
  $("smPrice").value = p.price;
  $("smQty").value = 1;
  $("smQty").max = p.quantity;
  formMsg("saleFormMsg", "");
  updateLineTotal();
  openModal("saleModal");
  $("smQty").focus();
  $("smQty").select();
}

function updateLineTotal() {
  const price = parseFloat($("smPrice").value) || 0;
  const qty = parseInt($("smQty").value, 10) || 0;
  $("smTotal").textContent = money(price * qty);
}
$("smPrice").addEventListener("input", updateLineTotal);
$("smQty").addEventListener("input", updateLineTotal);

$("saleForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  formMsg("saleFormMsg", "");

  const price = parseFloat($("smPrice").value);
  const qty = parseInt($("smQty").value, 10);

  if (isNaN(price) || price < 0) return formMsg("saleFormMsg", "Enter a valid price.");
  if (!qty || qty < 1) return formMsg("saleFormMsg", "Enter a valid quantity.");
  if (qty > activeProduct.quantity) {
    return formMsg("saleFormMsg", "Only " + activeProduct.quantity + " in stock.");
  }

  const btn = $("smSubmit");
  btn.disabled = true;
  btn.textContent = "Adding...";

  const { error } = await supabaseClient.rpc("add_sale", {
    p_product_id: activeProduct.id,
    p_quantity: qty,
    p_price: price,
    p_date: localDate(),
  });

  btn.disabled = false;
  btn.textContent = "Add to sale";

  if (error) return formMsg("saleFormMsg", error.message);

  closeModal("saleModal");
  await Promise.all([loadProducts(), loadTodaySales()]);
  toast("Added to today's sale");
});

// ====== TODAY'S SALE (left side of Home) ======
async function loadTodaySales() {
  $("todayLabel").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "short", day: "numeric", month: "short",
  });

  const { data, error } = await supabaseClient
    .from("sales")
    .select("*")
    .eq("sale_date", localDate())
    .order("created_at", { ascending: false });

  if (error) return toast(error.message, "error");
  todaySales = data;
  renderTodaySales();
}

function renderTodaySales() {
  const list = $("saleList");
  list.innerHTML = "";
  $("saleEmpty").classList.toggle("hidden", todaySales.length > 0);

  let total = 0;
  let count = 0;

  todaySales.forEach((s) => {
    total += Number(s.total);
    count += s.quantity;

    const li = el("li", "sale-item");
    const info = el("div", "sale-info");
    info.appendChild(el("div", "sale-name", s.product_name));
    const time = new Date(s.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    info.appendChild(el("div", "muted small", s.quantity + " × " + money(s.unit_price) + "  ·  " + time));
    if (s.description) info.appendChild(el("div", "muted small", s.description));

    const right = el("div", "sale-right");
    right.appendChild(el("strong", "", money(s.total)));
    const del = el("button", "icon-btn", "✕");
    del.type = "button";
    del.title = sale_undoTitle(s);
    del.addEventListener("click", () => removeSale(s, del));
    right.appendChild(del);

    li.appendChild(info);
    li.appendChild(right);
    list.appendChild(li);
  });

  $("todayCount").textContent = count;
  $("todayTotal").textContent = money(total);
  renderBill();
}

function sale_undoTitle(s) {
  return s.balance_id ? "Remove (balance will be restored)" : "Remove (stock will be restored)";
}

// A sale made by Balance Send / Receive remembers its balance (balance_id / type / amount).
// Removing it puts that balance back: Send -> balance goes up, Receive -> balance goes down.
function balanceUndoNote(sale) {
  if (!sale.balance_id || sale.balance_amount == null) return "";
  const b = balances.find((x) => String(x.id) === String(sale.balance_id));
  if (!b) return ""; // that balance entry was deleted, nothing to put back
  const up = sale.balance_type === "send";
  return ' The balance "' + b.title + '" will also ' + (up ? "go up" : "go down") +
    " by " + money(sale.balance_amount) + " (this undoes the " + (up ? "Send" : "Receive") + ").";
}

// Removes a sale. Returns null on success, or an error message.
async function deleteSaleAndUndo(sale) {
  const { data, error } = await supabaseClient.rpc("delete_sale_and_undo_balance", { p_sale_id: String(sale.id) });

  if (error) {
    // The balance_sale_link.sql script has not been run yet: use the old delete (balance is not undone)
    if (error.code === "PGRST202" || /could not find the function/i.test(error.message || "")) {
      const old = await supabaseClient.rpc("delete_sale", { p_sale_id: sale.id });
      return old.error ? old.error.message : null;
    }
    return error.message;
  }

  switch (data) {
    case "ok": return null;
    case "insufficient":
      return "Cannot remove this: it was a Receive of " + money(sale.balance_amount) +
        " and the balance now has less than that.";
    case "notfound": return "This sale no longer exists. Refresh the page.";
    default: return "Not allowed.";
  }
}

async function removeSale(sale, btn) {
  const note = balanceUndoNote(sale);
  const msg = (sale.product_id
    ? 'Remove "' + sale.product_name + '" from today\'s sale? The quantity goes back to stock.'
    : 'Remove "' + sale.product_name + '" from today\'s sale?') + note;
  if (!confirm(msg)) return;

  btn.disabled = true;
  const err = await deleteSaleAndUndo(sale);
  if (err) {
    btn.disabled = false;
    return toast(err, "error");
  }

  await Promise.all([loadProducts(), loadTodaySales(), loadBalances()]);
  toast(note ? "Removed, balance restored" : "Removed, stock restored");
}

// ====== ADD / EDIT PRODUCT POPUP ======
$("addProductBtn").addEventListener("click", () => openProductModal(null));

function showPreview(p) {
  const prev = $("pmPreview");
  prev.innerHTML = "";
  prev.appendChild(makeThumb(p || { name: "+" }, "big"));
}

function openProductModal(p) {
  editingProduct = p;
  $("pmTitle").textContent = p ? "Edit product" : "Add new product";
  $("pmName").value = p ? p.name : "";
  $("pmPrice").value = p ? p.price : "";
  $("pmQty").value = p ? p.quantity : "";
  $("pmDesc").value = p && p.description ? p.description : "";
  $("pmFile").value = "";
  showPreview(p);
  formMsg("productFormMsg", "");
  openModal("productModal");
  $("pmName").focus();
}

$("pmFile").addEventListener("change", () => {
  const f = $("pmFile").files[0];
  if (!f) return showPreview(editingProduct);
  const prev = $("pmPreview");
  prev.innerHTML = "";
  const img = el("img", "thumb big");
  img.src = URL.createObjectURL(f);
  prev.appendChild(img);
});

// ---- Image compression (runs in the browser, before the upload) ----
function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Invalid image file")); };
    img.src = url;
  });
}

// The picture drawn on a canvas, shrunk so its longest side is at most maxSide (never enlarged)
function scaledCanvas(img, maxSide, whiteBackground) {
  const iw = img.naturalWidth || 300;   // an SVG without a size reports 0
  const ih = img.naturalHeight || 300;
  const scale = Math.min(1, maxSide / Math.max(iw, ih));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(iw * scale));
  canvas.height = Math.max(1, Math.round(ih * scale));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (whiteBackground) {
    ctx.fillStyle = "#fff"; // transparent parts would turn black in a JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

// Product picture -> small WebP (about 30% smaller than JPEG). A browser that cannot
// make WebP quietly returns a PNG, so in that case we make a JPEG instead.
// Returns { blob, ext }.
async function compressImage(file) {
  const img = await loadImageFile(file);
  const canvas = scaledCanvas(img, MAX_IMAGE_SIDE, true);
  let blob = await canvasBlob(canvas, "image/webp", IMAGE_QUALITY);
  if (!blob || blob.type !== "image/webp") blob = await canvasBlob(canvas, "image/jpeg", IMAGE_QUALITY);
  if (!blob) throw new Error("Could not process image");
  return { blob, ext: blob.type === "image/webp" ? "webp" : "jpg" };
}

$("productForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  formMsg("productFormMsg", "");

  const name = $("pmName").value.trim();
  const price = parseFloat($("pmPrice").value);
  const qty = parseInt($("pmQty").value, 10);
  const desc = $("pmDesc").value.trim();
  const file = $("pmFile").files[0];

  if (!name) return formMsg("productFormMsg", "Product name is required.");
  if (isNaN(price) || price < 0) return formMsg("productFormMsg", "Enter a valid price.");
  if (isNaN(qty) || qty < 0) return formMsg("productFormMsg", "Enter a valid quantity.");
  if (file && !file.type.startsWith("image/")) return formMsg("productFormMsg", "Please choose an image file.");

  const btn = $("pmSubmit");
  btn.disabled = true;
  btn.textContent = "Saving...";

  const oldPath = editingProduct ? editingProduct.image_path : null;
  let imagePath = oldPath;
  let uploadedPath = null;

  try {
    // 1. Upload new image (if chosen)
    if (file) {
      const { blob, ext } = await compressImage(file);
      uploadedPath = currentUser.id + "/" + Date.now() + "." + ext;
      const { error: upErr } = await supabaseClient.storage
        .from(IMAGE_BUCKET)
        .upload(uploadedPath, blob, { contentType: blob.type, cacheControl: IMAGE_CACHE });
      if (upErr) throw upErr;
      imagePath = uploadedPath;
    }

    // 2. Save product row
    const payload = { name, price, quantity: qty, description: desc || null, image_path: imagePath };
    const { error } = editingProduct
      ? await supabaseClient.from("products").update(payload).eq("id", editingProduct.id)
      : await supabaseClient.from("products").insert(payload);

    if (error) {
      if (uploadedPath) await supabaseClient.storage.from(IMAGE_BUCKET).remove([uploadedPath]);
      throw error;
    }

    // 3. Remove the replaced image from storage
    if (uploadedPath && oldPath) {
      await supabaseClient.storage.from(IMAGE_BUCKET).remove([oldPath]);
    }

    closeModal("productModal");
    await loadProducts();
    toast(editingProduct ? "Product updated" : "Product added");
  } catch (err) {
    formMsg("productFormMsg", err.message || "Something went wrong.");
  }

  btn.disabled = false;
  btn.textContent = "Save product";
});

async function deleteProduct(p, btn) {
  if (!confirm('Delete "' + p.name + '"? Past sales stay in the sales history.')) return;

  btn.disabled = true;
  const { error } = await supabaseClient.from("products").delete().eq("id", p.id);
  if (error) {
    btn.disabled = false;
    return toast(error.message, "error");
  }

  if (p.image_path) {
    await supabaseClient.storage.from(IMAGE_BUCKET).remove([p.image_path]);
  }

  await Promise.all([loadProducts(), loadTodaySales()]);
  toast("Product deleted");
}

// ====== SALE MANAGEMENT (pick a date) ======
function setupSalesDate() {
  const input = $("saleDate");
  input.max = localDate();
  input.min = localDate(new Date(Date.now() - KEEP_DAYS * 86400000));
  input.value = localDate();
  input.addEventListener("change", loadSalesForDate);
}

async function loadSalesForDate() {
  const date = $("saleDate").value;
  if (!date) return;

  const { data, error } = await supabaseClient
    .from("sales")
    .select("*")
    .eq("sale_date", date)
    .order("created_at", { ascending: true });

  if (error) return toast(error.message, "error");

  const body = $("salesBody");
  body.innerHTML = "";
  $("salesEmpty").classList.toggle("hidden", data.length > 0);

  let total = 0;
  let count = 0;

  data.forEach((s) => {
    total += Number(s.total);
    count += s.quantity;

    const tr = document.createElement("tr");
    const time = new Date(s.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    [time, s.product_name + (s.description ? " — " + s.description : ""), String(s.quantity), money(s.unit_price), money(s.total)].forEach((t) =>
      tr.appendChild(el("td", "", t))
    );
    body.appendChild(tr);
  });

  $("sTotal").textContent = money(total);
  $("sCount").textContent = count;
}

// ====== THEME + LOGOUT ======
const root = document.documentElement;
$("themeToggle").addEventListener("click", () => {
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try { localStorage.setItem("theme", next); } catch (e) {}
});

$("logoutBtn").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  goLogin();
});

supabaseClient.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") goLogin();
});

// ====== START: only approved, logged-in users may stay ======
(async function init() {
  const { data } = await supabaseClient.auth.getSession();
  const user = data.session && data.session.user;
  if (!user) return goLogin();

  const { data: profile } = await supabaseClient
    .from("profiles")
    .select("status, full_name")
    .eq("id", user.id)
    .single();

  if (!profile || profile.status !== "approved") {
    await supabaseClient.auth.signOut();
    return goLogin();
  }

  currentUser = user;
  $("userName").textContent = profile.full_name || user.email;

  loadShopInfo(); // shop logo / name for Home and the PDF bill (doesn't block the rest)
  await supabaseClient.rpc("cleanup_old_sales"); // delete sales older than 30 days
  setupSalesDate();
  await loadProducts();
  await loadTodaySales();
  await loadBalances();
})();
// ====== MESSAGES FOR PIN / KHATA DATABASE ANSWERS ======
function statusMessage(status) {
  switch (status) {
    case "ok": return null;
    case "wrong": return "Wrong PIN.";
    case "locked": return "Too many wrong tries. Try again in 5 minutes.";
    case "nopin": return "No PIN set yet. Create one in the PIN & Password tab.";
    case "exists": return "This name is already in your Khata. Use Edit entry on that person.";
    case "invalid": return "Please check the details and try again.";
    case "insufficient": return "Balance is less than this amount.";
    case "notfound": return "This entry no longer exists. Refresh the page.";
    default: return "Not allowed.";
  }
}

function fmtDate(d) {
  return new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
function fmtDateTime(iso) {
  return new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// ====== UNIVERSAL PIN POPUP ======
// Use anywhere:
//   const pin = await requirePin("Enter PIN to continue", checkPin);
//   if (!pin) return;            // cancelled
// The 2nd argument runs with the typed PIN and returns an error text (popup stays open)
// or null (popup closes). Use checkPin to only verify, or your own function to verify + do the job.
let pinPending = null;

function requirePin(title, action) {
  return new Promise((resolve) => {
    if (pinPending) pinPending.resolve(null);
    pinPending = { action, resolve };
    $("pinPromptTitle").textContent = title;
    $("pinPromptInput").value = "";
    formMsg("pinPromptMsg", "");
    openModal("pinModal");
    $("pinPromptInput").focus();
  });
}

function cancelPin() {
  if (pinPending) {
    const p = pinPending;
    pinPending = null;
    p.resolve(null);
  }
}

async function checkPin(pin) {
  const { data, error } = await supabaseClient.rpc("verify_pin", { p_pin: pin });
  return error ? error.message : statusMessage(data);
}

$("pinPromptForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const current = pinPending;
  if (!current) return;

  const pin = $("pinPromptInput").value.trim();
  if (!/^\d{4,6}$/.test(pin)) return formMsg("pinPromptMsg", "Enter your 4 to 6 digit PIN.");

  const btn = $("pinPromptBtn");
  btn.disabled = true;
  const err = await current.action(pin);
  btn.disabled = false;

  if (pinPending !== current) return; // cancelled meanwhile
  if (err) {
    $("pinPromptInput").value = "";
    $("pinPromptInput").focus();
    return formMsg("pinPromptMsg", err);
  }

  pinPending = null;
  $("pinModal").classList.add("hidden");
  current.resolve(pin);
});

// PIN boxes accept digits only
document.querySelectorAll(".pin-input").forEach((inp) => {
  inp.addEventListener("input", () => { inp.value = inp.value.replace(/\D/g, ""); });
});

// ====== PIN & PASSWORD TAB ======
let hasPin = false;

async function loadPinStatus() {
  const { data, error } = await supabaseClient.rpc("has_pin");
  if (error) return toast(error.message, "error");
  hasPin = !!data;
  $("pinStatus").textContent = hasPin
    ? "A PIN is set. Enter your current PIN to change it."
    : "No PIN set yet. Create one to protect Khata edits and deletes.";
  $("oldPinWrap").classList.toggle("hidden", !hasPin);
  $("pinSave").textContent = hasPin ? "Update PIN" : "Set PIN";
}

$("pinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  formMsg("pinFormMsg", "");

  const oldPin = $("pinOld").value.trim();
  const newPin = $("pinNew").value.trim();
  const confirmPin = $("pinConfirm").value.trim();

  if (hasPin && !/^\d{4,6}$/.test(oldPin)) return formMsg("pinFormMsg", "Enter your current PIN.");
  if (!/^\d{4,6}$/.test(newPin)) return formMsg("pinFormMsg", "PIN must be 4 to 6 digits.");
  if (newPin !== confirmPin) return formMsg("pinFormMsg", "PINs do not match.");

  const btn = $("pinSave");
  btn.disabled = true;
  const { data, error } = await supabaseClient.rpc("set_pin", { p_new: newPin, p_old: hasPin ? oldPin : null });
  btn.disabled = false;

  const msg = error ? error.message : statusMessage(data);
  if (msg) return formMsg("pinFormMsg", msg);

  $("pinForm").reset();
  toast("PIN saved");
  loadPinStatus();
});

$("passForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  formMsg("passFormMsg", "");

  const oldPass = $("passOld").value;
  const newPass = $("passNew").value;
  const confirmPass = $("passConfirm").value;

  if (!oldPass) return formMsg("passFormMsg", "Enter your current password.");
  if (newPass.length < 6) return formMsg("passFormMsg", "New password must be at least 6 characters.");
  if (newPass !== confirmPass) return formMsg("passFormMsg", "New passwords do not match.");
  if (newPass === oldPass) return formMsg("passFormMsg", "New password must be different.");

  const btn = $("passSave");
  btn.disabled = true;

  // 1. check the old password is correct
  const { error: signErr } = await supabaseClient.auth.signInWithPassword({
    email: currentUser.email,
    password: oldPass,
  });
  if (signErr) {
    btn.disabled = false;
    return formMsg("passFormMsg", "Current password is incorrect.");
  }

  // 2. set the new one
  const { error } = await supabaseClient.auth.updateUser({ password: newPass });
  btn.disabled = false;
  if (error) return formMsg("passFormMsg", error.message);

  $("passForm").reset();
  toast("Password updated");
});

// ====== KHATA ======
let khataPeople = [];
let entryPerson = null;
let entrySign = 1;     // 1 = plus, -1 = minus
let entryPin = null;   // PIN typed for the open Edit entry popup

async function loadKhata() {
  if (!$("kDate").value) {
    $("kDate").value = localDate();
    $("kDate").max = localDate();
  }
  const { data, error } = await supabaseClient.from("khata_people").select("*").order("name");
  if (error) return toast(error.message, "error");
  khataPeople = data;
  renderKhata();
}

// ---- WhatsApp reminder (free "click to chat" link, no API needed) ----
// Turns a number typed like 0300-1234567 / +92 300 1234567 / 0092300... into 923001234567.
function whatsappNumber(raw) {
  if (!raw) return "";
  const text = String(raw).trim();
  let d = text.replace(/\D/g, "");
  if (!d) return "";
  if (text.startsWith("+")) { /* already has a country code */ }
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "92" + d.slice(1);       // local Pakistan number
  else if (d.length === 10 && d.startsWith("3")) d = "92" + d; // 3001234567
  return d.length >= 10 && d.length <= 15 ? d : "";
}

function khataReminderText(p) {
  const si = shopInfo || {};
  const owner = (si.owner_name || "").trim();
  const shop = (si.shop_name || "").trim();
  const sender = owner && shop ? owner + " (" + shop + ")" : owner || shop || "dukaan";
  const amount = CURRENCY + " " + Number(p.total).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (
    "Assalam o Alaikum " + p.name + ",\n" +
    sender + " ki taraf se yaad dehani: aap ke khata mein " + amount +
    " baqaya hain. Meherbani farma kar jald ada kar dein. Shukriya."
  );
}

function sendKhataReminder(p) {
  const num = whatsappNumber(p.phone);
  if (!num) return toast("Add a valid phone number for " + p.name, "error");
  const url = "https://wa.me/" + num + "?text=" + encodeURIComponent(khataReminderText(p));
  window.open(url, "_blank", "noopener");
}

function renderKhata() {
  const q = $("kSearch").value.trim().toLowerCase();
  const list = khataPeople.filter((p) => p.name.toLowerCase().includes(q));
  const body = $("khataBody");
  body.innerHTML = "";

  $("khataEmpty").classList.toggle("hidden", list.length > 0);
  $("khataEmpty").textContent = khataPeople.length ? "No one found." : "No one in Khata yet. Add a person above.";
  $("kTotal").textContent = money(khataPeople.reduce((s, p) => s + Number(p.total), 0));
  $("kPeople").textContent = khataPeople.length;

  list.forEach((p) => {
    const tr = document.createElement("tr");
    tr.appendChild(el("td", "", p.name));
    tr.appendChild(el("td", "", p.phone || "-"));
    tr.appendChild(el("td", "person-total", money(p.total)));
    tr.appendChild(el("td", "", p.last_entry ? fmtDateTime(p.last_entry) : "-"));

    const act = el("td", "actions");
    const buttons = [
      ["History", "", () => showHistory(p)],
      ["Edit entry", "", () => startEditEntry(p)],
      ["Delete", "danger", () => deletePerson(p)],
    ];
    // WhatsApp reminder: only for people who still owe money (total > 0)
    if (Number(p.total) > 0) {
      const hasNumber = !!whatsappNumber(p.phone);
      buttons.unshift(["WhatsApp", "wa", () => sendKhataReminder(p), !hasNumber]);
    }
    buttons.forEach(([label, cls, fn, disabled]) => {
      const b = el("button", "act-btn " + cls, label);
      b.type = "button";
      if (disabled) {
        b.disabled = true;
        b.title = "Add this person's phone number to send a WhatsApp reminder";
      } else {
        b.addEventListener("click", fn);
      }
      act.appendChild(b);
    });
    tr.appendChild(act);
    body.appendChild(tr);
  });
}
$("kSearch").addEventListener("input", renderKhata);

// Add person (name + date + amount)
$("khataForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  formMsg("khataFormMsg", "");

  const name = $("kName").value.trim();
  const phone = $("kPhone").value.trim();
  const note = $("kNote").value.trim();
  const date = $("kDate").value;
  const amount = parseFloat($("kAmount").value);

  if (!name) return formMsg("khataFormMsg", "Enter the person's name.");
  if (!date) return formMsg("khataFormMsg", "Select a date.");
  if (isNaN(amount) || amount <= 0) return formMsg("khataFormMsg", "Enter a valid amount.");

  const btn = $("kSubmit");
  btn.disabled = true;
  const { data, error } = await supabaseClient.rpc("khata_add_person", {
    p_name: name, p_phone: phone || null, p_amount: amount, p_date: date, p_note: note || null,
  });
  btn.disabled = false;

  const msg = error ? error.message : statusMessage(data);
  if (msg) return formMsg("khataFormMsg", msg);

  $("khataForm").reset();
  $("kDate").value = localDate();
  await loadKhata();
  toast("Added to Khata");
});

// History popup
async function showHistory(p) {
  $("hsName").textContent = p.name;
  $("hsTotal").textContent = money(p.total);
  $("hsBody").innerHTML = "";
  $("hsEmpty").classList.add("hidden");
  openModal("historyModal");

  const { data, error } = await supabaseClient
    .from("khata_entries")
    .select("*")
    .eq("person_id", p.id)
    .order("created_at", { ascending: false });
  if (error) return toast(error.message, "error");

  $("hsEmpty").classList.toggle("hidden", data.length > 0);
  data.forEach((en) => {
    const a = Number(en.amount);
    const tr = document.createElement("tr");
    tr.appendChild(el("td", "", fmtDate(en.entry_date)));
    tr.appendChild(el("td", "", new Date(en.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })));
    tr.appendChild(el("td", a > 0 ? "amt-plus" : "amt-minus", (a > 0 ? "+ " : "- ") + money(Math.abs(a))));
    tr.appendChild(el("td", "", en.description || "-"));
    $("hsBody").appendChild(tr);
  });
}

// Edit entry: PIN first, then the plus/minus popup
async function startEditEntry(p) {
  const pin = await requirePin("Enter PIN to edit entry", checkPin);
  if (!pin) return;

  entryPerson = p;
  entryPin = pin;
  $("enName").textContent = p.name;
  $("enCurrent").textContent = money(p.total);
  $("enAmount").value = "";
  $("enDesc").value = "";
  formMsg("entryMsg", "");
  setSign(1);
  openModal("entryModal");
  $("enAmount").focus();
}

function setSign(n) {
  entrySign = n;
  $("signPlus").classList.toggle("active", n === 1);
  $("signMinus").classList.toggle("active", n === -1);
  updateNewTotal();
}
function updateNewTotal() {
  if (!entryPerson) return;
  const amt = parseFloat($("enAmount").value) || 0;
  $("enNewTotal").textContent = money(Number(entryPerson.total) + entrySign * amt);
}
$("signPlus").addEventListener("click", () => setSign(1));
$("signMinus").addEventListener("click", () => setSign(-1));
$("enAmount").addEventListener("input", updateNewTotal);

$("entryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  formMsg("entryMsg", "");

  const amount = parseFloat($("enAmount").value);
  if (isNaN(amount) || amount <= 0) return formMsg("entryMsg", "Enter a valid amount.");

  const btn = $("enSubmit");
  btn.disabled = true;
  const { data, error } = await supabaseClient.rpc("khata_add_entry", {
    p_person_id: entryPerson.id,
    p_amount: entrySign * amount,
    p_description: $("enDesc").value.trim() || null,
    p_date: localDate(),
    p_pin: entryPin,
  });
  btn.disabled = false;

  const msg = error ? error.message : statusMessage(data);
  if (msg) return formMsg("entryMsg", msg);

  closeModal("entryModal");
  await loadKhata();
  toast("Entry saved");
});

// Delete person: confirm, then PIN, then delete
async function deletePerson(p) {
  if (!confirm('Delete "' + p.name + '" and ALL their entries? This cannot be undone.')) return;

  const pin = await requirePin("Enter PIN to delete", async (pin) => {
    const { data, error } = await supabaseClient.rpc("khata_delete_person", { p_person_id: p.id, p_pin: pin });
    return error ? error.message : statusMessage(data);
  });
  if (!pin) return;

  await loadKhata();
  toast("Deleted");
}
// ====== CUSTOM ENTRY (an item that is not in the products) ======
$("customEntryBtn").addEventListener("click", () => {
  $("customForm").reset();
  formMsg("customMsg", "");
  openModal("customModal");
  $("ceName").focus();
});

$("customForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  formMsg("customMsg", "");

  const name = $("ceName").value.trim();
  const price = parseFloat($("cePrice").value);
  const desc = $("ceDesc").value.trim();

  if (!name) return formMsg("customMsg", "Enter a name.");
  if (isNaN(price) || price <= 0) return formMsg("customMsg", "Enter a valid price.");

  const btn = $("ceSubmit");
  btn.disabled = true;
  const { error } = await supabaseClient.from("sales").insert({
    product_id: null,
    product_name: name,
    unit_price: price,
    quantity: 1,
    sale_date: localDate(),
    description: desc || null,
  });
  btn.disabled = false;

  if (error) return formMsg("customMsg", error.message);

  closeModal("customModal");
  await loadTodaySales();
  toast("Custom entry added");
});
// ====== BALANCE ======
// Home bar + Balance tab. Add needs no PIN; Edit and Delete ask for the PIN.
// Send / Receive (Home bar popup) change the balance, and only the optional
// "amount to be add in sale" goes into today's sale, never the actual amount.
let balances = [];
let editingBalance = null;  // entry being edited (null = adding new)
let balancePin = null;      // PIN typed for the open Edit popup
let txBalance = null;       // entry shown in the Send / Receive popup

async function loadBalances() {
  const { data, error } = await supabaseClient
    .from("balances")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) return toast(error.message, "error");
  balances = data;
  renderBalanceTable();
  renderBalanceBar();
}

// Home: top bar with every entry's title and total
function renderBalanceBar() {
  const list = $("balanceBarList");
  list.innerHTML = "";

  if (!balances.length) {
    list.appendChild(el("span", "bb-empty", "No balance entries yet. Add one in the Balance tab."));
    return;
  }

  balances.forEach((b) => {
    const chip = el("button", "bb-chip");
    chip.type = "button";
    chip.title = b.title;
    chip.appendChild(el("span", "bb-title", b.title));
    chip.appendChild(el("span", "bb-amount", money(b.amount)));
    chip.addEventListener("click", () => openTxModal(b));
    list.appendChild(chip);
  });
}

// Balance tab: table
function renderBalanceTable() {
  const body = $("balanceBody");
  body.innerHTML = "";
  $("balanceEmpty").classList.toggle("hidden", balances.length > 0);
  $("bTotal").textContent = money(balances.reduce((s, b) => s + Number(b.amount), 0));
  $("bCount").textContent = balances.length;

  balances.forEach((b) => {
    const tr = document.createElement("tr");
    tr.appendChild(el("td", "", b.title));
    tr.appendChild(el("td", "balance-amount", money(b.amount)));
    tr.appendChild(el("td", "desc", b.description || "-"));

    const act = el("td", "actions");
    [
      ["Edit", "", () => startEditBalance(b)],
      ["Delete", "danger", () => deleteBalance(b)],
    ].forEach(([label, cls, fn]) => {
      const btn = el("button", "act-btn " + cls, label);
      btn.type = "button";
      btn.addEventListener("click", fn);
      act.appendChild(btn);
    });
    tr.appendChild(act);
    body.appendChild(tr);
  });
}

// Add / edit popup
function openBalanceModal(b) {
  editingBalance = b;
  $("bmTitle").textContent = b ? "Edit entry" : "Add entry";
  $("bmSubmit").textContent = b ? "Save changes" : "Add entry";
  $("bmName").value = b ? b.title : "";
  $("bmAmount").value = b ? b.amount : "";
  $("bmDesc").value = b && b.description ? b.description : "";
  formMsg("balanceFormMsg", "");
  openModal("balanceModal");
  $("bmName").focus();
}

$("addBalanceBtn").addEventListener("click", () => {
  balancePin = null;
  openBalanceModal(null);
});

// Edit: PIN first, then the popup (the PIN is checked again on save)
async function startEditBalance(b) {
  const pin = await requirePin("Enter PIN to edit entry", checkPin);
  if (!pin) return;
  balancePin = pin;
  openBalanceModal(b);
}

$("balanceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  formMsg("balanceFormMsg", "");

  const title = $("bmName").value.trim();
  const amount = parseFloat($("bmAmount").value);
  const desc = $("bmDesc").value.trim();

  if (!title) return formMsg("balanceFormMsg", "Enter a title.");
  if (isNaN(amount) || amount < 0) return formMsg("balanceFormMsg", "Enter a valid balance amount.");

  const isEdit = !!editingBalance;
  const btn = $("bmSubmit");
  btn.disabled = true;
  const { data, error } = isEdit
    ? await supabaseClient.rpc("balance_update", {
        p_id: editingBalance.id,
        p_title: title,
        p_amount: amount,
        p_description: desc || null,
        p_pin: balancePin,
      })
    : await supabaseClient.rpc("balance_add", {
        p_title: title,
        p_amount: amount,
        p_description: desc || null,
      });
  btn.disabled = false;

  const msg = error ? error.message : statusMessage(data);
  if (msg) return formMsg("balanceFormMsg", msg);

  closeModal("balanceModal");
  await loadBalances();
  toast(isEdit ? "Entry updated" : "Entry added");
});

// Delete: confirm, then PIN, then delete
async function deleteBalance(b) {
  if (!confirm('Delete "' + b.title + '" (' + money(b.amount) + ')? This cannot be undone.')) return;

  const pin = await requirePin("Enter PIN to delete entry", async (pin) => {
    const { data, error } = await supabaseClient.rpc("balance_delete", { p_id: b.id, p_pin: pin });
    return error ? error.message : statusMessage(data);
  });
  if (!pin) return;

  await loadBalances();
  toast("Entry deleted");
}

// Send / Receive popup (opened from the Home bar)
function openTxModal(b) {
  txBalance = b;
  $("txTitle").textContent = b.title;
  $("txBalance").textContent = money(b.amount);
  $("txForm").reset();
  formMsg("txMsg", "");
  updateTxPreview();
  openModal("txModal");
  $("txAmount").focus();
}

function updateTxPreview() {
  if (!txBalance) return;
  const amt = parseFloat($("txAmount").value) || 0;
  const cur = Number(txBalance.amount);
  $("txAfterSend").textContent = money(cur - amt);
  $("txAfterReceive").textContent = money(cur + amt);
}
$("txAmount").addEventListener("input", updateTxPreview);

async function submitTx(type) {
  formMsg("txMsg", "");

  const amount = parseFloat($("txAmount").value);
  const saleRaw = $("txSale").value.trim();
  const sale = saleRaw === "" ? 0 : parseFloat(saleRaw);

  if (isNaN(amount) || amount <= 0) return formMsg("txMsg", "Enter a valid actual amount.");
  if (isNaN(sale) || sale < 0) return formMsg("txMsg", "Enter a valid sale amount.");
  if (type === "send" && amount > Number(txBalance.amount)) {
    return formMsg("txMsg", statusMessage("insufficient"));
  }

  const buttons = [$("txSend"), $("txReceive")];
  buttons.forEach((b) => (b.disabled = true));
  const { data, error } = await supabaseClient.rpc("balance_transaction", {
    p_id: txBalance.id,
    p_type: type,
    p_amount: amount,
    p_sale_amount: sale > 0 ? sale : null,
    p_description: $("txDesc").value.trim() || null,
    p_date: localDate(),
  });
  buttons.forEach((b) => (b.disabled = false));

  const msg = error ? error.message : statusMessage(data);
  if (msg) return formMsg("txMsg", msg);

  closeModal("txModal");
  await Promise.all([loadBalances(), loadTodaySales()]);
  toast(type === "send" ? "Sent. Balance updated" : "Received. Balance updated");
}

$("txSend").addEventListener("click", () => submitTx("send"));
$("txReceive").addEventListener("click", () => submitTx("receive"));
$("txForm").addEventListener("submit", (e) => e.preventDefault());

// ====== GENERATE BILL ======
// Left: this customer's order. Right: products.
// Every item added here is also a normal sale (add_sale), so it shows in Today's sale
// and the stock goes down. Removing it from the bill removes that sale and puts the
// stock back. The bill only remembers the ids of its sales rows, so the data always
// matches Today's sale.
const BILL_DRAFT_KEY = "billDraft";
let billItems = [];          // ids of the sales rows that belong to the bill being made
let activeBillProduct = null; // product shown in the "add to bill" popup
let lastBill = null;         // snapshot shown in the summary popup (this is what the PDF uses)

const round2 = (n) => Math.round(Number(n) * 100) / 100;

function billNumber(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return "B" + String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate()) +
    "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

// Keep the unfinished bill if the page is refreshed (same day only)
function saveBillDraft() {
  try {
    localStorage.setItem(BILL_DRAFT_KEY, JSON.stringify({
      date: localDate(),
      ids: billItems,
      customer: $("billCustomer").value,
      received: $("billReceived").value,
    }));
  } catch (e) {}
}
function restoreBillDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(BILL_DRAFT_KEY) || "null");
    if (!d || d.date !== localDate()) return;
    billItems = Array.isArray(d.ids) ? d.ids : [];
    $("billCustomer").value = d.customer || "";
    $("billReceived").value = d.received || "";
  } catch (e) {}
}
restoreBillDraft();
$("billCustomer").addEventListener("input", saveBillDraft);
$("billReceived").addEventListener("input", saveBillDraft);

// The sales rows that belong to this bill (looked up in today's sales)
function billSales() {
  const byId = new Map(todaySales.map((s) => [String(s.id), s]));
  return billItems.map((id) => byId.get(String(id))).filter(Boolean);
}

// Left side: the customer's items and the running total
function renderBill() {
  // forget items whose sale was removed meanwhile (for example from Home)
  const ids = new Set(todaySales.map((s) => String(s.id)));
  billItems = billItems.filter((id) => ids.has(String(id)));

  $("billDateLabel").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "short", day: "numeric", month: "short",
  });

  const items = billSales();
  const list = $("billList");
  list.innerHTML = "";
  $("billEmpty").classList.toggle("hidden", items.length > 0);

  let total = 0;
  let count = 0;
  items.forEach((s) => {
    total += Number(s.total);
    count += s.quantity;

    const li = el("li", "sale-item");
    const info = el("div", "sale-info");
    info.appendChild(el("div", "sale-name", s.product_name));
    info.appendChild(el("div", "muted small", s.quantity + " × " + money(s.unit_price)));

    const right = el("div", "sale-right");
    right.appendChild(el("strong", "", money(s.total)));
    const del = el("button", "icon-btn", "✕");
    del.type = "button";
    del.title = "Remove from bill (stock will be restored)";
    del.addEventListener("click", () => removeBillItem(s, del));
    right.appendChild(del);

    li.appendChild(info);
    li.appendChild(right);
    list.appendChild(li);
  });

  $("billCount").textContent = count;
  $("billTotal").textContent = money(total);
  saveBillDraft();
}

// Right side: products
function renderBillGrid() {
  const q = $("billSearch").value.trim().toLowerCase();
  const list = products.filter((p) => p.name.toLowerCase().includes(q));
  const grid = $("billGrid");
  grid.innerHTML = "";

  const empty = $("billGridEmpty");
  empty.classList.toggle("hidden", list.length > 0);
  empty.textContent = products.length ? "No products found." : "No products yet. Add some in Manage Products.";

  list.forEach((p) => grid.appendChild(productCard(p, () => openBillItemModal(p), "Add to bill")));
}
$("billSearch").addEventListener("input", renderBillGrid);

// Add-to-bill popup
function openBillItemModal(p) {
  activeBillProduct = p;
  const wrap = $("biImg");
  wrap.innerHTML = "";
  wrap.appendChild(makeThumb(p, "big"));

  $("biName").textContent = p.name;
  $("biDesc").textContent = p.description || "No description";
  $("biStock").textContent = p.quantity;
  $("biPrice").value = p.price;
  $("biQty").value = 1;
  $("biQty").max = p.quantity;
  formMsg("billItemMsg", "");
  updateBillItemTotal();
  openModal("billItemModal");
  $("biQty").focus();
  $("biQty").select();
}

function updateBillItemTotal() {
  const price = parseFloat($("biPrice").value) || 0;
  const qty = parseInt($("biQty").value, 10) || 0;
  $("biTotal").textContent = money(price * qty);
}
$("biPrice").addEventListener("input", updateBillItemTotal);
$("biQty").addEventListener("input", updateBillItemTotal);

// add_sale may return an id, a row or just a status; take the id if there is one
function saleIdFrom(data) {
  if (Array.isArray(data)) return data[0] && data[0].id != null ? data[0].id : null;
  if (data && typeof data === "object") return data.id != null ? data.id : null;
  if (typeof data === "string" || typeof data === "number") return data;
  return null;
}

$("billItemForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  formMsg("billItemMsg", "");

  const p = activeBillProduct;
  const price = parseFloat($("biPrice").value);
  const qty = parseInt($("biQty").value, 10);

  if (isNaN(price) || price < 0) return formMsg("billItemMsg", "Enter a valid price.");
  if (!qty || qty < 1) return formMsg("billItemMsg", "Enter a valid quantity.");
  if (qty > p.quantity) return formMsg("billItemMsg", "Only " + p.quantity + " in stock.");

  const btn = $("biSubmit");
  btn.disabled = true;
  btn.textContent = "Adding...";

  const before = new Set(todaySales.map((s) => String(s.id)));
  const { data, error } = await supabaseClient.rpc("add_sale", {
    p_product_id: p.id,
    p_quantity: qty,
    p_price: price,
    p_date: localDate(),
  });

  if (error) {
    btn.disabled = false;
    btn.textContent = "Add to bill";
    return formMsg("billItemMsg", error.message);
  }

  await Promise.all([loadProducts(), loadTodaySales()]);
  btn.disabled = false;
  btn.textContent = "Add to bill";
  closeModal("billItemModal");

  // find the sales row that was just created
  let newId = saleIdFrom(data);
  if (newId == null || !todaySales.some((s) => String(s.id) === String(newId))) {
    const fresh = todaySales.find((s) => !before.has(String(s.id)) && String(s.product_id) === String(p.id));
    newId = fresh ? fresh.id : null;
  }
  if (newId == null) {
    return toast("Added to today's sale, but not to the bill. Please refresh the page.", "error");
  }

  billItems.push(newId);
  renderBill();
  toast("Added to bill");
});

async function removeBillItem(sale, btn) {
  const msg = 'Remove "' + sale.product_name + '" from this bill? It is also removed from today\'s sale and the quantity goes back to stock.';
  if (!confirm(msg)) return;

  btn.disabled = true;
  const err = await deleteSaleAndUndo(sale);
  if (err) {
    btn.disabled = false;
    return toast(err, "error");
  }

  billItems = billItems.filter((id) => String(id) !== String(sale.id));
  await Promise.all([loadProducts(), loadTodaySales(), loadBalances()]);
  toast("Removed, stock restored");
}

// New bill: clears only this list. The items stay in today's sale.
$("billNewBtn").addEventListener("click", () => {
  if (billSales().length &&
      !confirm("Start a new bill? The items stay in today's sale, only this list is cleared.")) return;
  billItems = [];
  $("billCustomer").value = "";
  $("billReceived").value = "";
  renderBill();
});

// What the customer gets back / still owes
function billDiffInfo(b) {
  const diff = round2(b.received - b.total);
  if (diff > 0) return { label: "Remaining to give back", value: money(diff), kind: "give" };
  if (diff < 0) return { label: "Remaining to pay", value: money(-diff), kind: "owe" };
  return { label: "Balance", value: "Paid in full", kind: "even" };
}

// Calculate: freeze the order into a summary popup
$("billCalcBtn").addEventListener("click", () => {
  const items = billSales();
  if (!items.length) return toast("Add at least one item first.", "error");

  const raw = $("billReceived").value.trim();
  const received = raw === "" ? 0 : parseFloat(raw);
  if (isNaN(received) || received < 0) return toast("Enter a valid received payment.", "error");

  const now = new Date();
  lastBill = {
    number: billNumber(now),
    customer: $("billCustomer").value.trim(),
    dateTime: now.toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    items: items.map((s) => ({
      name: s.product_name,
      qty: s.quantity,
      price: Number(s.unit_price),
      total: Number(s.total),
    })),
    total: round2(items.reduce((sum, s) => sum + Number(s.total), 0)),
    received: round2(received),
  };
  showBillSummary(lastBill);
});

function showBillSummary(b) {
  $("bvCustomer").textContent = b.customer || "Walk-in customer";
  $("bvDate").textContent = b.dateTime;

  const body = $("bvBody");
  body.innerHTML = "";
  b.items.forEach((it) => {
    const tr = document.createElement("tr");
    tr.appendChild(el("td", "", it.name));
    tr.appendChild(el("td", "num", String(it.qty)));
    tr.appendChild(el("td", "num", money(it.price)));
    tr.appendChild(el("td", "num", money(it.total)));
    body.appendChild(tr);
  });

  const diff = billDiffInfo(b);
  $("bvTotal").textContent = money(b.total);
  $("bvReceived").textContent = money(b.received);
  $("bvDiffRow").className = "bill-sum-diff " + diff.kind;
  $("bvDiffLabel").textContent = diff.label;
  $("bvDiff").textContent = diff.value;

  // The PDF uses a basic font: it cannot draw Urdu or other non-English letters
  const text = b.customer + b.items.map((i) => i.name).join("");
  if (/[^\u0000-ÿ]/.test(text)) {
    formMsg("bvMsg", "Note: letters outside English (like Urdu script) will not show correctly in the PDF.");
  } else {
    formMsg("bvMsg", "");
  }
  openModal("billModal");
}

// ---- PDF ----
// Builds the PDF with jsPDF + autoTable and returns the document.
function buildBillPdf(bill) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 16; // page margin
  const green = [31, 169, 113];
  const ink = [30, 30, 30];
  const gray = [110, 110, 110];
  const red = [217, 54, 54];
  // fixed English format so the digits always print correctly (2 decimals only when needed)
  const pm = (n) => CURRENCY + " " + Number(n).toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2,
    maximumFractionDigits: 2,
  });

  // Header: shop logo + name + details on the left, BILL on the right
  const si = shopInfo || {};
  let textX = M;
  if (shopLogoData) {
    const box = 22; // logo is fitted inside a 22 x 22 mm box
    const r = Math.min(box / shopLogoData.w, box / shopLogoData.h);
    const lw = shopLogoData.w * r;
    const lh = shopLogoData.h * r;
    try {
      doc.addImage(shopLogoData.dataUrl, shopLogoData.format, M, 10 + (box - lh) / 2, lw, lh);
      textX = M + box + 5;
    } catch (e) { /* if the logo can't be drawn, print the bill without it */ }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...ink);
  const shopLines = doc.splitTextToSize(si.shop_name || SHOP_NAME, W - M - 38 - textX);
  doc.text(shopLines, textX, 20);

  doc.setFontSize(24);
  doc.setTextColor(...green);
  doc.text("BILL", W - M, 20, { align: "right" });

  let y = 20 + (shopLines.length - 1) * 8 + 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...gray);
  const addrLine = [si.address || SHOP_ADDRESS, si.city].filter(Boolean).join(", ");
  const phoneLine = [si.phone || SHOP_PHONE, si.phone2].filter(Boolean).join(" / ");
  [
    addrLine,
    phoneLine ? "Phone: " + phoneLine : "",
    si.email ? "Email: " + si.email : "",
    si.tax_no ? "NTN / Reg: " + si.tax_no : "",
    si.opening_hours ? "Hours: " + si.opening_hours : "",
  ].filter(Boolean).forEach((line) => {
    doc.text(doc.splitTextToSize(line, W - M - textX), textX, y);
    y += 4.8;
  });
  if (si.map_link) {
    doc.setTextColor(...green);
    doc.textWithLink("Location: View on Google Maps", textX, y, { url: si.map_link });
    doc.setTextColor(...gray);
    y += 4.8;
  }

  y = Math.max(y, shopLogoData ? 34 : 28) + 2;
  doc.setDrawColor(...green);
  doc.setLineWidth(0.8);
  doc.line(M, y, W - M, y);
  y += 9;

  // Billed to (left) and bill number / date (right)
  doc.setFontSize(8.5);
  doc.setTextColor(...gray);
  doc.text("BILLED TO", M, y);
  doc.text("BILL NO", W - M, y, { align: "right" });
  y += 5.5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...ink);
  const nameLines = doc.splitTextToSize(bill.customer || "Walk-in customer", 110);
  doc.text(nameLines, M, y);
  doc.text(bill.number, W - M, y, { align: "right" });

  const rightY = y + 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...gray);
  doc.text("DATE", W - M, rightY, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...ink);
  doc.text(bill.dateTime, W - M, rightY + 5.5, { align: "right" });

  y = Math.max(y + nameLines.length * 5.5, rightY + 6) + 8;

  // Items table
  doc.autoTable({
    startY: y,
    margin: { left: M, right: M, bottom: 24 },
    head: [["#", "Item", "Qty", "Price", "Total"]],
    body: bill.items.map((it, i) => [i + 1, it.name, it.qty, pm(it.price), pm(it.total)]),
    theme: "striped",
    styles: { font: "helvetica", fontSize: 10, cellPadding: 3, textColor: ink },
    headStyles: { fillColor: green, textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [244, 247, 246] },
    columnStyles: {
      0: { cellWidth: 12, halign: "center" },
      2: { cellWidth: 20, halign: "center" },
      3: { cellWidth: 36, halign: "right" },
      4: { cellWidth: 36, halign: "right" },
    },
    // heading labels line up with the numbers under them
    didParseCell: (d) => {
      if (d.section === "head") d.cell.styles.halign = ["center", "left", "center", "right", "right"][d.column.index];
    },
  });

  // Totals, right-aligned under the table
  let sy = doc.lastAutoTable.finalY + 10;
  if (sy + 42 > H - 20) {
    doc.addPage();
    sy = 24;
  }
  const labelX = W - M - 78;
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(labelX, sy - 5, W - M, sy - 5);

  const row = (label, value, opts = {}) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size || 11);
    doc.setTextColor(...(opts.color || ink));
    doc.text(label, labelX, sy);
    doc.text(value, W - M, sy, { align: "right" });
    sy += opts.gap || 7;
  };
  row("Total payment", pm(bill.total), { bold: true, size: 13, gap: 8 });
  row("Received payment", pm(bill.received), { gap: 9 });

  const diff = billDiffInfo(bill);
  const diffValue = diff.kind === "give" ? pm(round2(bill.received - bill.total))
    : diff.kind === "owe" ? pm(round2(bill.total - bill.received))
    : "Paid in full";
  row(diff.label, diffValue, {
    bold: true,
    size: 12,
    color: diff.kind === "owe" ? red : green,
  });

  // Footer on every page; thank-you note on the last one
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...gray);
    if (i === pages) doc.text(si.bill_footer || "Thank you for your purchase!", W / 2, H - 14, { align: "center" });
    if (pages > 1) doc.text("Page " + i + " of " + pages, W / 2, H - 8, { align: "center" });
  }
  return doc;
}

$("bvGenerate").addEventListener("click", () => {
  if (!lastBill) return;
  if (!window.jspdf || !window.jspdf.jsPDF) {
    return formMsg("bvMsg", "The PDF library could not load. Check the internet and refresh the page.");
  }
  try {
    buildBillPdf(lastBill).save("Bill-" + lastBill.number + ".pdf");
    formMsg("bvMsg", "Bill downloaded. Click New bill when you are done with this customer.", "success");
  } catch (err) {
    formMsg("bvMsg", "Could not create the PDF: " + (err.message || err));
  }
});

// ====== LOW STOCK ======
// Every product with LOW_STOCK or fewer left (including 0). Stock can be increased here.
let stockProduct = null; // product shown in the Add stock popup

function renderLowStock() {
  const low = products
    .filter((p) => p.quantity <= LOW_STOCK)
    .sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name));

  $("lowStockBadge").textContent = low.length;
  $("lowStockBadge").classList.toggle("hidden", low.length === 0);
  $("lowStockNote").textContent = "Products with " + LOW_STOCK + " or less left";

  const body = $("lowBody");
  body.innerHTML = "";
  $("lowEmpty").classList.toggle("hidden", low.length > 0);

  low.forEach((p) => {
    const tr = document.createElement("tr");

    const tdImg = document.createElement("td");
    tdImg.appendChild(makeThumb(p, "small"));
    tr.appendChild(tdImg);

    tr.appendChild(el("td", "", p.name));
    tr.appendChild(el("td", "", money(p.price)));
    tr.appendChild(el("td", p.quantity <= 0 ? "out" : "low", p.quantity <= 0 ? "Out of stock" : String(p.quantity)));

    const act = el("td", "actions");
    const add = el("button", "act-btn", "Add stock");
    add.type = "button";
    add.addEventListener("click", () => openStockModal(p));
    act.appendChild(add);
    tr.appendChild(act);

    body.appendChild(tr);
  });
}

function openStockModal(p) {
  stockProduct = p;
  const wrap = $("stImg");
  wrap.innerHTML = "";
  wrap.appendChild(makeThumb(p, "big"));
  $("stName").textContent = p.name;
  $("stCurrent").textContent = p.quantity;
  $("stAdd").value = "";
  formMsg("stockMsg", "");
  updateStockNew();
  openModal("stockModal");
  $("stAdd").focus();
}

function updateStockNew() {
  if (!stockProduct) return;
  const add = parseInt($("stAdd").value, 10) || 0;
  $("stNew").textContent = stockProduct.quantity + add;
}
$("stAdd").addEventListener("input", updateStockNew);

$("stockForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  formMsg("stockMsg", "");

  const p = stockProduct;
  const add = parseInt($("stAdd").value, 10);
  if (!add || add < 1) return formMsg("stockMsg", "Enter how many to add (1 or more).");

  const btn = $("stSubmit");
  btn.disabled = true;

  // Read the latest quantity first, so a sale made a moment ago is not overwritten
  const { data: cur, error: readErr } = await supabaseClient
    .from("products").select("quantity").eq("id", p.id).single();
  if (readErr) {
    btn.disabled = false;
    return formMsg("stockMsg", readErr.message);
  }

  const newQty = Number(cur.quantity) + add;
  const { data: updated, error } = await supabaseClient
    .from("products")
    .update({ quantity: newQty })
    .eq("id", p.id)
    .eq("quantity", cur.quantity) // only if nobody changed it in between
    .select("id");
  btn.disabled = false;

  if (error) return formMsg("stockMsg", error.message);
  if (!updated || !updated.length) {
    await loadProducts();
    return formMsg("stockMsg", "The stock changed just now. Please check the number and try again.");
  }

  closeModal("stockModal");
  await loadProducts();
  toast(p.name + ": stock is now " + newQty);
});

// ====== HOME: Generate Bill shortcut ======
$("homeBillBtn").addEventListener("click", () => {
  document.querySelector('.nav-item[data-view="bill"]').click();
});

// ====== SHOP INFO ======
// One row per user (user_id) in the shop_info table, so every user has their own shop details.
// The logo lives in the same storage bucket as the product pictures. Shown on Home (banner) and printed at the top of the PDF bill.
let shopInfo = null;          // saved shop details (null until the first save)
let shopLogoData = null;      // logo prepared for the PDF: { dataUrl, w, h, format }
let pendingLogoFile = null;   // new logo chosen but not saved yet
let removeLogoFlag = false;   // "Remove logo" clicked but not saved yet

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Could not read the logo"));
    r.readAsDataURL(blob);
  });
}

function imageSize(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("Invalid logo"));
    img.src = dataUrl;
  });
}

// Download the saved logo once, so the PDF (which is built instantly) can use it
async function prepareLogoForPdf() {
  shopLogoData = null;
  if (!shopInfo || !shopInfo.logo_path) return;
  try {
    const { data: blob, error } = await supabaseClient.storage.from(IMAGE_BUCKET).download(shopInfo.logo_path);
    if (error || !blob) return;
    const dataUrl = await blobToDataUrl(blob);
    const { w, h } = await imageSize(dataUrl);
    shopLogoData = { dataUrl, w, h, format: blob.type === "image/png" ? "PNG" : "JPEG" };
  } catch (e) {
    shopLogoData = null; // bill will simply print without a logo
  }
}

function logoNode(cls) {
  if (shopInfo && shopInfo.logo_path) {
    const img = el("img", cls);
    img.alt = (shopInfo.shop_name || "Shop") + " logo";
    img.src = imageUrl(shopInfo.logo_path);
    return img;
  }
  return el("div", cls + " ph", ((shopInfo && shopInfo.shop_name) || "S").charAt(0).toUpperCase());
}

function renderShopBanner() {
  const holder = $("shopBannerLogo");
  holder.innerHTML = "";
  holder.appendChild(logoNode("shop-logo-img"));

  if (!shopInfo) {
    $("shopBannerName").textContent = "Set up your shop";
    $("shopBannerLine1").textContent = "Add your shop name, logo, address and phone number.";
    $("shopBannerLine2").textContent = "";
    $("shopBannerEdit").textContent = "Add shop info";
    return;
  }
  $("shopBannerEdit").textContent = "Edit";
  $("shopBannerName").textContent = shopInfo.shop_name || SHOP_NAME;
  $("shopBannerLine1").textContent = [shopInfo.address, shopInfo.city].filter(Boolean).join(", ");
  $("shopBannerLine2").textContent = [
    shopInfo.owner_name ? "Owner: " + shopInfo.owner_name : "",
    shopInfo.phone ? "Phone: " + shopInfo.phone : "",
  ].filter(Boolean).join("  ·  ");
}

async function loadShopInfo() {
  const { data, error } = await supabaseClient.from("shop_info").select("*").eq("user_id", currentUser.id).maybeSingle();
  if (error) console.error("Shop info could not be loaded:", error.message);
  shopInfo = error ? null : data;
  renderShopBanner();
  fillShopForm();
  await prepareLogoForPdf();
}

function showLogoPreview(src) {
  const box = $("shopLogoPreview");
  box.innerHTML = "";
  if (src) {
    const img = el("img", "shop-logo-img");
    img.alt = "Logo preview";
    img.src = src;
    box.appendChild(img);
    $("shopLogoRemove").classList.remove("hidden");
  } else {
    box.appendChild(el("div", "shop-logo-img ph", "Logo"));
    $("shopLogoRemove").classList.add("hidden");
  }
}

function fillShopForm() {
  const s = shopInfo || {};
  $("siName").value = s.shop_name || "";
  $("siOwner").value = s.owner_name || "";
  $("siPhone").value = s.phone || "";
  $("siPhone2").value = s.phone2 || "";
  $("siEmail").value = s.email || "";
  $("siTax").value = s.tax_no || "";
  $("siAddress").value = s.address || "";
  $("siCity").value = s.city || "";
  $("siMap").value = s.map_link || "";
  $("siHours").value = s.opening_hours || "";
  $("siFooter").value = s.bill_footer || "";
  $("shopLogoFile").value = "";
  pendingLogoFile = null;
  removeLogoFlag = false;
  showLogoPreview(s.logo_path ? imageUrl(s.logo_path) : null);
  formMsg("siMsg", "");
}

$("shopLogoFile").addEventListener("change", () => {
  const f = $("shopLogoFile").files[0];
  if (!f) return;
  if (!f.type.startsWith("image/")) {
    $("shopLogoFile").value = "";
    return formMsg("siMsg", "Please choose an image file.");
  }
  formMsg("siMsg", "");
  pendingLogoFile = f;
  removeLogoFlag = false;
  showLogoPreview(URL.createObjectURL(f));
});

$("shopLogoRemove").addEventListener("click", () => {
  pendingLogoFile = null;
  removeLogoFlag = true;
  $("shopLogoFile").value = "";
  showLogoPreview(null);
});

// Logo -> at most 300px. A logo with a transparent background stays a PNG (transparency
// must survive). A logo without one is saved as whichever of PNG / JPEG is smaller.
// Returns { blob, ext }.
async function compressLogo(file) {
  const img = await loadImageFile(file);
  const canvas = scaledCanvas(img, LOGO_MAX_SIDE, false);
  const png = await canvasBlob(canvas, "image/png");
  if (!png) throw new Error("Could not process the logo");

  const px = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let transparent = false;
  for (let i = 3; i < px.length; i += 4) {
    if (px[i] < 250) { transparent = true; break; }
  }
  if (transparent) return { blob: png, ext: "png" };

  const jpg = await canvasBlob(scaledCanvas(img, LOGO_MAX_SIDE, true), "image/jpeg", 0.9);
  if (jpg && jpg.size < png.size) return { blob: jpg, ext: "jpg" };
  return { blob: png, ext: "png" };
}

$("shopForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  formMsg("siMsg", "");

  const v = (id) => $(id).value.trim();
  const name = v("siName");
  const owner = v("siOwner");
  const phone = v("siPhone");
  const address = v("siAddress");
  const map = v("siMap");

  if (!name) return formMsg("siMsg", "Shop name is required.");
  if (!owner) return formMsg("siMsg", "Owner name is required.");
  if (!phone) return formMsg("siMsg", "Shop number is required.");
  if (!address) return formMsg("siMsg", "Shop address is required.");
  if (map && !/^https?:\/\//i.test(map)) return formMsg("siMsg", "The map link must start with http:// or https://");

  const btn = $("siSave");
  btn.disabled = true;
  btn.textContent = "Saving...";

  const oldPath = shopInfo ? shopInfo.logo_path : null;
  let logoPath = removeLogoFlag ? null : oldPath;
  let uploadedPath = null;

  try {
    if (pendingLogoFile) {
      const { blob, ext } = await compressLogo(pendingLogoFile);
      uploadedPath = currentUser.id + "/shop-logo-" + Date.now() + "." + ext;
      const { error: upErr } = await supabaseClient.storage
        .from(IMAGE_BUCKET)
        .upload(uploadedPath, blob, { contentType: blob.type, cacheControl: IMAGE_CACHE });
      if (upErr) throw upErr;
      logoPath = uploadedPath;
    }

    const payload = {
      user_id: currentUser.id,
      shop_name: name,
      owner_name: owner,
      phone,
      phone2: v("siPhone2") || null,
      email: v("siEmail") || null,
      tax_no: v("siTax") || null,
      address,
      city: v("siCity") || null,
      map_link: map || null,
      opening_hours: v("siHours") || null,
      bill_footer: v("siFooter") || null,
      logo_path: logoPath,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabaseClient.from("shop_info").upsert(payload, { onConflict: "user_id" });
    if (error) {
      if (uploadedPath) await supabaseClient.storage.from(IMAGE_BUCKET).remove([uploadedPath]);
      throw error;
    }

    // remove the replaced / removed logo from storage (best effort)
    if (oldPath && oldPath !== logoPath) {
      await supabaseClient.storage.from(IMAGE_BUCKET).remove([oldPath]);
    }

    await loadShopInfo();
    toast("Shop info saved");
  } catch (err) {
    formMsg("siMsg", err.message || "Something went wrong.");
  }

  btn.disabled = false;
  btn.textContent = "Save shop info";
});

$("shopBannerEdit").addEventListener("click", () => {
  document.querySelector('.nav-item[data-view="shopinfo"]').click();
});