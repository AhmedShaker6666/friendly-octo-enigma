# RO'YA on Hatchable

Import this folder (zip) into Hatchable, then in the project console set the secret **SESSION_SECRET** (any long random string). Without it sign-in returns an error.

Demo logins (seeded): admin@roya-demo.com / Admin@ROYA26!, employee@roya-demo.com / Employee@ROYA26!

- `/#/about` : team page
- Add data: type it, monthly grid, Excel/CSV, scan (OCR in the browser), Odoo pull, ERP push key
- Inbox: review everything once, then accept
- Reduction plan (AI wording needs an AI provider key on your Hatchable account; otherwise a rule-based summary is shown)
- FRA credits, CBAM desk with input checks

If the deploy complains about the `[ai]` block, delete it from hatchable.toml: everything else works without it.
