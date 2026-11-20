// ===== Customer page (public, no login) =====
// URL: customer.html?s=<link-name>   (every shop has its own link name)
// It only calls ONE database function, get_customer_page(), which hands out the public details.
(function () {
  const SUPABASE_URL = "https://bebarpebjfqbulerwava.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_to_DWINIxZjm4nB6HdSaUQ_JO5K577U";

  // ====== SETTINGS (easy to change) ======
  const CURRENCY = "Rs";
  const IMAGE_BUCKET = "product-images";
  const DEFAULT_COUNTRY_CODE = "92";   // a number like 0317... is turned into 92317... for WhatsApp
  const REFRESH_AFTER_MS = 60 * 1000;  // when the customer comes back to the page, data older than this is reloaded

  const params = new URLSearchParams(location.search);
  const slug = (params.get("s") || "").trim().toLowerCase();
  const preview = params.get("preview") === "1";   // owner's preview inside the dashboard

  const app = document.getElementById("app");
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { detectSessionInUrl: false },
  });

  let data = null;
  let loadedAt = 0;
  let installEvent = null;
  let selCategory = "all";
  let query = "";

  if (preview) document.getElementById("preview-ribbon").classList.remove("hidden");

  // ---------- small helpers ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  // "0317-1234567" -> "923171234567"; returns null if it does not look like a phone number
  function waNumber(raw) {
    let d = String(raw || "").replace(/\D+/g, "");
    if (d.startsWith("00")) d = d.slice(2);
    else if (d.startsWith("0")) d = DEFAULT_COUNTRY_CODE + d.slice(1);
    return d.length >= 8 && d.length <= 15 ? d : null;
  }
  function waLink(raw, text) {
    const n = waNumber(raw);
    return n ? "https://wa.me/" + n + (text ? "?text=" + encodeURIComponent(text) : "") : null;
  }
  function telLink(raw) {
    const d = String(raw || "").replace(/[^\d+]/g, "");
    return d.length >= 5 ? "tel:" + d : null;
  }
  function safeUrl(u) {
    try {
      const x = new URL(String(u || "").trim());
      return x.protocol === "https:" || x.protocol === "http:" ? x.href : null;
    } catch (e) { return null; }
  }
  function money(n) {
    return CURRENCY + " " + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  function imageUrl(path) {
    return SUPABASE_URL + "/storage/v1/object/public/" + IMAGE_BUCKET + "/" +
      String(path).split("/").map(encodeURIComponent).join("/");
  }
  function fmtDate(v) {
    return new Date(v).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
  }
  function linkBtn(cls, label, href) {
    const a = el("a", "btn " + cls, label);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }

  // ---------- states ----------
  function showNotice(icon, title, text, withRetry) {
    app.innerHTML = "";
    const box = el("div", "notice-page");
    box.appendChild(el("div", "icon", icon));
    box.appendChild(el("h1", "", title));
    box.appendChild(el("p", "", text));
    if (withRetry) {
      const b = el("button", "btn primary retry", "Try again");
      b.type = "button";
      b.addEventListener("click", load);
      box.appendChild(b);
    }
    app.appendChild(box);
  }

  async function load() {
    if (!slug) return showNotice("\u{1F517}", "Page not found", "This link is not complete. Please scan the shop's QR code again.");
    if (!data) {
      app.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading...</p></div>';
    }
    const { data: res, error } = await sb.rpc("get_customer_page", { p_slug: slug });
    if (error) {
      if (data) return; // keep showing the old page if a refresh fails
      return showNotice("\u{1F4F6}", "Could not load", "Please check your internet connection and try again.", true);
    }
    if (!res) return showNotice("\u{1F6AB}", "Page not available", "This page does not exist or has been switched off by the shop.");
    data = res;
    loadedAt = Date.now();
    render();
    if (!preview) setupInstallable();
  }

  // ---------- page ----------
  function render() {
    const shop = data.shop || {};
    const page = data.page || {};
    const name = shop.name || "Our shop";
    document.title = name;
    app.innerHTML = "";

    // --- header ---
    const hero = el("header", "hero");
    if (shop.logo_path) {
      const img = el("img", "logo");
      img.alt = name + " logo";
      img.src = imageUrl(shop.logo_path);
      img.addEventListener("error", () => img.replaceWith(el("span", "logo-fallback", name.charAt(0).toUpperCase())));
      hero.appendChild(img);
    } else {
      hero.appendChild(el("span", "logo-fallback", name.charAt(0).toUpperCase()));
    }
    hero.appendChild(el("h1", "", name));
    if (shop.owner) hero.appendChild(el("div", "owner", "Owner: " + shop.owner));
    const addr = [shop.address, shop.city].filter(Boolean).join(", ");
    if (addr) hero.appendChild(el("div", "address", "\u{1F4CD} " + addr));
    hero.appendChild(el("div", "status-pill" + (page.is_open ? "" : " closed"), page.is_open ? "Open now" : "Closed now"));
    if (page.status_note) hero.appendChild(el("div", "status-note", page.status_note));

    const installTop = el("button", "install-top hidden", "⬇ Install app");
    installTop.type = "button";
    installTop.id = "installTop";
    installTop.addEventListener("click", doInstall);
    hero.appendChild(installTop);
    app.appendChild(hero);

    // --- quick buttons: Call / WhatsApp / Directions ---
    const actions = el("div", "actions");
    const tel = telLink(shop.phone);
    if (tel) actions.appendChild(linkBtn("primary", "\u{1F4DE} Call", tel));
    const wa = waLink(page.whatsapp, "Hello " + name + "!");
    if (wa) actions.appendChild(linkBtn("wa", "\u{1F4AC} WhatsApp", wa));
    const map = safeUrl(shop.map_link) ||
      (addr ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(name + " " + addr) : null);
    if (map && page.show_directions !== false) actions.appendChild(linkBtn("", "\u{1F9ED} Directions", map));
    if (actions.children.length) app.appendChild(actions);

    // --- announcement ---
    if (page.announcement) {
      const s = el("section");
      const c = el("div", "card announce");
      c.appendChild(el("div", "label", "\u{1F4E2} Announcement"));
      c.appendChild(el("div", "pre", page.announcement));
      s.appendChild(c);
      app.appendChild(s);
    }

    // --- opening hours ---
    if (shop.opening_hours) {
      const s = el("section");
      s.appendChild(el("h2", "", "Opening hours"));
      const c = el("div", "card hours-row");
      c.appendChild(el("span", "ico", "\u{1F552}"));
      c.appendChild(el("div", "pre", shop.opening_hours));
      s.appendChild(c);
      app.appendChild(s);
    }

    // --- entries (offers, news ...) ---
    const entries = data.entries || [];
    if (entries.length) {
      const s = el("section");
      s.appendChild(el("h2", "", "Latest updates"));
      const list = el("div", "entries");
      entries.forEach((en) => {
        const c = el("article", "card entry");
        c.appendChild(el("h3", "", (en.pinned ? "\u{1F4CC} " : "") + en.title));
        if (en.description) c.appendChild(el("p", "pre", en.description));
        const meta = el("div", "meta");
        if (en.expires_on) meta.appendChild(el("span", "tag", "Valid till " + fmtDate(en.expires_on)));
        meta.appendChild(el("span", "", fmtDate(en.created_at)));
        c.appendChild(meta);
        const link = waLink(en.whatsapp, '');
        if (link) c.appendChild(linkBtn("wa", "\u{1F4AC} WhatsApp", link));
        list.appendChild(c);
      });
      s.appendChild(list);
      app.appendChild(s);
    }

    // --- products ---
    if (page.show_products && (data.products || []).length) {
      const s = el("section");
      s.appendChild(el("h2", "", "Our products"));
      const search = el("input", "search");
      search.type = "search";
      search.placeholder = "Search products...";
      search.value = query;
      search.autocomplete = "off";
      s.appendChild(search);
      const chips = el("div", "chips");
      s.appendChild(chips);
      const grid = el("div", "products");
      s.appendChild(grid);
      app.appendChild(s);

      const cats = [...new Set(data.products.map((p) => p.category).filter(Boolean))].sort();
      const drawChips = () => {
        chips.innerHTML = "";
        chips.classList.toggle("hidden", cats.length === 0);
        ["all", ...cats].forEach((c) => {
          const b = el("button", "chip" + (selCategory === c ? " active" : ""), c === "all" ? "All" : c);
          b.type = "button";
          b.addEventListener("click", () => { selCategory = c; drawChips(); drawProducts(); });
          chips.appendChild(b);
        });
      };
      const drawProducts = () => {
        grid.innerHTML = "";
        const q = query.trim().toLowerCase();
        const list = data.products.filter((p) =>
          (selCategory === "all" || p.category === selCategory) &&
          (!q || (p.name + " " + (p.category || "")).toLowerCase().includes(q)));
        if (!list.length) { grid.appendChild(el("p", "empty", "No product found.")); grid.style.display = "block"; return; }
        grid.style.display = "";
        list.forEach((p) => {
          const c = el("div", "card product");
          if (p.image_path) {
            const img = el("img", "thumb");
            img.alt = p.name;
            img.loading = "lazy";
            img.src = imageUrl(p.image_path);
            img.addEventListener("error", () => img.replaceWith(el("div", "thumb", p.name.charAt(0).toUpperCase())));
            c.appendChild(img);
          } else {
            c.appendChild(el("div", "thumb", p.name.charAt(0).toUpperCase()));
          }
          c.appendChild(el("div", "name", p.name));
          if (p.price !== null && p.price !== undefined) c.appendChild(el("div", "price", money(p.price)));
          c.appendChild(el("div", "stock" + (p.in_stock ? "" : " out"), p.in_stock ? "In stock" : "Out of stock"));
          const ask = waLink(page.whatsapp, 'Hello, I want to ask about "' + p.name + '" (' + name + ").");
          if (ask) c.appendChild(linkBtn("wa ask", "Ask on WhatsApp", ask));
          grid.appendChild(c);
        });
      };
      search.addEventListener("input", () => { query = search.value; drawProducts(); });
      drawChips();
      drawProducts();
    }

    // --- nothing to show yet ---
    if (!page.announcement && !shop.opening_hours && !entries.length && !(page.show_products && (data.products || []).length)) {
      const s = el("section");
      s.appendChild(el("p", "empty", "No updates yet. Please check again soon."));
      app.appendChild(s);
    }

    // --- install card (the button appears only when the browser allows installing) ---
    if (!preview) {
      const s = el("section", "hidden");
      s.id = "installCard";
      const c = el("div", "card install-card");
      c.appendChild(el("strong", "", "\u{1F4F1} Keep this page on your phone"));
      c.appendChild(el("p", "", "Install it like an app and open it with one tap."));
      c.id = "installBody";
      s.appendChild(c);
      app.appendChild(s);
      refreshInstallUi();
    }

    const foot = el("p", "footer");
    foot.textContent = "Updated " + fmtDate(page.updated_at || Date.now()) + " · Made with ShopEase";
    app.appendChild(foot);
  }

  // ---------- install as an app (PWA) ----------
  const isStandalone = () =>
    window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e;
    refreshInstallUi();
  });
  window.addEventListener("appinstalled", () => { installEvent = null; refreshInstallUi(); });

  async function doInstall() {
    if (!installEvent) return;
    installEvent.prompt();
    try { await installEvent.userChoice; } catch (e) {}
    installEvent = null;
    refreshInstallUi();
  }

  function refreshInstallUi() {
    const top = document.getElementById("installTop");
    const card = document.getElementById("installCard");
    const body = document.getElementById("installBody");
    if (!card || !body) return;
    body.querySelectorAll("button, .ios-hint").forEach((n) => n.remove());
    const standalone = isStandalone();
    if (top) top.classList.toggle("hidden", !installEvent || standalone);

    if (standalone) return card.classList.add("hidden");
    if (installEvent) {
      const b = el("button", "btn primary", "⬇ Install app");
      b.type = "button";
      b.addEventListener("click", doInstall);
      body.appendChild(b);
      return card.classList.remove("hidden");
    }
    if (isIos()) {
      // iPhone / iPad: Safari has no install button, the steps are done by hand
      body.appendChild(el("p", "ios-hint", "Tap the Share button, then choose “Add to Home Screen”."));
      return card.classList.remove("hidden");
    }
    card.classList.add("hidden");
  }

  // Every shop gets its own app name and its own start link (so each QR installs ITS page).
  function setupInstallable() {
    try {
      const shop = data.shop || {};
      const name = shop.name || "Shop";
      const here = location.origin + location.pathname;
      const start = here + "?s=" + encodeURIComponent(slug);
      const icon = (f) => new URL("assets/icons/" + f, location.href).href;
      const manifest = {
        id: start,
        name: name,
        short_name: name.length > 14 ? name.slice(0, 13) + "…" : name,
        description: "News, offers and opening status of " + name,
        start_url: start,
        scope: here,
        display: "standalone",
        background_color: "#0f1512",
        theme_color: "#1fa971",
        icons: [
          { src: icon("icon-192.png"), sizes: "192x192", type: "image/png", purpose: "any" },
          { src: icon("icon-512.png"), sizes: "512x512", type: "image/png", purpose: "any" },
          { src: icon("icon-maskable-512.png"), sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      };
      let link = document.querySelector('link[rel="manifest"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "manifest";
        document.head.appendChild(link);
      }
      if (link.href && link.href.startsWith("blob:")) URL.revokeObjectURL(link.href);
      link.href = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" }));
      if ("serviceWorker" in navigator && !navigator.serviceWorker.controller) {
        navigator.serviceWorker.register("./sw.js").catch(() => {});
      }
    } catch (e) { /* the page works even if installing is not possible */ }
  }

  // coming back to the page later (or switching to the app) shows fresh news / open-closed status
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && data && Date.now() - loadedAt > REFRESH_AFTER_MS) load();
  });

  load();
})();