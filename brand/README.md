# Brand source files

Masters only — the files you re-export FROM. Nothing here is loaded by the site.

What the site actually loads lives in `assets/`:
- `assets/gunforma-logo.png` — nav wordmark, 1496x211, transparent, cropped tight
- `assets/gunforma-mark.png`  — nav mark for <600px, 251x211

Re-exporting the nav logo: transparent background, cropped to the artwork with
zero padding, 211px tall. The CSS pins the image to 22px tall including any
padding, so a padded export renders the logo tiny.

THIS FOLDER IS PUBLIC. Netlify serves the repo root, so anything committed here
is downloadable from gunforma.com. Unreleased work goes in the private
alexgamboa1/gunforma-drafts repo instead.
