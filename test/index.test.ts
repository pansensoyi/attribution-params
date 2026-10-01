import { describe, expect, it } from 'vitest';
import { decorateUrl, memoryStorage, parseTouch, toFields, touchToParams, trackVisit } from '../src/index';

const at = (iso: string) => () => new Date(iso);

describe('parseTouch', () => {
  it('uses UTMs first (lowercased)', () => {
    const t = parseTouch('https://shop.com/p?utm_source=Newsletter&utm_medium=Email&utm_campaign=oct_sale&gclid=abc');
    expect(t).toMatchObject({ source: 'newsletter', medium: 'email', campaign: 'oct_sale', clickIds: { gclid: 'abc' }, landingPage: 'https://shop.com/p' });
  });

  it('infers paid traffic from click ids', () => {
    expect(parseTouch('https://shop.com/?gclid=1')).toMatchObject({ source: 'google', medium: 'cpc' });
    expect(parseTouch('https://shop.com/?fbclid=1')).toMatchObject({ source: 'facebook', medium: 'paid_social' });
    expect(parseTouch('https://shop.com/?msclkid=1')).toMatchObject({ source: 'bing', medium: 'cpc' });
  });

  it('classifies referrers', () => {
    expect(parseTouch('https://shop.com/', 'https://www.google.com.ph/')).toMatchObject({ source: 'google', medium: 'organic' });
    expect(parseTouch('https://shop.com/', 'https://l.facebook.com/')).toMatchObject({ source: 'facebook', medium: 'social' });
    expect(parseTouch('https://shop.com/', 'https://blog.example.org/post')).toMatchObject({ source: 'blog.example.org', medium: 'referral' });
  });

  it('treats internal and missing referrers as direct', () => {
    expect(parseTouch('https://shop.com/', 'https://www.shop.com/cart')).toMatchObject({ source: '(direct)', medium: '(none)' });
    expect(parseTouch('https://shop.com/', 'https://pay.shop.com/', { internalHosts: ['shop.com', 'pay.shop.com'] }).source).toBe('(direct)');
    expect(parseTouch('https://shop.com/').source).toBe('(direct)');
  });
});

describe('trackVisit', () => {
  it('keeps first touch and uses last non-direct click', () => {
    const storage = memoryStorage();
    trackVisit('https://shop.com/?utm_source=google&utm_medium=cpc', undefined, { storage, now: at('2026-01-01T00:00:00Z') });
    let s = trackVisit('https://shop.com/', undefined, { storage, now: at('2026-01-02T00:00:00Z') });
    expect(s.last.source).toBe('google'); // direct didn't overwrite
    s = trackVisit('https://shop.com/?utm_source=braze&utm_medium=email', undefined, { storage, now: at('2026-01-03T00:00:00Z') });
    expect(s.first.source).toBe('google');
    expect(s.last.source).toBe('braze');
  });

  it('resets after TTL', () => {
    const storage = memoryStorage();
    trackVisit('https://shop.com/?utm_source=a&utm_medium=b', undefined, { storage, now: at('2026-01-01T00:00:00Z'), ttlDays: 30 });
    const s = trackVisit('https://shop.com/?utm_source=c&utm_medium=d', undefined, { storage, now: at('2026-03-01T00:00:00Z'), ttlDays: 30 });
    expect(s.first.source).toBe('c');
  });

  it('survives broken storage', () => {
    const broken = { getItem: () => '{not json', setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
    expect(trackVisit('https://shop.com/?gclid=1', undefined, { storage: broken }).first.source).toBe('google');
  });
});

describe('hand-off', () => {
  it('flattens to prefixed fields', () => {
    const s = trackVisit('https://shop.com/?utm_source=x&utm_medium=y&gclid=g', undefined, { now: at('2026-01-01T00:00:00Z') });
    const f = toFields(s);
    expect(f).toMatchObject({ ft_source: 'x', ft_medium: 'y', ft_gclid: 'g', lt_source: 'x', ft_timestamp: '2026-01-01T00:00:00.000Z' });
    expect(f.ft_campaign).toBeUndefined();
  });

  it('decorates only allowed hosts and never overwrites', () => {
    const t = parseTouch('https://shop.com/?utm_source=x&utm_medium=y');
    expect(decorateUrl('https://checkout.pay.com/?utm_source=keep', touchToParams(t), ['pay.com'])).toBe(
      'https://checkout.pay.com/?utm_source=keep&utm_medium=y',
    );
    expect(decorateUrl('https://other.com/', touchToParams(t), ['pay.com'])).toBe('https://other.com/');
  });

  it('does not emit utm params for direct touches', () => {
    expect(touchToParams(parseTouch('https://shop.com/')).utm_source).toBeUndefined();
  });
});
