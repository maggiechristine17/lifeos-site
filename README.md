# lifeos-site

Public website built from the LifeOS artifact. Only entries switched to **Show on website** appear here.

- `index.html`: the site (rebuilt automatically by a scheduled Claude task)
- `tools/build.mjs`: builds `index.html` from a JSON export of the public entries (`node tools/build.mjs <data-dir>`)

Never commit the exported data folder; only `index.html` is published.
