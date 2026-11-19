// ====== SUPABASE CONFIG (same values as app.js) ======
const SUPABASE_URL = "https://bebarpebjfqbulerwava.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_to_DWINIxZjm4nB6HdSaUQ_JO5K577U";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ====== SETTINGS (easy to change) ======
const CURRENCY = "Rs";            // shown before every amount
const LOW_STOCK = 1;              // quantity at or below this shows a low-stock warning
const KEEP_DAYS = 90;             // how far back the date picker goes (SQL cleanup also uses 90)
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
    if (btn.dataset.view === "tasks") loadTasks();
    if (btn.dataset.view === "suppliers") loadSuppliers();
    if (btn.dataset.view === "notes") loadNotes();
    if (btn.dataset.view === "categories") { catDetailId = null; loadCategories(); }
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
  renderCategoryViews();
}

// Home: product cards with search
function renderGrid() {
  renderCatChips($("homeCats"), homeCat, (k) => { homeCat = k; renderGrid(); });
  const list = filterProducts(products, $("searchBox").value, homeCat, false);
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
  // fixed-height box keeps the card the same size; on hover the full name opens over the card
  const nameBox = el("div", "p-name-box");
  const nameEl = el("div", "p-name", p.name);
  nameEl.title = p.name; // phones / keyboard: the browser's own tooltip as a backup
  nameBox.appendChild(nameEl);
  card.appendChild(nameBox);
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
$("mgSearch").addEventListener("input", renderProductsTable);

// Manage Products: table
function renderProductsTable() {
  // totals above the table (stock value = price x quantity of every product)
  const units = products.reduce((s, p) => s + Math.max(0, Number(p.quantity) || 0), 0);
  const value = products.reduce((s, p) => s + Number(p.price) * Math.max(0, Number(p.quantity) || 0), 0);
  $("pStockValue").textContent = money(value);
  $("pCount").textContent = products.length;
  $("pUnits").textContent = units.toLocaleString("en-US");

  renderCatChips($("mgCats"), mgCat, (k) => { mgCat = k; renderProductsTable(); });
  const list = filterProducts(products, $("mgSearch").value, mgCat, true);

  const body = $("productsBody");
  body.innerHTML = "";
  $("productsEmpty").classList.toggle("hidden", list.length > 0);
  $("productsEmpty").textContent = products.length ? "No products found." : 'No products yet. Click "Add new product".';

  list.forEach((p) => {
    const tr = document.createElement("tr");

    const tdImg = document.createElement("td");
    tdImg.appendChild(makeThumb(p, "small"));
    tr.appendChild(tdImg);

    const cells = [
      [p.name, ""],
      [categoryName(p.category_id) || "-", ""],
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
  pmCategoryId = p && p.category_id ? p.category_id : null;
  $("pmCatSearch").value = "";
  renderPmCategory();
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
    if (categoriesReady) payload.category_id = pmCategoryId; // only once categories.sql has been run
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

// ====== SALE MANAGEMENT (pick a date range + graphs) ======
const SALES_PAGE = 1000;          // Supabase returns at most 1000 rows per request
const TOP_ITEMS = 10;             // how many items the "most sold" graph shows
let salesReqId = 0;               // ignores an old answer if a newer one was asked for meanwhile
let topMode = "qty";              // "qty" = by quantity, "amount" = by money
let topRows = [];                 // the grouped items of the current range

function setupSalesDate() {
  const from = $("saleFrom");
  const to = $("saleTo");
  const today = localDate();
  const oldest = localDate(new Date(Date.now() - KEEP_DAYS * 86400000));
  [from, to].forEach((i) => {
    i.min = oldest;
    i.max = today;
    i.value = today;
    i.addEventListener("change", () => {
      if (!from.value || !to.value) return;
      if (from.value > to.value) {           // "from" after "to": swap them
        const t = from.value; from.value = to.value; to.value = t;
      }
      loadSalesForDate();
    });
  });

  // quick buttons: Today / Last 7 / 15 / 30 / 60 / 90 days
  document.querySelectorAll("[data-range]").forEach((b) => {
    b.addEventListener("click", () => {
      const days = Number(b.dataset.range);
      from.value = localDate(new Date(Date.now() - (days - 1) * 86400000));
      if (from.value < oldest) from.value = oldest;
      to.value = today;
      loadSalesForDate();
    });
  });

  document.querySelectorAll("[data-top]").forEach((b) => {
    b.addEventListener("click", () => {
      topMode = b.dataset.top;
      renderTopChart();
    });
  });
}

async function fetchSalesRange(from, to) {
  const all = [];
  for (let start = 0; ; start += SALES_PAGE) {
    const { data, error } = await supabaseClient
      .from("sales")
      .select("*")
      .gte("sale_date", from)
      .lte("sale_date", to)
      .order("created_at", { ascending: false })
      .range(start, start + SALES_PAGE - 1);
    if (error) throw error;
    all.push(...data);
    if (data.length < SALES_PAGE) break;
  }
  return all;
}

async function loadSalesForDate() {
  const from = $("saleFrom").value;
  const to = $("saleTo").value;
  if (!from || !to) return;

  const myReq = ++salesReqId;
  let data;
  try {
    data = await fetchSalesRange(from, to);
  } catch (error) {
    return toast(error.message, "error");
  }
  if (myReq !== salesReqId) return; // a newer request is already running

  const single = from === to;
  $("salesDateCol").classList.toggle("hidden", single);

  const body = $("salesBody");
  body.innerHTML = "";
  $("salesEmpty").classList.toggle("hidden", data.length > 0);

  let total = 0;
  let count = 0;
  const perDay = {};   // "2026-11-15" -> money
  const perItem = {};  // item key -> { name, qty, amount }

  data.forEach((s) => {
    const line = Number(s.total);
    total += line;
    count += s.quantity;
    perDay[s.sale_date] = (perDay[s.sale_date] || 0) + line;

    // same product = same row (by product id, or by name for custom entries)
    const key = s.product_id ? "p:" + s.product_id : "n:" + String(s.product_name).trim().toLowerCase();
    const it = perItem[key] || (perItem[key] = { name: s.product_name, qty: 0, amount: 0 });
    it.qty += s.quantity;
    it.amount += line;

    const tr = document.createElement("tr");
    const time = new Date(s.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const cells = [
      time,
      s.product_name + (s.description ? " — " + s.description : ""),
      String(s.quantity),
      money(s.unit_price),
      money(s.total),
    ];
    if (!single) cells.unshift(fmtDate(s.sale_date));
    cells.forEach((t) => tr.appendChild(el("td", "", t)));
    body.appendChild(tr);
  });

  const dayCount = Math.round((new Date(to + "T00:00:00") - new Date(from + "T00:00:00")) / 86400000) + 1;
  $("sTotal").textContent = money(total);
  $("sCount").textContent = count;
  $("sDays").textContent = Object.keys(perDay).length + " / " + dayCount;
  $("sAvg").textContent = money(total / dayCount);
  $("salesRangeLabel").textContent = single ? fmtDate(from) : fmtDate(from) + " to " + fmtDate(to);

  topRows = Object.values(perItem);
  renderTopChart();
  renderDayChart(from, dayCount, perDay);
}

// Horizontal bars: which items sold the most
function renderTopChart() {
  document.querySelectorAll("[data-top]").forEach((b) => b.classList.toggle("active", b.dataset.top === topMode));

  const box = $("topChart");
  box.innerHTML = "";
  $("topEmpty").classList.toggle("hidden", topRows.length > 0);
  if (!topRows.length) { $("topNote").textContent = ""; return; }

  const rows = topRows.slice().sort((a, b) => b[topMode] - a[topMode] || b.amount - a.amount).slice(0, TOP_ITEMS);
  const max = rows[0][topMode] || 1;
  $("topNote").textContent = topRows.length > TOP_ITEMS
    ? "Top " + TOP_ITEMS + " of " + topRows.length + " items"
    : topRows.length + (topRows.length === 1 ? " item" : " items");

  rows.forEach((r, i) => {
    const row = el("div", "bar-row");
    row.appendChild(el("span", "bar-rank", String(i + 1)));
    const mid = el("div", "bar-mid");
    mid.appendChild(el("div", "bar-name", r.name));
    const track = el("div", "bar-track");
    const fill = el("div", "bar-fill" + (i === 0 ? " top" : ""));
    fill.style.width = Math.max(2, (r[topMode] / max) * 100) + "%";
    track.appendChild(fill);
    mid.appendChild(track);
    row.appendChild(mid);
    const val = el("div", "bar-val");
    val.appendChild(el("strong", "", topMode === "qty" ? r.qty + " sold" : money(r.amount)));
    val.appendChild(el("span", "muted small", topMode === "qty" ? money(r.amount) : r.qty + " sold"));
    row.appendChild(val);
    box.appendChild(row);
  });
}

// Vertical bars: how much was sold on each day (only when more than one day is selected)
function renderDayChart(from, dayCount, perDay) {
  const card = $("dayChartCard");
  card.classList.toggle("hidden", dayCount < 2);
  const box = $("dayChart");
  box.innerHTML = "";
  if (dayCount < 2) return;

  const days = [];
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(from + "T00:00:00");
    d.setDate(d.getDate() + i);
    const key = localDate(d);
    days.push({ key, label: d.getDate() + "/" + (d.getMonth() + 1), amount: perDay[key] || 0 });
  }
  const max = Math.max(...days.map((d) => d.amount), 1);

  days.forEach((d) => {
    const col = el("div", "col");
    col.title = fmtDate(d.key) + ": " + money(d.amount);
    const barBox = el("div", "col-bar");
    const fill = el("div", "col-fill" + (d.amount === 0 ? " zero" : ""));
    fill.style.height = d.amount === 0 ? "3px" : Math.max(4, (d.amount / max) * 100) + "%";
    barBox.appendChild(fill);
    col.appendChild(barBox);
    col.appendChild(el("span", "col-label", d.label));
    box.appendChild(col);
  });
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
  await supabaseClient.rpc("cleanup_old_sales"); // delete sales older than 90 days (see sales_retention_90.sql)
  setupSalesDate();
  await loadCategories(true);
  await loadProducts();
  await loadTodaySales();
  await loadBalances();
  loadTasks(true); // task badge + Home reminders (quiet: no error popup at start)
  loadNotes(true); // Notes on the Home page
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

// ---- Export backup: one PDF with every person and every entry ----
async function fetchAllKhataEntries() {
  const all = [];
  const page = 1000; // Supabase returns at most 1000 rows per request
  for (let from = 0; ; from += page) {
    const { data, error } = await supabaseClient
      .from("khata_entries")
      .select("*")
      .order("created_at", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw error;
    all.push(...data);
    if (data.length < page) break;
  }
  return all;
}

function buildKhataBackupPdf(people, entries) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const green = [31, 169, 113];
  const ink = [30, 30, 30];
  const gray = [110, 110, 110];
  const red = [217, 54, 54];
  const pm = (n) => CURRENCY + " " + Number(n).toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  const si = shopInfo || {};
  const now = new Date();
  const stamp = now.toLocaleDateString("en-GB") + " " +
    now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  // ----- Page 1: header + summary of everyone -----
  let textX = M;
  if (shopLogoData) {
    const box = 18;
    const r = Math.min(box / shopLogoData.w, box / shopLogoData.h);
    try {
      doc.addImage(shopLogoData.dataUrl, shopLogoData.format, M, 10, shopLogoData.w * r, shopLogoData.h * r);
      textX = M + box + 5;
    } catch (e) { /* no logo in the backup if it can't be drawn */ }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...ink);
  doc.text(doc.splitTextToSize(si.shop_name || SHOP_NAME, W - M - 60 - textX), textX, 17);
  doc.setFontSize(15);
  doc.setTextColor(...green);
  doc.text("KHATA BACKUP", W - M, 17, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...gray);
  doc.text("Created: " + stamp, W - M, 23, { align: "right" });

  const total = people.reduce((s, p) => s + Number(p.total), 0);
  const owing = people.filter((p) => Number(p.total) > 0).length;
  doc.setDrawColor(...green);
  doc.setLineWidth(0.7);
  doc.line(M, 31, W - M, 31);
  doc.setFontSize(10.5);
  doc.setTextColor(...ink);
  doc.text(
    "People: " + people.length + "     Still owe money: " + owing + "     Total balance: " + pm(total),
    M, 38
  );

  const colorTotal = (d) => {
    if (d.section === "body" && d.column.index === 3) {
      const v = Number(people[d.row.index].total);
      d.cell.styles.textColor = v > 0 ? red : green;
      d.cell.styles.fontStyle = "bold";
    }
  };
  doc.autoTable({
    startY: 43,
    margin: { left: M, right: M, bottom: 20 },
    head: [["#", "Name", "Phone", "Total", "Last entry"]],
    body: people.map((p, i) => [
      i + 1, p.name, p.phone || "-", pm(p.total), p.last_entry ? fmtDateTime(p.last_entry) : "-",
    ]),
    theme: "striped",
    styles: { font: "helvetica", fontSize: 9.5, cellPadding: 2.6, textColor: ink },
    headStyles: { fillColor: green, textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [244, 247, 246] },
    columnStyles: { 0: { cellWidth: 10, halign: "center" }, 3: { halign: "right" } },
    didParseCell: (d) => {
      if (d.section === "head" && d.column.index === 3) d.cell.styles.halign = "right";
      colorTotal(d);
    },
  });

  // ----- Then each person with every entry -----
  const byPerson = {};
  entries.forEach((en) => { (byPerson[en.person_id] = byPerson[en.person_id] || []).push(en); });

  people.forEach((p) => {
    const list = byPerson[p.id] || [];
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...ink);
    doc.text(doc.splitTextToSize(p.name, W - M * 2 - 50), M, 18);
    doc.setFontSize(12);
    doc.setTextColor(...(Number(p.total) > 0 ? red : green));
    doc.text(pm(p.total), W - M, 18, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...gray);
    doc.text(
      (p.phone ? "Phone: " + p.phone + "     " : "") + "Entries: " + list.length,
      M, 25
    );

    doc.autoTable({
      startY: 29,
      margin: { left: M, right: M, bottom: 20 },
      head: [["Date", "Time", "Amount", "Description"]],
      body: list.length
        ? list.map((en) => {
            const a = Number(en.amount);
            return [
              fmtDate(en.entry_date),
              new Date(en.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
              (a > 0 ? "+ " : "- ") + pm(Math.abs(a)),
              en.description || "-",
            ];
          })
        : [["No entries", "", "", ""]],
      theme: "striped",
      styles: { font: "helvetica", fontSize: 9.5, cellPadding: 2.6, textColor: ink },
      headStyles: { fillColor: green, textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [244, 247, 246] },
      columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 20 }, 2: { cellWidth: 36, halign: "right" } },
      didParseCell: (d) => {
        if (d.section === "head" && d.column.index === 2) d.cell.styles.halign = "right";
        if (d.section === "body" && d.column.index === 2 && list.length) {
          d.cell.styles.textColor = Number(list[d.row.index].amount) > 0 ? red : green;
        }
      },
    });
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...gray);
    doc.text((si.shop_name || SHOP_NAME) + " - Khata backup, " + stamp, M, H - 8);
    doc.text("Page " + i + " of " + pages, W - M, H - 8, { align: "right" });
  }
  return doc;
}

$("exportKhataBtn").addEventListener("click", async () => {
  if (!khataPeople.length) return toast("There is no one in Khata to export.", "error");
  if (!window.jspdf || !window.jspdf.jsPDF) {
    return toast("The PDF library could not load. Check the internet and refresh the page.", "error");
  }
  const btn = $("exportKhataBtn");
  btn.disabled = true;
  btn.textContent = "Preparing...";
  try {
    await loadKhata(); // newest totals
    const entries = await fetchAllKhataEntries();
    if (shopInfo && shopInfo.logo_path && !shopLogoData) await prepareLogoForPdf();
    buildKhataBackupPdf(khataPeople, entries).save("Khata-backup-" + localDate() + ".pdf");
    toast("Backup downloaded");
  } catch (e) {
    toast((e && e.message) || "Could not create the backup.", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Export backup (PDF)";
  }
});

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
  renderCatChips($("billCats"), billCat, (k) => { billCat = k; renderBillGrid(); });
  const list = filterProducts(products, $("billSearch").value, billCat, false);
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


// ====== TASK REMINDER ======
// Tasks live in the "tasks" table (one set per user). "Complete" deletes the task.
// A task can have a date. Tasks due today or overdue are counted on the tab badge, and
// they (plus every "very high" task) bounce on the Home page. Click one -> Task Reminder tab.
const PRIORITY_RANK = { low: 1, medium: 2, high: 3, very_high: 4 };
const PRIORITY_LABEL = { low: "Low", medium: "Medium", high: "High", very_high: "Very high" };

let tasks = [];
let taskFilter = "all";
let editingTaskId = null;
let tasksDay = localDate();   // the day the lists were last drawn for (to notice midnight)

async function loadTasks(quiet) {
  const { data, error } = await supabaseClient.from("tasks").select("*").order("created_at", { ascending: true });
  if (error) {
    console.error("Tasks could not be loaded:", error.message);
    if (!quiet) formMsg("tkMsg", "Could not load tasks: " + error.message + " (Did you run tasks.sql in Supabase?)");
    return;
  }
  tasks = data;
  renderTasks();
}

// Whole days from today to the task date: 0 = today, 1 = tomorrow, -2 = two days ago
function daysFromToday(dateStr) {
  const a = new Date(dateStr + "T00:00:00");
  const b = new Date(localDate() + "T00:00:00");
  return Math.round((a - b) / 86400000);
}

function dueLabel(t) {
  if (!t.due_date) return { text: "No date", cls: "none" };
  const d = daysFromToday(t.due_date);
  if (d === 0) return { text: "Today", cls: "today" };
  if (d === 1) return { text: "Tomorrow", cls: "soon" };
  if (d < 0) return { text: "Overdue by " + -d + (d === -1 ? " day" : " days"), cls: "overdue" };
  return { text: fmtDate(t.due_date), cls: "soon" };
}

function taskState(t) {
  if (!t.due_date) return "nodate";
  const d = daysFromToday(t.due_date);
  return d < 0 ? "overdue" : d === 0 ? "today" : "upcoming";
}

// biggest priority first, then the nearest date, then the oldest
function sortTasks(list) {
  return list.slice().sort(
    (a, b) =>
      PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
      (a.due_date || "9999-12-31").localeCompare(b.due_date || "9999-12-31") ||
      String(a.created_at).localeCompare(String(b.created_at))
  );
}

function openTasksTab() {
  document.querySelector('.nav-item[data-view="tasks"]').click();
}

function renderTasks() {
  tasksDay = localDate();

  // counts for the filters and the tab badge (today + overdue need attention)
  const counts = { all: tasks.length, today: 0, overdue: 0, upcoming: 0, nodate: 0 };
  tasks.forEach((t) => counts[taskState(t)]++);
  $("tfAll").textContent = counts.all;
  $("tfToday").textContent = counts.today;
  $("tfOverdue").textContent = counts.overdue;
  $("tfUpcoming").textContent = counts.upcoming;
  $("tfNoDate").textContent = counts.nodate;

  const due = counts.today + counts.overdue;
  $("taskBadge").textContent = due;
  $("taskBadge").classList.toggle("hidden", due === 0);
  $("taskSummary").textContent = counts.all
    ? counts.all + (counts.all === 1 ? " task" : " tasks") + (due ? " · " + due + " due today / overdue" : "")
    : "";

  document.querySelectorAll(".task-filter").forEach((b) => b.classList.toggle("active", b.dataset.filter === taskFilter));

  // the list
  const shown = sortTasks(taskFilter === "all" ? tasks : tasks.filter((t) => taskState(t) === taskFilter));
  const list = $("taskList");
  list.innerHTML = "";
  $("taskEmpty").classList.toggle("hidden", shown.length > 0);
  $("taskEmpty").textContent = tasks.length
    ? "No tasks in this list."
    : "No tasks yet. Add your first task above.";

  shown.forEach((t) => {
    const due = dueLabel(t);
    const li = el("li", "task-item pr-" + t.priority + " st-" + taskState(t));

    const main = el("div", "task-main");
    main.appendChild(el("div", "task-title", t.title));
    const meta = el("div", "task-meta");
    meta.appendChild(el("span", "pr-tag pr-" + t.priority, PRIORITY_LABEL[t.priority]));
    meta.appendChild(el("span", "due-tag due-" + due.cls, due.text));
    if (t.note) meta.appendChild(el("span", "task-note", t.note));
    main.appendChild(meta);
    li.appendChild(main);

    const act = el("div", "task-actions");
    const edit = el("button", "act-btn", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => startEditTask(t));
    const done = el("button", "act-btn task-done", "Complete");
    done.type = "button";
    done.addEventListener("click", () => completeTask(t, li, done));
    act.appendChild(edit);
    act.appendChild(done);
    li.appendChild(act);

    list.appendChild(li);
  });

  renderHomeTasks();
}

// Home page: very high + high priority tasks, and tasks due today / overdue. They ring forever.
function renderHomeTasks() {
  const urgent = sortTasks(
    tasks.filter((t) => t.priority === "very_high" || t.priority === "high" || (t.due_date && daysFromToday(t.due_date) <= 0))
  );
  const box = $("homeTasks");
  const list = $("homeTasksList");
  list.innerHTML = "";
  box.classList.toggle("hidden", urgent.length === 0);

  urgent.forEach((t, i) => {
    const due = dueLabel(t);
    const chip = el("button", "ht-chip pr-" + t.priority + (t.priority === "very_high" ? " dance" : " bounce"));
    chip.type = "button";
    chip.style.animationDelay = (i % 8) * 0.15 + "s"; // chips do not all jump together
    chip.title = "Open Task Reminder";
    chip.appendChild(el("span", "ht-title", t.title));
    chip.appendChild(el("span", "ht-meta", PRIORITY_LABEL[t.priority] + (t.due_date ? " · " + due.text : "")));
    chip.addEventListener("click", openTasksTab);
    list.appendChild(chip);
  });
}

// Filters
document.querySelectorAll(".task-filter").forEach((b) => {
  b.addEventListener("click", () => {
    taskFilter = b.dataset.filter;
    renderTasks();
  });
});

// Add / edit form
function resetTaskForm() {
  editingTaskId = null;
  $("taskForm").reset();
  $("tkPriority").value = "medium";
  $("tkDate").min = localDate();
  $("taskFormTitle").textContent = "Add new task";
  $("tkSubmit").textContent = "Add task";
  $("tkCancel").classList.add("hidden");
  formMsg("tkMsg", "");
}

function startEditTask(t) {
  editingTaskId = t.id;
  $("tkTitle").value = t.title;
  $("tkPriority").value = t.priority;
  $("tkDate").removeAttribute("min"); // an older date may already be set
  $("tkDate").value = t.due_date || "";
  $("tkNote").value = t.note || "";
  $("taskFormTitle").textContent = "Edit task";
  $("tkSubmit").textContent = "Save changes";
  $("tkCancel").classList.remove("hidden");
  formMsg("tkMsg", "");
  $("taskForm").scrollIntoView({ behavior: "smooth", block: "start" });
  $("tkTitle").focus();
}

$("tkCancel").addEventListener("click", resetTaskForm);

$("taskForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  formMsg("tkMsg", "");

  const title = $("tkTitle").value.trim();
  const priority = $("tkPriority").value;
  const date = $("tkDate").value;
  const note = $("tkNote").value.trim();

  if (!title) return formMsg("tkMsg", "Please write the task title.");
  if (!PRIORITY_RANK[priority]) return formMsg("tkMsg", "Please choose a priority.");

  const row = { title, priority, due_date: date || null, note: note || null };

  const btn = $("tkSubmit");
  btn.disabled = true;
  const res = editingTaskId
    ? await supabaseClient.from("tasks").update(row).eq("id", editingTaskId)
    : await supabaseClient.from("tasks").insert(row);
  btn.disabled = false;

  if (res.error) return formMsg("tkMsg", res.error.message);

  const wasEditing = !!editingTaskId;
  resetTaskForm();
  await loadTasks();
  toast(wasEditing ? "Task updated" : "Task added");
});

// Complete = delete the task
async function completeTask(t, li, btn) {
  btn.disabled = true;
  const { error } = await supabaseClient.from("tasks").delete().eq("id", t.id);
  if (error) {
    btn.disabled = false;
    return toast(error.message, "error");
  }
  if (editingTaskId === t.id) resetTaskForm();
  li.classList.add("leaving"); // short fade-out, then the list is redrawn
  setTimeout(() => loadTasks(), 250);
  toast("Task completed");
}

// When midnight passes (or the app comes back to the screen), "today" changes: redraw badge + Home
setInterval(() => {
  if (localDate() !== tasksDay) renderTasks();
}, 60000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && localDate() !== tasksDay) renderTasks();
});

$("tkDate").min = localDate();


// ====== SUPPLIERS ======
// A simple address book of the people you buy from (table "suppliers", one list per user).
// WhatsApp opens the chat with that supplier (same free click-to-chat link as the Khata reminder).
let suppliers = [];
let editingSupplierId = null;

async function loadSuppliers() {
  const { data, error } = await supabaseClient.from("suppliers").select("*").order("name");
  if (error) {
    formMsg("spMsg", "Could not load suppliers: " + error.message + " (Did you run suppliers.sql in Supabase?)");
    return;
  }
  suppliers = data;
  renderSuppliers();
}

function supplierGreeting(s) {
  const si = shopInfo || {};
  const owner = (si.owner_name || "").trim();
  const shop = (si.shop_name || "").trim();
  const sender = owner && shop ? owner + " (" + shop + ")" : owner || shop;
  return "Assalam o Alaikum " + s.name + "," + (sender ? "\n" + sender + " ki taraf se baat kar raha hoon." : "");
}

function openSupplierWhatsApp(s) {
  const num = whatsappNumber(s.phone);
  if (!num) return toast("Add a valid WhatsApp number for " + s.name, "error");
  window.open("https://wa.me/" + num + "?text=" + encodeURIComponent(supplierGreeting(s)), "_blank", "noopener");
}

function renderSuppliers() {
  const q = $("spSearch").value.trim().toLowerCase();
  const list = suppliers.filter((s) =>
    [s.name, s.company, s.items, s.city, s.phone].some((v) => (v || "").toLowerCase().includes(q))
  );

  $("supCount").textContent = suppliers.length + (suppliers.length === 1 ? " supplier" : " suppliers");
  $("supEmpty").classList.toggle("hidden", list.length > 0);
  $("supEmpty").textContent = suppliers.length ? "No supplier found." : "No suppliers yet. Add one above.";

  const body = $("supBody");
  body.innerHTML = "";

  list.forEach((s) => {
    const tr = document.createElement("tr");

    const tdName = el("td");
    tdName.appendChild(el("div", "sup-name", s.name));
    const sub = [s.company, s.city].filter(Boolean).join(" · ");
    if (sub) tdName.appendChild(el("div", "sup-sub", sub));
    tr.appendChild(tdName);

    tr.appendChild(el("td", "", s.phone));

    const tdItems = el("td", "", s.items || "-");
    if (s.note) tdItems.appendChild(el("div", "sup-sub", s.note));
    tr.appendChild(tdItems);

    const act = el("td", "actions");
    [
      ["WhatsApp", "wa", () => openSupplierWhatsApp(s), !whatsappNumber(s.phone)],
      ["Edit", "", () => startEditSupplier(s)],
      ["Delete", "danger", () => deleteSupplier(s)],
    ].forEach(([label, cls, fn, disabled]) => {
      const b = el("button", "act-btn " + cls, label);
      b.type = "button";
      if (disabled) b.disabled = true;
      else b.addEventListener("click", fn);
      act.appendChild(b);
    });
    tr.appendChild(act);
    body.appendChild(tr);
  });
}
$("spSearch").addEventListener("input", renderSuppliers);

function resetSupplierForm() {
  editingSupplierId = null;
  $("supForm").reset();
  $("supFormTitle").textContent = "Add supplier";
  $("spSubmit").textContent = "Add supplier";
  $("spCancel").classList.add("hidden");
  formMsg("spMsg", "");
}

function startEditSupplier(s) {
  editingSupplierId = s.id;
  $("spName").value = s.name;
  $("spPhone").value = s.phone;
  $("spCompany").value = s.company || "";
  $("spCity").value = s.city || "";
  $("spItems").value = s.items || "";
  $("spNote").value = s.note || "";
  $("supFormTitle").textContent = "Edit supplier";
  $("spSubmit").textContent = "Save changes";
  $("spCancel").classList.remove("hidden");
  formMsg("spMsg", "");
  $("supForm").scrollIntoView({ behavior: "smooth", block: "start" });
  $("spName").focus();
}
$("spCancel").addEventListener("click", resetSupplierForm);

$("supForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  formMsg("spMsg", "");

  const v = (id) => $(id).value.trim();
  const name = v("spName");
  const phone = v("spPhone");

  if (!name) return formMsg("spMsg", "Please write the supplier's name.");
  if (!phone) return formMsg("spMsg", "Please write the WhatsApp number.");
  if (!whatsappNumber(phone)) return formMsg("spMsg", "This number does not look right. Example: 0300 1234567");

  const row = {
    name,
    phone,
    company: v("spCompany") || null,
    city: v("spCity") || null,
    items: v("spItems") || null,
    note: v("spNote") || null,
  };

  const btn = $("spSubmit");
  btn.disabled = true;
  const res = editingSupplierId
    ? await supabaseClient.from("suppliers").update(row).eq("id", editingSupplierId)
    : await supabaseClient.from("suppliers").insert(row);
  btn.disabled = false;
  if (res.error) return formMsg("spMsg", res.error.message);

  const wasEditing = !!editingSupplierId;
  resetSupplierForm();
  await loadSuppliers();
  toast(wasEditing ? "Supplier updated" : "Supplier added");
});

async function deleteSupplier(s) {
  if (!confirm('Delete supplier "' + s.name + '"? This cannot be undone.')) return;
  const { error } = await supabaseClient.from("suppliers").delete().eq("id", s.id);
  if (error) return toast(error.message, "error");
  if (editingSupplierId === s.id) resetSupplierForm();
  await loadSuppliers();
  toast("Supplier deleted");
}


// ====== CATEGORIES ======
// A product belongs to ONE category (products.category_id). Categories show as filter buttons on
// Home, Generate Bill and Manage Products, and have their own tab to add products into them.
let categories = [];
let categoriesReady = false;           // true once the categories table exists (categories.sql was run)
let homeCat = "all";                   // selected button: "all", "none" (no category) or a category id
let billCat = "all";
let mgCat = "all";
let catDetailId = null;                // the category opened in the Categories tab
let pmCategoryId = null;               // category picked in the product popup
let cpSelected = new Set();            // products ticked in the "Add products" popup

function categoryName(id) {
  const c = categories.find((x) => x.id === id);
  return c ? c.name : "";
}
function productsInCategory(id) {
  return products.filter((p) => p.category_id === id);
}

async function loadCategories(quiet) {
  const { data, error } = await supabaseClient.from("categories").select("*").order("name");
  if (error) {
    categoriesReady = false;
    categories = [];
    console.error("Categories could not be loaded:", error.message);
    if (!quiet) formMsg("catMsg", "Categories are not set up yet. Run categories.sql in Supabase. (" + error.message + ")");
  } else {
    categoriesReady = true;
    categories = data;
    formMsg("catMsg", "");
  }
  // a selected button whose category no longer exists goes back to "All"
  const exists = (k) => k === "all" || k === "none" || categories.some((c) => c.id === k);
  if (!exists(homeCat)) homeCat = "all";
  if (!exists(billCat)) billCat = "all";
  if (!exists(mgCat)) mgCat = "all";

  renderGrid();
  renderBillGrid();
  renderProductsTable();
  renderCategoryViews();
}

// Products matching the search words (name, category name, and description in Manage Products) + the selected button
function filterProducts(list, query, sel, withDesc) {
  const q = query.trim().toLowerCase();
  return list.filter((p) => {
    if (sel === "none") {
      if (p.category_id) return false;
    } else if (sel !== "all" && p.category_id !== sel) return false;
    if (!q) return true;
    return [p.name, categoryName(p.category_id), withDesc ? p.description : ""].join(" ").toLowerCase().includes(q);
  });
}

// The row of category buttons (All, Drinks, Snacks, ... and "No category")
function renderCatChips(box, current, onPick) {
  box.innerHTML = "";
  box.classList.toggle("hidden", categories.length === 0);
  if (!categories.length) return;

  const add = (label, key, count) => {
    const b = el("button", "cat-chip" + (current === key ? " active" : ""));
    b.type = "button";
    b.appendChild(el("span", "cat-chip-name", label));
    b.appendChild(el("span", "cat-count", String(count)));
    b.addEventListener("click", () => onPick(key));
    box.appendChild(b);
  };
  add("All", "all", products.length);
  categories.forEach((c) => add(c.name, c.id, productsInCategory(c.id).length));
  const loose = products.filter((p) => !p.category_id).length;
  if (loose) add("No category", "none", loose);
}

// ---- Categories tab: list ----
function renderCategoryViews() {
  renderCategoryList();
  renderCategoryDetail();
}

function renderCategoryList() {
  const q = $("catSearch").value.trim().toLowerCase();
  const list = categories.filter((c) => c.name.toLowerCase().includes(q));
  $("catCount").textContent = categories.length + (categories.length === 1 ? " category" : " categories");
  $("catEmpty").classList.toggle("hidden", list.length > 0);
  $("catEmpty").textContent = categories.length ? "No category found." : "No categories yet. Add your first category above.";

  const grid = $("catGrid");
  grid.innerHTML = "";
  list.forEach((c) => {
    const n = productsInCategory(c.id).length;
    const card = el("button", "cat-card");
    card.type = "button";
    card.appendChild(el("span", "cat-card-name", c.name));
    card.appendChild(el("span", "cat-card-count", n + (n === 1 ? " product" : " products")));
    card.addEventListener("click", () => openCategory(c.id));
    grid.appendChild(card);
  });
}
$("catSearch").addEventListener("input", renderCategoryList);

function friendlyCategoryError(error) {
  return error.code === "23505" ? "A category with this name already exists." : error.message;
}

$("catForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  formMsg("catMsg", "");
  const name = $("catName").value.trim();
  if (!name) return formMsg("catMsg", "Please write the category name.");
  if (!categoriesReady) return formMsg("catMsg", "Categories are not set up yet. Run categories.sql in Supabase.");

  $("catAddBtn").disabled = true;
  const { error } = await supabaseClient.from("categories").insert({ name });
  $("catAddBtn").disabled = false;
  if (error) return formMsg("catMsg", friendlyCategoryError(error));

  $("catName").value = "";
  await loadCategories();
  toast("Category added");
});

// ---- Categories tab: one category opened ----
function openCategory(id) {
  catDetailId = id;
  $("catProdSearch").value = "";
  renderCategoryDetail();
}

$("catBack").addEventListener("click", () => {
  catDetailId = null;
  renderCategoryDetail();
});

function renderCategoryDetail() {
  let cat = categories.find((c) => c.id === catDetailId);
  if (!cat) catDetailId = null;
  $("catListMode").classList.toggle("hidden", !!cat);
  $("catDetailMode").classList.toggle("hidden", !cat);
  if (!cat) return;

  const all = productsInCategory(cat.id);
  const q = $("catProdSearch").value.trim().toLowerCase();
  const list = all.filter((p) => p.name.toLowerCase().includes(q));

  $("catDetailName").textContent = cat.name;
  $("catDetailCount").textContent = all.length + (all.length === 1 ? " product" : " products");
  $("catProdEmpty").classList.toggle("hidden", list.length > 0);
  $("catProdEmpty").textContent = all.length
    ? "No product found."
    : 'No products in this category yet. Click "+ Add products".';

  const body = $("catProdBody");
  body.innerHTML = "";
  list.forEach((p) => {
    const tr = document.createElement("tr");
    const tdImg = document.createElement("td");
    tdImg.appendChild(makeThumb(p, "small"));
    tr.appendChild(tdImg);
    tr.appendChild(el("td", "", p.name));
    tr.appendChild(el("td", "", money(p.price)));
    tr.appendChild(el("td", p.quantity <= 0 ? "out" : p.quantity <= LOW_STOCK ? "low" : "", String(p.quantity)));

    const act = el("td", "actions");
    const edit = el("button", "act-btn", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => openProductModal(p));
    const remove = el("button", "act-btn danger", "Remove");
    remove.type = "button";
    remove.title = "Take this product out of the category (the product is not deleted)";
    remove.addEventListener("click", () => removeFromCategory(p));
    act.appendChild(edit);
    act.appendChild(remove);
    tr.appendChild(act);
    body.appendChild(tr);
  });
}
$("catProdSearch").addEventListener("input", renderCategoryDetail);

async function removeFromCategory(p) {
  const { error } = await supabaseClient.from("products").update({ category_id: null }).eq("id", p.id);
  if (error) return toast(error.message, "error");
  await loadProducts();
  toast("Removed from category");
}

$("catRenameBtn").addEventListener("click", async () => {
  const cat = categories.find((c) => c.id === catDetailId);
  if (!cat) return;
  const name = (prompt("New name for this category:", cat.name) || "").trim();
  if (!name || name === cat.name) return;
  const { error } = await supabaseClient.from("categories").update({ name }).eq("id", cat.id);
  if (error) return toast(friendlyCategoryError(error), "error");
  await loadCategories();
  toast("Category renamed");
});

$("catDeleteBtn").addEventListener("click", async () => {
  const cat = categories.find((c) => c.id === catDetailId);
  if (!cat) return;
  const n = productsInCategory(cat.id).length;
  const msg =
    'Delete category "' + cat.name + '"?' +
    (n ? "\n\nIts " + n + " product(s) are NOT deleted, they just become \"No category\"." : "");
  if (!confirm(msg)) return;
  const { error } = await supabaseClient.from("categories").delete().eq("id", cat.id);
  if (error) return toast(error.message, "error");
  catDetailId = null;
  await loadCategories();
  await loadProducts();
  toast("Category deleted");
});

// ---- "+ Add products" popup: tick saved products and put them in this category ----
$("catAddProductsBtn").addEventListener("click", () => {
  const cat = categories.find((c) => c.id === catDetailId);
  if (!cat) return;
  cpSelected = new Set();
  $("cpSearch").value = "";
  $("cpTitle").textContent = 'Add products to "' + cat.name + '"';
  formMsg("cpMsg", "");
  renderCatPicker();
  openModal("catPickModal");
  $("cpSearch").focus();
});

function renderCatPicker() {
  const q = $("cpSearch").value.trim().toLowerCase();
  const rank = (p) => (p.category_id === catDetailId ? 2 : p.category_id ? 1 : 0); // no category first, already here last
  const list = products
    .filter((p) => [p.name, categoryName(p.category_id)].join(" ").toLowerCase().includes(q))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  const box = $("cpList");
  box.innerHTML = "";
  if (!list.length) {
    box.appendChild(el("p", "empty", products.length ? "No product found." : "No products yet. Add some in Manage Products."));
  }
  list.forEach((p) => {
    const here = p.category_id === catDetailId;
    const row = el("label", "cp-row" + (here ? " here" : ""));
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = here || cpSelected.has(p.id);
    cb.disabled = here;
    cb.addEventListener("change", () => {
      if (cb.checked) cpSelected.add(p.id);
      else cpSelected.delete(p.id);
      updateCpCount();
    });
    row.appendChild(cb);
    row.appendChild(makeThumb(p, "small"));
    row.appendChild(el("span", "cp-name", p.name));
    const tag = here ? "Already here" : p.category_id ? "In: " + categoryName(p.category_id) + " (will move)" : "No category";
    row.appendChild(el("span", "cp-tag" + (p.category_id && !here ? " move" : ""), tag));
    box.appendChild(row);
  });
  updateCpCount();
}
function updateCpCount() {
  const n = cpSelected.size;
  $("cpSelCount").textContent = n + " selected";
  $("cpSave").disabled = n === 0;
}
$("cpSearch").addEventListener("input", renderCatPicker);

$("cpSave").addEventListener("click", async () => {
  if (!cpSelected.size || !catDetailId) return;
  $("cpSave").disabled = true;
  const n = cpSelected.size;
  const { error } = await supabaseClient.from("products").update({ category_id: catDetailId }).in("id", [...cpSelected]);
  if (error) {
    $("cpSave").disabled = false;
    return formMsg("cpMsg", error.message);
  }
  closeModal("catPickModal");
  await loadProducts();
  toast(n + (n === 1 ? " product added" : " products added"));
});

// ---- Product popup: search a category, pick it, or create a new one on the spot ----
function renderPmCategory() {
  $("pmCatField").classList.toggle("hidden", !categoriesReady);

  const sel = $("pmCatSelected");
  sel.innerHTML = "";
  if (pmCategoryId && categoryName(pmCategoryId)) {
    const chip = el("span", "cat-selected-chip", categoryName(pmCategoryId));
    const x = el("button", "cat-x", "\u00d7");
    x.type = "button";
    x.title = "Remove category";
    x.addEventListener("click", () => { pmCategoryId = null; renderPmCategory(); });
    chip.appendChild(x);
    sel.appendChild(chip);
  } else {
    sel.appendChild(el("span", "muted small", "No category selected"));
  }

  const q = $("pmCatSearch").value.trim();
  const ql = q.toLowerCase();
  const box = $("pmCatOptions");
  box.innerHTML = "";
  const matches = categories.filter((c) => c.name.toLowerCase().includes(ql));
  matches.forEach((c) => {
    const b = el("button", "cat-opt" + (c.id === pmCategoryId ? " selected" : ""), c.name);
    b.type = "button";
    b.addEventListener("click", () => { pmCategoryId = c.id; renderPmCategory(); });
    box.appendChild(b);
  });
  if (q && !categories.some((c) => c.name.toLowerCase() === ql)) {
    const b = el("button", "cat-opt create", '+ Create "' + q + '"');
    b.type = "button";
    b.addEventListener("click", () => createCategoryFromPicker(q));
    box.appendChild(b);
  }
  if (!box.children.length) box.appendChild(el("span", "muted small", "No categories yet. Type a name to create one."));
}

async function createCategoryFromPicker(name) {
  formMsg("productFormMsg", "");
  const { error } = await supabaseClient.from("categories").insert({ name });
  if (error && error.code !== "23505") return formMsg("productFormMsg", friendlyCategoryError(error));
  await loadCategories(true);
  const made = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (made) pmCategoryId = made.id;
  $("pmCatSearch").value = "";
  renderPmCategory();
}

$("pmCatSearch").addEventListener("input", renderPmCategory);
// Enter in this box must not save the whole product form: it picks the first match instead
$("pmCatSearch").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const first = $("pmCatOptions").querySelector(".cat-opt");
  if (first) first.click();
});

// ====== NOTES ======
// Each note: optional title, text, background color, pinned yes/no, optional date & time.
// Pinned / newest notes also show on the Home page.
const NOTE_COLORS = ["default", "yellow", "green", "blue", "pink", "purple", "orange", "gray"];
const HOME_NOTES_MAX = 8;
let notes = [];
let notesReady = false;      // true once notes.sql has been run
let noteEditId = null;       // note being edited (null = adding a new one)
let noteColor = "default";

async function loadNotes(quiet) {
  const { data, error } = await supabaseClient.from("notes").select("*");
  if (error) {
    notesReady = false;
    notes = [];
    console.error("Notes could not be loaded:", error.message);
    if (!quiet) formMsg("ntMsg", "Could not load notes: " + error.message + " (Did you run notes.sql in Supabase?)");
  } else {
    notesReady = true;
    notes = data;
    formMsg("ntMsg", "");
  }
  if (noteEditId && !notes.some((n) => n.id === noteEditId)) resetNoteForm();
  renderNotes();
  renderHomeNotes();
}

// pinned first, then newest
function sortedNotes() {
  return [...notes].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.created_at) - new Date(a.created_at)
  );
}

function noteWhen(n) {
  if (!n.remind_at) return null;
  const d = new Date(n.remind_at);
  const text = d.toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return { text, overdue: d.getTime() < Date.now() };
}

function toLocalInput(iso) {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function makeNoteCard(n, forHome) {
  const card = el(forHome ? "button" : "div", "note-card c-" + n.color + (forHome ? " home" : ""));
  if (forHome) card.type = "button";
  const when = noteWhen(n);
  if (when && when.overdue) card.classList.add("overdue");

  if (n.title || n.pinned) {
    const head = el("div", "note-head");
    head.appendChild(el("span", "note-title", n.title || ""));
    if (n.pinned) head.appendChild(el("span", "note-pin", "📌"));
    card.appendChild(head);
  }
  card.appendChild(el("p", "note-body", n.body));

  const foot = el("div", "note-foot");
  if (when) foot.appendChild(el("span", "note-when" + (when.overdue ? " overdue" : ""), "⏰ " + when.text));
  foot.appendChild(el("span", "note-created", "Added " + fmtDateTime(n.created_at)));
  card.appendChild(foot);
  return card;
}

function renderNotes() {
  const q = $("noteSearch").value.trim().toLowerCase();
  const list = sortedNotes().filter((n) => ((n.title || "") + " " + n.body).toLowerCase().includes(q));
  $("noteSummary").textContent = notes.length + (notes.length === 1 ? " note" : " notes");
  $("noteEmpty").classList.toggle("hidden", list.length > 0);
  $("noteEmpty").textContent = notes.length
    ? "No note found."
    : notesReady ? "No notes yet. Write your first note above." : "Notes are not set up yet. Run notes.sql in Supabase.";

  const grid = $("noteGrid");
  grid.innerHTML = "";
  list.forEach((n) => {
    const card = makeNoteCard(n, false);
    const act = el("div", "note-actions");
    const pin = el("button", "act-btn", n.pinned ? "Unpin" : "Pin");
    pin.type = "button";
    pin.addEventListener("click", () => toggleNotePin(n));
    const edit = el("button", "act-btn", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => startEditNote(n.id));
    const del = el("button", "act-btn danger", "Delete");
    del.type = "button";
    del.addEventListener("click", () => deleteNote(n));
    act.appendChild(pin);
    act.appendChild(edit);
    act.appendChild(del);
    card.appendChild(act);
    grid.appendChild(card);
  });
}
$("noteSearch").addEventListener("input", renderNotes);

function renderHomeNotes() {
  const list = sortedNotes().slice(0, HOME_NOTES_MAX);
  $("homeNotes").classList.toggle("hidden", list.length === 0);
  const wrap = $("homeNotesList");
  wrap.innerHTML = "";
  list.forEach((n) => {
    const card = makeNoteCard(n, true);
    card.addEventListener("click", () => {
      document.querySelector('.nav-item[data-view="notes"]').click();
      startEditNote(n.id);
    });
    wrap.appendChild(card);
  });
}

// ---- color picker in the form ----
function renderNoteColors() {
  const box = $("ntColors");
  box.innerHTML = "";
  NOTE_COLORS.forEach((c) => {
    const b = el("button", "note-swatch c-" + c + (c === noteColor ? " active" : ""));
    b.type = "button";
    b.title = c === "default" ? "No color" : c;
    b.setAttribute("aria-label", b.title);
    b.addEventListener("click", () => { noteColor = c; renderNoteColors(); });
    box.appendChild(b);
  });
}
renderNoteColors();

function resetNoteForm() {
  noteEditId = null;
  noteColor = "default";
  $("noteForm").reset();
  $("noteFormTitle").textContent = "Add new note";
  $("ntSubmit").textContent = "Add note";
  $("ntCancel").classList.add("hidden");
  renderNoteColors();
}
$("ntCancel").addEventListener("click", () => { resetNoteForm(); formMsg("ntMsg", ""); });

function startEditNote(id) {
  const n = notes.find((x) => x.id === id);
  if (!n) return;
  noteEditId = id;
  noteColor = NOTE_COLORS.includes(n.color) ? n.color : "default";
  $("ntTitle").value = n.title || "";
  $("ntBody").value = n.body;
  $("ntRemind").value = n.remind_at ? toLocalInput(n.remind_at) : "";
  $("ntPin").checked = !!n.pinned;
  $("noteFormTitle").textContent = "Edit note";
  $("ntSubmit").textContent = "Save changes";
  $("ntCancel").classList.remove("hidden");
  formMsg("ntMsg", "");
  renderNoteColors();
  $("noteForm").scrollIntoView({ behavior: "smooth", block: "start" });
  $("ntBody").focus();
}

$("noteForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  formMsg("ntMsg", "");
  const body = $("ntBody").value.trim();
  if (!body) return formMsg("ntMsg", "Please write the note.");
  if (!notesReady) return formMsg("ntMsg", "Notes are not set up yet. Run notes.sql in Supabase.");

  const remind = $("ntRemind").value;
  const payload = {
    title: $("ntTitle").value.trim() || null,
    body,
    color: noteColor,
    pinned: $("ntPin").checked,
    remind_at: remind ? new Date(remind).toISOString() : null,
  };

  $("ntSubmit").disabled = true;
  const q = noteEditId
    ? supabaseClient.from("notes").update(payload).eq("id", noteEditId)
    : supabaseClient.from("notes").insert(payload);
  const { error } = await q;
  $("ntSubmit").disabled = false;
  if (error) return formMsg("ntMsg", error.message);

  const wasEdit = !!noteEditId;
  resetNoteForm();
  await loadNotes(true);
  toast(wasEdit ? "Note updated" : "Note added");
});

async function toggleNotePin(n) {
  const { error } = await supabaseClient.from("notes").update({ pinned: !n.pinned }).eq("id", n.id);
  if (error) return toast(error.message, "error");
  await loadNotes(true);
}

async function deleteNote(n) {
  if (!confirm("Delete this note?" + (n.title ? '\n\n"' + n.title + '"' : ""))) return;
  const { error } = await supabaseClient.from("notes").delete().eq("id", n.id);
  if (error) return toast(error.message, "error");
  if (noteEditId === n.id) resetNoteForm();
  await loadNotes(true);
  toast("Note deleted");
}