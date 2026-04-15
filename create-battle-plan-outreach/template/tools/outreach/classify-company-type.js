#!/usr/bin/env node
// classify-company-type.js — Heuristic classification of leads into company_type taxonomy
// No API calls. Pure regex/keyword matching on company name, industry, domain, title, tags.

const { load, save } = require('./lib/leads');

// ---------------------------------------------------------------------------
// Classification rules — checked in priority order (first match wins)
// ---------------------------------------------------------------------------

function classify(lead) {
  const company = (lead.company || '').toLowerCase();
  const industry = (lead.industry || '').toLowerCase();
  const domain = (lead.domain || '').toLowerCase();
  const title = (lead.title || '').toLowerCase();
  const tags = (lead.tags || '').toLowerCase();
  const notes = (lead.notes || '').toLowerCase();
  const all = `${company} ${industry} ${domain} ${tags} ${notes}`;

  // 1. CYBERSEC — security/infosec product companies
  const cybersecCompany = /\b(security|secure|secur|cyber|infosec|siem|endpoint|pentest|vulnerab|sentinel|defend|defen[cs]e|guardian?|shield|threat|firewall|soar|xdr|edr|detect|forensi|soc\b|zerotrust|zero.?trust|hackproof|bugcrowd|crowdstrike)\b/;
  const cybersecIndustry = /cyber|information security|infosec/;
  if (cybersecIndustry.test(industry)) return 'cybersec-vendor';
  if (cybersecCompany.test(company) || cybersecCompany.test(domain)) {
    // Avoid false positives: "security" in notes/tags doesn't count, only in company/domain/industry
    return 'cybersec-vendor';
  }

  // 2. FINTECH — financial technology, payments, banking, insurance
  const fintechCompany = /\b(pay|bank|fintech|lend|credit|insur|trading|invest|capital|wealth|billing|invoice|accounting|ledger|treasury|remit|neobank|regtech)\b/;
  const fintechIndustry = /fintech|payment|financial|banking|insurance/;
  if (fintechIndustry.test(industry)) return 'fintech';
  if (fintechCompany.test(company) || fintechCompany.test(domain)) return 'fintech';
  if (tags.includes('fintech')) return 'fintech';

  // 3. BLOCKCHAIN — crypto, web3, DeFi, chain infrastructure
  const blockchainCompany = /\b(blockchain|crypto|web3|defi|nft|token|chain|ledger|dao|dapp|wallet|mining|staking|solidity|ethereum|bitcoin|solana|polygon)\b/;
  const blockchainIndustry = /blockchain|crypto|web3|defi|decentralized/;
  if (blockchainIndustry.test(industry)) return 'blockchain';
  if (blockchainCompany.test(company) || blockchainCompany.test(domain)) return 'blockchain';

  // 4. HEALTHTECH — healthcare, pharma, biotech, medtech
  const healthCompany = /\b(health|med|pharma|bio|clinical|patient|therap|diagnos|genomic|hospital|dental|cardio|oncol|radiol|wellness|telehealth|ehrs?)\b/;
  const healthIndustry = /health|pharma|biotech|medical|clinical/;
  if (healthIndustry.test(industry)) return 'healthtech';
  if (healthCompany.test(company) || healthCompany.test(domain)) return 'healthtech';

  // 5. CONSULTING — professional services, advisory, consultancies
  const consultCompany = /\b(consult|advisory|advisors?|partners?|services|beratung|agentur|agency)\b/;
  const consultIndustry = /consult|professional services|advisory/;
  if (consultIndustry.test(industry)) return 'consulting';
  if (consultCompany.test(company)) {
    // Avoid false positive on "partners" in VC fund names — check it's not a VC/fund
    if (/\b(venture|capital|fund|invest|vc)\b/.test(company)) return 'other-b2b';
    return 'consulting';
  }

  // 6. DATA-INFRA — cloud, data, AI/ML platforms, analytics infrastructure
  const dataCompany = /\b(cloud|data|infra|analytics|ai|ml|machine.?learn|deep.?learn|neural|compute|devops|kubernetes|k8s|observ|monitor|telemetry|pipeline|warehouse|lakehouse|etl|streaming)\b/;
  const dataIndustry = /data infrastructure|cloud|ai\/ml|artificial intelligence|machine learning/;
  if (dataIndustry.test(industry)) return 'data-infra';
  if (dataCompany.test(company) && !dataCompany.test('dai')) {
    // "AI" in company name is common — only classify as data-infra if combined with infra signals
    const infraSignal = /\b(cloud|infra|data|platform|pipeline|warehouse|analytics|devops|observ|monitor)\b/;
    if (infraSignal.test(company) || infraSignal.test(domain) || infraSignal.test(industry)) {
      return 'data-infra';
    }
  }

  // 7. B2C — consumer-facing products
  const b2cCompany = /\b(gaming|game|entertainment|consumer|retail|ecommerce|e-commerce|food|restaurant|travel|booking|dating|social|music|streaming|fashion|beauty|lifestyle|fitness|sport)\b/;
  const b2cIndustry = /gaming|entertainment|media|e-commerce|retail|food|beverage|consumer|advertising|marketing/;
  if (b2cIndustry.test(industry)) return 'b2c';
  if (b2cCompany.test(company) || b2cCompany.test(domain)) return 'b2c';

  // 8. OTHER-B2B — non-SaaS B2B: manufacturing, logistics, energy, telecom, real estate, etc.
  const otherB2bIndustry = /manufactur|logistics|transport|energy|utilit|telecom|real estate|automotive|aerospace|defense|agriculture|government|public sector|non-profit|education/;
  if (otherB2bIndustry.test(industry)) return 'other-b2b';

  // 9. B2B-SAAS — default for anything with software/SaaS/platform/tech signals
  const saasSignal = /\b(saas|software|platform|tech|app|digital|solution|automation|workflow|crm|erp|hrm|hris)\b/;
  if (saasSignal.test(industry) || saasSignal.test(company) || saasSignal.test(domain)) {
    return 'b2b-saas';
  }

  // 10. Final fallback — check domain for any hint, otherwise other-b2b
  if (/\.(ai|io|app|dev|cloud|tech)$/.test(domain)) return 'b2b-saas';

  return 'other-b2b';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const rows = load();
const counts = {};

for (const row of rows) {
  const type = classify(row);
  row.company_type = type;
  counts[type] = (counts[type] || 0) + 1;
}

save(rows);

// Print summary
console.log('\n=== Company Type Classification Summary ===\n');
const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
let total = 0;
for (const [type, count] of sorted) {
  const pct = ((count / rows.length) * 100).toFixed(1);
  console.log(`  ${type.padEnd(20)} ${String(count).padStart(5)}  (${pct}%)`);
  total += count;
}
console.log(`  ${'TOTAL'.padEnd(20)} ${String(total).padStart(5)}`);
console.log(`\nClassified ${rows.length} leads. Saved to leads.csv.\n`);
