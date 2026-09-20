import { createAnalytics } from './analyticsCore.mjs';

const env = import.meta.env || {};
const browser = typeof window !== 'undefined';
const key = (env.VITE_AMPLITUDE_API_KEY || '').trim();
const stateKey = Symbol.for('sicr3p.amplitude');
const disabled = () => {
  if (!browser) return true;
  try {
    return window.localStorage.getItem('sicr3p.analytics.optout') === 'true'
      || window.navigator.globalPrivacyControl === true;
  } catch { return true; }
};

function loadSdk() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => finish(new Error('Amplitude load timeout')), 10000);
    function finish(error) {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      if (error) { script.remove(); reject(error); }
      else if (window.amplitude?.init) resolve(window.amplitude);
      else reject(new Error('Amplitude SDK unavailable'));
    }
    // Official project Script Loader. No replay plugin or automatic capture.
    script.src = 'https://cdn.amplitude.com/script/' + encodeURIComponent(key) + '.js';
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    script.onload = () => finish();
    script.onerror = () => finish(new Error('Amplitude load failed'));
    document.head.appendChild(script);
  });
}

const analytics = browser
  ? (window[stateKey] ||= createAnalytics({
      apiKey: key,
      serverZone: env.VITE_AMPLITUDE_SERVER_ZONE,
      enabled: env.VITE_AMPLITUDE_ENABLED === 'true',
      loadSdk,
      blocked: disabled,
    }))
  : createAnalytics({ enabled: false });

export const trackAnalytics = (event, properties) => analytics.track(event, properties);
export const trackPublicPage = (pathname, navigationKey) => analytics.page(pathname, navigationKey);
export function setAnalyticsOptOut(value) {
  if (browser) {
    try { window.localStorage.setItem('sicr3p.analytics.optout', String(Boolean(value))); }
    catch { /* still disable in memory */ }
  }
  analytics.setOptOut(value);
}
