// ── ui ──────────────────────────────────────────────────────────────────────
// The panel body. It reads the store directly and calls the actions from
// 10-store.js; there is no second state layer, so a repaint shows exactly what
// the host reported after the last call.
//
// Two surfaces share it: the docked sidebar tab and the wide settings page. The
// `wide` flag only changes the wrapper class — every list below is vh-capped so
// neither surface can push the export controls out of reach.

const FC_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.6" y="3" width="12.8" height="10" rx="2"/><path d="M6.2 6.4l3.4 1.6-3.4 1.6z"/></svg>'
const FC_TAB_KIND = 'filmcraft-progress'
const FC_TAB_ID = 'dsh-filmcraft-progress/panel'
const FC_TAB_TITLE = '剪辑'

const FC_STATE_TEXT = { queued: '排队', running: '导出中', done: '已完成', failed: '失败', cancelled: '已取消' }
const FC_STATE_CLASS = { running: 'run', done: 'ok', failed: 'err', cancelled: 'err', queued: '' }

function FcIcon() {
  return h('span', { className: 'fc-entry-gl', dangerouslySetInnerHTML: { __html: FC_ICON } })
}

function useFcStore() {
  const pair = React.useState(0)
  React.useEffect(function () {
    const listener = function () { pair[1](function (n) { return n + 1 }) }
    store.listeners.add(listener)
    return function () { store.listeners.delete(listener) }
  }, [])
}

// The pane body does not scroll by itself, so the panel caps its own height at
// the viewport below its top edge and scrolls inside. Measured, never hard-coded:
// the top moves with the header, the tab strip and the sidebar width.
function usePanelFill(ref) {
  const pair = React.useState(0)
  const setHeight = pair[1]
  React.useEffect(function () {
    let last = -1
    function measure() {
      const element = ref.current
      if (element === null || element === undefined) return
      if (typeof element.getBoundingClientRect !== 'function') return
      const viewport = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 0
      if (!viewport) return
      const top = element.getBoundingClientRect().top
      const height = Math.max(220, Math.round(viewport - top - 10))
      // Guard: an unchanged value would re-render forever once a ResizeObserver
      // is watching the element whose size this changes.
      if (height !== last) { last = height; setHeight(height) }
    }
    measure()
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', measure)
    let observer = null
    if (typeof ResizeObserver !== 'undefined' && ref.current) {
      observer = new ResizeObserver(measure)
      observer.observe(ref.current)
    }
    return function () {
      if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('resize', measure)
      if (observer !== null) observer.disconnect()
    }
  }, [])
  return pair[0]
}

// Which palette to paint with. prefers-color-scheme is the OS, and the desktop
// app's own theme is a separate setting — so read the background of the surface
// this panel was mounted into instead, and walk up to the first opaque layer.
function fcDetectTheme(node) {
  try {
    if (!node || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return 'dark'
    // Start outside our own tree: .fc-root paints a background of its own, so
    // reading it would just echo the palette we picked last time.
    let element = node.parentElement
    while (element && String(element.className || '').indexOf('fc-root') >= 0) element = element.parentElement
    let color = ''
    for (let depth = 0; depth < 8 && element; depth++) {
      color = window.getComputedStyle(element).backgroundColor || ''
      const parsed = color.match(/rgba?\(([^)]+)\)/)
      if (parsed) {
        const parts = parsed[1].split(',').map(Number)
        if (parts.length < 4 || !(parts[3] < 0.5)) break
      }
      element = element.parentElement
    }
    const parsed = color.match(/rgba?\(([^)]+)\)/)
    if (!parsed) return 'dark'
    const parts = parsed[1].split(',').map(Number)
    if (parts.length < 3) return 'dark'
    const luminance = (0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]) / 255
    return luminance > 0.5 ? 'light' : 'dark'
  } catch (_) { return 'dark' }
}

function FcBtn(props) {
  const cls = 'fc-btn' + (props.primary ? ' primary' : '') + (props.danger ? ' danger' : '')
  return h('button', {
    className: cls,
    type: 'button',
    title: props.title,
    disabled: props.disabled === true,
    onClick: props.onClick,
  }, props.children)
}

function FcBadge(props) {
  return h('span', { className: 'fc-badge' + (props.kind ? ' ' + props.kind : '') },
    h('span', { className: 'fc-dot' }), props.children)
}

function FcSection(props) {
  return h('div', { className: 'fc-sec' },
    h('div', { className: 'fc-sec-h' }, props.title, props.extra || null),
    props.children)
}

function FcStat(props) {
  return h('div', { className: 'fc-stat' },
    h('div', { className: 'fc-stat-k' }, props.label),
    h('div', { className: 'fc-stat-v' }, props.children))
}

// ── preview ─────────────────────────────────────────────────────────────────
function PreviewBlock() {
  const clip = fcSelectedClip()
  const busy = store.busy !== ''
  const span = clip ? Math.max(0.5, Math.min(store.proxySeconds, PROXY_MAX, clip.dur - store.scrub)) : 0
  return h('div', { className: 'fc-sec' },
    h('div', { className: 'fc-sec-h' },
      '预览' + (clip === null ? '' : ' · ' + clip.trackLabel + ' ' + fcShort(clip.name, 22)),
      h('button', {
        className: 'fc-fold', type: 'button',
        title: store.prevOpen ? '收起画面，给片段列表腾地方' : '展开画面',
        onClick: function () { store.prevOpen = !store.prevOpen; fcEmit() },
      }, store.prevOpen ? '收起画面' : '展开画面')),

    store.prevOpen ? h('div', { className: 'fc-prev' },
      store.proxyUrl
        ? h('video', { className: 'fc-prev-v', src: store.proxyUrl, controls: true, autoPlay: true, loop: true, playsInline: true })
        : (store.frameUrl
          ? h('img', { className: 'fc-prev-i', src: store.frameUrl, alt: '预览画面' })
          : h('div', { className: 'fc-prev-none' },
            store.frameBusy ? '渲染中…' : (clip === null ? '选一个片段' : '准备中…'))),
      store.frameBusy && store.frameUrl ? h('div', { className: 'fc-prev-ov' }, '渲染中…') : null) : null,

    clip === null ? null : h('div', { className: 'fc-row' },
      h('span', { className: 'fc-lb' }, '时间'),
      h(FcBtn, {
        disabled: busy || store.frameBusy, title: '往前 0.5 秒',
        onClick: function () { fcScrub(Math.max(0, store.scrub - 0.5)) },
      }, '◀'),
      h('input', {
        className: 'fc-range', type: 'range', min: 0, max: Math.max(0.001, clip.dur), step: 0.05,
        value: store.scrub, onChange: function (event) { fcScrub(Number(event.target.value)) },
      }),
      h(FcBtn, {
        disabled: busy || store.frameBusy, title: '往后 0.5 秒',
        onClick: function () { fcScrub(Math.min(clip.dur, store.scrub + 0.5)) },
      }, '▶'),
      h('span', { className: 'fc-clip-t' }, store.scrub.toFixed(2) + ' / ' + clip.dur.toFixed(2) + 's')),

    clip === null ? null : h('div', { className: 'fc-row' },
      h('span', { className: 'fc-lb' }, '视频'),
      h('input', {
        className: 'fc-num', type: 'number', min: 0.5, max: PROXY_MAX, step: 0.5,
        value: String(store.proxySeconds),
        title: '预览片段长度，0.5 – ' + PROXY_MAX + ' 秒',
        onChange: function (event) { store.proxySeconds = event.target.value; fcEmit() },
        // Typing "1" on the way to "15" must not be clamped mid-keystroke.
        onBlur: function () {
          store.proxySeconds = Math.max(0.5, Math.min(PROXY_MAX, Number(store.proxySeconds) || 0.5))
          fcEmit()
        },
      }),
      h('span', { className: 'fc-clip-t' }, '秒'),
      h('button', {
        className: 'fc-fold', type: 'button', title: '从头预览整段（最长 ' + PROXY_MAX + ' 秒）',
        onClick: fcWholeClip,
      }, '整段'),
      h(FcBtn, { disabled: busy || store.proxyBusy, onClick: fcProxy }, store.proxyBusy ? '导出中…' : '生成预览片段'),
      store.proxyUrl ? h(FcBtn, {
        onClick: function () {
          try { URL.revokeObjectURL(store.proxyUrl) } catch (_) { }
          store.proxyUrl = ''
          fcEmit()
        },
      }, '关闭视频') : null),

    store.frameError ? h('div', { className: 'fc-toast err' }, store.frameError) : null,
    store.proxyError ? h('div', { className: 'fc-toast err' }, store.proxyError) : null,

    store.prevOpen ? h('div', { className: 'fc-hint' },
      '画面是套过调色的成片效果；拖动时间轴看任意一帧。',
      h('br'), '「生成预览片段」渲染真实视频，长度自己填（0.5–' + PROXY_MAX + ' 秒），约 ' +
        span.toFixed(1) + ' 秒 ≈ ' + Math.max(1, Math.round(span * 50 * 0.13)) + ' 秒渲染时间，结果会缓存。') : null)
}

// ── clips ───────────────────────────────────────────────────────────────────
// Two selection concepts, deliberately separate: `clipId` is the clip the editor
// acts on (preview, trim), `store.multi` is the set a batch grade applies to.
// Mixing them would make every single-clip action quietly a batch action.
function ClipList() {
  const clips = fcClips()
  const multi = store.multi || []
  return h('div', null,
    h('div', { className: 'fc-row' },
      h('span', { className: 'fc-lb' }, '多选'),
      h(FcBtn, { disabled: clips.length === 0, onClick: fcMultiAll }, multi.length === clips.length && clips.length > 0 ? '取消全选' : '全选'),
      h(FcBtn, { disabled: multi.length === 0, onClick: function () { fcMultiSet([]) } }, '清空'),
      h('span', { className: 'fc-clip-t' }, multi.length === 0 ? '点序号可多选' : '已选 ' + multi.length + ' 段')),
    h('div', { className: 'fc-clips' },
      clips.map(function (clip, index) {
        const on = clip.clip === store.clipId
        const picked = multi.indexOf(clip.clip) >= 0
        return h('div', {
          className: 'fc-clip' + (on ? ' on' : ''),
          key: 'clip-' + clip.clip,
          title: clip.name,
          onClick: function () {
            if (store.clipId === clip.clip) return
            store.clipId = clip.clip
            store.scrub = 0
            store.proxyUrl = ''
            fcEmit()
            if (store.prevOpen) fcFrame(clip.start)
          },
        },
          h('span', {
            className: 'fc-clip-n',
            style: { cursor: 'pointer', color: picked ? 'var(--bar)' : undefined, fontWeight: picked ? 700 : 400 },
            title: picked ? '移出多选' : '加入多选',
            onClick: function (event) {
              event.stopPropagation()
              fcMultiToggle(clip.clip)
            },
          }, (picked ? '✓' : '') + (index + 1)),
          h('span', { className: 'fc-g' + (fcHasGrade(clip) ? '' : ' none') }),
          h('span', { className: 'fc-clip-name' }, fcShort(clip.name, 30)),
          h('span', { className: 'fc-clip-t' }, clip.trackLabel + ' ' + fcTime(clip.start) + '–' + fcTime(clip.end)),
          clip.enabled ? null : h('span', { className: 'fc-clip-t' }, '停用'))
      })))
}

// ── edit actions ────────────────────────────────────────────────────────────
function EditActions() {
  const clip = fcSelectedClip()
  const clips = fcClips()
  const index = clip === null ? -1 : clips.indexOf(clip)
  const busy = store.busy !== ''
  const presets = store.workspace && Array.isArray(store.workspace.presets) ? store.workspace.presets : []
  return h('div', null,
    h('div', { className: 'fc-sec-h' },
      '编辑' + (clip === null ? '' : ' · ' + clip.trackLabel + ' #' + (index + 1) + ' · ' + clip.dur.toFixed(2) + 's')),

    h('div', { className: 'fc-row' },
      h('span', { className: 'fc-lb' }, '裁头'),
      h(FcBtn, { disabled: busy || clip === null, title: '把入点往左拉 0.5 秒（变长）', onClick: function () { fcTrim('in', -0.5) } }, '−0.5s'),
      h(FcBtn, { disabled: busy || clip === null, title: '裁掉开头 0.5 秒', onClick: function () { fcTrim('in', 0.5) } }, '+0.5s'),
      h(FcBtn, { disabled: busy || clip === null, onClick: function () { fcTrim('in', 1) } }, '+1s'),
      h(FcBtn, { disabled: busy || clip === null, onClick: function () { fcTrim('in', 3) } }, '+3s')),

    h('div', { className: 'fc-row' },
      h('span', { className: 'fc-lb' }, '裁尾'),
      h(FcBtn, { disabled: busy || clip === null, onClick: function () { fcTrim('out', -0.5) } }, '−0.5s'),
      h(FcBtn, { disabled: busy || clip === null, title: '裁掉结尾 0.5 秒', onClick: function () { fcTrim('out', 0.5) } }, '+0.5s'),
      h(FcBtn, { disabled: busy || clip === null, onClick: function () { fcTrim('out', 1) } }, '+1s'),
      h(FcBtn, { disabled: busy || clip === null, onClick: function () { fcTrim('out', 3) } }, '+3s')),

    h('div', { className: 'fc-row' },
      h('span', { className: 'fc-lb' }, '排序'),
      h(FcBtn, { disabled: busy || clip === null || index <= 0, onClick: function () { fcMoveClip(-1) } }, '◀ 上移'),
      h(FcBtn, { disabled: busy || clip === null || index >= clips.length - 1, onClick: function () { fcMoveClip(1) } }, '下移 ▶'),
      h(FcBtn, { danger: true, disabled: busy || clip === null, onClick: fcDeleteClip }, '删除')),

    h('div', { className: 'fc-row' },
      h('span', { className: 'fc-lb' }, '调色'),
      presets.map(function (preset) {
        return h(FcBtn, {
          key: 'preset-' + preset.id,
          disabled: busy || clip === null,
          title: preset.builtin ? '内置预设' : '自定义预设',
          onClick: function () { fcApplyGrade(preset.id) },
        }, preset.name)
      }),
      h(FcBtn, { disabled: busy || clip === null || !fcHasGrade(clip), onClick: fcClearGrade }, '清空')),

    h('div', { className: 'fc-row' },
      h('span', { className: 'fc-lb' }, '其他'),
      h(FcBtn, { disabled: busy || clip === null, onClick: fcToggleClip }, clip === null || clip.enabled ? '停用' : '启用'),
      h(FcBtn, { disabled: busy, title: '还原到上一次编辑前的工程快照', onClick: fcUndo }, '↩ 撤销')),

    // Batch is its own block: when nothing is checked it falls back to every clip,
    // which is the "整条片子统一调色" gesture the old version hard-coded.
    h('div', { className: 'fc-sec-h' }, '批量'),
    h('div', { className: 'fc-row' },
      h('span', { className: 'fc-lb' }, '范围'),
      h('span', { className: 'fc-clip-t' },
        (store.multi || []).length > 0 ? '选中的 ' + store.multi.length + ' 段' : '全部 ' + clips.length + ' 段')),
    h('div', { className: 'fc-row' },
      h('span', { className: 'fc-lb' }, '调色'),
      presets.map(function (preset) {
        return h(FcBtn, {
          key: 'batch-' + preset.id,
          disabled: busy || clips.length === 0,
          title: '对' + ((store.multi || []).length > 0 ? '选中的片段' : '全部片段') + '套用「' + preset.name + '」',
          onClick: function () { fcGradeMany(null, preset.id) },
        }, preset.name)
      })),
    h('div', { className: 'fc-row' },
      h('span', { className: 'fc-lb' }, '操作'),
      h(FcBtn, { disabled: busy || clips.length === 0, onClick: function () { fcGradeClearMany(null) } }, '清空这批调色')))
}

// ── export ──────────────────────────────────────────────────────────────────
function ExportBlock() {
  const busy = store.busy !== ''
  const running = fcRunningJobs()
  const job = running.length > 0 ? running[0] : null
  const ratio = job && job.progress && typeof job.progress.ratio === 'number' ? job.progress.ratio : null
  return h(FcSection, { title: '导出' },
    h('div', { className: 'fc-row' },
      h('span', { className: 'fc-lb' }, '输出'),
      h('input', {
        className: 'fc-inp', type: 'text', value: store.out,
        placeholder: '留空 = 工作区 exports/工程名-时间.mp4',
        onChange: function (event) { store.out = event.target.value; fcEmit() },
      })),

    h('div', { className: 'fc-row' },
      h('span', { className: 'fc-lb' }, '格式'),
      h('select', {
        className: 'fc-sel', value: store.format,
        onChange: function (event) { store.format = event.target.value; fcEmit() },
      },
        ['h264', 'hevc', 'prores'].map(function (name) { return h('option', { value: name, key: name }, name) })),
      h('span', { className: 'fc-lb' }, '缩放'),
      h('select', {
        className: 'fc-sel', value: String(store.scale),
        onChange: function (event) { store.scale = Number(event.target.value); fcEmit() },
      },
        [['1', '100%'], ['0.5', '50%'], ['0.25', '25%']].map(function (pair) {
          return h('option', { value: pair[0], key: pair[0] }, pair[1])
        }))),

    h('div', { className: 'fc-btns' },
      h(FcBtn, { primary: true, disabled: busy, onClick: fcExport }, '导出当前序列')),

    job === null ? null : h('div', null,
      h('div', { className: 'fc-meta' }, '正在导出：' + fcShort(job.project ? job.project.name : '', 24) +
        ' · ' + (ratio === null ? '采样中' : Math.round(ratio * 100) + '%')),
      h('div', { className: 'fc-prog' },
        h('div', { className: 'fc-prog-fill', style: { width: (ratio === null ? 0 : ratio * 100) + '%' } })),
      h('div', { className: 'fc-btns' }, h(FcBtn, { onClick: function () { fcJobAction('cancel', job.id) } }, '取消任务'))),

    h('div', { className: 'fc-hint' }, '导出在后台跑，进度在「任务」页实时刷新；同一工程可随时再剪辑。'))
}

// ── project / sequence header ───────────────────────────────────────────────
function ProjectBlock() {
  const detail = store.detail
  const sequences = detail && Array.isArray(detail.sequences) ? detail.sequences : []
  const busy = store.busy !== ''
  return h('div', null,
    h('div', { className: 'fc-row' },
      h('span', { className: 'fc-lb' }, '工程'),
      h('select', {
        className: 'fc-sel', value: store.projectId || '',
        onChange: function (event) { if (event.target.value) fcOpenProject(event.target.value) },
      },
        h('option', { value: '' }, store.projects.length > 0 ? '选择工程…' : '还没有工程'),
        store.projects.map(function (project) {
          return h('option', { key: project.id, value: project.id }, (project.exists ? '' : '⚠ ') + project.name)
        })),
      h(FcBtn, { disabled: busy, title: '在工作区里重新扫描 .fcproj', onClick: fcScan }, '扫描')),

    detail === null ? null : h('div', { className: 'fc-row' },
      h('span', { className: 'fc-clip-t', title: detail.path }, (detail.name || '未命名工程') + ' · ' + sequences.length + ' 序列' + (detail.revision === undefined || detail.revision === null ? '' : ' · rev ' + detail.revision)),
      h(FcBtn, { disabled: busy, onClick: fcRefreshProject }, '刷新')),

    detail === null ? null : h('div', { className: 'fc-chips' },
      sequences.map(function (sequence) {
        return h('button', {
          key: 'seq-' + sequence.id,
          className: 'fc-chip' + (sequence.active ? ' on' : ''),
          type: 'button',
          title: (sequence.clipCount === null || sequence.clipCount === undefined ? '' : sequence.clipCount + ' 段 · ') + fcTime(sequence.duration),
          onClick: function () { if (!sequence.active) fcActivateSequence(sequence.id) },
        }, (sequence.active ? '● ' : '') + fcShort(sequence.name, 18))
      }),
      h(FcBtn, { disabled: busy, onClick: fcNewSequence }, '+ 序列')))
}

// ── edit view ───────────────────────────────────────────────────────────────
function EditView() {
  const detail = store.detail
  if (detail === null) {
    return h('div', null,
      h('div', { className: 'fc-row' },
        h('span', { className: 'fc-lb' }, '工程'),
        h(FcBtn, { disabled: store.busy !== '', onClick: fcScan }, '扫描'),
        h(FcBtn, { disabled: store.busy !== '', onClick: function () { fcRefreshJobs().catch(function () { }) } }, '刷新')),

      store.projects.length === 0
        ? h('div', { className: 'fc-empty' }, '工作区里还没有登记工程。点「扫描」找 .fcproj。')
        : h('div', { className: 'fc-clips', style: { maxHeight: '180px' } },
          store.projects.map(function (project) {
            return h('div', {
              key: 'p-' + project.id,
              className: 'fc-clip',
              title: project.display,
              onClick: function () { fcOpenProject(project.id) },
            },
              h('span', { className: 'fc-clip-name' }, (project.exists ? '' : '⚠ ') + project.name),
              h('span', { className: 'fc-clip-t' }, project.exists ? fcBytes(project.bytes) : '文件缺失'))
          })),

      h('div', { className: 'fc-hint' },
        '工作区：' + (store.workspace ? store.workspace.rootDisplay : '…'),
        h('br'), '选中工程后可以：预览画面、裁头裁尾、删除、上下移、调色、导出。'))
  }

  const sequence = fcSequence()
  const clip = fcSelectedClip()
  return h('div', null,
    h(ProjectBlock, null),

    store.workspace === null || store.workspace.cli.exists
      ? null
      : h('div', { className: 'fc-alert' }, '找不到 filmcraft-cli：' + store.workspace.cli.path),

    detail === null ? null : h('div', { className: 'fc-path' }, detail.path),

    sequence === null
      ? h('div', { className: 'fc-empty' }, '这个工程没有激活的序列。新建一条序列再开始。')
      : h('div', null,
        h('div', { className: 'fc-stats' },
          h(FcStat, { label: '序列' }, fcShort(sequence.name, 20)),
          h(FcStat, { label: '时长' }, fcTime(sequence.duration)),
          h(FcStat, { label: '规格' }, (sequence.width || '?') + '×' + (sequence.height || '?') + ' · ' + (sequence.fps ? sequence.fps.toFixed(2) : '?') + 'fps'),
          h(FcStat, { label: '片段' }, String(fcClips().length))),

        h(PreviewBlock, null),

        h(FcSection, { title: '片段 (' + fcClips().length + ')' }, h(ClipList, null)),

        h(FcSection, { title: '素材' },
          h('div', { className: 'fc-btns' },
            h(FcBtn, { disabled: store.busy !== '', onClick: fcRefreshAssets }, '读取素材'),
            h(FcBtn, {
              disabled: store.busy !== '',
              onClick: function () { store.browseOpen = !store.browseOpen; fcEmit(); if (store.browseOpen) fcBrowse('') },
            }, store.browseOpen ? '收起目录' : '选素材'),
            h(FcBtn, {
              disabled: store.busy !== '' || (store.staging || []).length === 0,
              title: '只导入到工程素材箱，不动时间线',
              onClick: function () { fcImport(null) },
            }, '导入 (' + (store.staging || []).length + ')'),
            h(FcBtn, {
              disabled: store.busy !== '' || (store.staging || []).length === 0,
              title: '新建一条序列并把这批素材按顺序摆上去',
              onClick: function () { fcPlaceStaging(null) },
            }, '放到新序列')),
          (store.assets || []).length > 0 ? h('div', { className: 'fc-chips' },
            store.assets.map(function (asset) {
              if (!asset.path) return null
              const staged = fcStagingIndex(asset.path) >= 0
              return h('button', {
                key: 'asset-' + asset.item, type: 'button',
                className: 'fc-chip' + (staged ? ' on' : ''),
                title: asset.path + ' · ' + (asset.width || '?') + '×' + (asset.height || '?') + ' · ' + (asset.fps || '?') + 'fps' + (asset.online === false ? '（离线）' : ''),
                disabled: store.busy !== '',
                onClick: function () { if (staged) fcUnstage(asset.path); else fcStage(asset.path) },
              }, (asset.online === false ? '⚠ ' : '') + fcShort(asset.name, 14))
            }).filter(Boolean)) : null,
          store.browseOpen ? h(FcBrowsePicker, { kind: 'media', onPick: fcStage }) : null),

        clip === null ? h('div', { className: 'fc-hint' }, '选一个片段就能剪。') : h(EditActions, null),

        h(ExportBlock, null)))
}

// ── jobs ────────────────────────────────────────────────────────────────────
function JobCard(props) {
  const job = props.job
  const progress = job.progress || {}
  const ratio = typeof progress.ratio === 'number' ? progress.ratio : null
  const expected = job.expected || {}
  return h('div', { className: 'fc-job' },
    h('div', { className: 'fc-job-h' },
      h('span', { className: 'fc-job-n', title: job.out }, (job.project ? job.project.name : '（无工程）') +
        (job.sequence ? ' · ' + job.sequence.name : '')),
      h(FcBadge, { kind: FC_STATE_CLASS[job.state] || '' }, FC_STATE_TEXT[job.state] || job.state)),

    h('div', { className: 'fc-prog' },
      h('div', { className: 'fc-prog-fill', style: { width: (ratio === null ? 0 : Math.round(ratio * 1000) / 10) + '%' } })),

    h('div', { className: 'fc-meta' },
      (ratio === null ? '进度未知' : Math.round(ratio * 1000) / 10 + '%'),
      ' · ' + fcBytes(progress.bytes) + (expected.bytes ? ' / ' + fcBytes(expected.bytes) : ''),
      typeof progress.etaMs === 'number' ? ' · 剩余 ' + fcDuration(progress.etaMs) : '',
      progress.bytesPerSecond ? ' · ' + fcBytes(progress.bytesPerSecond) + '/s' : ''),

    h('div', { className: 'fc-meta' }, job.display || job.out || ''),
    job.error && job.state === 'failed' ? h('div', { className: 'fc-toast err' }, job.error) : null,
    job.state === 'done' && job.result ? h('div', { className: 'fc-meta' },
      job.result.frames + ' 帧 · ' + fcDuration(job.result.seconds * 1000) + ' · ' + fcBytes(job.result.bytes)) : null,

    h('div', { className: 'fc-btns', style: { marginTop: '4px' } },
      job.state === 'running' ? h(FcBtn, { onClick: function () { fcJobAction('cancel', job.id) } }, '取消') : null,
      job.state !== 'running' ? h(FcBtn, { danger: true, onClick: function () { fcJobAction('remove', job.id) } }, '清除记录') : null))
}

function LegacyBlock() {
  const legacy = store.legacy
  if (!legacy || legacy.present !== true) return null
  const state = legacy.state || {}
  return h('div', { className: 'fc-note' },
    h('span', null, '旧版状态文件：'),
    h('span', null, (state.phase || '未知') + (state.percent === null || state.percent === undefined ? '' : ' ' + Math.round(state.percent) + '%')),
    h('span', { style: { color: 'var(--dim)' } }, legacy.alive ? '（' + fcAgo(legacy.updatedAt) + '）' : '（已停止更新）'))
}

function JobsView() {
  const running = fcRunningJobs()
  const done = store.jobs.filter(function (job) { return job.state !== 'running' })
  return h('div', null,
    h('div', { className: 'fc-row' },
      h('span', { className: 'fc-clip-t' }, running.length + ' 个进行中 · ' + done.length + ' 条历史'),
      h(FcBtn, { onClick: function () { fcRefreshJobs().catch(function () { }) } }, '刷新')),

    LegacyBlock(),

    running.length === 0
      ? h('div', { className: 'fc-empty' }, '没有正在导出的任务。')
      : running.map(function (job) { return h(JobCard, { job: job, key: job.id }) }),

    done.length === 0 ? null : h(FcSection, { title: '历史' },
      done.slice(0, 12).map(function (job) { return h(JobCard, { job: job, key: job.id }) })),

    h('div', { className: 'fc-path' }, '任务记录保存在工作区的 jobs/ 目录，重启后仍在。'))
}

// ── panel ───────────────────────────────────────────────────────────────────
function Panel(props) {
  const wide = !!(props && props.wide)
  useFcStore()
  const wrapRef = React.useRef(null)
  const fillHeight = usePanelFill(wrapRef)
  React.useEffect(function () {
    store.mounted = true
    fcBoot()
    fcEnsurePolling()
    // The desktop app's theme is a setting, not necessarily the OS theme, so the
    // palette is read off the surface the panel is mounted into.
    const theme = fcDetectTheme(wrapRef.current)
    if (theme !== store.theme) { store.theme = theme; fcEmit() }
    return function () { store.mounted = false }
  }, [])
  const wrap = 'fc-wrap' + (wide ? ' wide' : '')
  const tabs = [
    { id: 'projects', label: '项目' },
    { id: 'edit', label: '剪辑' },
    { id: 'merge', label: '合并' },
    { id: 'jobs', label: '任务' },
    { id: 'settings', label: '设置' },
  ]
  return h('div', { className: 'fc-root' + (store.theme === 'light' ? ' light' : '') },
    h('div', {
      className: wrap,
      ref: wrapRef,
      style: fillHeight > 0 ? { maxHeight: fillHeight + 'px', overflowY: 'auto' } : null,
    },
      h('div', { className: 'fc-tabs' },
        tabs.map(function (tab) {
          const running = tab.id === 'jobs' ? fcRunningJobs().length : 0
          return h('button', {
            key: tab.id,
            className: 'fc-tab' + (store.tab === tab.id ? ' on' : ''), type: 'button',
            onClick: function () {
              store.tab = tab.id
              fcEmit()
              if (tab.id === 'jobs') fcRefreshJobs().catch(function () { })
              if (tab.id === 'merge' && store.browse.path === '') fcBrowse('')
            },
            // The count badge is its own element: inside the label text it wrapped
            // 「任务 · 1」 onto two lines and made the whole strip uneven.
          }, h('span', { className: 'fc-tab-lb' }, tab.label),
            running > 0 ? h('span', { className: 'fc-tab-n' }, String(running)) : null)
        })),

      store.notice ? h('div', { className: 'fc-toast' }, store.notice) : null,
      store.error ? h('div', { className: 'fc-toast err' }, store.error) : null,
      store.busy ? h('div', { className: 'fc-hint' }, store.busy + '…') : null,

      store.tab === 'edit' ? h(EditView, null) : null,
      store.tab === 'projects' ? h(ProjectsView, null) : null,
      store.tab === 'merge' ? h(MergeView, null) : null,
      store.tab === 'jobs' ? h(JobsView, null) : null,
      store.tab === 'settings' ? h(SettingsView, null) : null))
}

// ── fallback drawer (non-modal, no backdrop) ────────────────────────────────
function Drawer() {
  const open = useDrawerOpen()
  React.useEffect(function () {
    if (!open) return
    function onKey(event) { if (event.key === 'Escape') setDrawerOpen(false) }
    window.addEventListener('keydown', onKey)
    return function () { window.removeEventListener('keydown', onKey) }
  }, [open])
  if (!open) return null
  return h('div', { className: 'fc-root' },
    h('div', { className: 'fc-drawer', role: 'complementary' },
      h('div', { className: 'fc-drawer-hd' },
        h('b', null, FC_TAB_TITLE),
        h('button', { className: 'fc-x', type: 'button', title: '关闭', onClick: function () { setDrawerOpen(false) } }, '×')),
      h('div', { className: 'fc-drawer-bd' }, h(Panel, null))))
}

function FooterAction(props) {
  const wide = !(props && props.wide === false)
  useFcStore()
  React.useEffect(function () { fcBoot(); fcEnsurePolling() }, [])
  const running = fcRunningJobs()
  const job = running.length > 0 ? running[0] : null
  const ratio = job && job.progress && typeof job.progress.ratio === 'number' ? Math.round(job.progress.ratio * 100) : null
  return h('button', {
    className: wide ? 'fc-entry' : 'fc-entry rail',
    type: 'button',
    title: job === null ? FC_TAB_TITLE + ' · 空闲' : '正在导出 ' + (ratio === null ? '' : ratio + '%'),
    onClick: function () { openPanel() },
  },
    h(FcIcon, null),
    wide ? h('span', { className: 'fc-entry-lb' }, FC_TAB_TITLE) : null,
    ratio !== null && wide ? h('span', { className: 'fc-entry-pct' }, ratio + '%') : null)
}
