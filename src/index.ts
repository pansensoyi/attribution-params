/**
 * attribution-params — capture UTMs & click IDs, infer source/medium,
 * persist first and last-non-direct touch, and hand attribution to forms/CRMs.
 * Works in the browser and in Node (pass URLs explicitly).
 */

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id'] as const;

/** Click identifier -> [source, medium] it implies. */
export const CLICK_IDS: Record<string, [string, string]> = {
  gclid: ['google', 'cpc'],
  gbraid: ['google', 'cpc'],
  wbraid: ['google', 'cpc'],
  dclid: ['google', 'display'],
  msclkid: ['bing', 'cpc'],
  fbclid: ['facebook', 'paid_social'],
  ttclid: ['tiktok', 'paid_social'],
  li_fat_id: ['linkedin', 'paid_social'],
  twclid: ['twitter', 'paid_social'],
  epik: ['pinterest', 'paid_social'],
  sccid: ['snapchat', 'paid_social'],
};

const SEARCH_ENGINES: Record<string, string> = {
  'google.': 'google',
  'bing.com': 'bing',
  'yahoo.': 'yahoo',
  'duckduckgo.com': 'duckduckgo',
  'baidu.com': 'baidu',
  'yandex.': 'yandex',
  'ecosia.org': 'ecosia',
};

const SOCIAL: Record<string, string> = {
  'facebook.com': 'facebook',
  'instagram.com': 'instagram',
  't.co': 'twitter',
  'x.com': 'twitter',
  'linkedin.com': 'linkedin',
  'lnkd.in': 'linkedin',
  'youtube.com': 'youtube',
  'tiktok.com': 'tiktok',
  'reddit.com': 'reddit',
  'pinterest.': 'pinterest',
};

export interface Touch {
  source: string;
  medium: string;
  campaign?: string;
  term?: string;
  content?: string;
  id?: string;
  clickIds: Record<string, string>;
  landingPage: string;
  referrer?: string;
  timestamp: string;
}

export interface ParseOptions {
  /** Hostnames treated as internal (not referrals). Defaults to the landing page host. */
  internalHosts?: string[];
  now?: () => Date;
}

const hostOf = (u: string): string | undefined => {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return undefined;
  }
};

const matchHost = (host: string, table: Record<string, string>): string | undefined => {
  for (const [needle, name] of Object.entries(table)) {
    if (needle.endsWith('.') ? host.includes(needle) : host === needle || host.endsWith(`.${needle}`)) return name;
  }
  return undefined;
};

export const isDirect = (t: Pick<Touch, 'source' | 'medium'>): boolean => t.source === '(direct)';

/** Parse a landing URL (+ optional referrer) into a Touch. */
export function parseTouch(landingUrl: string, referrer?: string, opts: ParseOptions = {}): Touch {
  const url = new URL(landingUrl);
  const p = url.searchParams;
  const get = (k: string) => p.get(k)?.trim() || undefined;

  const clickIds: Record<string, string> = {};
  for (const k of Object.keys(CLICK_IDS)) {
    const v = get(k);
    if (v) clickIds[k] = v;
  }

  const base = {
    campaign: get('utm_campaign'),
    term: get('utm_term'),
    content: get('utm_content'),
    id: get('utm_id'),
    clickIds,
    landingPage: `${url.origin}${url.pathname}`,
    referrer: referrer || undefined,
    timestamp: (opts.now?.() ?? new Date()).toISOString(),
  };

  // 1) Explicit UTMs win
  const utmSource = get('utm_source');
  if (utmSource) return { source: utmSource.toLowerCase(), medium: (get('utm_medium') ?? '(none)').toLowerCase(), ...base };

  // 2) Click IDs imply paid traffic
  const firstClick = Object.keys(clickIds)[0];
  if (firstClick) {
    const [source, medium] = CLICK_IDS[firstClick];
    return { source, medium, ...base };
  }

  // 3) Referrer classification
  const refHost = referrer ? hostOf(referrer) : undefined;
  const internal = new Set((opts.internalHosts ?? [url.hostname]).map((h) => h.replace(/^www\./, '').toLowerCase()));
  if (refHost && !internal.has(refHost)) {
    const engine = matchHost(refHost, SEARCH_ENGINES);
    if (engine) return { source: engine, medium: 'organic', ...base };
    const social = matchHost(refHost, SOCIAL);
    if (social) return { source: social, medium: 'social', ...base };
    return { source: refHost, medium: 'referral', ...base };
  }

  return { source: '(direct)', medium: '(none)', ...base };
}

// ------------------------------------------------------------------- persistence

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AttributionState {
  first: Touch;
  last: Touch;
}

export interface TrackerOptions extends ParseOptions {
  storage?: StorageLike | null;
  key?: string;
  /** Days before first touch expires and is replaced. Default 90. */
  ttlDays?: number;
}

/** In-memory fallback so the tracker never throws when storage is blocked. */
export function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

/**
 * Record a visit. First touch is kept until it expires; last touch follows
 * "last non-direct click" — a direct visit never overwrites a marketing touch.
 */
export function trackVisit(landingUrl: string, referrer?: string, opts: TrackerOptions = {}): AttributionState {
  const storage = opts.storage ?? memoryStorage();
  const key = opts.key ?? 'attribution';
  const ttlMs = (opts.ttlDays ?? 90) * 864e5;
  const now = opts.now?.() ?? new Date();
  const touch = parseTouch(landingUrl, referrer, { ...opts, now: () => now });

  let state: AttributionState | null = null;
  try {
    const raw = storage.getItem(key);
    state = raw ? (JSON.parse(raw) as AttributionState) : null;
  } catch {
    state = null;
  }

  if (!state || now.getTime() - Date.parse(state.first.timestamp) > ttlMs) {
    state = { first: touch, last: touch };
  } else if (!isDirect(touch) || isDirect(state.last)) {
    state = { ...state, last: touch };
  }

  try {
    storage.setItem(key, JSON.stringify(state));
  } catch {
    /* storage full or blocked — attribution still returned */
  }
  return state;
}

// ------------------------------------------------------------------ hand-off

/** Flatten state into string fields for hidden form inputs, CRM properties or Braze attributes. */
export function toFields(state: AttributionState, prefixes: { first?: string; last?: string } = {}): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (prefix: string, t: Touch) => {
    const entries: Array<[string, string | undefined]> = [
      ['source', t.source],
      ['medium', t.medium],
      ['campaign', t.campaign],
      ['term', t.term],
      ['content', t.content],
      ['landing_page', t.landingPage],
      ['referrer', t.referrer],
      ['timestamp', t.timestamp],
      ...Object.entries(t.clickIds),
    ];
    for (const [k, v] of entries) if (v) out[`${prefix}${k}`] = v;
  };
  add(prefixes.first ?? 'ft_', state.first);
  add(prefixes.last ?? 'lt_', state.last);
  return out;
}

/** Fill (or create) hidden inputs in a form element. */
export function fillForm(form: HTMLFormElement, fields: Record<string, string>): void {
  for (const [name, value] of Object.entries(fields)) {
    let input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (!input) {
      input = form.ownerDocument.createElement('input');
      input.type = 'hidden';
      input.name = name;
      form.appendChild(input);
    }
    input.value = value;
  }
}

/**
 * Append attribution params to a link (e.g. cross-domain checkout) without
 * overwriting params already present. Only decorates the listed domains.
 */
export function decorateUrl(href: string, params: Record<string, string | undefined>, onlyHosts?: string[]): string {
  const url = new URL(href);
  const host = url.hostname.replace(/^www\./, '');
  if (onlyHosts && !onlyHosts.some((h) => host === h || host.endsWith(`.${h}`))) return href;
  for (const [k, v] of Object.entries(params)) if (v && !url.searchParams.has(k)) url.searchParams.set(k, v);
  return url.toString();
}

/** UTM params (and click IDs) of a touch, ready for decorateUrl. */
export function touchToParams(t: Touch): Record<string, string | undefined> {
  return {
    utm_source: isDirect(t) ? undefined : t.source,
    utm_medium: isDirect(t) ? undefined : t.medium,
    utm_campaign: t.campaign,
    utm_term: t.term,
    utm_content: t.content,
    ...t.clickIds,
  };
}
