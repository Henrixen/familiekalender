// Vercel Serverless Function
// GitHub path must be: /api/ics-proxy.js

function isPrivateOrLocalHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1' || h.endsWith('.local')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a === 10 || a === 127 || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return true;
  }
  return false;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Kun GET er støttet.' });
  }

  try {
    let raw = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;
    raw = String(raw || '').trim();
    if (!raw) return res.status(400).json({ error: 'Mangler kalenderlenke.' });

    raw = raw.replace(/^webcal:\/\//i, 'https://');

    let target;
    try { target = new URL(raw); }
    catch { return res.status(400).json({ error: 'Ugyldig kalenderlenke.' }); }

    if (!['http:', 'https:'].includes(target.protocol)) {
      return res.status(400).json({ error: 'Kalenderlenken må bruke http, https eller webcal.' });
    }
    if (isPrivateOrLocalHost(target.hostname)) {
      return res.status(400).json({ error: 'Denne adressen kan ikke hentes av proxyen.' });
    }

    const upstream = await fetch(target.toString(), {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Familiekalenderen/1.0',
        'Accept': 'text/calendar,text/plain;q=0.9,*/*;q=0.5'
      }
    });

    const body = await upstream.text();

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `Kalenderleverandøren svarte med HTTP ${upstream.status}.`
      });
    }

    if (!/BEGIN:VCALENDAR/i.test(body)) {
      return res.status(422).json({
        error: 'Lenken kunne hentes, men svaret var ikke en gyldig ICS/iCalendar-kalender. Sjekk at Apple-kalenderen er offentlig og bruk den kopierte webcal-lenken.'
      });
    }

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).send(body);
  } catch (err) {
    console.error('ICS proxy error:', err);
    return res.status(500).json({
      error: 'Kunne ikke hente kalenderen: ' + (err?.message || 'ukjent feil')
    });
  }
}
