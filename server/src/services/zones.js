const { pool } = require('../db/pool');

const NEAREST_ZONE_KM = 3;

/**
 * Which zone a point is in. Where zones overlap the smallest wins. A point outside every zone gets the nearest
 * zone if that is within 3 km, otherwise null (outside the pilot area).
 */
async function tagPoint({ lat, lng }, db = pool) {
  const { rows } = await db.query(
    `WITH p AS (SELECT ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography AS g)
     SELECT z.zone_id, z.name, ST_Distance(z.polygon, p.g) AS dist_m
       FROM zones z, p
      ORDER BY NOT ST_Covers(z.polygon, p.g), ST_Distance(z.polygon, p.g), ST_Area(z.polygon)
      LIMIT 1`,
    [lat, lng],
  );
  const z = rows[0];
  if (!z || z.dist_m > NEAREST_ZONE_KM * 1000) return null;
  return { zoneId: z.zone_id, name: z.name };
}

/** zone_id -> Set of neighbouring zone ids. */
async function neighbourMap(db = pool) {
  const { rows } = await db.query('SELECT zone_id, neighbour_id FROM zone_neighbours');
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.zone_id)) map.set(r.zone_id, new Set());
    map.get(r.zone_id).add(r.neighbour_id);
  }
  return map;
}

async function zoneNames(db = pool) {
  const { rows } = await db.query('SELECT zone_id, name FROM zones');
  return new Map(rows.map((r) => [r.zone_id, r.name]));
}

module.exports = { tagPoint, neighbourMap, zoneNames, NEAREST_ZONE_KM };
