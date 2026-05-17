// Cloudflare Pages Function - Proxy LuckMail API to avoid CORS
export async function onRequest(context) {
    const url = new URL(context.request.url);
    const path = url.pathname.replace('/api/', '');
    const target = `https://mails.luckyous.com/api/v1/openapi/email/token/${path}`;

    const response = await fetch(target, {
        method: context.request.method,
        headers: { 'User-Agent': 'LuckMailViewer/1.0' },
    });

    const body = await response.text();

    return new Response(body, {
        status: response.status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
        },
    });
}
