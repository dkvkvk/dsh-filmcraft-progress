#!/usr/bin/env node
/**
 * Publish FilmCraft editing progress to the dsh-filmcraft-progress panel.
 *
 * The panel polls the status contract file and derives percent / speed / ETA
 * live from the output file, so a pipeline only has to announce *what* it is
 * doing — not keep re-reporting progress.
 *
 *   # start a job (builds shots + timeline from a plan.json)
 *   node tools/publish.cjs start --project "深圳天文台" \
 *     --out "D:\Myfiles\临时\成片\成片.mp4" \
 *     --plan "D:\Myfiles\临时\build\plan.json" \
 *     --expected-bytes 3040870400 --realtime 27
 *
 *   # move between phases
 *   node tools/publish.cjs phase grade  "正在调色"
 *   node tools/publish.cjs phase export
 *   node tools/publish.cjs done
 *   node tools/publish.cjs error "导出失败：磁盘空间不足"
 *
 *   # free-form patch
 *   node tools/publish.cjs patch '{"notes":["已裁剪 0319"]}'
 *
 * Progress file: $FILMCRAFT_PROGRESS_FILE, default D:\Myfiles\临时\film-status.json
 */
'use strict';
const fs = require('node:fs');

const FILE = process.env.FILMCRAFT_PROGRESS_FILE || 'D:\\Myfiles\\临时\\film-status.json';

const PHASES = {
  idle: '待机', plan: '规划', import: '导入素材', build: '搭建时间线',
  grade: '调色', crop: '裁剪画面', export: '导出中', done: '已完成', error: '出错',
};

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}
function write(next) {
  next.version = next.version || 1;
  next.updated = new Date().toISOString();
  fs.mkdirSync(require('node:path').dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
function patch(fields) { return write(Object.assign(read(), fields)); }

/** Build a complete starting status from an edit-decision plan. */
function start(opts) {
  const plan = opts.plan ? JSON.parse(fs.readFileSync(opts.plan, 'utf8')) : [];
  const stats = {};
  for (const p of plan) stats[p.cat] = (stats[p.cat] || 0) + 1;
  const total = plan.reduce((a, p) => a + (p.dur || 0), 0);
  const realtime = Number(opts.realtime || 27);
  const status = {
    version: 1,
    project: opts.project || '未命名剪辑',
    phase: opts.phase || 'export',
    phaseLabel: PHASES[opts.phase || 'export'],
    message: opts.message || '',
    startedAt: opts.startedAt || new Date().toISOString(),
    expectedMs: opts['expected-ms'] ? Number(opts['expected-ms']) : Math.round(total * realtime * 1000),
    export: {
      path: opts.out || '',
      expectedBytes: opts['expected-bytes'] ? Number(opts['expected-bytes']) : 0,
    },
    video: opts['video-json'] ? JSON.parse(opts['video-json']) : null,
    timeline: {
      width: Number(opts.width || 3840), height: Number(opts.height || 2880),
      fps: Number(opts.fps || 25),
      durationSeconds: Number(total.toFixed(2)),
      shotCount: plan.length,
    },
    stats,
    grades: opts.grades ? JSON.parse(fs.readFileSync(opts.grades, 'utf8')) : undefined,
    shots: plan.map((p, i) => ({
      n: i + 1, tag: p.tag, cat: p.cat,
      start: Number((p.tlStart || 0).toFixed(2)), dur: Number((p.dur || 0).toFixed(2)),
      srcIn: Number((p.srcIn || 0).toFixed(2)), crop: !!p.crop,
    })),
    notes: [],
  };
  if (status.video === null) delete status.video;
  if (status.grades === undefined) delete status.grades;
  return write(status);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  let result;
  switch (cmd) {
    case 'start': result = start(args); break;
    case 'phase': {
      const phase = args._[1];
      if (!PHASES[phase]) { console.error('未知阶段: ' + phase + '（可用: ' + Object.keys(PHASES).join(', ') + '）'); process.exit(1); }
      result = patch({ phase, phaseLabel: args._[2] || PHASES[phase], message: args._[2] || '' });
      break;
    }
    case 'done': result = patch({ phase: 'done', phaseLabel: PHASES.done, message: args._[1] || '导出完成' }); break;
    case 'error': result = patch({ phase: 'error', phaseLabel: PHASES.error, error: args._[1] || '未知错误' }); break;
    case 'note': result = patch({ notes: read().notes ? read().notes.concat([args._[1]]) : [args._[1]] }); break;
    case 'patch': result = patch(JSON.parse(args._[1] || '{}')); break;
    case 'show': console.log(JSON.stringify(read(), null, 2)); return;
    default:
      console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').replace(/^ ?\* ?/gm, ''));
      process.exit(cmd ? 1 : 0);
  }
  console.log('phase=' + result.phase + '  file=' + FILE);
}

module.exports = { read, write, patch, start, FILE, PHASES };
if (require.main === module) main();
