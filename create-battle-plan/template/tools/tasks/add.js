#!/usr/bin/env node
// tools/tasks/add.js — CLI to append a task to tasks.yml.
// Usage: node tools/tasks/add.js "title" [--due YYYY-MM-DD] [--tag X] [--priority 1|2|3] [--context "..."] [--snooze YYYY-MM-DD]

const tasks = require('./lib/tasks');

function parseArgs(argv) {
  const args = { title: null, due: null, tags: [], priority: 2, context: null, snooze: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--due') args.due = argv[++i];
    else if (a === '--tag') args.tags.push(argv[++i]);
    else if (a === '--priority') args.priority = parseInt(argv[++i], 10);
    else if (a === '--context') args.context = argv[++i];
    else if (a === '--snooze') args.snooze = argv[++i];
    else positional.push(a);
  }
  args.title = positional.join(' ');
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.title) {
  console.error('Usage: node tools/tasks/add.js "title" [--due YYYY-MM-DD] [--tag X] [--priority 1|2|3] [--context "..."] [--snooze YYYY-MM-DD]');
  process.exit(1);
}
if (!tasks.VALID_PRIORITY.has(args.priority)) {
  console.error(`Invalid priority ${args.priority} — must be 1, 2, or 3.`);
  process.exit(1);
}
if (args.due && !/^\d{4}-\d{2}-\d{2}$/.test(args.due)) {
  console.error(`Invalid --due ${args.due} — must be YYYY-MM-DD.`);
  process.exit(1);
}

const state = tasks.load();
const id = tasks.nextId(state);
const task = {
  id,
  created: tasks.today(),
  due: args.due || null,
  status: args.snooze ? 'snoozed' : 'open',
  priority: args.priority,
  tags: args.tags,
  title: args.title,
  context: args.context || null,
  done_at: null,
  snoozed_until: args.snooze || null
};
state.tasks.push(task);
tasks.save(state);

console.log(`✓ Added TASK-${id} (priority ${args.priority}${args.due ? ', due ' + args.due : ''}${args.tags.length ? ', tags ' + args.tags.join(',') : ''})`);
console.log(`  ${args.title}`);
console.log('');
console.log('Run `node tools/tasks/render-today.js` to regenerate docs/today.md.');
