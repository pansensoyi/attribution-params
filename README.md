# attribution-params

![CI](https://github.com/pansensoyi/attribution-params/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

Lead-source attribution that survives the trip from ad click to CRM. Zero dependencies, works in the browser and Node.

- **Capture** UTMs and click IDs (`gclid`, `gbraid`, `wbraid`, `msclkid`, `fbclid`, `ttclid`, `li_fat_id`, …).
- **Infer** source / medium when UTMs are missing — click IDs → paid, search engines → organic, social sites → social, everything else → referral, internal or empty → direct.
- **Persist** first touch (with TTL) and *last non-direct* touch, so a returning direct visit doesn't wipe out the campaign that won the lead.
- **Hand off** to hidden form fields, CRM / CDP properties (Braze, HubSpot, Salesforce) and cross-domain links.

## Install

```bash
npm install github:pansensoyi/attribution-params
```

## Usage

```ts
import { trackVisit, toFields, fillForm, decorateUrl, touchToParams } from '@pansensoyi/attribution-params';

// On every page load
const attribution = trackVisit(location.href, document.referrer, {
  storage: window.localStorage,
  internalHosts: ['mysite.com', 'checkout.mysite.com'],
  ttlDays: 90,
});

// Lead form -> hidden inputs ft_source, ft_medium, lt_campaign, ft_gclid, ...
fillForm(document.querySelector('form#signup')!, toFields(attribution));

// Keep attribution across domains
link.href = decorateUrl(link.href, touchToParams(attribution.last), ['partner-checkout.com']);
```

Server-side (e.g. a Next.js route or Express middleware):

```ts
import { parseTouch } from '@pansensoyi/attribution-params';

const touch = parseTouch(`https://${req.headers.host}${req.url}`, req.headers.referer);
```

Send to a CDP as user attributes:

```ts
braze.getUser().setCustomUserAttribute('ft_source', attribution.first.source);
```

## Classification order

1. `utm_source` present → use UTMs as-is (lowercased).
2. A known click ID → e.g. `gclid` ⇒ `google / cpc`, `fbclid` ⇒ `facebook / paid_social`.
3. External referrer → `organic` (search engines), `social`, or `referral`.
4. Otherwise → `(direct) / (none)`.

## Development

```bash
npm install
npm test
npm run build
```

## License

MIT
