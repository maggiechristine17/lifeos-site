// Builds index.html for the public website: the real LifeOS page (tools/app.html) in read-only
// "public" mode, fed with ONLY the entries marked "Show on website".
// Usage: node tools/build.mjs <data-dir> [out-file]
// <data-dir> holds JSON exports of the LifeOS artifact's database:
//   <data-dir>/projects/*.json, areas/*.json, pages/*.json, archive/*.json, ideas/*.json, values/*.json, goals/*.json, and optionally settings/site.json
// Entries without public === true are dropped here too, as a second safety check.
// The data folder must never be committed.
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const dir = process.argv[2];
const outFile = process.argv[3] || path.join(here, "..", "index.html");
const appFile = path.join(here, "app.html");
if (!dir || !fs.existsSync(dir)) { console.error("Usage: node tools/build.mjs <data-dir> [out-file]"); process.exit(1); }
if (!fs.existsSync(appFile)) { console.error("Missing tools/app.html (the LifeOS page)."); process.exit(1); }

const readCol = (name) => {
  const d = path.join(dir, name); if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith(".json")).sort().map(f => {
    const raw = JSON.parse(fs.readFileSync(path.join(d, f), "utf8"));
    const doc = raw && typeof raw === "object" && raw.data && typeof raw.data === "object" && !raw.title ? raw.data : raw;
    return { ...doc, id: raw.id || doc.id || f.replace(/\.json$/, "") };
  });
};
// Fields that only matter inside LifeOS and never go on the website
const PRIVATE_FIELDS = ["createdAt", "updatedAt", "archivedFrom", "archivedAt"];
const clean = (e) => {
  const o = { ...e };
  PRIVATE_FIELDS.forEach(k => delete o[k]);
  const onlyLinks = (l) => (Array.isArray(l) ? l : []).filter(f => f && f.kind === "link" && /^https?:/i.test(f.url || ""));
  o.files = onlyLinks(o.files);
  if (Array.isArray(o.noteTabs)) o.noteTabs = o.noteTabs.map(t => ({ ...t, files: onlyLinks(t.files) }));
  return o;
};
const out = {};
let count = 0; const titles = [];
for (const type of ["projects", "areas", "pages", "archive", "ideas", "values", "goals"]) {
  out[type] = readCol(type).filter(e => e.public === true).map(clean);
  count += out[type].length; out[type].forEach(e => titles.push(e.title || "Untitled"));
}
// Routines are Layer 7 entries: only those with public === true are published (with their planner placements)
out.routines = readCol("routines").filter(r => r.public === true).map(r => ({ id: r.id, name: String(r.name || ""), emoji: r.emoji || "", body: String(r.body || ""), color: String(r.color || ""), public: true, createdAt: r.createdAt || "", plans: (Array.isArray(r.plans) ? r.plans : []).map(p => ({ id: p.id, date: p.date, slot: p.slot, status: p.status, doneAt: p.doneAt || "" })) }));
count += out.routines.length; out.routines.forEach(r => titles.push(r.name));
// Links may only point at other public entries
const pub = new Set(Object.values(out).flat().map(e => e.id));
Object.values(out).flat().forEach(e => { if (Array.isArray(e.links)) e.links = e.links.filter(id => pub.has(id)); });
let title = "";
for (const f of ["settings/site.json", "settings/site"]) { const p = path.join(dir, f); if (fs.existsSync(p)) { try { const s = JSON.parse(fs.readFileSync(p, "utf8")); title = String(s.title || (s.data && s.data.title) || "").trim(); } catch (e) {} } }
out.title = title;
// Home page switches: which tabs appear on the website (missing file = the original set)
const readJson = (f) => { for (const n of [f + ".json", f]) { const p = path.join(dir, n); if (fs.existsSync(p)) { try { const j = JSON.parse(fs.readFileSync(p, "utf8")); return j && j.data && typeof j.data === "object" && !j.web && !j.rooms ? j.data : j; } catch (e) {} } } return null; };
const home = readJson("settings/home");
if (home && home.web && typeof home.web === "object") out.home = { web: Object.fromEntries(Object.entries(home.web).map(([k, v]) => [k, v === true])) };
// Inventory is published (all items) only while its Home link is switched on for the website
if (out.home && out.home.web.inventory) {
  out.inventory = readCol("inventory").map(x => ({ id: x.id, title: String(x.title || ""), room: String(x.room || "") }));
  const r = readJson("settings/rooms"); out.rooms = r && Array.isArray(r.rooms) ? r.rooms.map(String) : [];
  count += out.inventory.length; titles.push(`${out.inventory.length} inventory items`);
}
// Meals are published (all of them) only while the Meals Home link is switched on for the website
if (out.home && out.home.web.meals) {
  const keep = ["title", "icon", "category", "menu", "cuisine", "method", "status", "date", "created", "link", "ingredients", "directions", "ingList"];
  out.meals = readCol("meals").map(m => Object.fromEntries([["id", m.id], ...keep.filter(k => m[k] !== undefined).map(k => [k, m[k]])]));
  count += out.meals.length; titles.push(`${out.meals.length} meals`);
}

const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
const json = JSON.stringify(out).replace(/</g, "\\u003c").split(LS).join("\\u2028").split(PS).join("\\u2029");
let app = fs.readFileSync(appFile, "utf8");
if (!app.includes("LIFEOS_PUBLIC")) { console.error("tools/app.html is not a LifeOS page with public mode."); process.exit(1); }
const inject = `<script>window.LIFEOS_PUBLIC=${json};</script>`;
app = app.includes("</head>") ? app.replace("</head>", inject + "\n</head>") : inject + app;
if (title) app = app.replace(/<title>[^<]*<\/title>/, `<title>${title.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))}</title>`);

// Keep the empty, account-free copy (template/index.html) in step with the latest LifeOS design
try { (await import("node:child_process")).execFileSync(process.execPath, [path.join(here, "template.mjs"), appFile, path.join(here, "..", "template", "index.html")], { stdio: "inherit" }); } catch (e) { console.error("Template not rebuilt: " + e.message); }
const prev = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
if (prev === app) { console.log(`UNCHANGED: ${count} public entries`); process.exit(0); }
fs.writeFileSync(outFile, app);
console.log(`WROTE ${outFile}: ${count} public entries (${titles.join("; ")})`);
