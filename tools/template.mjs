// Builds template/index.html: an empty copy of LifeOS that anyone can use without a Claude account.
// Everything is saved in the visitor's own browser (localStorage), never on a server, and never shared.
// Usage: node tools/template.mjs [app.html] [out-file]
import fs from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const appFile = process.argv[2] || path.join(here, "app.html");
const outFile = process.argv[3] || path.join(here, "..", "template", "index.html");
let app = fs.readFileSync(appFile, "utf8");
const n = (app.match(/window\.claude\?\.use\?\.\(/g) || []).length;
if (n < 5) { console.error("Unexpected page: found " + n + " capability calls."); process.exit(1); }
app = app.replace(/window\.claude\?\.use\?\.\(/g, "window.LIFEOS_USE(");
const shim = String.raw`<script>
(function () {
  // ---- LifeOS (your own copy): a database that lives in this browser only ----
  var KEY = "lifeos.mine.v1", mem = null;
  function load() { if (mem) return mem; try { mem = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { mem = null; } if (!mem || typeof mem !== "object" || !mem.c) mem = { c: {} }; return mem; }
  var saveFail = false;
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(mem)); saveFail = false; } catch (e) { if (!saveFail) { saveFail = true; setTimeout(function () { alertNote("This browser couldn't save your last change (storage is full or blocked). Download a backup from ⚙ Settings."); }, 0); } } }
  function alertNote(t) { var n = document.getElementById("notice"); if (n) { n.hidden = false; n.textContent = t; } }
  var clone = function (x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); };
  var colSubs = {}, docSubs = {};
  function colSnap(c) { var m = load().c[c] || {}; return { metadata: { fromCache: false }, docs: Object.keys(m).map(function (id) { var d = m[id]; return { id: id, exists: true, data: function () { return clone(d); } }; }) }; }
  function docSnap(c, id) { var m = load().c[c] || {}, d = m[id]; return { id: id, exists: d !== undefined, data: function () { return clone(d); } }; }
  function emit(c, id) { setTimeout(function () { (colSubs[c] || []).forEach(function (f) { try { f(colSnap(c)); } catch (e) { console.error(e); } }); (docSubs[c + "/" + id] || []).forEach(function (f) { try { f(docSnap(c, id)); } catch (e) { console.error(e); } }); }, 0); }
  function docRef(c, id) {
    return {
      set: function (body) { var s = load(); s.c[c] = s.c[c] || {}; s.c[c][id] = clone(body); persist(); emit(c, id); return Promise.resolve(); },
      update: function (patch) { var s = load(); s.c[c] = s.c[c] || {}; s.c[c][id] = Object.assign({}, s.c[c][id] || {}, clone(patch)); persist(); emit(c, id); return Promise.resolve(); },
      delete: function () { var s = load(); if (s.c[c]) delete s.c[c][id]; persist(); emit(c, id); return Promise.resolve(); },
      get: function () { return Promise.resolve(docSnap(c, id)); },
      onSnapshot: function (cb) { var k = c + "/" + id; (docSubs[k] = docSubs[k] || []).push(cb); setTimeout(function () { cb(docSnap(c, id)); }, 0); return function () { docSubs[k] = (docSubs[k] || []).filter(function (f) { return f !== cb; }); }; }
    };
  }
  var db = {
    collection: function (c) { return { doc: function (id) { return docRef(c, id); }, onSnapshot: function (cb) { (colSubs[c] = colSubs[c] || []).push(cb); setTimeout(function () { cb(colSnap(c)); }, 0); return function () { colSubs[c] = (colSubs[c] || []).filter(function (f) { return f !== cb; }); }; } }; },
    doc: function (p) { var i = p.lastIndexOf("/"); return docRef(p.slice(0, i), p.slice(i + 1)); }
  };
  // Only the database is provided; features that need a Claude account (Ask Claude, file uploads, publishing a website) stay switched off.
  window.LIFEOS_USE = function (name) { return Promise.resolve(name === "db" ? db : null); };
  window.LIFEOS_MINE = true;
  // ---- Backup, restore and start-over controls in ⚙ Settings ----
  // Inside Claude the backup is saved through the viewer's own save dialog; on a normal web page, as a plain download.
  function download(name, text) {
    var blob = new Blob([text], { type: "application/json" });
    var real = window.claude && window.claude.use ? window.claude.use("downloads") : Promise.resolve(null);
    return real.then(function (d) { if (d) return d.save({ filename: name, data: blob }); plain(name, text); }).catch(function (e) { if (!(e && /declin|cancel/i.test(e.code || ""))) plain(name, text); });
  }
  function plain(name, text) { var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "application/json" })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
  document.addEventListener("DOMContentLoaded", function () {
    var pop = document.getElementById("setPop"); if (!pop) return;
    var box = document.createElement("div");
    box.className = "mine-box";
    box.innerHTML = '<div class="mine-title">💾 Your data</div><p class="set-desc">Everything you add is saved only in this browser, on this device. Nobody else can see it. Download a backup now and then, and use it to move LifeOS to another device or browser.</p>' +
      '<div class="mine-row"><button type="button" class="btn" id="mineExport">⬇ Download backup</button><label class="btn mine-file">⬆ Restore a backup<input type="file" id="mineImport" accept="application/json,.json" hidden></label></div>' +
      '<div class="mine-row"><button type="button" class="btn danger" id="mineErase">Erase everything</button></div><p class="set-desc" id="mineMsg" role="status"></p>';
    pop.appendChild(box);
    var msg = function (t) { document.getElementById("mineMsg").textContent = t; };
    document.getElementById("mineExport").addEventListener("click", function () { var d = new Date(), p = function (x) { return String(x).padStart(2, "0"); }; download("lifeos-backup-" + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + ".json", JSON.stringify({ lifeos: 1, savedAt: d.toISOString(), data: load() })); msg("Backup downloaded."); });
    document.getElementById("mineImport").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      f.text().then(function (t) { var j = JSON.parse(t), d = j && j.data; if (!d || typeof d !== "object" || !d.c) throw new Error("bad"); if (!confirmTwice("restore")) { msg("Tap “Restore a backup” again and pick the file to replace everything here with that backup."); e.target.value = ""; return; } mem = d; persist(); location.reload(); })
        .catch(function () { msg("That file isn't a LifeOS backup."); e.target.value = ""; });
    });
    var armed = {}; function confirmTwice(k) { if (armed[k]) { armed[k] = false; return true; } armed[k] = true; setTimeout(function () { armed[k] = false; }, 8000); return false; }
    document.getElementById("mineErase").addEventListener("click", function () { if (!confirmTwice("erase")) { msg("Tap “Erase everything” again to delete all your entries from this browser. Download a backup first if you might want them."); return; } mem = { c: {} }; persist(); try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf("chevy.") === 0) localStorage.removeItem(k); }); } catch (e) {} location.reload(); });
  });
})();
</script>
<style>
#siteBtn, #siteBtn + .set-desc, #sitePop, .set-row:has(#siteBtn), [data-hmweb] { display: none !important; }
.mine-box { border-top: 1px solid var(--line); margin-top: 10px; padding-top: 10px; display: grid; gap: 8px; }
.mine-title { font-weight: 700; }
.mine-row { display: flex; gap: 8px; flex-wrap: wrap; }
.mine-file { cursor: pointer; }
</style>`;
if (!app.includes("</head>")) { console.error("No </head> in page."); process.exit(1); }
app = app.replace("</head>", shim + "\n</head>");
app = app.replace(/<title>[^<]*<\/title>/, "<title>LifeOS</title>");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, app);
console.log("WROTE " + outFile);
