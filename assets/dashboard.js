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
function closeModal(id) { $(id).classList.add("hidden"); }

document.querySelectorAll(".modal").forEach((m) => {
  m.addEventListener("click", (e) => {
    if (e.target === m || e.target.hasAttribute("data-close")) m.classList.add("hidden");
  });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.querySelectorAll(".modal").forEach((m) => m.classList.add("hidden"));
});

// ====== TABS ======
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    $("view-" + btn.dataset.view).classList.remove("hidden");
    if (btn.dataset.view === "sales") loadSalesForDate();
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
  if (!confirm('Remove "' + sale.product_name + '" from today\'s sale? The quantity goes back to stock.')) return;

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
    [time, s.product_name, String(s.quantity), money(s.unit_price), money(s.total)].forEach((t) =>
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
})();