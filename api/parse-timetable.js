// Vercel serverless function: POST /api/parse-timetable
// Tar imot et bilde (base64), en PDF (base64), eller ren tekst (fra f.eks. Word-dokument
// tolket i nettleseren) og ber Claude lese av timeplanen og returnere strukturert JSON.
//
// Krever miljøvariabelen ANTHROPIC_API_KEY satt i Vercel-prosjektet
// (Project Settings → Environment Variables). Nøkkelen ligger KUN her på serveren,
// aldri i frontend-koden.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY er ikke satt som miljøvariabel i Vercel-prosjektet.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { mediaType, data, isPdf } = body || {};
  if (!data) {
    res.status(400).json({ error: 'Mangler data (base64 eller tekst).' });
    return;
  }

  let contentBlock;
  if (mediaType === 'text/plain') {
    contentBlock = { type: 'text', text: String(data).slice(0, 20000) };
  } else if (isPdf) {
    contentBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  } else {
    contentBlock = { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/png', data } };
  }

  const prompt = `Dette er et bilde eller dokument av en timeplan/ukeplan for et barn.
Les av alle timer/aktiviteter du finner og svar KUN med en gyldig JSON-array, ingen annen tekst, ingen \`\`\`-blokker, i nøyaktig dette formatet:
[{"day":"Mandag","start":"08:30","end":"09:15","title":"Norsk"}, {"day":"Mandag","start":"09:15","end":"10:00","title":"Matte"}]

Regler:
- "day" må være ett av: Mandag, Tirsdag, Onsdag, Torsdag, Fredag, Lørdag, Søndag.
- "start" og "end" i 24-timers HH:MM-format. Hvis sluttid ikke fremgår tydelig, utelat "end" helt.
- Slå gjerne sammen flere rader med samme fag på rad til én oppføring med riktig start/slutt.
- Ikke gjett aktiviteter som ikke er lesbare — hopp heller over uklare felt.
- Returner BARE JSON-arrayen.`;

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [contentBlock, { type: 'text', text: prompt }]
        }]
      })
    });

    const json = await upstream.json();
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: json.error || json });
      return;
    }

    const textOut = (json.content || []).map(b => b.text || '').join('');
    const cleaned = textOut.replace(/```json|```/gi, '').trim();

    let events;
    try {
      events = JSON.parse(cleaned);
    } catch (e) {
      res.status(502).json({ error: 'Klarte ikke tolke svaret som JSON.', raw: textOut });
      return;
    }
    if (!Array.isArray(events)) {
      res.status(502).json({ error: 'Uventet svarformat fra Claude.', raw: textOut });
      return;
    }

    res.status(200).json({ events });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Ukjent feil ved kall til Claude.' });
  }
}
