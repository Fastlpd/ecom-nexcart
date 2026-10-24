function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function optionalText(value, className) {
  const text = String(value ?? '').trim();
  return text ? `<div class="${className}">${escapeHtml(text)}</div>` : '';
}

function renderPinterestTemplate(data) {
  const brand = String(data.brand ?? '').trim();
  const headline = String(data.headline ?? '').trim();
  const productImage = String(data.productImage ?? '').trim();
  const benefits = [data.benefit1, data.benefit2, data.benefit3]
    .map((benefit) => String(benefit ?? '').trim())
    .filter(Boolean)
    .map((benefit) => `<li><span class="check">✓</span><span>${escapeHtml(benefit)}</span></li>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=1000, height=1500">
  <title>${escapeHtml(headline || 'Pinterest product pin')}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 1000px; height: 1500px; }
    body {
      background: #f4efe6;
      color: #0f1715;
      font-family: 'Inter', Arial, Helvetica, sans-serif;
      overflow: hidden;
    }
    .pin {
      position: relative;
      display: flex;
      flex-direction: column;
      width: 1000px;
      height: 1500px;
      padding: 75px 80px 70px;
      overflow: hidden;
      background: linear-gradient(135deg, #ffffff 0%, #ece2d5 100%);
    }
    .accent { position: absolute; width: 480px; height: 480px; right: -140px; top: -160px; border-radius: 50%; background: #c5d8ce; opacity: .85; }
    .accent-two { position: absolute; width: 320px; height: 320px; left: -140px; bottom: 140px; border-radius: 50%; background: #e8cbb5; opacity: .6; }
    .content { position: relative; z-index: 1; display: flex; flex-direction: column; height: 100%; }
    
    /* Bigger, bolder brand & typography */
    .brand { min-height: 38px; color: #2e5c4e; font-size: 28px; font-weight: 800; letter-spacing: 5px; text-transform: uppercase; }
    .headline { max-width: 840px; margin-top: 35px; color: #0b1311; font-size: 72px; font-weight: 900; line-height: 1.05; letter-spacing: -2px; overflow-wrap: anywhere; }
    .subtitle { max-width: 800px; margin-top: 20px; color: #3b4d47; font-size: 34px; font-weight: 600; line-height: 1.25; overflow-wrap: anywhere; }
    
    /* Vibrant, high-contrast product container with image punch */
    .product-wrap { display: flex; align-items: center; justify-content: center; height: 620px; margin: 35px 0 35px; border-radius: 28px; background: rgba(255,255,255,0.85); box-shadow: 0 20px 45px rgba(45, 35, 25, 0.15); border: 2px solid rgba(255,255,255,0.9); }
    .product { width: 90%; height: 90%; object-fit: contain; filter: contrast(1.06) saturate(1.12); }
    
    .details { display: flex; align-items: flex-end; justify-content: space-between; gap: 36px; }
    .benefits { flex: 1; margin: 0; padding: 0; list-style: none; color: #1e2b27; font-size: 28px; font-weight: 600; line-height: 1.4; }
    .benefits li { display: flex; gap: 16px; align-items: flex-start; margin: 12px 0; overflow-wrap: anywhere; }
    
    .check { display: inline-flex; flex: 0 0 36px; align-items: center; justify-content: center; width: 36px; height: 36px; margin-top: 2px; border-radius: 50%; background: #2e5c4e; color: #fff; font-size: 22px; font-weight: 800; box-shadow: 0 4px 10px rgba(46,92,78,0.3); }
    .price { color: #0b1311; font-size: 52px; font-weight: 900; white-space: nowrap; }
    
    .cta { align-self: flex-start; margin-top: auto; padding: 24px 44px; border-radius: 999px; background: #c85a38; color: #fff; font-size: 32px; font-weight: 800; letter-spacing: -0.5px; box-shadow: 0 10px 25px rgba(200,90,56,0.35); overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <main class="pin">
    <div class="accent"></div><div class="accent-two"></div>
    <div class="content">
      ${optionalText(brand, 'brand')}
      <div class="headline">${escapeHtml(headline)}</div>
      ${optionalText(data.subtitle, 'subtitle')}
      <div class="product-wrap"><img class="product" src="${escapeHtml(productImage)}" alt="${escapeHtml(headline)}"></div>
      <div class="details">
        <ul class="benefits">${benefits}</ul>
        ${optionalText(data.price, 'price')}
      </div>
      ${optionalText(data.cta, 'cta')}
    </div>
  </main>
</body>
</html>`;
}

module.exports = { renderPinterestTemplate };