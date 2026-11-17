function PrecisionEditor() {
  const clip = fcSelectedClip()
  const disabled = store.busy !== '' || !clip
  return h('div', { className: 'fc-sec' },
    h('div', { className: 'fc-sec-h' }, '精确裁切'),
    clip ? h('div', { className: 'fc-hint fc-mono' }, '源入点 ' + fcTc(clip.sourceIn) + ' · 出点 ' + fcTc(clip.sourceOut)) : null,
    ['in', 'out'].map(function (edge) {
      return h('div', { className: 'fc-row', key: edge },
        h('span', { className: 'fc-lb' }, edge === 'in' ? '裁头' : '裁尾'),
        [-5, -1, 1, 5].map(function (frames) {
          return h(FcBtn, { key: frames, disabled: disabled, title: (frames > 0 ? '裁掉 ' : '延长 ') + Math.abs(frames) + ' 帧', onClick: function () { fcTrimExact(edge, frames + 'f') } }, (frames > 0 ? '+' : '−') + Math.abs(frames) + 'f')
        }))
    }),
    h('div', { className: 'fc-row' },
      h('select', { className: 'fc-sel', value: store.trimEdge, disabled: disabled, 'aria-label': '裁切位置', onChange: function (event) { store.trimEdge = event.target.value; fcEmit() } }, h('option', { value: 'in' }, '裁头'), h('option', { value: 'out' }, '裁尾')),
      h('input', { className: 'fc-edit-time', value: store.trimInput, disabled: disabled, 'aria-label': '裁切量', placeholder: '12f / 0.5s / 时间码', onChange: function (event) { store.trimInput = event.target.value; fcEmit() } }),
      h(FcBtn, { disabled: disabled, onClick: function () { fcTrimExact(store.trimEdge, store.trimInput) } }, '应用裁切')),
    h('div', { className: 'fc-row' },
      h('span', { className: 'fc-clip-t fc-mono' }, '播放头 ' + fcTc(clip ? clip.start + store.scrub : 0)),
      h(FcBtn, { disabled: disabled || store.scrub <= 0 || (clip && store.scrub >= clip.dur), onClick: fcSplit }, '在此分割')),
    h('div', { className: 'fc-hint' }, '正数裁短，负数延长；支持秒、帧和非丢帧时间码。后方镜头随裁切移动。'))
}

function CaptionEditor() {
  const sequence = fcSequence()
  const tracks = sequence.captionTracks || []
  const draft = store.captionDraft
  const busy = store.busy !== ''
  const set = function (key) { return function (event) { draft[key] = event.target.value; fcEmit() } }
  return h(FcSection, { title: '字幕' },
    h('div', { className: 'fc-row' },
      h(FcBtn, { disabled: busy, onClick: fcCaptionNew }, '从播放头新建'),
      h('span', { className: 'fc-clip-t' }, draft.id ? '正在修改字幕' : '新字幕')),
    h('textarea', { className: 'fc-caption-text', 'aria-label': '字幕内容', placeholder: '输入字幕，支持换行', maxLength: 4000, value: draft.text, disabled: busy, onChange: set('text') }),
    h('div', { className: 'fc-row' },
      h('label', { className: 'fc-lb' }, '起止'),
      h('input', { className: 'fc-edit-time', 'aria-label': '字幕起点', value: draft.start, disabled: busy, onChange: set('start') }),
      h('span', null, '→'),
      h('input', { className: 'fc-edit-time', 'aria-label': '字幕终点', value: draft.end, disabled: busy, onChange: set('end') })),
    h('div', { className: 'fc-row' },
      h(FcBtn, { primary: true, disabled: busy || !draft.text.trim(), onClick: fcCaptionSave }, draft.id ? '保存字幕' : '添加字幕'),
      draft.id ? h(FcBtn, { disabled: busy, onClick: fcCaptionNew }, '取消修改') : null),
    h('div', { className: 'fc-caption-list' }, tracks.map(function (track) {
      return track.items.map(function (caption) {
        return h('div', { className: 'fc-caption-row', key: caption.id },
          h('button', { className: 'fc-caption-pick', type: 'button', disabled: busy, title: caption.text, onClick: function () { fcCaptionChoose(track, caption) } },
            h('span', { className: 'fc-clip-t' }, track.label + ' ' + fcTc(caption.start) + '–' + fcTc(caption.end)), h('span', { className: 'fc-caption-line' }, caption.text)),
          h(FcBtn, { danger: true, disabled: busy, onClick: function () { fcCaptionDelete(track, caption) } }, '删除'))
      })
    })),
    h('div', { className: 'fc-hint' }, '起止按整个序列计时，可填秒、帧或时间码。字幕会渲染到成片中；调整镜头后请复核字幕时间。'))
}

const FC_TRANSITION_NAMES = { cross_dissolve: '交叉溶解', dip_to_black: '淡入淡出黑场' }
function TransitionEditor() {
  const clip = fcSelectedClip()
  const sequence = fcSequence()
  const track = clip && sequence.tracks.video.find(function (entry) { return entry.id === clip.track })
  const transitions = track ? (track.transitions || []).filter(function (entry) { return entry.from === clip.clip || entry.to === clip.clip }) : []
  const disabled = store.busy !== '' || !clip
  return h(FcSection, { title: '视频转场' },
    h('div', { className: 'fc-row' },
      h('select', { className: 'fc-sel', 'aria-label': '转场类型', value: store.transitionEffect, disabled: disabled, onChange: function (event) { store.transitionEffect = event.target.value; fcEmit() } },
        Object.keys(FC_TRANSITION_NAMES).map(function (id) { return h('option', { value: id, key: id }, FC_TRANSITION_NAMES[id]) })),
      h('select', { className: 'fc-sel', 'aria-label': '转场位置', value: store.transitionEdge, disabled: disabled, onChange: function (event) { store.transitionEdge = event.target.value; fcEmit() } }, h('option', { value: 'in' }, '镜头开头'), h('option', { value: 'out' }, '镜头结尾'))),
    h('div', { className: 'fc-row' },
      h('span', { className: 'fc-lb' }, '时长'),
      h('input', { className: 'fc-edit-time', 'aria-label': '转场时长', value: store.transitionDuration, disabled: disabled, onChange: function (event) { store.transitionDuration = event.target.value; fcEmit() } }),
      h(FcBtn, { disabled: disabled, onClick: function () { fcTransition() } }, '添加转场')),
    transitions.map(function (entry) {
      return h('div', { className: 'fc-row', key: entry.id },
        h('span', { className: 'fc-clip-name' }, (FC_TRANSITION_NAMES[entry.effect] || entry.effect) + ' · ' + Math.round(entry.dur * fcFps()) + 'f'),
        h(FcBtn, { disabled: disabled, onClick: function () { fcTransition({ transition: entry.id }) } }, '更新时长'),
        h(FcBtn, { danger: true, disabled: disabled, onClick: function () { fcTransition({ transition: entry.id, remove: true }) } }, '移除'))
    }),
    h('div', { className: 'fc-hint' }, '相邻镜头衔接处添加转场；序列首尾可淡入淡出。排序前请先移除该轨转场。'))
}
