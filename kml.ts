import { Router } from 'express';
import { admin, getCaller } from '../supabase.js';

export const kml = Router();

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const STRUCT: Record<string, string> = {
  mh: 'Manhole', hh: 'Handhole', aerial: 'Aerial', building: 'Building',
};

/**
 * GET /closures.kml — the master closure registry as a KML for Google Earth.
 * One pin per closure (a manhole can hold several). Any active user can pull it
 * (techs load it on their phones). Optional ?customer=Lumen filter.
 */
kml.get('/closures.kml', async (req, res) => {
  const caller = await getCaller(req.headers.authorization);
  if (!caller) return res.status(401).json({ error: 'unauthorized' });

  let q = admin
    .from('closures')
    .select('closure_code, gps_lat, gps_lng, structure_type, structure_owner, enclosure_model, notes, customers(name, code)')
    .not('gps_lat', 'is', null);
  const customer = req.query.customer as string | undefined;

  const { data: closures, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const rows = (closures ?? []).filter((c: any) =>
    !customer || c.customers?.code === customer || c.customers?.name === customer);

  const placemarks = rows.map((c: any) => `
    <Placemark>
      <name>${esc(c.closure_code)}</name>
      <description><![CDATA[
        Customer: ${esc(c.customers?.name)}<br/>
        Structure: ${esc(STRUCT[c.structure_type] ?? c.structure_type)}<br/>
        Owner/tag: ${esc(c.structure_owner)}<br/>
        Enclosure: ${esc(c.enclosure_model)}<br/>
        ${c.notes ? 'Notes: ' + esc(c.notes) + '<br/>' : ''}
      ]]></description>
      <Point><coordinates>${Number(c.gps_lng)},${Number(c.gps_lat)},0</coordinates></Point>
    </Placemark>`).join('');

  const doc = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>B&amp;M Closure Registry${customer ? ' — ' + esc(customer) : ''}</name>
    ${placemarks}
  </Document>
</kml>`;

  res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml');
  res.setHeader('Content-Disposition', 'attachment; filename="bm-closures.kml"');
  return res.send(doc);
});
