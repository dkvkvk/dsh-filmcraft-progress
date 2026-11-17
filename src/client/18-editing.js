// Editing drafts are kept outside React so typing survives store repainting.
Object.assign(store, {
  trimInput: '1f', trimEdge: 'in',
  captionDraft: { id: null, track: null, text: '', start: '0', end: '3' },
  transitionEffect: 'cross_dissolve', transitionEdge: 'out', transitionDuration: '12f',
  dragClip: null, dragSequence: null,
})

function fcFps() { return (fcSequence() && fcSequence().fps) || 25 }
function fcTc(seconds) {
  const fps = fcFps()
  const nominal = Math.round(fps)
  let frames = Math.max(0, Math.round(seconds * fps))
  const ff = frames % nominal
  const ss = Math.floor(frames / nominal) % 60
  const mm = Math.floor(frames / nominal / 60) % 60
  return fcPad(Math.floor(frames / nominal / 3600)) + ':' + fcPad(mm) + ':' + fcPad(ss) + ':' + fcPad(ff)
}

async function fcWorkflow(options, label) {
  if (store.busy || !fcSequence()) return null
  const result = await fcRun(label, function () {
    return host.call('edit.write', Object.assign({ project: fcProjectRef(), sequence: fcSequence().id, atomic: true }, options))
  })
  if (!result) return null
  if (result.detail) fcSetDetail(result.detail, { keep: true })
  if (result.ok === false || (result.failed && result.failed.length)) {
    fcFail(label + '失败' + (result.rolledBack ? '，已恢复修改前的工程' : '') + '：' + ((result.failed && result.failed[0] && result.failed[0].error) || '请重试'))
    return null
  }
  fcNotice(label + '完成')
  return result
}

function fcTrimExact(edge, delta) {
  const clip = fcSelectedClip()
  if (!clip) return
  return fcWorkflow({ operation: 'trim', clip: clip.clip, edge: edge, delta: delta }, '精确裁切')
}
function fcSplit() {
  const clip = fcSelectedClip()
  if (clip) return fcWorkflow({ operation: 'split', clip: clip.clip, time: clip.start + store.scrub }, '分割镜头')
}
function fcReorder(clipId, target, after) {
  return fcWorkflow({ operation: 'reorder', clip: clipId, target: target, after: after === true }, '调整顺序')
}

// Native drag events support both the horizontal timeline and vertical list.
// No repaint during a drag: replacing the dragged DOM node cancels native DnD.
function fcDragBindings(clip, vertical) {
  return {
    draggable: store.busy === '',
    onDragStart: function (event) {
      if (store.busy) { event.preventDefault(); return }
      store.dragClip = clip.clip
      store.dragSequence = fcSequence().id
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', String(clip.clip))
      }
    },
    onDragOver: function (event) {
      const source = fcClips().find(function (entry) { return entry.clip === store.dragClip })
      if (!source || source.clip === clip.clip || source.track !== clip.track || store.busy) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      const box = event.currentTarget.getBoundingClientRect()
      const after = vertical ? event.clientY >= box.top + box.height / 2 : event.clientX >= box.left + box.width / 2
      event.currentTarget.classList.toggle('fc-drop-after', after)
      event.currentTarget.classList.toggle('fc-drop-before', !after)
    },
    onDragLeave: function (event) { event.currentTarget.classList.remove('fc-drop-before', 'fc-drop-after') },
    onDragEnd: function () {
      store.dragClip = null
      store.dragSequence = null
      if (typeof document.querySelectorAll === 'function') document.querySelectorAll('.fc-drop-before,.fc-drop-after').forEach(function (element) { element.classList.remove('fc-drop-before', 'fc-drop-after') })
    },
    onDrop: function (event) {
      event.preventDefault()
      event.currentTarget.classList.remove('fc-drop-before', 'fc-drop-after')
      const source = store.dragClip
      const valid = store.dragSequence === fcSequence().id
      store.dragClip = null
      store.dragSequence = null
      if (!valid || source === null || source === clip.clip || store.busy) return
      const box = event.currentTarget.getBoundingClientRect()
      const after = vertical ? event.clientY >= box.top + box.height / 2 : event.clientX >= box.left + box.width / 2
      fcReorder(source, clip.clip, after)
    },
  }
}

function fcCaptionNew() {
  const clip = fcSelectedClip()
  const start = clip ? clip.start + store.scrub : 0
  const end = Math.min(fcSequence().duration, start + 3)
  store.captionDraft = { id: null, track: null, text: '', start: fcTc(start), end: fcTc(end) }
  fcEmit()
}
function fcCaptionChoose(track, caption) {
  store.captionDraft = { id: caption.id, track: track.id, text: caption.text, start: fcTc(caption.start), end: fcTc(caption.end) }
  fcEmit()
  if (store.prevOpen) fcFrame(caption.start)
}
async function fcCaptionSave() {
  const draft = store.captionDraft
  const result = await fcWorkflow({ operation: 'caption', caption: draft.id, track: draft.track, text: draft.text, start: draft.start, end: draft.end }, draft.id ? '修改字幕' : '添加字幕')
  if (result) fcCaptionNew()
}
function fcCaptionDelete(track, caption) {
  return fcWorkflow({ operation: 'caption', track: track.id, caption: caption.id, remove: true }, '删除字幕').then(function (result) {
    if (result && store.captionDraft.id === caption.id) fcCaptionNew()
  })
}
function fcTransition(options) {
  const clip = fcSelectedClip()
  if (!clip) return
  return fcWorkflow(Object.assign({ operation: 'transition', clip: clip.clip, effect: store.transitionEffect, edge: store.transitionEdge, duration: store.transitionDuration }, options || {}), options && options.remove ? '移除转场' : '设置转场')
}
