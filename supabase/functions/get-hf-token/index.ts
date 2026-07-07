const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// The client needs the raw token so its service worker can inject auth
// headers on Hugging Face model downloads — exposure is inherent to the
// design (the token is a read-only gated-model token, nothing else).
// Rate limiting keeps the endpoint from being farmed by scrapers.
const MAX_REQUESTS_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;
const MAX_BUCKET_ENTRIES = 5000;

type Bucket = { windowStart: number; count: number };
const requestsByClient = new Map<string, Bucket>();

function isRateLimited(clientId: string): boolean {
  const now = Date.now();
  // Bound the map: drop expired buckets once it grows large.
  if (requestsByClient.size >= MAX_BUCKET_ENTRIES) {
    for (const [key, bucket] of requestsByClient) {
      if (now - bucket.windowStart >= HOUR_MS) requestsByClient.delete(key);
    }
  }
  const current = requestsByClient.get(clientId);
  if (!current || now - current.windowStart >= HOUR_MS) {
    requestsByClient.set(clientId, { windowStart: now, count: 1 });
    return false;
  }
  current.count++;
  return current.count > MAX_REQUESTS_PER_HOUR;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const clientId = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? req.headers.get('cf-connecting-ip')
      ?? 'unknown';
    if (isRateLimited(clientId)) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please wait.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '3600' },
      });
    }

    const token = Deno.env.get('HF_TOKEN') || '';

    if (!token) {
      return new Response(JSON.stringify({ error: 'No HF_TOKEN configured on server' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ token }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('get-hf-token error:', e);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
