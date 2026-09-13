const { readState } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.json({ ok: false });
  }

  try {
    const { items } = await readState();
    // newest first for the client
    const sorted = [...items].sort((a, b) => (b.t || 0) - (a.t || 0));
    return res.json({ ok: true, count: sorted.length, items: sorted });
  } catch (e) {
    res.statusCode = 500;
    return res.json({ ok: false, error: 'read failed' });
  }
};
