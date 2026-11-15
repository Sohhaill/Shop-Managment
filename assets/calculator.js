// Calculator popup (opens from the calculator icon in the top bar).
// Works without eval(): numbers and operators are collected, then solved with the normal rule
// (multiply and divide first, then plus and minus).
(function () {
  const modal = document.getElementById("calcModal");
  const openBtn = document.getElementById("calcBtn");
  if (!modal || !openBtn) return;

  const exprEl = document.getElementById("calcExpr");
  const mainEl = document.getElementById("calcMain");

  const SYMBOL = { "+": "+", "-": "−", "*": "×", "/": "÷" };
  const MAX_DIGITS = 15;

  let tokens = [];        // finished parts, e.g. ["12", "+", "3"]
  let cur = "";           // the number being typed
  let result = null;      // shown after "=" (a string), otherwise null
  let error = "";         // e.g. "Cannot divide by 0"

  const isOp = (t) => t === "+" || t === "-" || t === "*" || t === "/";

  // 1234567.5 -> "1,234,567.5" (works for half typed numbers like "12." too)
  function fmt(s) {
    if (s === "" || s == null) return "";
    const neg = s[0] === "-";
    const body = neg ? s.slice(1) : s;
    const [i, d] = body.split(".");
    const withCommas = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-" : "") + withCommas + (d !== undefined ? "." + d : "");
  }

  // remove floating point dust: 0.1 + 0.2 -> 0.3
  function clean(n) {
    return String(Number(n.toPrecision(12)));
  }

  function render() {
    let main;
    if (error) main = error;
    else if (result !== null) main = fmt(result);
    else if (cur !== "") main = fmt(cur);
    else if (tokens.length) {
      // an operator was just pressed: keep showing the last number
      const nums = tokens.filter((t) => !isOp(t));
      main = fmt(nums[nums.length - 1]);
    } else main = "0";

    const expr = tokens.map((t) => (isOp(t) ? SYMBOL[t] : fmt(t))).join(" ");
    exprEl.textContent = result !== null && !error ? expr + " =" : expr + (cur !== "" && expr ? " " + fmt(cur) : "");

    exprEl.scrollLeft = exprEl.scrollWidth; // a long sum keeps showing its newest end
    mainEl.textContent = main;
    mainEl.classList.toggle("is-error", !!error);
    mainEl.classList.toggle("small", main.length > 11 && !error);
    mainEl.classList.toggle("tiny", main.length > 15 && !error);
  }

  function clearAll() {
    tokens = [];
    cur = "";
    result = null;
    error = "";
  }

  // after "=" or an error, typing a digit starts fresh
  function startFreshIfNeeded() {
    if (result !== null || error) clearAll();
  }

  function digit(d) {
    startFreshIfNeeded();
    if (cur.replace(/[-.]/g, "").length >= MAX_DIGITS) return;
    cur = cur === "0" ? d : cur === "-0" ? "-" + d : cur + d;
    render();
  }

  function dot() {
    startFreshIfNeeded();
    if (cur.includes(".")) return;
    cur = cur === "" ? "0." : cur === "-" ? "-0." : cur + ".";
    render();
  }

  function operator(o) {
    if (error) clearAll();
    if (result !== null) {           // continue with the answer
      tokens = [result];
      result = null;
      cur = "";
    }
    if (cur !== "" && cur !== "-") {
      tokens.push(cur.endsWith(".") ? cur.slice(0, -1) : cur);
      cur = "";
    } else if (tokens.length === 0) {
      tokens.push("0");
    } else if (isOp(tokens[tokens.length - 1])) {
      tokens.pop();                  // changed my mind: replace the operator
    }
    tokens.push(o);
    render();
  }

  function percent() {
    if (error) return;
    if (result !== null) {
      result = clean(Number(result) / 100);
    } else if (cur !== "" && cur !== "-") {
      cur = clean(Number(cur) / 100);
    }
    render();
  }

  function negate() {
    if (error) return;
    if (result !== null) {
      result = result[0] === "-" ? result.slice(1) : "-" + result;
    } else if (cur === "") {
      cur = "-";
    } else {
      cur = cur[0] === "-" ? cur.slice(1) : "-" + cur;
    }
    render();
  }

  function backspace() {
    if (error || result !== null) { clearAll(); render(); return; }
    if (cur !== "") {
      cur = cur.slice(0, -1);
      if (cur === "-") cur = "";
    } else if (tokens.length) {
      tokens.pop();                                  // remove the operator
      if (tokens.length) cur = tokens.pop();         // and edit the number before it again
    }
    render();
  }

  // multiply / divide first, then add / subtract. Returns a number or null (divide by zero).
  function solve(parts) {
    const a = parts.slice();
    for (let i = 1; i < a.length; i += 2) {
      if (a[i] === "*" || a[i] === "/") {
        const x = Number(a[i - 1]);
        const y = Number(a[i + 1]);
        if (a[i] === "/" && y === 0) return null;
        a.splice(i - 1, 3, String(a[i] === "*" ? x * y : x / y));
        i -= 2;
      }
    }
    let total = Number(a[0]);
    for (let i = 1; i < a.length; i += 2) {
      total = a[i] === "+" ? total + Number(a[i + 1]) : total - Number(a[i + 1]);
    }
    return total;
  }

  function equals() {
    if (error || result !== null) return;
    const parts = tokens.slice();
    if (cur !== "" && cur !== "-") parts.push(cur.endsWith(".") ? cur.slice(0, -1) : cur);
    while (parts.length && isOp(parts[parts.length - 1])) parts.pop(); // "5 +" = 5
    if (!parts.length) return;

    const total = solve(parts);
    if (total === null) {
      clearAll();
      error = "Cannot divide by 0";
    } else {
      tokens = parts;
      cur = "";
      result = clean(total);
    }
    render();
  }

  function press(key) {
    if (/^[0-9]$/.test(key)) digit(key);
    else if (key === ".") dot();
    else if (isOp(key)) operator(key);
    else if (key === "=") equals();
    else if (key === "C") { clearAll(); render(); }
    else if (key === "back") backspace();
    else if (key === "%") percent();
    else if (key === "neg") negate();
  }

  // ----- open / close -----
  openBtn.addEventListener("click", () => {
    modal.classList.remove("hidden");
    render();
  });

  modal.querySelector(".calc-keys").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-key]");
    if (b) press(b.dataset.key);
  });

  // keyboard (only while the calculator is open)
  document.addEventListener("keydown", (e) => {
    if (modal.classList.contains("hidden") || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    let handled = true;
    if (/^[0-9]$/.test(k)) press(k);
    else if (k === "." || k === ",") press(".");
    else if (k === "+" || k === "-" || k === "*" || k === "/") press(k);
    else if (k === "x" || k === "X") press("*");
    else if (k === "Enter" || k === "=") press("=");
    else if (k === "Backspace") press("back");
    else if (k === "Delete" || k === "c" || k === "C") press("C");
    else if (k === "%") press("%");
    else handled = false;
    if (handled) e.preventDefault(); // also stops Enter from "clicking" the focused button twice
  });
})();