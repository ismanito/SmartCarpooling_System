/**
 * Mock geocoder: the pickup / drop-off points students can choose while no Google Maps key is set.
 * Coordinates are approximate neighbourhood centres around USIU-Africa (Nairobi).
 */
const PLACES = [
  // The campus is entered through one of two gates, so those are what people pick. The plain 'usiu' entry stays
  // only so older trips keep working; it is hidden from the picker. Gate coordinates are approximate: adjust them.
  { id: 'usiu-gate-a', name: 'USIU-Africa, Gate A', lat: -1.2189, lng: 36.8808, campus: true },
  { id: 'usiu-gate-b', name: 'USIU-Africa, Gate B', lat: -1.2203, lng: 36.8771, campus: true },
  { id: 'usiu', name: 'USIU-Africa campus', lat: -1.2195, lng: 36.8789, hidden: true },
  { id: 'safari-park', name: 'Safari Park / Thika Rd', lat: -1.2223, lng: 36.8888 },
  { id: 'roysambu', name: 'Roysambu', lat: -1.2185, lng: 36.8892 },
  { id: 'trm', name: 'Thika Road Mall (TRM)', lat: -1.2196, lng: 36.8886 },
  { id: 'zimmerman', name: 'Zimmerman', lat: -1.2087, lng: 36.8957 },
  { id: 'kasarani', name: 'Kasarani', lat: -1.2216, lng: 36.9046 },
  { id: 'mirema', name: 'Mirema Drive', lat: -1.2141, lng: 36.8785 },
  { id: 'garden-city', name: 'Garden City Mall', lat: -1.2321, lng: 36.8781 },
  { id: 'ruaraka', name: 'Ruaraka', lat: -1.2440, lng: 36.8717 },
  { id: 'githurai', name: 'Githurai 45', lat: -1.2010, lng: 36.9180 },
  { id: 'kahawa-sukari', name: 'Kahawa Sukari', lat: -1.1937, lng: 36.9355 },
  { id: 'kahawa-west', name: 'Kahawa West', lat: -1.1858, lng: 36.9049 },
  { id: 'runda', name: 'Runda', lat: -1.2180, lng: 36.8150 },
  { id: 'gigiri', name: 'Gigiri', lat: -1.2340, lng: 36.8150 },
  { id: 'muthaiga', name: 'Muthaiga', lat: -1.2499, lng: 36.8300 },
  { id: 'parklands', name: 'Parklands', lat: -1.2630, lng: 36.8150 },
  { id: 'westlands', name: 'Westlands', lat: -1.2676, lng: 36.8108 },
  { id: 'cbd', name: 'Nairobi CBD', lat: -1.2864, lng: 36.8172 },
  { id: 'kilimani', name: 'Kilimani', lat: -1.2900, lng: 36.7860 },
  { id: 'kileleshwa', name: 'Kileleshwa', lat: -1.2800, lng: 36.7800 },
  { id: 'lavington', name: 'Lavington', lat: -1.2780, lng: 36.7680 },
  { id: 'south-b', name: 'South B', lat: -1.3090, lng: 36.8350 },
  { id: 'eastleigh', name: 'Eastleigh', lat: -1.2740, lng: 36.8500 },
  { id: 'embakasi', name: 'Embakasi', lat: -1.3200, lng: 36.9000 },
];

// Places on campus that someone can say they are going to or leaving from. Edit this list to match the real campus.
const CAMPUS_BUILDINGS = [
  { id: 'science-centre', name: 'Science Centre' },
  { id: 'business-school', name: 'Chandaria Business School' },
  { id: 'library', name: 'Library' },
  { id: 'student-centre', name: 'Student Centre' },
  { id: 'admin-block', name: 'Administration Block' },
  { id: 'auditorium', name: 'Auditorium' },
  { id: 'sports-complex', name: 'Sports Complex' },
  { id: 'cafeteria', name: 'Cafeteria' },
  { id: 'hostels', name: 'Student Hostels' },
];

const BY_ID = new Map(PLACES.map((p) => [p.id, p]));
const BUILDING_BY_ID = new Map(CAMPUS_BUILDINGS.map((b) => [b.id, b]));

function findPlace(id) {
  return BY_ID.get(id) || null;
}

/**
 * A place with the campus building added to its name, e.g. "USIU-Africa, Gate A (Science Centre)".
 * Only campus gates have buildings. Returns null when the building does not exist or the place is off campus.
 * With no building the place is returned unchanged.
 */
function withBuilding(place, buildingId) {
  if (!buildingId) return place;
  const building = BUILDING_BY_ID.get(buildingId);
  if (!building || !place.campus) return null;
  return { ...place, name: `${place.name} (${building.name})` };
}

/** Great-circle distance in km. */
function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Mock router: roads are roughly 1.3x the straight-line distance.
const ROAD_FACTOR = 1.3;

function routeKm(from, to) {
  return Math.max(0.1, Math.round(haversineKm(from, to) * ROAD_FACTOR * 100) / 100);
}

module.exports = { PLACES, CAMPUS_BUILDINGS, withBuilding, findPlace, haversineKm, routeKm, ROAD_FACTOR };
