// Builds index.html from LifeOS entries marked "Show on website".
// Usage: node tools/build.mjs <data-dir> [out-file]
// <data-dir> holds JSON exports of the LifeOS artifact's database:
//   <data-dir>/projects/*.json, areas/*.json, pages/*.json, and optionally settings/site.json
// Only entries with public === true are published. The data folder must never be committed.
import fs from "node:fs";
import path from "node:path";
import { marked } from "./marked.esm.js";

const dir = process.argv[2];
const outFile = process.argv[3] || path.join(path.dirname(new URL(import.meta.url).pathname), "..", "index.html");
if (!dir || !fs.existsSync(dir)) { console.error("Usage: node tools/build.mjs <data-dir> [out-file]"); process.exit(1); }

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const readCol = (name) => {
  const d = path.join(dir, name); if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith(".json")).map(f => {
    const raw = JSON.parse(fs.readFileSync(path.join(d, f), "utf8"));
    const doc = raw && typeof raw === "object" && raw.data && typeof raw.data === "object" && !raw.title ? raw.data : raw;
    return { id: raw.id || doc.id || f.replace(/\.json$/, ""), ...doc };
  });
};
const TYPES = ["projects", "areas", "pages"];
const LBL = { projects: "Project", areas: "Area", pages: "Resource" };
const FALLBACK = { projects: "📌", areas: "🧭", pages: "📚" };
const all = TYPES.flatMap(type => readCol(type).map(e => ({ type, e })));
let siteTitle = "";
for (const f of ["settings/site.json", "settings/site"]) { const p = path.join(dir, f); if (fs.existsSync(p)) { try { const s = JSON.parse(fs.readFileSync(p, "utf8")); siteTitle = (s.title || (s.data && s.data.title) || "").trim(); } catch (e) {} } }

const list = all.filter(x => x.e.public === true);
const pubIds = new Set(list.map(x => x.e.id));
const byId = new Map(all.map(x => [x.e.id, x]));
const byTitle = new Map(all.map(x => [(x.e.title || "").trim().toLowerCase(), x]));
const slug = (x) => "e-" + String(x.e.id).replace(/[^A-Za-z0-9_-]/g, "");
const linksOf = (id) => {
  const out = new Set(); const me = byId.get(id);
  (Array.isArray(me && me.e.links) ? me.e.links : []).forEach(l => out.add(l));
  all.forEach(x => { if (Array.isArray(x.e.links) && x.e.links.includes(id)) out.add(x.e.id); });
  out.delete(id); return [...out].map(i => byId.get(i)).filter(Boolean);
};
const safeUrl = (u) => /^(https?:|mailto:)/i.test(u || "") ? u : "";
const safeImg = (u) => /^(https?:|data:image\/(png|jpe?g|gif|webp);)/i.test(u || "") ? u : "";
const WIKI = /\[\[([^\[\]\n|]+)(?:\|([^\[\]\n]+))?\]\]/g;

marked.use({ gfm: true, breaks: true, renderer: {
  html(html) { return esc(typeof html === "string" ? html : (html && html.text) || ""); },
  link(href, title, text) { const h = typeof href === "object" ? href.href : href; const ok = /^(https?:|mailto:|#)/i.test(h || ""); return ok ? `<a href="${esc(h)}"${/^https?:/i.test(h) ? ' target="_blank" rel="noopener"' : ""}${title ? ` title="${esc(title)}"` : ""}>${text}</a>` : text; },
  image(href, title, text) { const h = typeof href === "object" ? href.href : href; return safeImg(h) ? `<img src="${esc(h)}" alt="${esc(text || "")}">` : esc(text || ""); },
} });
const md = (src) => marked.parse(String(src || "").replace(WIKI, (m, t, alias) => {
  const hit = byTitle.get(t.trim().toLowerCase()); const label = (alias || t).trim();
  return hit && pubIds.has(hit.e.id) ? `[${label.replace(/[\[\]]/g, "")}](#${slug(hit)})` : label;
}));

const order = { projects: 0, areas: 1, pages: 2 };
list.sort((a, b) => order[a.type] - order[b.type] || (a.e.title || "").localeCompare(b.e.title || ""));
const card = (x) => {
  const e = x.e, tabs = [{ name: "Notes", body: e.body || "", files: e.files || [] }, ...(Array.isArray(e.noteTabs) ? e.noteTabs : [])];
  const links = linksOf(e.id).filter(y => pubIds.has(y.e.id));
  const tags = Array.isArray(e.tags) ? e.tags.filter(Boolean) : [];
  const tasks = (Array.isArray(e.tasks) ? e.tasks : []).filter(t => t && (t.text || "").trim());
  const cover = safeImg(e.cover);
  const tabHtml = tabs.map((t, i) => {
    const fl = (t.files || []).filter(f => f && f.kind === "link" && safeUrl(f.url));
    const body = String(t.body || "").trim();
    if (!body && !fl.length) return "";
    return `${tabs.length > 1 || i > 0 ? `<h3>${esc(t.name || "Notes")}</h3>` : ""}${fl.length ? `<ul class="links">${fl.map(f => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener">🔗 ${esc(f.name || f.url.replace(/^https?:\/\/(www\.)?/, ""))}</a></li>`).join("")}</ul>` : ""}${body ? `<div class="md">${md(body)}</div>` : ""}`;
  }).join("");
  const sub = tasks.length ? `<ul class="tasks">${tasks.map(t => `<li>${t.done ? "☑" : "☐"} ${esc(t.text)}</li>`).join("")}</ul>` : (e.subtitle ? `<p class="sub">${esc(e.subtitle)}</p>` : "");
  const search = [e.title, e.subtitle, tags.join(" "), tabs.map(t => t.body).join(" ")].join(" ").toLowerCase().replace(/\s+/g, " ").slice(0, 4000);
  const emoji = (typeof e.emoji === "string" && e.emoji.trim()) || FALLBACK[x.type];
  return `<details class="card" id="${slug(x)}" data-type="${x.type}" data-s="${esc(search)}"><summary><span class="em">${esc(emoji)}</span><span class="tt">${esc(e.title || "Untitled")}</span><span class="ty">${LBL[x.type]}</span></summary>
<div class="in">${cover ? `<img class="cover" src="${esc(cover)}" alt="">` : ""}${sub}${tags.length ? `<p class="tags">${tags.map(t => `<span>${esc(t)}</span>`).join("")}</p>` : ""}${tabHtml || (sub ? "" : '<p class="muted">No details yet.</p>')}${links.length ? `<p class="rel">Related: ${links.map(y => `<a href="#${slug(y)}">${esc(y.e.title || "Untitled")}</a>`).join(" · ")}</p>` : ""}</div></details>`;
};
const counts = Object.fromEntries(TYPES.map(k => [k, list.filter(x => x.type === k).length]));
const title = siteTitle || "My resources";
const updated = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--bg:#f7f6f2;--card:#fff;--ink:#1d1f1c;--muted:#686b63;--line:#e3e1d8;--accent:#4d7c0f;--soft:#eef4e2}
@media (prefers-color-scheme:dark){:root{--bg:#121411;--card:#1b1e1a;--ink:#ebede6;--muted:#a1a59a;--line:#2d322b;--accent:#a3d65c;--soft:#243020}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:820px;margin:0 auto;padding:32px 16px 64px}h1{font-size:30px;margin:0 0 4px;letter-spacing:-.01em}.upd{color:var(--muted);font-size:13px;margin:0 0 20px}
.bar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}.bar input{flex:1;min-width:200px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);font-size:15px}
.bar button{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:999px;padding:6px 14px;font-size:14px;cursor:pointer}.bar button[aria-pressed=true]{background:var(--soft);border-color:var(--accent);font-weight:600}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;margin:0 0 10px}.card summary{list-style:none;display:flex;gap:10px;align-items:center;padding:14px 16px;cursor:pointer}.card summary::-webkit-details-marker{display:none}
.em{font-size:20px}.tt{flex:1;font-weight:650}.ty{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:1px 8px}
.in{padding:0 16px 16px;border-top:1px solid var(--line)}.in h3{font-size:15px;margin:16px 0 4px}.sub{color:var(--muted)}.muted{color:var(--muted)}
.tags span{display:inline-block;background:var(--soft);border-radius:999px;padding:1px 9px;font-size:12px;margin:0 4px 4px 0}.cover{width:100%;max-height:260px;object-fit:cover;border-radius:8px;margin-top:14px}
.tasks,.links{padding-left:4px;list-style:none}.md img{max-width:100%}.md pre{overflow-x:auto;background:var(--bg);padding:10px;border-radius:6px}a{color:var(--accent)}
.rel{font-size:14px;color:var(--muted);border-top:1px dashed var(--line);padding-top:10px}.none{color:var(--muted);text-align:center;padding:30px}footer{color:var(--muted);font-size:12px;text-align:center;margin-top:30px}
</style></head><body><div class="wrap">
<h1>${esc(title)}</h1><p class="upd">Updated ${esc(updated)} · ${list.length} ${list.length === 1 ? "entry" : "entries"}</p>
<div class="bar"><input type="search" id="q" placeholder="Search…" aria-label="Search"><button type="button" data-f="all" aria-pressed="true">All</button>${TYPES.filter(k => counts[k]).map(k => `<button type="button" data-f="${k}" aria-pressed="false">${LBL[k]}s (${counts[k]})</button>`).join("")}</div>
<div id="list">${list.map(card).join("\n")}</div><p class="none" id="none"${list.length ? " hidden" : ""}>${list.length ? "Nothing matches." : "Nothing here yet."}</p>
<footer>Made with LifeOS</footer></div>
<script>(function(){var f="all",q=document.getElementById("q"),cards=[].slice.call(document.querySelectorAll(".card"));function go(){var t=q.value.trim().toLowerCase(),n=0;cards.forEach(function(c){var ok=(f==="all"||c.dataset.type===f)&&(!t||c.dataset.s.indexOf(t)>-1||c.textContent.toLowerCase().indexOf(t)>-1);c.hidden=!ok;if(ok)n++});document.getElementById("none").hidden=n>0}q.addEventListener("input",go);[].forEach.call(document.querySelectorAll("[data-f]"),function(b){b.addEventListener("click",function(){f=b.dataset.f;[].forEach.call(document.querySelectorAll("[data-f]"),function(x){x.setAttribute("aria-pressed",String(x===b))});go()})});function open(){var h=location.hash.slice(1);if(h){var el=document.getElementById(h);if(el){el.open=true;el.scrollIntoView({block:"start"})}}}window.addEventListener("hashchange",open);open()})();</script>
</body></html>
`;
// Compare without the date line so a day with no changes doesn't produce a new deploy
const strip = (h) => h.replace(/<p class="upd">[^<]*<\/p>/, "");
const prev = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
if (strip(prev) === strip(html)) { console.log(`UNCHANGED: ${list.length} public entries`); process.exit(0); }
fs.writeFileSync(outFile, html);
console.log(`WROTE ${outFile}: ${list.length} public entries (${list.map(x => x.e.title).join("; ")})`);
