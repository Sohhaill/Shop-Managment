// ====== SUPABASE CONFIG (same values as app.js) ======
const SUPABASE_URL = "https://bebarpebjfqbulerwava.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_to_DWINIxZjm4nB6HdSaUQ_JO5K577U";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ====== ELEMENTS ======
const loginCard = document.getElementById("loginCard");
const loginForm = document.getElementById("adminLoginForm");
const dashboard = document.getElementById("dashboard");
const logoutBtn = document.getElementById("logoutBtn");
const messageBox = document.getElementById("message");

// ====== HELPERS ======
function showMessage(text, type = "error") {
  messageBox.textContent = text;
  messageBox.className = "message " + type;
}

function clearMessage() {
  messageBox.textContent = "";
  messageBox.className = "message";
}

function showLogin() {
  loginCard.classList.remove("hidden");
  dashboard.classList.add("hidden");
  logoutBtn.classList.add("hidden");
}

function showDashboard(user) {
  loginCard.classList.add("hidden");
  dashboard.classList.remove("hidden");
  logoutBtn.classList.remove("hidden");
  document.getElementById("welcomeText").textContent = "Logged in as " + user.email;
  loadUsers();
}

// Returns true only if the logged-in user has role = 'admin' in profiles.
// (The real protection is Row Level Security in the database, this is the UI check.)
async function isAdmin(user) {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  return !error && data && data.role === "admin";
}

// ====== LOGIN ======
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMessage();

  const email = document.getElementById("adminEmail").value.trim();
  const password = document.getElementById("adminPassword").value;
  const btn = document.getElementById("adminLoginBtn");

  if (!email || !password) {
    return showMessage("Please enter email and password.");
  }

  btn.disabled = true;
  btn.textContent = "Checking...";

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

  if (error) {
    btn.disabled = false;
    btn.textContent = "Log in";
    return showMessage(error.message);
  }

  if (!(await isAdmin(data.user))) {
    await supabaseClient.auth.signOut();
    btn.disabled = false;
    btn.textContent = "Log in";
    return showMessage("Access denied. This account is not an admin.");
  }

  btn.disabled = false;
  btn.textContent = "Log in";
  loginForm.reset();
  showDashboard(data.user);
});

// ====== LOGOUT ======
logoutBtn.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  clearMessage();
  showLogin();
});

// ====== ON PAGE LOAD: keep admin logged in, kick out normal users ======
(async () => {
  const { data } = await supabaseClient.auth.getSession();
  const user = data.session && data.session.user;

  if (user && (await isAdmin(user))) {
    showDashboard(user);
  } else {
    showLogin();
  }
})();

// ====== THEME TOGGLE ======
const root = document.documentElement;

document.getElementById("themeToggle").addEventListener("click", () => {
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try { localStorage.setItem("theme", next); } catch (e) {}
});
// ====== USER REQUESTS (approve / reject) ======
let currentStatus = "pending";
let allUsers = [];

function showPanelMessage(text) {
  const box = document.getElementById("panelMessage");
  box.textContent = text;
  box.className = "message error";
}

function clearPanelMessage() {
  const box = document.getElementById("panelMessage");
  box.textContent = "";
  box.className = "message";
}

async function loadUsers() {
  clearPanelMessage();
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, full_name, email, status, created_at")
    .eq("role", "user")
    .order("created_at", { ascending: false });

  if (error) return showPanelMessage(error.message);

  allUsers = data;
  renderUsers();
}

function renderUsers() {
  ["pending", "approved", "rejected"].forEach((s) => {
    document.getElementById("count-" + s).textContent =
      allUsers.filter((u) => u.status === s).length;
  });

  const rows = allUsers.filter((u) => u.status === currentStatus);
  const body = document.getElementById("usersBody");
  body.innerHTML = "";
  document.getElementById("emptyText").classList.toggle("hidden", rows.length > 0);

  rows.forEach((u) => {
    const tr = document.createElement("tr");

    [u.full_name || "-", u.email, new Date(u.created_at).toLocaleDateString()].forEach((text) => {
      const td = document.createElement("td");
      td.textContent = text; // textContent keeps user-entered names safe from HTML injection
      tr.appendChild(td);
    });

    const actions = document.createElement("td");
    actions.className = "actions";
    if (u.status !== "approved") actions.appendChild(makeBtn("Approve", "approve", u.id, "approved"));
    if (u.status === "pending") actions.appendChild(makeBtn("Reject", "reject", u.id, "rejected"));
    if (u.status === "approved") actions.appendChild(makeBtn("Revoke", "reject", u.id, "rejected"));
    tr.appendChild(actions);

    body.appendChild(tr);
  });
}

function makeBtn(label, cls, id, newStatus) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "act-btn " + cls;
  b.textContent = label;
  b.addEventListener("click", () => setStatus(id, newStatus, b));
  return b;
}

async function setStatus(id, status, btn) {
  btn.disabled = true;
  const { error } = await supabaseClient.from("profiles").update({ status }).eq("id", id);
  if (error) {
    btn.disabled = false;
    return showPanelMessage(error.message);
  }
  await loadUsers();
}

document.querySelectorAll("#statusTabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#statusTabs .tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    currentStatus = tab.dataset.status;
    renderUsers();
  });
});