export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    const url = new URL(request.url);

    // Get dashboard data
    if (url.pathname === "/api/data" && request.method === "GET") {
      try {
        const { results } = await env.DB.prepare(`
          SELECT 
            k.id AS keyword_id, k.name AS keyword,
            s.tcin, s.rank, s.price, s.reviews, s.captured_at,
            p.title, p.brand, p.mine
          FROM snapshots s
          JOIN keywords k ON k.id = s.keyword_id
          JOIN products p ON p.tcin = s.tcin
          ORDER BY s.captured_at DESC
        `).all();

        return new Response(JSON.stringify(results), {
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*" 
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*" 
          }
        });
      }
    }

    // Handle search & scrape
    if (url.pathname === "/api/scrape" && request.method === "POST") {
      try {
        const body = await request.json();
        const keywordText = body.keyword;

        if (!keywordText) {
          return new Response(JSON.stringify({ error: "Missing keyword" }), { status: 400 });
        }

        const kwId = keywordText.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now();
        await env.DB.prepare(`
          INSERT INTO keywords (id, name) VALUES (?, ?)
          ON CONFLICT(name) DO NOTHING
        `).bind(kwId, keywordText).run();

        const kwRecord = await env.DB.prepare("SELECT id FROM keywords WHERE name = ?").bind(keywordText).first();
        const activeKwId = kwRecord.id;

        const items = await scrapeTargetSearch(keywordText);

        for (const item of items) {
          await env.DB.prepare(`
            INSERT INTO products (tcin, title, brand)
            VALUES (?, ?, ?)
            ON CONFLICT(tcin) DO UPDATE SET title=excluded.title, brand=excluded.brand
          `).bind(item.tcin, item.title, item.brand).run();

          await env.DB.prepare(`
            INSERT INTO snapshots (keyword_id, tcin, rank, price, reviews)
            VALUES (?, ?, ?, ?, ?)
          `).bind(activeKwId, item.tcin, item.position, item.price, item.reviews).run();
        }

        return new Response(JSON.stringify({ status: "success", count: items.length }), {
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { 
          status: 500,
          headers: { "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    return new Response("Not Found", { status: 404 });
  }
};

async function scrapeTargetSearch(keyword) {
  const searchUrl = `https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2?key=9f36aeafbe60771e321a7ccc953a5d02cd308d0a&keyword=${encodeURIComponent(keyword)}&count=24&offset=0`;

  const response = await fetch(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Target API status ${response.status}`);
  }

  const data = await response.json();
  const products = data?.data?.search?.products || [];

  return products.map((p, index) => ({
    tcin: p.tcin,
    title: p.item?.product_description?.title || "Unknown",
    brand: p.item?.primary_brand?.name || "",
    price: p.price?.current_retail || null,
    reviews: p.ratings_and_reviews?.statistics?.rating?.count || 0,
    position: index + 1
  }));
}
