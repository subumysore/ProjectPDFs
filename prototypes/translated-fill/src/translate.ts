/**
 * Translation provider. Default = MyMemory (real hosted API, CORS-enabled, no key).
 * If an API key is supplied we use Google Cloud Translation v2 REST instead.
 * This is the "real cloud translation API" the spike was scoped to use.
 *
 * KNOWN TENSION: any cloud provider sends form text off-device, which violates
 * ProjectPDFs' local-first privacy rule. In production this must be an on-device
 * model; the spike uses cloud only to validate the translate→fill→export flow.
 */

const cache = new Map<string, string>();

export async function translate(
  text: string,
  from: string,
  to: string,
  apiKey?: string,
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed || from === to) return trimmed;
  const key = `${from}|${to}|${trimmed}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const out = apiKey
    ? await googleTranslate(trimmed, from, to, apiKey)
    : await myMemoryTranslate(trimmed, from, to);
  cache.set(key, out);
  return out;
}

async function myMemoryTranslate(text: string, from: string, to: string): Promise<string> {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MyMemory ${res.status}`);
  const json = (await res.json()) as { responseData?: { translatedText?: string } };
  return json.responseData?.translatedText ?? text;
}

async function googleTranslate(text: string, from: string, to: string, apiKey: string): Promise<string> {
  const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source: from, target: to, format: 'text' }),
  });
  if (!res.ok) throw new Error(`Google Translate ${res.status}`);
  const json = (await res.json()) as { data?: { translations?: { translatedText: string }[] } };
  return json.data?.translations?.[0]?.translatedText ?? text;
}

/** Translate many strings, de-duplicated, with limited concurrency (free APIs rate-limit). */
export async function translateBatch(
  texts: string[],
  from: string,
  to: string,
  apiKey?: string,
): Promise<Map<string, string>> {
  const unique = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
  const result = new Map<string, string>();
  const concurrency = 4;
  for (let i = 0; i < unique.length; i += concurrency) {
    const slice = unique.slice(i, i + concurrency);
    const done = await Promise.all(
      slice.map(async (t) => [t, await translate(t, from, to, apiKey)] as const),
    );
    for (const [k, v] of done) result.set(k, v);
  }
  return result;
}
