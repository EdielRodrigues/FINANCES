(() => {
  'use strict';

  const siteUrl = 'https://edielrodrigues.github.io/FINANCES/';
  const origin = location.origin;
  const pageUrl = origin + location.pathname;

  const canonical = document.getElementById('seoCanonical');
  if (canonical) canonical.href = pageUrl;

  let ogUrl = document.querySelector('meta[property="og:url"]');
  if (!ogUrl) {
    ogUrl = document.createElement('meta');
    ogUrl.setAttribute('property','og:url');
    document.head.appendChild(ogUrl);
  }
  ogUrl.content = pageUrl;

  const image = new URL('icon-512.png', pageUrl).href;
  const ogImage = document.querySelector('meta[property="og:image"]');
  if (ogImage) ogImage.content = image;
  const twImage = document.querySelector('meta[name="twitter:image"]');
  if (twImage) twImage.content = image;

  const schema = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "Finance IA Pro",
    "url": pageUrl,
    "applicationCategory": "FinanceApplication",
    "operatingSystem": "Web, Android, iOS, Windows, macOS",
    "description": "Plataforma de gestão financeira pessoal, familiar e empresarial com controle de receitas, despesas, metas, contas, cartões, clientes, recibos, agendamentos, relatórios e inteligência artificial.",
    "inLanguage": "pt-BR",
    "image": image,
    "isPartOf": {"@type":"WebSite","name":"Finance IA Pro","url":siteUrl}
  };

  let script = document.getElementById('financeIaProSchema');
  if (!script) {
    script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'financeIaProSchema';
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(schema);
})();
