const { geocode } = require('../src/lib/geocode');

const row = { lat: '-1.2182469', lon: '36.9007403', display_name: 'Kasarani Mwiki Road, Clay City, Kasarani, Nairobi, Kenya' };
const fakeFetch = (rows) => jest.fn().mockResolvedValue({ ok: true, json: async () => rows });

describe('address search', () => {
  test('turns results into points the matching can use', async () => {
    const f = fakeFetch([row]);
    const out = await geocode('kasarani mwiki', { fetchImpl: f });
    expect(out).toEqual([{ id: 'geo:-1.21825,36.90074', name: 'Kasarani Mwiki Road, Clay City, Kasarani', lat: -1.2182469, lng: 36.9007403, geo: true }]);
    const url = String(f.mock.calls[0][0]);
    expect(url).toContain('countrycodes=ke');
    expect(url).toContain('bounded=1');
  });

  test('short queries are not sent anywhere', async () => {
    const f = fakeFetch([row]);
    expect(await geocode('ab', { fetchImpl: f })).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  test('repeat searches come from the cache', async () => {
    const f = fakeFetch([row]);
    await geocode('thika road mall', { fetchImpl: f });
    await geocode('Thika Road Mall', { fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
