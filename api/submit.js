const {
  sanitizeName,
  sanitizePhone,
  validPicks,
  LEVELS,
  readState,
  updateState,
  rateLimited,
} = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.json({ ok: false, error: 'Method not allowed' });
  }

  let b = req.body;
  if (typeof b === 'string') {
    try {
      b = JSON.parse(b || '{}');
    } catch {
      b = {};
    }
  }
  if (!b || typeof b !== 'object') b = {};

  // Honeypot: bots that fill the hidden "website" field are silently accepted but ignored
  if (b.website) return res.json({ ok: true });

  const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || 'unknown').trim();
  if (rateLimited(ip)) {
    res.statusCode = 429;
    return res.json({ ok: false, error: 'محاولة كتير جدًا — استنى شوية وجرّب تاني' });
  }

  const name = sanitizeName(b.name);
  if (name.length < 2 || !/[\p{L}\p{N}]/u.test(name)) {
    res.statusCode = 400;
    return res.json({ ok: false, error: 'اكتب اسم واضح الأول' });
  }

  const phone = sanitizePhone(b.phone);
  if (!phone) {
    res.statusCode = 400;
    return res.json({ ok: false, error: 'اكتب رقم تواصل صحيح (موبايل)' });
  }

  const { picks, total } = validPicks(b.picks);
  if (total < 1) {
    res.statusCode = 400;
    return res.json({ ok: false, error: 'اختار مهارة واحدة على الأقل' });
  }
  if (total > 20) {
    res.statusCode = 400;
    return res.json({ ok: false, error: 'الحد الأقصى 20 مهارة' });
  }

  // Every picked skill must carry a valid level
  const rawLv = (b.levels && typeof b.levels === 'object' && !Array.isArray(b.levels)) ? b.levels : {};
  const levels = {};
  for (const arr of Object.values(picks)) {
    for (const s of arr) {
      const L = rawLv[s];
      if (!LEVELS.has(L)) {
        res.statusCode = 400;
        return res.json({ ok: false, error: 'اختار مستواك في كل مهارة علّمت عليها' });
      }
      levels[s] = L;
    }
  }

  try {
    // Re-submit with editId => replace the previous entry (by id)
    const isEdit = typeof b.editId === 'string' && b.editId.length < 40;
    const entry = {
      id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      name,
      phone,
      picks,
      levels,
      t: Date.now(),
    };

    let count = 0;
    let updated = false;
    await updateState((items) => {
      const mine = isEdit ? items.find((e) => e.id === b.editId) : undefined;
      const keep = items.filter((e) => e !== mine);
      const next = [...keep, entry].sort((a, b) => a.t - b.t);
      count = next.length;
      updated = !!mine;
      return next;
    });

    return res.json({ ok: true, count, id: entry.id, updated });
  } catch (e) {
    res.statusCode = 500;
    return res.json({ ok: false, error: 'حصلت مشكلة في الحفظ — جرّب تاني' });
  }
};
