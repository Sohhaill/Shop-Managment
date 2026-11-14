// ====== SUPABASE CONFIG (same values as app.js) ======
const SUPABASE_URL = "https://bebarpebjfqbulerwava.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_to_DWINIxZjm4nB6HdSaUQ_JO5K577U";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ====== SETTINGS (easy to change) ======
const CURRENCY = "Rs";            // shown before every amount
const LOW_STOCK = 5;              // quantity at or below this shows a low-stock warning
const KEEP_DAYS = 30;             // how far back the date picker goes (SQL cleanup also uses 30)
const IMAGE_BUCKET = "product-images";
const MAX_IMAGE_SIDE = 700;       // product images are shrunk to this size before upload

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
    if (btn.dataset.view === "pin") loadPinStatus();
  });
});

// ====== PRODUCTS: LOAD + RENDER ======
async function loadProducts() {
  const { data, error } = await supabaseClient.from("products").select("*").order("name");
  if (error) return toast(error.message, "error");
  products = data;
  renderGrid();
  renderProductsTable();
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

  list.forEach((p) => {
    const card = el("div", "product-card");
    card.appendChild(makeThumb(p));
    card.appendChild(el("div", "p-name", p.name));
    card.appendChild(el("div", "p-price", money(p.price)));

    const stock = el("div", "p-stock", p.quantity > 0 ? "In stock: " + p.quantity : "Out of stock");
    if (p.quantity <= 0) stock.classList.add("out");
    else if (p.quantity <= LOW_STOCK) stock.classList.add("low");
    card.appendChild(stock);

    const btn = el("button", "add-btn", p.quantity > 0 ? "Add" : "Out of stock");
    btn.type = "button";
    btn.disabled = p.quantity <= 0;
    btn.addEventListener("click", () => openSaleModal(p));
    card.appendChild(btn);

    grid.appendChild(card);
  });
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
    del.title = "Remove (stock will be restored)";
    del.addEventListener("click", () => removeSale(s, del));
    right.appendChild(del);

    li.appendChild(info);
    li.appendChild(right);
    list.appendChild(li);
  });

  $("todayCount").textContent = count;
  $("todayTotal").textContent = money(total);
}

async function removeSale(sale, btn) {
  const msg = sale.product_id
    ? 'Remove "' + sale.product_name + '" from today\'s sale? The quantity goes back to stock.'
    : 'Remove "' + sale.product_name + '" from today\'s sale?';
  if (!confirm(msg)) return;

  btn.disabled = true;
  const { error } = await supabaseClient.rpc("delete_sale", { p_sale_id: sale.id });
  if (error) {
    btn.disabled = false;
    return toast(error.message, "error");
  }

  await Promise.all([loadProducts(), loadTodaySales()]);
  toast("Removed, stock restored");
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

// Shrink the picture before upload to save storage
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; // white background for transparent PNGs
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not process image"))), "image/jpeg", 0.8);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Invalid image file"));
    };
    img.src = url;
  });
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
      const blob = await compressImage(file);
      uploadedPath = currentUser.id + "/" + Date.now() + ".jpg";
      const { error: upErr } = await supabaseClient.storage
        .from(IMAGE_BUCKET)
        .upload(uploadedPath, blob, { contentType: "image/jpeg" });
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
    [
      ["History", "", () => showHistory(p)],
      ["Edit entry", "", () => startEditEntry(p)],
      ["Delete", "danger", () => deletePerson(p)],
    ].forEach(([label, cls, fn]) => {
      const b = el("button", "act-btn " + cls, label);
      b.type = "button";
      b.addEventListener("click", fn);
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