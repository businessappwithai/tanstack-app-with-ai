/**
 * The Enterprise Reporting platform's components, as plain DOM.
 *
 * The deployed platform (`businessappwithai/enterprise_reporting_tanstack`) is
 * React, shadcn/ui and the Tremor design tokens. This runtime has no build step
 * and no dependencies, so it cannot run those components — but it can draw the
 * same ones: the same card, table, button, badge and input, in the same sizes,
 * on the same tokens (`.er` in styles.css carries them, value for value from
 * the platform's `src/styles/globals.css`).
 *
 * Each helper names the platform component it stands for. Keep it that way:
 * when the platform changes a component, this file is where the preview
 * follows it, and a helper nobody can map back to a component is one that
 * drifts without anyone noticing.
 */

import { el, formatNumeric } from "../dom.js";

/*
 * Lucide icons — the set the platform imports from `lucide-react` — as their
 * published path data, drawn at the same 24-unit box and 2px stroke.
 */
const ICONS = {
  barChart3: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  database:
    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  fileText:
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  layoutDashboard:
    '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  messageSquare: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  layers:
    '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  squareTerminal:
    '<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  shield:
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  settings:
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  helpCircle:
    '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  logOut:
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
  arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  refresh:
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  lineChart: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  pieChart: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  areaChart: '<path d="M3 3v18h18"/><path d="M7 12v5h12V8l-5 5-4-4Z"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
};

/** One Lucide icon, `h-4 w-4` unless told otherwise. */
export function icon(name, className = "er-icon") {
  const span = document.createElement("span");
  span.className = `er-iconwrap ${className}`;
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ""}</svg>`;
  return span;
}

/** `components/ui/button.tsx` — variant: default | outline | secondary | ghost | link. */
export function button(label, { variant = "default", size = "default", iconName, ...props } = {}) {
  return el(
    `button.er-btn.er-btn--${variant}.er-btn--size-${size}`,
    { type: "button", ...props },
    iconName ? icon(iconName) : null,
    label
  );
}

/** `components/ui/badge.tsx` — variant: default | secondary | outline | neutral | warning | destructive. */
export function badge(label, variant = "default") {
  return el(`span.er-badge.er-badge--${variant}`, label);
}

/** `components/ui/card.tsx`: Card, CardHeader, CardTitle, CardDescription, CardContent. */
export function card(...children) {
  return el("div.er-card", ...children);
}
export function cardHeader(title, description, extra) {
  return el(
    "div.er-card__header",
    el(
      "div.er-card__heading",
      el("div", el("h3.er-card__title", title), description ? el("p.er-card__description", description) : null),
      extra ?? null
    )
  );
}
export function cardContent(...children) {
  return el("div.er-card__content", ...children);
}

/** `components/layout/page-header.tsx`. */
export function pageHeader(title, description, { actions, badge: badgeNode, back } = {}) {
  return el(
    "div.er-pageheader",
    el(
      "div.er-pageheader__lead",
      back ? el("a.er-btn.er-btn--ghost.er-btn--size-icon", { href: back, "aria-label": "Back" }, icon("arrowLeft", "er-icon--lg")) : null,
      el(
        "div.er-pageheader__text",
        el("div.er-pageheader__titlerow", el("h1.er-pageheader__title", title), badgeNode ?? null),
        description ? el("p.er-pageheader__description", description) : null
      )
    ),
    actions ? el("div.er-pageheader__actions", ...[actions].flat()) : null
  );
}

/** `components/layout/breadcrumb.tsx`. */
export function breadcrumb(items) {
  return el(
    "nav.er-breadcrumb",
    { "aria-label": "Breadcrumb" },
    ...items.flatMap((item, index) => [
      index > 0 ? icon("chevronRight", "er-icon--sm") : null,
      item.href ? el("a", { href: item.href }, item.label) : el("span.is-current", item.label),
    ])
  );
}

/**
 * `components/ui/table.tsx`. `rows` are arrays of cells; a cell may be a node.
 * `onRow` makes the whole row a link, the way the platform's list screens open
 * a definition.
 */
export function table(headers, rows, { onRow } = {}) {
  return el(
    "div.er-table-wrap",
    el(
      "table.er-table",
      el("thead", el("tr", ...headers.map((header) => el("th", header)))),
      el(
        "tbody",
        ...rows.map((cells, index) =>
          el(
            "tr",
            onRow ? { class: "is-link", onclick: (event) => onRow(index, event) } : null,
            ...cells.map((cellValue) => el("td", cellValue ?? "—"))
          )
        )
      )
    )
  );
}

/** `components/ui/kpi-card.tsx`. */
export function kpiCard(label, value, iconName, href) {
  return el(
    "a.er-card.er-kpi",
    { href },
    el("div.er-kpi__label", icon(iconName, "er-icon--md er-subtle"), el("span", label)),
    el("p.er-kpi__metric", Number(value).toLocaleString())
  );
}

/** `components/ui/alert.tsx`. */
export function alert(title, body, variant = "default") {
  return el(
    `div.er-alert.er-alert--${variant}`,
    { role: variant === "destructive" ? "alert" : "note" },
    icon(variant === "destructive" ? "lock" : "info"),
    el("div", el("p.er-alert__title", title), body ? el("div.er-alert__body", body) : null)
  );
}

/** The platform's loading state: a spinner in the middle of the card. */
export function loading(label = "Loading") {
  return el("div.er-loading", el("span.er-spinner", { "aria-hidden": "true" }), el("span", label));
}

/** An empty table body, the way the platform's list screens say it. */
export function emptyState(title, detail) {
  return el("div.er-empty", el("p.er-empty__title", title), detail ? el("p.er-empty__detail", detail) : null);
}

/**
 * One SQL scalar as text. `numeric` says the column is a Postgres NUMERIC —
 * the run endpoints name those columns, because a string of digits in a text
 * column (a code, a phone number) must not be regrouped.
 */
export function cellText(value, numeric = false) {
  if (value === null || value === undefined) return "—";
  if (value instanceof Date) return value.toLocaleDateString();
  if (numeric) return formatNumeric(value);
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * A chart from the rows its query returned, in the platform's brand blue.
 *
 * The platform draws with Recharts; this draws the same four shapes the pack
 * asks for — bar, line, area and pie — as SVG, with the axis labels and the
 * gridlines Recharts puts there, so a tile reads the same at a glance.
 */
export function chart(kind, xField, yField, rows) {
  const points = rows
    .map((row) => ({ label: cellText(row[xField]), value: Number(row[yField]) }))
    .filter((point) => Number.isFinite(point.value))
    .slice(0, 30);
  if (points.length === 0) return null;

  const ns = "http://www.w3.org/2000/svg";
  const make = (tag, attrs, text) => {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const short = (text) => (text.length > 12 ? `${text.slice(0, 11)}…` : text);

  const svg = make("svg", {
    class: "er-chart",
    role: "img",
    "aria-label": `${yField} by ${xField}`,
    viewBox: "0 0 720 260",
    preserveAspectRatio: "xMidYMid meet",
  });

  if (kind === "pie") {
    const total = points.reduce((sum, point) => sum + Math.max(point.value, 0), 0) || 1;
    let angle = -Math.PI / 2;
    const palette = ["#3b82f6", "#06b6d4", "#6366f1", "#8b5cf6", "#d946ef", "#f59e0b", "#10b981", "#f43f5e"];
    points.slice(0, 8).forEach((point, index) => {
      const share = Math.max(point.value, 0) / total;
      const next = angle + share * Math.PI * 2;
      const large = share > 0.5 ? 1 : 0;
      const [cx, cy, r] = [180, 130, 110];
      const path =
        share >= 0.999
          ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
          : `M ${cx} ${cy} L ${cx + r * Math.cos(angle)} ${cy + r * Math.sin(angle)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(next)} ${cy + r * Math.sin(next)} Z`;
      svg.appendChild(make("path", { d: path, fill: palette[index % palette.length] }));
      svg.appendChild(make("rect", { x: 340, y: 40 + index * 24, width: 10, height: 10, rx: 2, fill: palette[index % palette.length] }));
      svg.appendChild(
        make("text", { x: 358, y: 49 + index * 24, class: "er-chart__legend" }, `${short(point.label)} · ${point.value.toLocaleString()}`)
      );
      angle = next;
    });
    return svg;
  }

  const [left, top, width, height] = [48, 12, 660, 200];
  // A round axis maximum, as Recharts picks: 1, 2, 2.5 or 5 times a power of
  // ten, so four ticks land on numbers a reader would write down. An unrounded
  // maximum of 3 gave ticks of 0.75, 1.5, 2.25 — shown rounded, as 1, 2, 2.
  const raw = Math.max(...points.map((point) => point.value), 0) || 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw / 4));
  const tickStep =
    [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate * 4 >= raw) ??
    10 * magnitude;
  const max = tickStep * 4;
  const step = width / points.length;
  const y = (value) => top + height - (value / max) * height;

  for (let tick = 0; tick <= 4; tick++) {
    const value = tickStep * tick;
    svg.appendChild(make("line", { x1: left, x2: left + width, y1: y(value), y2: y(value), class: "er-chart__grid" }));
    svg.appendChild(
      make("text", { x: left - 8, y: y(value) + 4, "text-anchor": "end", class: "er-chart__tick" }, value.toLocaleString(undefined, { maximumFractionDigits: 2 }))
    );
  }

  if (kind === "line" || kind === "area") {
    const coords = points.map((point, index) => [left + index * step + step / 2, y(point.value)]);
    if (kind === "area") {
      const first = coords[0];
      const last = coords[coords.length - 1];
      svg.appendChild(
        make("path", {
          d: `M ${first[0]} ${top + height} ${coords.map(([cx, cy]) => `L ${cx} ${cy}`).join(" ")} L ${last[0]} ${top + height} Z`,
          class: "er-chart__area",
        })
      );
    }
    svg.appendChild(make("polyline", { points: coords.map((pair) => pair.join(",")).join(" "), class: "er-chart__line" }));
  } else {
    points.forEach((point, index) => {
      const barTop = y(Math.max(point.value, 0));
      svg.appendChild(
        make("rect", {
          x: left + index * step + step * 0.15,
          y: barTop,
          width: step * 0.7,
          height: top + height - barTop,
          rx: 3,
          class: "er-chart__bar",
        })
      );
    });
  }

  points.forEach((point, index) => {
    svg.appendChild(
      make("text", { x: left + index * step + step / 2, y: top + height + 20, "text-anchor": "middle", class: "er-chart__tick" }, short(point.label))
    );
  });

  return svg;
}
