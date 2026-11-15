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

function showPanelMessage(text, type = "error") {
  const box = document.getElementById("panelMessage");
  box.textContent = text;
  box.className = "message " + type;
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

    [
      ["Name", u.full_name || "-"],
      ["Email", u.email],
      ["Signed up", new Date(u.created_at).toLocaleDateString()],
    ].forEach(([label, text]) => {
      const td = document.createElement("td");
      td.dataset.label = label; // the phone layout shows this label above the value
      td.textContent = text; // textContent keeps user-entered names safe from HTML injection
      tr.appendChild(td);
    });

    const actions = document.createElement("td");
    actions.className = "actions";
    actions.dataset.label = "Actions";
    if (u.status !== "approved") actions.appendChild(makeBtn("Approve", "approve", u.id, "approved"));
    if (u.status === "pending") actions.appendChild(makeBtn("Reject", "reject", u.id, "rejected"));
    if (u.status === "approved") {
      actions.appendChild(makeActionBtn("Reset password", "", () => openPasswordModal(u)));
      actions.appendChild(makeActionBtn("Reset PIN", "", () => openPinModal(u)));
      actions.appendChild(makeBtn("Revoke", "reject", u.id, "rejected"));
    }
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

function makeActionBtn(label, cls, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "act-btn " + cls;
  b.textContent = label;
  b.addEventListener("click", onClick);
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

// ====== RESET PASSWORD / RESET PIN (for approved users) ======
// Password: the "admin-reset-password" Edge Function (it checks on the server that you are an admin).
// PIN:      the admin_reset_pin SQL function (removes the user's PIN, they set a new one themselves).
let resetUser = null; // the user shown in the open popup

function openModal(id) {
  document.getElementById(id).classList.remove("hidden");
}
function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
  if (id === "pwModal") document.getElementById("pwNew").value = ""; // do not keep a password in the page
  resetUser = null;
}

document.querySelectorAll(".modal").forEach((modal) => {
  modal.addEventListener("click", (e) => {
    // click on the dark background or on a [data-close] button
    if (e.target === modal || e.target.closest("[data-close]")) closeModal(modal.id);
  });
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  document.querySelectorAll(".modal:not(.hidden)").forEach((m) => closeModal(m.id));
});

function setMsg(id, text, type = "error") {
  const box = document.getElementById(id);
  box.textContent = text;
  box.className = "message " + type;
}

function whoText(u) {
  return (u.full_name || "No name") + " (" + u.email + ")";
}

// Easy to read out loud: no 0/O, 1/l/I
function randomPassword(length = 8) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const limit = 256 - (256 % chars.length); // avoids a slight bias towards the first letters
  let out = "";
  while (out.length < length) {
    const buf = new Uint8Array(length * 2);
    crypto.getRandomValues(buf);
    for (const n of buf) {
      if (n < limit && out.length < length) out += chars[n % chars.length];
    }
  }
  return out;
}

// ----- password -----
function openPasswordModal(u) {
  resetUser = u;
  document.getElementById("pwWho").textContent = whoText(u);
  document.getElementById("pwNew").value = "";
  document.getElementById("pwForm").classList.remove("hidden");
  document.getElementById("pwDone").classList.add("hidden");
  setMsg("pwMsg", "");
  openModal("pwModal");
  document.getElementById("pwNew").focus();
}

document.getElementById("pwGen").addEventListener("click", () => {
  document.getElementById("pwNew").value = randomPassword();
  setMsg("pwMsg", "");
});

// Turns the error of supabase.functions.invoke() into a readable message
async function functionErrorText(error) {
  const res = error && error.context;
  if (res && typeof res.json === "function") {
    try {
      const body = await res.json();
      if (body && body.error) return body.error; // message written by our function
    } catch (e) {}
    if (res.status === 404) {
      return "The Edge Function is not deployed yet. Deploy admin-reset-password in Supabase first.";
    }
  }
  if (error && error.name === "FunctionsFetchError") {
    return "Could not reach the function. Check the internet, and that admin-reset-password is deployed.";
  }
  return (error && error.message) || "Something went wrong.";
}

document.getElementById("pwForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!resetUser) return;

  const pass = document.getElementById("pwNew").value.trim();
  if (pass.length < 6) return setMsg("pwMsg", "Password must be at least 6 characters.");
  if (pass.length > 72) return setMsg("pwMsg", "Password is too long (max 72 characters).");

  const btn = document.getElementById("pwSave");
  btn.disabled = true;
  btn.textContent = "Saving...";
  setMsg("pwMsg", "");

  const { error } = await supabaseClient.functions.invoke("admin-reset-password", {
    body: { user_id: resetUser.id, new_password: pass },
  });

  btn.disabled = false;
  btn.textContent = "Set new password";
  if (error) return setMsg("pwMsg", await functionErrorText(error));

  // success: show the password once so it can be told to the user
  document.getElementById("pwForm").classList.add("hidden");
  document.getElementById("pwShown").value = pass;
  document.getElementById("pwNew").value = "";
  document.getElementById("pwDone").classList.remove("hidden");
  showPanelMessage("Password changed for " + whoText(resetUser) + ".", "success");
});

document.getElementById("pwCopy").addEventListener("click", async () => {
  const input = document.getElementById("pwShown");
  const btn = document.getElementById("pwCopy");
  try {
    await navigator.clipboard.writeText(input.value);
  } catch (e) {
    input.select(); // older browsers: select it so Ctrl+C works
    try { document.execCommand("copy"); } catch (e2) {}
  }
  btn.textContent = "Copied";
  setTimeout(() => (btn.textContent = "Copy"), 1500);
});

// ----- PIN -----
function openPinModal(u) {
  resetUser = u;
  document.getElementById("pinWho").textContent = whoText(u);
  setMsg("pinMsg", "");
  openModal("pinModal");
}

document.getElementById("pinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!resetUser) return;

  const btn = document.getElementById("pinSave");
  btn.disabled = true;
  btn.textContent = "Resetting...";
  setMsg("pinMsg", "");

  const { data, error } = await supabaseClient.rpc("admin_reset_pin", { p_user_id: resetUser.id });

  btn.disabled = false;
  btn.textContent = "Reset PIN";

  if (error) {
    const missing = error.code === "PGRST202" || /could not find the function/i.test(error.message || "");
    return setMsg("pinMsg", missing
      ? "The admin_reset_pin SQL is not installed yet. Run supabase/admin_reset_pin.sql in Supabase first."
      : error.message);
  }
  if (data === "denied") return setMsg("pinMsg", "Only an admin can do this.");
  if (data === "notfound") return setMsg("pinMsg", "This user does not have a PIN set, nothing to reset.");
  if (data !== "ok") return setMsg("pinMsg", "Something went wrong.");

  const who = whoText(resetUser);
  closeModal("pinModal");
  showPanelMessage("PIN removed for " + who + ". They can set a new one in the PIN & Password tab.", "success");
});