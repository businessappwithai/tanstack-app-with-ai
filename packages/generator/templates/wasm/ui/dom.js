/**
 * A hundred lines instead of a framework.
 *
 * The frontend has to run with no build step: it is served out of Cache Storage
 * by a Service Worker in the hosted case, and there is no bundler in a browser
 * tab to turn JSX into anything. So the components below are functions that
 * return DOM nodes, and rendering a screen means replacing a subtree.
 *
 * The screens themselves are still drawn from the Application Dictionary rather
 * than written per entity — that is the part worth keeping, and it is
 * independent of which library draws them.
 */

/** `el("div.card", { onclick }, child, child)` */
export function el(spec, props = null, ...children) {
  const [tag, ...classes] = String(spec).split(".");
  const node = document.createElement(tag || "div");
  if (classes.length) node.className = classes.join(" ");

  if (props && (props.nodeType || Array.isArray(props) || typeof props === "string")) {
    children.unshift(props);
    props = null;
  }

  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = `${node.className} ${value}`.trim();
    else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "value" || key === "checked" || key === "disabled") node[key] = value;
    else node.setAttribute(key, value === true ? "" : value);
  }

  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(node, ...children) {
  clear(node);
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function tray(className) {
  let node = document.querySelector(`.${className}`);
  if (!node) {
    node = el(`div.${className}`);
    document.body.appendChild(node);
  }
  return node;
}

/** Transient message. Errors stay until dismissed; successes fade. */
export function toast(message, tone = "info") {
  const node = el(
    `div.toast.toast--${tone}`,
    el("div.toast__body", message),
    el("button.toast__close", { onclick: () => node.remove(), "aria-label": "Dismiss" }, "×")
  );
  tray("toasts").appendChild(node);
  if (tone !== "error") setTimeout(() => node.remove(), 4000);
  return node;
}

/**
 * Help, and the only shape it takes in this application.
 *
 * A window's help and a field's help both arrive here: one panel at the top
 * right, opened by a `?` and removed by its own close button and nothing else.
 *
 * Four ways it is deliberately not an ordinary toast:
 *
 * 1. **No timeout.** `toast(help, "info")` is what this used to be, and it
 *    took the text away after four seconds — help is read while the form it
 *    describes is being filled in, so four seconds is not a reading time, it
 *    is a glimpse. Only the close button removes it: not a timer, not a click
 *    elsewhere, not Escape.
 * 2. **Its own tray.** Transient messages are bottom right and this is top
 *    right, so saving a record while help is open cannot push the help off
 *    the screen, and a panel that may be 500px tall cannot push the
 *    confirmation of the save off it either.
 * 3. **Only one of it.** Opening a second topic replaces the first rather than
 *    stacking, because a tower of panels down the edge of the screen is what a
 *    toaster is supposed to avoid.
 * 4. **It never covers the page.** No backdrop: the record stays visible and
 *    editable with the help open beside it.
 *
 * `body` is a string or a node, so a caller can hand over a list of fields
 * rather than a paragraph.
 */
export function helpToast(title, body) {
  const helptray = tray("helptray");
  helptray.querySelector(".toast--help")?.remove();

  const node = el(
    "div.toast.toast--help",
    { role: "note", "aria-live": "polite" },
    el(
      "div.toast__body",
      el(
        "div.toast__head",
        el("strong.toast__title", title),
        el(
          "button.toast__close",
          { onclick: () => node.remove(), "aria-label": "Close help", title: "Close help" },
          "×"
        )
      ),
      el("div.toast__help", body)
    )
  );

  helptray.appendChild(node);
  return node;
}

export function spinner(label = "Loading") {
  return el("div.spinner", el("div.spinner__dot"), el("span", label));
}

export function empty(title, detail) {
  return el("div.empty", el("h3", title), detail ? el("p", detail) : null);
}

/** Format a value for a grid cell, using what the dictionary says it is. */
export function displayValue(value, field) {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field && field.field_type === "date") return String(value).slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value).toLocaleString();
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]
  );

/**
 * A NUMERIC as text: grouped, with two decimals when it has a fraction.
 *
 * Postgres hands NUMERIC over as a string so no digit is lost, and money is
 * DECIMAL(18,4) — printed as it arrived, an amount read `25955.7000`. Formatted
 * from the string rather than a parsed Number, which `Intl` treats as an exact
 * decimal, so a value past 2^53 keeps its digits. Up to four decimals survive,
 * which is the scale money is stored at; trailing zeros past the second do not.
 */
export function formatNumeric(value) {
  const text = String(value);
  if (!/^-?\d+(\.\d+)?$/.test(text)) return text;
  const fraction = /\.\d*[1-9]/.test(text);
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: fraction ? 2 : 0,
    maximumFractionDigits: 4,
  }).format(text);
}
