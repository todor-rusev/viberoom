# The marks of the catalogue's systems

One file per row of `src/connections/catalog.ts`, named by its id, served at `/connection-logos/<id>.svg`. Each is one
path in one colour; the window draws it through a mask, white or black on the brand's colour (`mark.hex` in the
catalogue).

- From **Simple Icons** 16.32.0 (https://simpleicons.org, CC0-1.0), written by `node scripts/connection-logos.mjs`:
  atlassian, notion, linear, airtable, todoist, sentry, cloudflare, supabase, huggingface, clickup, miro, dropbox,
  vercel, netlify, neon, posthog, webflow, wix, stripe, paypal, perplexity, wolfram, trello, calendly, wordpress,
  trivago, alltrails.
- Kept by hand: **higgsfield.svg**, the glyph of the header of https://higgsfield.ai (`hf-logo__glyph`), taken on
  2026-09-25; its colour is the lime of the site's app icon. It is not in Simple Icons.
- Kept by hand, 2026-09-27: the brand's own mark, reduced to one path
  on the 24 grid with its wordmark and background left out. From the brand's own site: exa (exa.ai, the blue mark of
  its logo), tavily (the site's icon), fireflies (the mark of the header's logo), kiwi (images.kiwi.com, the K of the
  mobile logo), monday (the three shapes of the header's logo), context7 (the symbol of its logo), awsknowledge
  (aws.amazon.com, the wordmark with its smile, which is AWS's mark), semgrep, apify and mercury (the sites' icons),
  jam (the strawberry of the site's icon, its face left out: one colour cannot carry it), globalping (the pinned-tab
  icon), guru (the G of its logo), attio (attio.com/brand, the mark of its lockup). From SVGL (https://svgl.app, which
  keeps each brand's official file with its source): canva (the C of its mark), axiom, granola. From Wikimedia
  Commons, public domain: mslearn (the Microsoft logo's four squares), honeycomb (the four hexagons of its logo), ramp
  (the mark of its logo). Each colour is the brand's, read from the same source.

- No mark: craft, deepwiki, invideo, close, gamma. They are not in Simple Icons, SVGL or Commons, and their sites give
  no SVG mark of their own (only raster icons, which are not traced); the window draws the first letter.

The marks are the trademarks of their owners. viberoom shows them only to name the system a connection goes to.
