// LuckMail API Proxy Worker - 粘贴到 Cloudflare Worker 编辑器
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,OPTIONS',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    const path = url.pathname.replace(/^\//, '');
    if (!path) return new Response('LuckMail API Proxy OK');
    const target = 'https://mails.luckyous.com/api/v1/openapi/email/token/' + path;
    const resp = await fetch(target, { headers: { 'User-Agent': 'LuckMailViewer/1.0' } });
    const body = await resp.text();
    return new Response(body, {
      status: resp.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};
