const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();

    if (!url || typeof url !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Only allow HuggingFace URLs to prevent SSRF
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!parsed.hostname.endsWith('huggingface.co')) {
      return new Response(JSON.stringify({ error: 'Only HuggingFace URLs are allowed' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = Deno.env.get('HF_TOKEN') || '';
    const fetchHeaders: Record<string, string> = {};
    if (token) fetchHeaders['Authorization'] = `Bearer ${token}`;

    const upstream = await fetch(url, { headers: fetchHeaders });

    if (!upstream.ok) {
      // Forward error status but not internal details
      const body = await upstream.text();
      return new Response(body, {
        status: upstream.status,
        headers: {
          ...corsHeaders,
          'Content-Type': upstream.headers.get('content-type') || 'text/plain',
        },
      });
    }

    // Stream the response back, preserving content-length for progress tracking
    const responseHeaders: Record<string, string> = { ...corsHeaders };
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) responseHeaders['Content-Length'] = contentLength;
    const contentType = upstream.headers.get('content-type');
    if (contentType) responseHeaders['Content-Type'] = contentType;

    return new Response(upstream.body, { headers: responseHeaders });
  } catch (e) {
    console.error('hf-proxy error:', e);
    return new Response(JSON.stringify({ error: 'Proxy error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
