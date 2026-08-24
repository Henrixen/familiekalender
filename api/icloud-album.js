// Vercel serverless function: GET /api/icloud-album?url=<delt album-lenke>
//
// Henter bildelenker fra et offentlig delt Apple-album ("Public Website" på).
// Bruker Apple sitt IKKE-dokumenterte interne grensesnitt (samme som icloud.com
// selv bruker) — dette kan i prinsippet slutte å virke hvis Apple endrer noe,
// siden det ikke er en offisiell, støttet API.

export default async function handler(req, res) {
  const raw = req.query.url;
  if (!raw || typeof raw !== 'string') {
    res.status(400).json({ error: 'Mangler "url"-parameter' });
    return;
  }

  // Godta både hele lenken (https://www.icloud.com/sharedalbum/#B1-xxxx) og bare token.
  const match = raw.match(/#([A-Za-z0-9-]+)/);
  const token = match ? match[1] : raw.trim();
  if (!token) {
    res.status(400).json({ error: 'Fant ikke album-token i lenken.' });
    return;
  }

  async function fetchWebstream(host) {
    const r = await fetch(`https://${host}/${token}/sharedstreams/webstream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamCtag: null })
    });
    if (!r.ok) throw new Error(`webstream svarte ${r.status}`);
    return r.json();
  }

  try {
    let host = 'p23-sharedstreams.icloud.com';
    let data = await fetchWebstream(host);
    if (data && data['X-Apple-MMe-Host']) {
      host = data['X-Apple-MMe-Host'];
      data = await fetchWebstream(host);
    }

    const photos = data.photos || [];
    if (!photos.length) {
      res.status(200).json({ urls: [] });
      return;
    }

    const guids = photos.map(p => p.photoGuid);
    const assetRes = await fetch(`https://${host}/${token}/sharedstreams/webasseturls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoGuids: guids })
    });
    if (!assetRes.ok) throw new Error(`webasseturls svarte ${assetRes.status}`);
    const assetData = await assetRes.json();
    const items = assetData.items || {};

    const urls = [];
    for (const p of photos) {
      const derivs = p.derivatives || {};
      const keys = Object.keys(derivs);
      if (!keys.length) continue;
      // Velg den største versjonen av bildet som finnes.
      let best = derivs[keys[0]];
      for (const k of keys) {
        if (parseInt(derivs[k].fileSize || 0, 10) > parseInt(best.fileSize || 0, 10)) best = derivs[k];
      }
      const item = items[best.checksum];
      if (item) urls.push(`https://${item.url_location}${item.url_path}`);
    }

    res.status(200).json({ urls });
  } catch (e) {
    res.status(502).json({
      error: 'Klarte ikke hente fra iCloud: ' + (e.message || 'ukjent feil') +
        '. Apple sitt interne grensesnitt kan ha endret seg — dette er ikke en offisiell API.'
    });
  }
}
