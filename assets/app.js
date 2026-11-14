// ====== SUPABASE CONFIG ======
// Paste your anon (public) key from: Supabase Dashboard > Project Settings > API
// NEVER put the service_role key here.
const SUPABASE_URL = "https://bebarpebjfqbulerwava.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_to_DWINIxZjm4nB6HdSaUQ_JO5K577U";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ====== ELEMENTS ======
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
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

// ====== SWITCH BETWEEN LOGIN / SIGNUP ======
document.getElementById("showSignup").addEventListener("click", (e) => {
  e.preventDefault();
  loginForm.classList.add("hidden");
  signupForm.classList.remove("hidden");
  clearMessage();
});

document.getElementById("showLogin").addEventListener("click", (e) => {
  e.preventDefault();
  signupForm.classList.add("hidden");
  loginForm.classList.remove("hidden");
  clearMessage();
});

// ====== LOGIN ======
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMessage();

  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const btn = document.getElementById("loginBtn");

  if (!email || !password) {
    return showMessage("Please enter email and password.");
  }

  btn.disabled = true;
  btn.textContent = "Logging in...";

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

  if (error) {
    btn.disabled = false;
    btn.textContent = "Log in";
    return showMessage(error.message);
  }

  // Only approved users may log in
  const { data: profile } = await supabaseClient
    .from("profiles")
    .select("status")
    .eq("id", data.user.id)
    .single();

  btn.disabled = false;
  btn.textContent = "Log in";

  if (!profile || profile.status !== "approved") {
    await supabaseClient.auth.signOut();
    return showMessage(
      profile && profile.status === "rejected"
        ? "Your account request was not approved."
        : "Your account is waiting for admin approval."
    );
  }

  showMessage("Login successful!", "success");
    window.location.href = "dashboard.html";
});

// ====== SIGNUP ======
signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMessage();

  const name = document.getElementById("signupName").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  const confirm = document.getElementById("signupConfirm").value;
  const btn = document.getElementById("signupBtn");

  if (!name || !email || !password || !confirm) {
    return showMessage("Please fill in all fields.");
  }
  if (password.length < 6) {
    return showMessage("Password must be at least 6 characters.");
  }
  if (password !== confirm) {
    return showMessage("Passwords do not match.");
  }

  btn.disabled = true;
  btn.textContent = "Creating account...";

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: { data: { full_name: name } },
  });

  btn.disabled = false;
  btn.textContent = "Sign up";

  if (error) {
    return showMessage(error.message);
  }

  // Don't leave the new user logged in while waiting for approval
  await supabaseClient.auth.signOut();

  showMessage("Request sent! You can log in after the admin approves your account.", "success");
  signupForm.reset();
});

// ====== If already logged in, tell the user ======
(async () => {
  const { data } = await supabaseClient.auth.getSession();
  if (data.session) {
    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("status")
      .eq("id", data.session.user.id)
      .single();
    if (profile && profile.status === "approved") {
      window.location.href = "dashboard.html";
    }
  }
})();

// ====== THEME TOGGLE ======
const root = document.documentElement;

function applyTheme(theme) {
  root.setAttribute("data-theme", theme);
  try { localStorage.setItem("theme", theme); } catch (e) {}
}

document.getElementById("themeToggle").addEventListener("click", () => {
  applyTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
});