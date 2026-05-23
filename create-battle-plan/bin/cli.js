#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');

// ── Helpers ──────────────────────────────────────────────

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function metricKey(text) {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function shortPath(p) {
  const home = os.homedir();
  if (p === home) return '~';
  if (p.startsWith(home + '/')) return '~/' + p.slice(home.length + 1);
  return p;
}

// ── Colors ───────────────────────────────────────────────

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const WHITE = '\x1b[37m';
const INVERSE = '\x1b[7m';
const RESET = '\x1b[0m';
const CLEAR_LINE = '\x1b[2K';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

// ── Simple question (readline) ───────────────────────────

let rl;

function initReadline() {
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
}

function closeReadline() {
  if (rl) { rl.close(); rl = null; }
}

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function askRequired(question, errorMsg) {
  while (true) {
    const answer = await ask(question);
    if (answer) return answer;
    console.log(`${YELLOW}   ${errorMsg}${RESET}`);
  }
}

// ── Interactive folder picker (raw mode) ─────────────────

function getDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  } catch {
    return [];
  }
}

function isDirEmpty(dir) {
  try { return fs.readdirSync(dir).length === 0; } catch { return false; }
}

function pickFolder(shortName) {
  return new Promise((resolve) => {
    // Pause readline so we can use raw mode
    closeReadline();

    let cwd = process.cwd();
    let selected = 0;
    let mode = 'browse'; // 'browse' or 'input'
    let inputBuffer = '';

    function getOptions() {
      const dirs = getDirs(cwd);
      const options = [];
      if (isDirEmpty(cwd)) {
        options.push({
          label: `${GREEN}● Install in this folder ${BOLD}(${path.basename(cwd)}/)${RESET}${GREEN} — no subfolder${RESET}`,
          action: 'here_no_sub',
        });
      }
      options.push({ label: `${GREEN}+ Create new folder here${RESET}`, action: 'create' });
      options.push({ label: `${CYAN}» Install here as ${BOLD}${shortName}/${RESET}`, action: 'here' });
      if (path.dirname(cwd) !== cwd) {
        options.push({ label: `${DIM}../${RESET}  ${DIM}(up)${RESET}`, action: 'up' });
      }
      for (const d of dirs) {
        options.push({ label: `  ${d}/`, action: 'enter', dir: d });
      }
      return options;
    }

    function render() {
      const options = getOptions();
      const display = shortPath(cwd);

      // Move cursor up to clear previous render
      let output = '';

      if (mode === 'input') {
        output += `${CLEAR_LINE}\r${DIM}[7/7]${RESET} ${BOLD}Folder name:${RESET} ${inputBuffer}\x1b[K`;
        process.stdout.write(output);
        return;
      }

      output += `\x1b[H\x1b[2J`; // clear screen
      output += `\n`;
      output += `${DIM}[7/7]${RESET} ${BOLD}Where do you want to install it?${RESET}\n`;
      output += `${DIM}      ${display}${RESET}\n`;
      output += `\n`;
      output += `${DIM}      ↑↓ navigate · enter select · q cancel${RESET}\n`;
      output += `\n`;

      for (let i = 0; i < options.length; i++) {
        if (i === selected) {
          output += `  ${INVERSE} › ${options[i].label} ${RESET}\n`;
        } else {
          output += `    ${options[i].label}\n`;
        }
      }

      process.stdout.write(output);
    }

    function handleBrowseKey(key) {
      const options = getOptions();

      if (key === '\x1b[A' || key === 'k') {
        // Up
        selected = Math.max(0, selected - 1);
        render();
      } else if (key === '\x1b[B' || key === 'j') {
        // Down
        selected = Math.min(options.length - 1, selected + 1);
        render();
      } else if (key === '\r' || key === '\n') {
        // Enter
        const opt = options[selected];
        if (opt.action === 'create') {
          mode = 'input';
          inputBuffer = shortName;
          process.stdout.write(`\x1b[H\x1b[2J`);
          process.stdout.write(`\n`);
          process.stdout.write(`${DIM}[7/7]${RESET} ${BOLD}Folder name:${RESET} ${inputBuffer}`);
        } else if (opt.action === 'here') {
          finish(path.join(cwd, shortName));
        } else if (opt.action === 'here_no_sub') {
          finish(cwd);
        } else if (opt.action === 'up') {
          cwd = path.dirname(cwd);
          selected = 0;
          render();
        } else if (opt.action === 'enter') {
          cwd = path.join(cwd, opt.dir);
          selected = 0;
          render();
        }
      } else if (key === 'q' || key === '\x03') {
        // q or ctrl-c
        cleanup();
        process.stdout.write(SHOW_CURSOR);
        process.exit(0);
      }
    }

    function handleInputKey(key) {
      if (key === '\r' || key === '\n') {
        // Confirm
        if (inputBuffer.length > 0) {
          finish(path.join(cwd, inputBuffer));
        }
      } else if (key === '\x7f' || key === '\b') {
        // Backspace
        inputBuffer = inputBuffer.slice(0, -1);
        process.stdout.write(`\r${CLEAR_LINE}`);
        process.stdout.write(`${DIM}[7/7]${RESET} ${BOLD}Folder name:${RESET} ${inputBuffer}`);
      } else if (key === '\x1b' || key === '\x03') {
        // Escape or ctrl-c → back to browse
        mode = 'browse';
        render();
      } else if (key.length === 1 && key.charCodeAt(0) >= 32) {
        inputBuffer += key;
        process.stdout.write(key);
      }
    }

    function cleanup() {
      process.stdin.setRawMode(false);
      process.stdin.removeListener('data', onData);
      process.stdout.write(SHOW_CURSOR);
    }

    function finish(dir) {
      cleanup();
      process.stdout.write(`\x1b[H\x1b[2J`);
      console.log('');
      console.log(`${DIM}[7/7]${RESET} ${BOLD}Location:${RESET} ${shortPath(dir)}`);
      console.log('');
      resolve(dir);
    }

    function onData(data) {
      const key = data.toString();

      // Handle multi-byte escape sequences
      if (mode === 'browse') {
        handleBrowseKey(key);
      } else {
        handleInputKey(key);
      }
    }

    process.stdout.write(HIDE_CURSOR);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);

    render();
  });
}

// ── Banner & Diagram ─────────────────────────────────────

function banner() {
  console.log('');
  console.log(`${BOLD}${WHITE}    ___  ____ ___ ___ _    ____${RESET}`);
  console.log(`${BOLD}${WHITE}    |__] |__|  |   |  |    |___${RESET}`);
  console.log(`${BOLD}${WHITE}    |__] |  |  |   |  |___ |___${RESET}`);
  console.log('');
  console.log(`${BOLD}${WHITE}   ___  _    ____ _  _${RESET}`);
  console.log(`${BOLD}${WHITE}   |__] |    |__| |\\ |${RESET}`);
  console.log(`${BOLD}${WHITE}   |    |___ |  | | \\|${RESET}`);
  console.log('');
  console.log(`${DIM}   A markdown-based context system${RESET}`);
  console.log(`${DIM}   for LLM-powered projects${RESET}`);
  console.log('');
  console.log(`${DIM}   ─────────────────────────────${RESET}`);
  console.log('');
}

function cascadeDiagram(domains) {
  const domainStr = domains.slice(0, 3).join('  ');
  const dots = domains.length > 3 ? '  ...' : '';

  console.log(`${DIM}   Your cascade:${RESET}`);
  console.log('');
  console.log(`${CYAN}      new info ──→ ${WHITE}metrics.yml${RESET}`);
  console.log(`${DIM}                       │${RESET}`);
  console.log(`${DIM}                       ▼${RESET}`);
  console.log(`${CYAN}                ${WHITE}battle-plan.md${RESET}`);
  console.log(`${DIM}                  /    |    \\${RESET}`);
  console.log(`${CYAN}              ${WHITE}${domainStr}${dots}${RESET}`);
  console.log(`${DIM}                       │${RESET}`);
  console.log(`${DIM}                       ▼${RESET}`);
  console.log(`${GREEN}              verify-cascade.sh ${BOLD}✓${RESET}`);
  console.log('');
}

// ── Domain suggestions ───────────────────────────────────

function suggestDomains(desc) {
  const d = desc.toLowerCase();
  const s = [];
  if (/market|customer|user|audience|segment|icp/.test(d)) s.push('market');
  if (/valid|test|hypothes|experiment|interview/.test(d)) s.push('validation');
  if (/strat|position|compete|pricing|business/.test(d)) s.push('strategy');
  if (/research|learn|study|paper|domain/.test(d)) s.push('research');
  if (/content|write|blog|newsletter|social/.test(d)) s.push('content');
  if (/logist|ops|supply|shipping|fulfil/.test(d)) s.push('logistics');
  if (/product|feature|build|ship|release/.test(d)) s.push('product');
  if (/sales|outreach|pipeline|deal|close/.test(d)) s.push('sales');
  if (/fund|invest|pitch|raise|capital/.test(d)) s.push('fundraising');
  if (s.length === 0) s.push('market', 'validation', 'strategy', 'research');
  return s.join(', ');
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  banner();

  initReadline();

  // Question 1: Project description (one sentence — used for context, not the folder name)
  const projectName = await askRequired(
    `${DIM}[1/7]${RESET} ${BOLD}What's your project in one sentence?${RESET}\n> `,
    'A one-sentence description is required — even rough is fine. Try again:'
  );
  console.log('');

  // Question 2: Short name (the actual folder slug). Default = cwd basename when sensible.
  const cwdBasename = path.basename(process.cwd());
  const cwdSlug = slugify(cwdBasename);
  const cwdIsEmpty = (() => {
    try { return fs.readdirSync(process.cwd()).length === 0; } catch { return false; }
  })();
  const sentenceSlug = slugify(projectName);
  const truncatedSentenceSlug = sentenceSlug.split('-').slice(0, 3).join('-');
  const genericNames = new Set(['projects', 'code', 'src', 'work', 'dev', 'repos', 'workspace', 'documents', 'desktop']);
  const defaultShortName = (cwdIsEmpty && cwdSlug && !genericNames.has(cwdSlug))
    ? cwdSlug
    : (truncatedSentenceSlug || 'my-battle-plan');
  const shortNameRaw = await ask(
    `${DIM}[2/7]${RESET} ${BOLD}Short name for the folder?${RESET} ${DIM}(default: ${defaultShortName})${RESET}\n> `
  );
  const shortName = slugify(shortNameRaw) || defaultShortName;
  console.log('');

  // Question 3: Time horizon
  const horizon = await ask(
    `${DIM}[3/7]${RESET} ${BOLD}What's your time horizon?${RESET} ${DIM}(e.g., "3 weeks to demo day", "6 months to launch", "ongoing")${RESET}\n> `
  );
  console.log('');

  // Question 4: Metrics
  const metricsRaw = await askRequired(
    `${DIM}[4/7]${RESET} ${BOLD}What are the 3-5 key metrics you want to track?${RESET} ${DIM}(comma-separated, e.g., "outreach sent, calls booked, LOIs signed")${RESET}\n> `,
    'At least one metric is required — pick anything quantifiable you care about. You can rename or add more later in metrics.yml. Try again:'
  );
  const metrics = metricsRaw.split(',').map((m) => m.trim()).filter(Boolean);
  console.log('');

  // Question 5: Domains
  const suggested = suggestDomains(projectName);
  const domainsRaw = await askRequired(
    `${DIM}[5/7]${RESET} ${BOLD}What domains does your work cover?${RESET} ${DIM}(comma-separated)\nSuggested based on your project: ${suggested}${RESET}\n> `,
    `At least one domain is required — try the suggestions (${suggested}) or any topic area. Try again:`
  );
  const domains = domainsRaw.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  console.log('');

  // Question 6: People
  const peopleRaw = await ask(
    `${DIM}[6/7]${RESET} ${BOLD}Who are the key people you'll be working with?${RESET} ${DIM}(format: "Name:Role, Name:Role" — or press enter to skip)${RESET}\n> `
  );
  const people = peopleRaw
    ? peopleRaw.split(',').map((p) => {
        const [name, role] = p.split(':').map((s) => s.trim());
        return { name: name || '', role: role || '' };
      }).filter((p) => p.name)
    : [];
  console.log('');

  // Question 7: Interactive folder picker
  const targetDir = await pickFolder(shortName);

  // Re-init readline for any future questions
  initReadline();
  closeReadline();

  // ── Scaffold ─────────────────────────────────────────

  console.log(`${DIM}   ─────────────────────────────${RESET}`);
  console.log('');
  console.log(`${CYAN}   Scaffolding...${RESET}`);
  console.log('');

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    console.log(`${YELLOW}   Warning: ${shortPath(targetDir)} already exists and is not empty.${RESET}`);
    process.exit(1);
  }

  // Copy template
  const templateDir = path.join(__dirname, '..', 'template');
  copyDir(templateDir, targetDir);

  // npm strips .gitignore from packages, so we ship it as 'gitignore' and rename
  const gitignoreSrc = path.join(targetDir, 'gitignore');
  const gitignoreDest = path.join(targetDir, '.gitignore');
  if (fs.existsSync(gitignoreSrc) && !fs.existsSync(gitignoreDest)) {
    fs.renameSync(gitignoreSrc, gitignoreDest);
  }

  console.log(`${DIM}   + CLAUDE.md (system prompt)${RESET}`);
  console.log(`${DIM}   + tools/ (verification scripts)${RESET}`);
  console.log(`${DIM}   + .claude/commands/ (slash commands)${RESET}`);
  console.log(`${DIM}   + .githooks/pre-commit${RESET}`);

  // Make shell scripts executable
  const toolsDir = path.join(targetDir, 'tools');
  if (fs.existsSync(toolsDir)) {
    for (const f of fs.readdirSync(toolsDir)) {
      if (f.endsWith('.sh')) {
        fs.chmodSync(path.join(toolsDir, f), 0o755);
      }
    }
  }
  const hookFile = path.join(targetDir, '.githooks', 'pre-commit');
  if (fs.existsSync(hookFile)) {
    fs.chmodSync(hookFile, 0o755);
  }

  const today = new Date().toISOString().split('T')[0];

  // Create domain directories and docs
  for (const domain of domains) {
    const domainDir = path.join(targetDir, 'docs', domain);
    fs.mkdirSync(domainDir, { recursive: true });
    fs.writeFileSync(
      path.join(domainDir, `${domain}-overview.md`),
      `# ${capitalize(domain)} Overview

**Last Updated:** ${today}
**Status:** Draft
**Role:** cascade-target
**Compression:** amended

**TL;DR:** Initial ${domain} document for ${projectName}. To be filled in as the project progresses.

---

## Notes

_Start adding content here._
`
    );
  }

  console.log(`${DIM}   + docs/ (${domains.length} domain${domains.length > 1 ? 's' : ''})${RESET}`);

  // Create metrics.yml
  const metricsContent = [
    `# metrics.yml — project-wide metrics registry for ${projectName}`,
    '# The LLM updates this file FIRST in any cascade, before touching docs.',
    '# Scripts verify all (→ metrics.yml#field) references against these values.',
    '',
    `last_updated: ${today}`,
    '',
    ...metrics.map((m) => `${metricKey(m)}: 0`),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(targetDir, 'metrics.yml'), metricsContent);
  console.log(`${DIM}   + metrics.yml (${metrics.length} metric${metrics.length > 1 ? 's' : ''})${RESET}`);

  // Create battle plan
  const metricsTable = metrics
    .map((m) => `| ${m} | _set target_ | **0** (→ metrics.yml#${metricKey(m)}) |`)
    .join('\n');

  fs.writeFileSync(
    path.join(targetDir, 'docs', 'battle-plan.md'),
    `# Battle Plan — ${projectName}

**Last Updated:** ${today}
**Status:** Active
**Role:** source-of-truth
**Compression:** chronological

**TL;DR:** ${projectName} — just initialized. Time horizon: ${horizon || 'not set'}. All metrics at 0. First priority: fill in the battle plan with real tasks and targets.

---

## Rules for This Document

1. Every task has an assigned date — no "sometime this week"
2. Tasks move, never disappear — if slipped, add new date + reason
3. New info updates the battle plan FIRST, before any other doc
4. Everything links — tasks reference the doc they depend on or produce

---

## Key Metrics

| Metric | Target | Current |
|--------|--------|---------|
${metricsTable}

---

## Today's Priorities

- [ ] Set targets for each metric
- [ ] Fill in this week's tasks
- [ ] Record any existing conversations in external-insights.md

---

## This Week

_Add day-by-day tasks here._

---

## Daily Log

_Append-only. Three lines per day._
`
  );

  // Create external-insights.md
  const peopleSections = people.length
    ? people.map((p) => `### ${p.name} — ${p.role}\n_No sessions recorded yet._\n`).join('\n')
    : '_Add key people here as you start conversations._\n';

  fs.writeFileSync(
    path.join(targetDir, 'docs', 'external-insights.md'),
    `# External Insights

**Last Updated:** ${today}
**Status:** Active
**Role:** cascade-target
**Compression:** chronological

**TL;DR:** All external conversations, calls, and meetings for ${projectName}. 0 sessions recorded so far.

---

## How to Use This Document

Every conversation gets appended as a dated session. Record everything — even "small" chats contain signal.

### Template

\`\`\`markdown
## Session N (YYYY-MM-DD) — [Person Name], [Role/Company]

### Context
[Why this conversation happened]

### Key insights
1. **Insight title.** Detail. \`Confidence: [level]\`

### Raw quotes (if available)
> "Quote here"

### Action items
- [ ] Follow-up X
\`\`\`

---

## People

${peopleSections}
`
  );

  console.log(`${DIM}   + docs/battle-plan.md${RESET}`);
  console.log(`${DIM}   + docs/external-insights.md${RESET}`);

  // Save onboarding answers for Claude to read on first /good-morning
  fs.writeFileSync(
    path.join(targetDir, '.battle-plan-onboarding.json'),
    JSON.stringify(
      { project_name: projectName, horizon, metrics, domains, people, installed_at: today },
      null, 2
    ) + '\n'
  );

  // Mark as initialized
  fs.writeFileSync(path.join(targetDir, '.battle-plan-initialized'), `Initialized on ${today}\n`);

  console.log('');

  // Initialize git repo
  try {
    const { execSync } = require('child_process');
    execSync('git init', { cwd: targetDir, stdio: 'pipe' });
    execSync('git config core.hooksPath .githooks', { cwd: targetDir, stdio: 'pipe' });
    execSync('git add -A', { cwd: targetDir, stdio: 'pipe' });
    execSync('git commit -m "Initial battle plan scaffold"', {
      cwd: targetDir,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Battle Plan', GIT_AUTHOR_EMAIL: 'noreply@battleplan.dev',
        GIT_COMMITTER_NAME: 'Battle Plan', GIT_COMMITTER_EMAIL: 'noreply@battleplan.dev',
      },
    });
    console.log(`${DIM}   + git repo initialized${RESET}`);
  } catch {
    // git not available or failed — not critical
  }

  // ── Done ───────────────────────────────────────────

  console.log('');
  console.log(`${DIM}   ─────────────────────────────${RESET}`);
  console.log('');
  console.log(`${GREEN}${BOLD}   Ready.${RESET}`);
  console.log('');
  console.log(`${BOLD}   Project:${RESET}  ${projectName}`);
  console.log(`${BOLD}   Location:${RESET} ${shortPath(targetDir)}`);
  console.log(`${BOLD}   Horizon:${RESET}  ${horizon || 'not set'}`);
  console.log(`${BOLD}   Metrics:${RESET}  ${metrics.join(', ')}`);
  console.log(`${BOLD}   Domains:${RESET}  ${domains.join(', ')}`);
  if (people.length) {
    console.log(`${BOLD}   People:${RESET}   ${people.map((p) => `${p.name} (${p.role})`).join(', ')}`);
  }
  console.log('');

  cascadeDiagram(domains);

  console.log(`${DIM}   ─────────────────────────────${RESET}`);
  console.log('');
  console.log(`${CYAN}${BOLD}   To start your first session,${RESET}`);
  console.log(`${CYAN}${BOLD}   copy and paste this into your terminal:${RESET}`);
  console.log('');
  const relPath = path.relative(process.cwd(), targetDir) || '.';
  console.log(`${DIM}   ┌─────────────────────────────────────────┐${RESET}`);
  console.log(`${DIM}   │${RESET}  ${BOLD}cd ${relPath} && claude${RESET}${DIM}${' '.repeat(Math.max(0, 37 - relPath.length - 12))}│${RESET}`);
  console.log(`${DIM}   └─────────────────────────────────────────┘${RESET}`);
  console.log('');
  console.log(`   Once Claude is running, type ${GREEN}${BOLD}/good-morning${RESET}`);
  console.log(`   to start your first session. Claude will`);
  console.log(`   introduce itself, explain how everything`);
  console.log(`   works, and help you set your first targets.`);
  console.log('');
}

main().catch((err) => {
  process.stdout.write(SHOW_CURSOR);
  console.error(err);
  process.exit(1);
});
