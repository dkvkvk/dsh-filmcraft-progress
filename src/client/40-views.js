// ── views: projects, merge, settings ────────────────────────────────────────
// The edit view (30-ui.js) works inside one already-open project. These three
// cover everything around it: which project is open, how several sources become
// one sequence, and where the workspace lives.

// ── shared: directory picker ────────────────────────────────────────────────
// One component serves two jobs (picking .fcproj files and picking media) because
// the host returns both from the same listing — the difference is only which
// entries are clickable.
function FcBrowsePicker(props) {
  const kind = props.kind === 'project' ? 'project' : 'media'
  const browse = store.browse
  const busy = store.busy !== ''
  const rows = []
  if (browse.parent) {
    rows.push(h('div', {
      key: 'up', className: 'fc-clip', title: browse.parent,
      onClick: function () { if (!busy) fcBrowse(browse.parent) },
    }, h('span', { className: 'fc-clip-n' }, '↑'), h('span', { className: 'fc-clip-name' }, '..'), h('span', { className: 'fc-clip-t' }, '上级')))
  }
  for (const dir of browse.dirs) {
    rows.push(h('div', {
      key: 'd-' + dir.path, className: 'fc-clip', title: dir.path,
      onClick: function () { if (!busy) fcBrowse(dir.path) },
    }, h('span', { className: 'fc-clip-n' }, '▸'), h('span', { className: 'fc-clip-name' }, dir.name), h('span', { className: 'fc-clip-t' }, '')))
  }
  if (kind === 'project') {
    for (const path of browse.projects) {
      rows.push(h('div', {
        key: 'p-' + path, className: 'fc-clip', title: path,
        onClick: function () { if (!busy && props.onPick) props.onPick(path) },
      }, h('span', { className: 'fc-clip-n' }, '+'), h('span', { className: 'fc-clip-name' }, path.split(/[\\/]/).pop()), h('span', { className: 'fc-clip-t' }, '工程')))
    }
  } else {
    for (const file of browse.files) {
      const staged = fcStagingIndex(file.path) >= 0
      rows.push(h('div', {
        key: 'f-' + file.path, className: 'fc-clip' + (staged ? ' on' : ''), title: file.path,
        onClick: function () { if (!busy) { if (props.onPick) props.onPick(file.path); else fcStage(file.path) } },
      },
        h('span', { className: 'fc-clip-n' }, staged ? '✓' : '+'),
        h('span', { className: 'fc-clip-name' }, file.name),
        h('span', { className: 'fc-clip-t' }, fcBytes(file.bytes))))
    }
  }
  return h('div', null,
    h('div', { className: 'fc-row' },
      h(FcBtn, { onClick: fcBrowseUp, disabled: busy || !browse.parent, title: '上级目录' }, '↑'),
      h('span', { className: 'fc-clip-name', title: browse.path }, browse.path || '（未选择目录）'),
      h(FcBtn, { onClick: function () { fcBrowse(browse.path) }, disabled: busy }, '刷新')),
    rows.length === 0
      ? h('div', { className: 'fc-empty' }, kind === 'project' ? '这个目录里没有 .fcproj' : '这个目录里没有可导入的素材')
      : h('div', { className: 'fc-clips' }, rows))
}

// ── projects ────────────────────────────────────────────────────────────────
function ProjectsView() {
  const workspace = store.workspace
  const busy = store.busy !== ''
  const pair = React.useState({ mode: '', text: '', name: '' })
  const form = pair[0]
  const setForm = function (patch) { pair[1](Object.assign({}, pair[0], patch)) }
  if (workspace === null) return h('div', { className: 'fc-empty' }, '正在读取工作区…')

  const projects = store.projects || []
  const existing = projects.filter(function (project) { return project.exists })
  const missing = projects.filter(function (project) { return !project.exists })

  return h('div', null,
    h('div', { className: 'fc-stats' },
      h(FcStat, { label: '工程' }, String(existing.length)),
      h(FcStat, { label: '缺失' }, String(missing.length)),
      h(FcStat, { label: '任务' }, String(workspace.counts ? workspace.counts.jobs : 0)),
      h(FcStat, { label: '版本' }, workspace.version || '?')),

    h('div', { className: 'fc-path' }, '工作区：' + (workspace.rootDisplay || '?')),
    workspace.cli && workspace.cli.exists === false
      ? h('div', { className: 'fc-alert' }, '找不到 filmcraft-cli：' + workspace.cli.path)
      : null,

    h(FcSection, { title: '工程 (' + projects.length + ')' },
      h('div', { className: 'fc-btns', style: { marginBottom: '6px' } },
        h(FcBtn, { onClick: fcRescan, disabled: busy }, '重新扫描'),
        h(FcBtn, {
          onClick: function () {
            const next = form.mode === 'add' ? '' : 'add'
            setForm({ mode: next })
            if (next === 'add') fcBrowse(store.browse.path || '')
          },
        }, '+ 登记已有工程'),
        h(FcBtn, {
          onClick: function () {
            const next = form.mode === 'new' ? '' : 'new'
            setForm({ mode: next })
            if (next === 'new' && !store.browse.path) fcBrowse(workspace.paths ? workspace.paths.projects : '')
          },
        }, '+ 新建工程')),

      form.mode === '' ? null : h('div', { className: 'fc-note', style: { display: 'block' } },
        h('div', { className: 'fc-row' },
          h('span', { className: 'fc-lb' }, '路 径'),
          h('input', {
            className: 'fc-inp', value: form.text, placeholder: 'D:\\work\\新工程.fcproj',
            onChange: function (event) { setForm({ text: event.target.value }) },
          })),
        h('div', { className: 'fc-row' },
          h('span', { className: 'fc-lb' }, '名 称'),
          h('input', {
            className: 'fc-inp', value: form.name, placeholder: form.mode === 'new' ? '留空则用文件名' : '可选',
            onChange: function (event) { setForm({ name: event.target.value }) },
          })),
        h('div', { className: 'fc-btns' },
          h(FcBtn, {
            primary: true, disabled: busy,
            onClick: async function () {
              const path = form.text.trim()
              if (!path) { fcFail('先填一个路径'); return }
              if (form.mode === 'new') await fcProjectCreate(path, form.name.trim());
              else await fcProjectAdd(path, form.name.trim())
              setForm({ mode: '', text: '', name: '' })
            },
          }, form.mode === 'new' ? '创建并打开' : '登记并打开'),
          h(FcBtn, { onClick: function () { setForm({ mode: '' }) } }, '取消')),
        h('div', { className: 'fc-hint' },
          form.mode === 'new'
            ? '引擎不能凭空创建工程文件，」新建」实际是「建空工程 + 立刻导入素材」。建好后到「合并」页放素材。'
            : '指到一个已存在的 .fcproj 就行。也可以从下面的目录里点选。'),
        h(FcBrowsePicker, {
          kind: 'project',
          onPick: function (path) { setForm({ text: path }) },
        })),

      projects.length === 0
        ? h('div', { className: 'fc-empty' }, '还没有工程。点「重新扫描」或「登记已有工程」。')
        : h('div', { className: 'fc-clips' },
          projects.map(function (project) {
            const on = store.detail && store.detail.path && store.detail.path === project.file
            return h('div', {
              key: project.id,
              className: 'fc-clip' + (on ? ' on' : ''),
              title: project.display,
              onClick: function () { if (!busy) fcOpenProject(project.id) },
            },
              h('span', { className: 'fc-clip-n' }, on ? '●' : ''),
              h('span', { className: 'fc-clip-name' }, (project.exists ? '' : '⚠ ') + project.name),
              h('span', { className: 'fc-clip-t' }, project.exists ? fcBytes(project.bytes) + ' · ' + fcAgo(project.savedAt) : '文件缺失'))
          }))),

    store.detail === null ? null : h(FcSection, { title: '已打开' },
      h('div', { className: 'fc-note' },
        h('span', null, store.detail.name),
        h('span', { style: { color: 'var(--dim)' } }, (store.detail.sequences || []).length + ' 序列 · rev ' + store.detail.revision)),
      h('div', { className: 'fc-path' }, store.detail.path),
      h('div', { className: 'fc-btns' },
        h(FcBtn, { onClick: function () { store.tab = 'edit'; fcEmit() } }, '进入剪辑'),
        h(FcBtn, {
          danger: true, disabled: busy,
          onClick: function () { fcProjectRemove(store.projectId) },
          title: '只从列表移除，不删文件',
        }, '从列表移除'))),

    h('div', { className: 'fc-hint' },
      '工程按 id 登记在工作区里，编辑时只用 id，不再写死路径 —— 这就是换项目不用改代码的原因。'))
}

// ── merge ───────────────────────────────────────────────────────────────────
function MergeView() {
  const busy = store.busy !== ''
  const staging = store.staging || []
  const merge = store.merge
  const compat = merge.compat
  const detail = store.detail
  const mode = merge.createName ? 'new' : (detail ? 'current' : 'new')

  return h('div', null,
    h(FcSection, { title: '待合并 (' + staging.length + ')' },
      staging.length === 0
        ? h('div', { className: 'fc-empty' }, '还没有素材。下面选一段，或从工程素材里加。')
        : h('div', { className: 'fc-clips' },
          staging.map(function (path, index) {
            return h('div', { key: path + index, className: 'fc-clip', title: path },
              h('span', { className: 'fc-clip-n' }, String(index + 1)),
              h('span', { className: 'fc-clip-name' }, path.split(/[\\/]/).pop()),
              h('span', { className: 'fc-btns' },
                h(FcBtn, { disabled: busy || index === 0, title: '上移', onClick: function () { fcStageMove(path, -1) } }, '↑'),
                h(FcBtn, { disabled: busy || index === staging.length - 1, title: '下移', onClick: function () { fcStageMove(path, 1) } }, '↓'),
                h(FcBtn, { danger: true, disabled: busy, title: '移出', onClick: function () { fcUnstage(path) } }, '×')))
          })),
      h('div', { className: 'fc-btns', style: { marginTop: '6px' } },
        h(FcBtn, { disabled: busy || staging.length === 0, onClick: fcUnstageAll }, '清空'))),

    h(FcSection, { title: '添加素材' },
      h('div', { className: 'fc-btns', style: { marginBottom: '6px' } },
        h(FcBtn, { disabled: busy, onClick: function () { fcBrowse(store.browse.path || '') } }, '浏览目录'),
        h(FcBtn, { disabled: busy, title: '用「添加素材」选中的文件' }, '添加到列表')),
      store.assets.length > 0 ? h('div', null,
        h('div', { className: 'fc-sub' }, '当前工程素材（点一下加入）：'),
        h('div', { className: 'fc-chips' },
          store.assets.map(function (asset) {
            if (!asset.path) return null
            const staged = fcStagingIndex(asset.path) >= 0
            return h('button', {
              key: 'a-' + asset.item, className: 'fc-chip' + (staged ? ' on' : ''), type: 'button',
              title: asset.path + (asset.online === false ? '（离线）' : ''),
              disabled: busy,
              onClick: function () { if (staged) fcUnstage(asset.path); else fcStage(asset.path) },
            }, (asset.online === false ? '⚠ ' : '') + fcShort(asset.name, 16))
          }).filter(Boolean))) : null,
      h(FcBrowsePicker, { kind: 'media', onPick: fcStage })),

    h(FcSection, { title: '输出' },
      h('div', { className: 'fc-row' },
        h('span', { className: 'fc-lb' }, '目 标'),
        h('select', {
          className: 'fc-sel', value: mode, disabled: busy,
          onChange: function (event) {
            const next = event.target.value
            if (next === 'new') { store.merge.createName = merge.createName || fcMergeDefaultName(); store.merge.settings = null }
            else { store.merge.createName = ''; store.merge.settings = null }
            fcEmit()
          },
        },
          detail ? h('option', { value: 'current' }, '合并进当前工程：' + fcShort(detail.name, 14)) : null,
          h('option', { value: 'new' }, '新建工程（推荐）'))),

      mode === 'new' ? h('div', null,
        h('div', { className: 'fc-row' },
          h('span', { className: 'fc-lb' }, '工程名'),
          h('input', {
            className: 'fc-inp', value: merge.createName, disabled: busy,
            placeholder: fcMergeDefaultName() || '合并工程',
            onChange: function (event) { store.merge.createName = event.target.value; fcEmit() },
          })),
        h('div', { className: 'fc-row' },
          h('span', { className: 'fc-lb' }, '目 录'),
          h('input', {
            className: 'fc-inp', value: merge.createDir, disabled: busy,
            placeholder: store.workspace && store.workspace.paths ? store.workspace.paths.projects : '',
            onChange: function (event) { store.merge.createDir = event.target.value; fcEmit() },
          }))) : null,

      h('div', { className: 'fc-row' },
        h('span', { className: 'fc-lb' }, '序列名'),
        h('input', {
          className: 'fc-inp', value: merge.name, disabled: busy, placeholder: '合并序列',
          onChange: function (event) { store.merge.name = event.target.value; fcEmit() },
        })),

      h('div', { className: 'fc-row' },
        h('span', { className: 'fc-lb' }, '导 出'),
        h('label', { className: 'fc-clip-name', style: { display: 'flex', alignItems: 'center', gap: '5px' } },
          h('input', {
            type: 'checkbox', checked: merge.exportAfter === true,
            onChange: function (event) { store.merge.exportAfter = event.target.checked; fcEmit() },
          }),
          '合并完直接导出成片（' + Math.round(store.scale * 100) + '% 缩放）')),

      h('div', { className: 'fc-btns', style: { marginTop: '6px' } },
        h(FcBtn, {
          primary: true, disabled: busy || staging.length === 0,
          onClick: function () {
            fcMergeRun({
              name: merge.name,
              createName: mode === 'new' ? (merge.createName || fcMergeDefaultName()) : '',
              overwrite: false,
            })
          },
        }, '开始合并 (' + staging.length + ' 段)')),

      h('div', { className: 'fc-hint' },
        '合并 = 把 N 段素材按这个顺序摆到同一条视频轨上（音轨联动），一次 undo 落位。',
        '引擎没有 ffmpeg 那种无损拼接，所以「合并」的可编辑形态是时间线上的排列，成片靠导出渲染。')),

    compat === null ? null : h(FcSection, { title: '兼容性' },
      compat.warnings && compat.warnings.length > 0
        ? compat.warnings.map(function (text, index) {
          return h('div', { key: 'w' + index, className: 'fc-toast err' }, text)
        })
        : h('div', { className: 'fc-toast' }, '检查了 ' + compat.checked + ' 段，尺寸与帧率一致，不会被动缩放。'),
      compat.rows && compat.rows.length > 0 ? h('div', { className: 'fc-clips' },
        compat.rows.map(function (row) {
          return h('div', { key: 'c' + row.index, className: 'fc-clip' },
            h('span', { className: 'fc-clip-n' }, String(row.index + 1)),
            h('span', { className: 'fc-clip-name' }, row.name),
            h('span', { className: 'fc-clip-t' }, row.width + '×' + row.height + ' · ' + row.fps + 'fps'))
        })) : null),

    merge.result === null ? null : h(FcSection, { title: '结果' },
      h('div', { className: 'fc-note' },
        h('span', null, merge.result.project ? merge.result.project.name : ''),
        h('span', { style: { color: 'var(--dim)' } },
          (merge.result.sequence ? merge.result.sequence.name : '') +
          ' · ' + (Array.isArray(merge.result.itemIds) ? merge.result.itemIds.length : 0) + ' 段')),
      h('div', { className: 'fc-btns' },
        h(FcBtn, { onClick: function () { store.tab = 'edit'; store.staging = []; store.merge.result = null; fcEmit() } }, '去剪辑'))))
}

// ── settings ────────────────────────────────────────────────────────────────
function SettingsView() {
  const workspace = store.workspace
  const busy = store.busy !== ''
  const pair = React.useState({ root: '', cli: '', name: '' })
  const form = pair[0]
  const setForm = function (patch) { pair[1](Object.assign({}, pair[0], patch)) }
  if (workspace === null) return h('div', { className: 'fc-empty' }, '正在读取工作区…')
  const presets = (workspace.presets || [])

  return h('div', null,
    h(FcSection, { title: '工作区' },
      h('div', { className: 'fc-row' },
        h('span', { className: 'fc-lb' }, '目 录'),
        h('input', {
          className: 'fc-inp', value: form.root || workspace.rootDisplay, disabled: busy,
          onChange: function (event) { setForm({ root: event.target.value }) },
        })),
      h('div', { className: 'fc-btns' },
        h(FcBtn, { primary: true, disabled: busy, onClick: function () { fcSetRoot(form.root || workspace.rootDisplay) } }, '保存并切换'),
        h(FcBtn, { disabled: busy, onClick: function () { fcSetRoot(workspace.rootDisplay) } }, '还原'),
        h(FcBtn, { onClick: function () { fcBrowse(form.root || workspace.rootDisplay) } }, '浏览')),
      h('div', { className: 'fc-hint' },
        '切换工作区会重建注册表位置（projects/ exports/ jobs/ work/ 都在它下面），已登记的工程不会自动带过去 —— 换回来即可。')),

    h(FcSection, { title: 'CLI' },
      h('div', { className: 'fc-row' },
        h('span', { className: 'fc-lb' }, '路 径'),
        h('input', {
          className: 'fc-inp', value: form.cli || (workspace.cli ? workspace.cli.path : ''), disabled: busy,
          onChange: function (event) { setForm({ cli: event.target.value }) },
        })),
      h('div', { className: 'fc-btns' },
        h(FcBtn, { disabled: busy, onClick: function () { fcSetCli(form.cli || (workspace.cli ? workspace.cli.path : '')) } }, '保存'),
        h(FcBadge, { kind: workspace.cli && workspace.cli.exists ? 'ok' : 'err' },
          workspace.cli && workspace.cli.exists ? '可达' : '找不到')),
      h('div', { className: 'fc-hint' }, '每次编辑都会启动一个 filmcraft-cli 进程，改完立即生效。')),

    h(FcSection, { title: '调色预设 (' + presets.length + ')' },
      h('div', { className: 'fc-clips' },
        presets.map(function (preset) {
          return h('div', { key: preset.id, className: 'fc-clip' },
            h('span', { className: 'fc-g' + (preset.builtin ? ' none' : ''), style: { background: preset.color || 'var(--bar)' } }),
            h('span', { className: 'fc-clip-name' }, preset.name),
            h('span', { className: 'fc-clip-t' }, preset.builtin ? '内置' : '自定义'),
            preset.builtin ? null : h(FcBtn, {
              danger: true, disabled: busy, title: '删除这个预设',
              onClick: function () { fcPresetRemove(preset.id) },
            }, '删除'))
        })),
      h('div', { className: 'fc-row', style: { marginTop: '6px' } },
        h('span', { className: 'fc-lb' }, '新预设'),
        h('input', {
          className: 'fc-inp', value: form.name, placeholder: '把选中片段的调色另存为…',
          onChange: function (event) { setForm({ name: event.target.value }) },
        }),
        h(FcBtn, {
          disabled: busy, onClick: async function () {
            const clip = fcSelectedClip()
            if (!clip) { fcFail('先到「剪辑」页选一个已调色的片段'); return }
            let lumetri = null
            for (const effect of clip.effects || []) if (effect.effect === 'lumetri') lumetri = effect
            if (!lumetri) { fcFail('这个片段没有调色效果，先套一个预设'); return }
            const params = {}
            for (const key of Object.keys(lumetri.params || {})) {
              const value = lumetri.params[key]
              if (typeof value === 'number' || typeof value === 'boolean') params[key] = value
            }
            await fcPresetSave({ name: form.name || '自定义 ' + (presets.length + 1), params: params, color: '#8b949e' })
            setForm({ name: '' })
          },
        }, '另存为')),
      h('div', { className: 'fc-hint' },
        '内置预设不可改也不可删。想调整就从片段「另存为」出一个自己的。')),

    h(FcSection, { title: '信息' },
      h('div', { className: 'fc-path' },
        '版本 ' + (workspace.version || '?'),
        h('br'), '注册表 ' + (workspace.paths ? workspace.paths.registry : '?'),
        h('br'), '导出 ' + (workspace.paths ? workspace.paths.exports : '?'),
        h('br'), '任务 ' + (workspace.paths ? workspace.paths.jobs : '?'),
        workspace.legacyRoot ? h('br') : null,
        workspace.legacyRoot ? '旧版目录 ' + workspace.legacyRoot + '（只读兼容，不再写入）' : null),
      h('div', { className: 'fc-btns', style: { marginTop: '6px' } },
        h(FcBtn, { onClick: function () { store.booted = false; fcBoot() } }, '重新读取工作区'))))
}
