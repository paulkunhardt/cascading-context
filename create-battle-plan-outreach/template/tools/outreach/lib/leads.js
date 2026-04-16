const path = require('path');
const csv = require('./csv');

const LEADS_PATH = path.resolve(__dirname, '../../../outreach/leads.csv');

const HEADERS = [
  'linkedin_url','first_name','last_name','title','company','domain',
  'industry','company_type','employees','revenue','country','email','source','tags','status','priority',
  'contacted_at','replied_at','call_at','followed_up_at','channel','template','inmail_template','notes'
];

const VALID_STATUS = new Set([
  'new','dm_sent','replied','call_booked','call_done','verbal','loi','paying','dead'
]);

function load() {
  return csv.readObjects(LEADS_PATH).rows;
}

function save(rows) {
  csv.writeObjects(LEADS_PATH, HEADERS, rows);
}

function normKey(lead) {
  // Primary key: linkedin_url. For manual: keys, normalize to company slug
  // (so the same company imported from two sources dedups).
  const url = (lead.linkedin_url || '').replace(/\/$/, '').toLowerCase();
  if (url && !url.startsWith('manual:')) return url;
  const companySlug = (lead.company || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `company:${companySlug}`;
}

function upsert(rows, lead, { overwrite = false } = {}) {
  const key = normKey(lead);
  const idx = rows.findIndex(r => normKey(r) === key);
  if (idx >= 0) {
    if (overwrite) {
      rows[idx] = { ...rows[idx], ...lead };
      return { action: 'updated', row: rows[idx] };
    }
    // Merge: fill blank fields on existing row from new lead, append non-dup notes
    const existing = rows[idx];
    let merged = false;
    for (const k of Object.keys(lead)) {
      if ((!existing[k] || existing[k] === '') && lead[k]) {
        existing[k] = lead[k];
        merged = true;
      }
    }
    if (lead.notes && existing.notes && !existing.notes.includes(lead.notes)) {
      existing.notes = existing.notes + ' || ' + lead.notes;
      merged = true;
    }
    return { action: merged ? 'merged' : 'skipped', row: existing };
  }
  // Fill in missing headers as empty
  const blank = {};
  HEADERS.forEach(h => { blank[h] = ''; });
  rows.push({ ...blank, ...lead });
  return { action: 'inserted', row: rows[rows.length - 1] };
}

module.exports = { LEADS_PATH, HEADERS, VALID_STATUS, load, save, normKey, upsert };
