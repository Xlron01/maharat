// Shared helpers for the API functions (underscore prefix => not routed as an endpoint)
// Storage: private GitHub repo via REST API (replaces suspended Vercel Blob).
// Files: data/responses.json  — single JSON array of entries, read/write via
// the Contents API with optimistic concurrency via the commit SHA.

const TOKEN = process.env.GH_DATA_TOKEN;
const REPO = 'Xlron01/maharat-data';
const BRANCH = 'main';
const FILE = 'data/responses.json';
const API = `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(FILE).replace(/%2F/g, '/')}`;
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

const skillsData = require('../skills.json');

const VALID = new Map(
  (skillsData.categories || []).map((c) => [c.name, new Set(c.skills)])
);
const LEVELS = new Set(['مبتدئ', 'متوسط', 'متقدم', 'خبير']);

function sanitizeName(raw) {
  return String(raw || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function sanitizePhone(raw) {
  let p = String(raw || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/\s+/g, ' ')
    .trim();
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (p.length > 20) return null;
  const digits = p.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  if (p.startsWith('+')) {
    if (!/^\+[\d][\d\s-]*$/.test(p)) return null;
  } else if (!/^[\d][\d\s-]*$/.test(p)) return null;
  return p;
}

function validPicks(rawPicks) {
  const picks = {};
  let total = 0;
  if (rawPicks && typeof rawPicks === 'object' && !Array.isArray(rawPicks)) {
    for (const [cat, arr] of Object.entries(rawPicks)) {
      const allowed = VALID.get(cat);
      if (!allowed || !Array.isArray(arr)) continue;
      const isOther = cat === 'Other';
      const sel = [...new Set(arr.filter((s) => {
        if (typeof s !== 'string') return false;
        if (allowed.has(s)) return true;
        // free-text skills are accepted only under "Other" (user-authored in the form)
        return isOther && s.replace(/\s+/g, ' ').trim().length >= 2 && s.length <= 60;
      }).map(s => s.replace(/\s+/g, ' ').trim()))];
      if (sel.length) {
        picks[cat] = sel;
        total += sel.length;
      }
    }
  }
  return { picks, total };
}

// ---------- GitHub storage layer ----------

async function ghFetch(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...HEADERS, ...(opts.headers || {}) } });
  return r;
}

async function readState() {
  // Returns { items: [...], sha: string|null } — empty list when the file does not exist yet.
  const r = await ghFetch(API + `?ref=${BRANCH}`);
  if (r.status === 404) return { items: [], sha: null };
  if (!r.ok) throw new Error(`GH read ${r.status}`);
  const j = await r.json();
  const items = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
  if (!Array.isArray(items)) throw new Error('corrupt state');
  return { items, sha: j.sha };
}

async function writeState(items, sha) {
  const body = JSON.stringify({
    message: 'update responses',
    content: Buffer.from(JSON.stringify(items), 'utf8').toString('base64'),
    branch: BRANCH,
    ...(sha ? { sha } : {}),
  });
  const r = await ghFetch(API, { method: 'PUT', body });
  if (r.status === 409) throw Object.assign(new Error('conflict'), { conflict: true });
  if (!r.ok) throw new Error(`GH write ${r.status}`);
  return true;
}

// Update with one retry on SHA conflicts (two people submitting at the same second).
async function updateState(mutator) {
  for (let i = 0; i < 3; i++) {
    const { items, sha } = await readState();
    const next = mutator(items);
    if (!next) return; // nothing changed
    try {
      await writeState(next, sha);
      return;
    } catch (e) {
      if (e.conflict && i < 2) continue; // re-read + retry
      throw e;
    }
  }
}

// Mirror the old Blob-based API surface so endpoints stay unchanged.
async function listPrefix() { return null; } // unused; kept for interface compat
async function readPairs() { return null; } // unused
async function newestAggregate() { return null; } // unused
async function pruneBlobs() {} // no-op

// Best-effort, per-instance rate limiting (50 submissions / 10 min per IP)
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 50;
}

module.exports = {
  VALID,
  LEVELS,
  sanitizeName,
  sanitizePhone,
  validPicks,
  readState,
  writeState,
  updateState,
  listPrefix,
  readPairs,
  newestAggregate,
  pruneBlobs,
  rateLimited,
};
