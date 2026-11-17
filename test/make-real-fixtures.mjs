// Dependency-free real video + PCM audio fixtures. No downloads or user footage.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const u32 = (values) => {
  const data = Buffer.alloc(values.length * 4)
  values.forEach((value, index) => data.writeUInt32LE(value >>> 0, index * 4))
  return data
}
const chunk = (id, data) => Buffer.concat([
  Buffer.from(id), u32([data.length]), data, Buffer.alloc(data.length % 2),
])
const list = (id, children) => chunk('LIST', Buffer.concat([Buffer.from(id), ...children]))

function streamHeader(type, rate, scale, length, bufferSize, sampleSize, width = 0, height = 0) {
  const data = Buffer.alloc(56)
  data.write(type, 0)
  if (type === 'vids') data.write('DIB ', 4)
  data.writeUInt32LE(scale, 20)
  data.writeUInt32LE(rate, 24)
  data.writeUInt32LE(length, 32)
  data.writeUInt32LE(bufferSize, 36)
  data.writeUInt32LE(0xffffffff, 40)
  data.writeUInt32LE(sampleSize, 44)
  data.writeInt16LE(width, 52)
  data.writeInt16LE(height, 54)
  return chunk('strh', data)
}

function makeAvi(file, { seconds, width, height, color, frequency }) {
  const fps = 25, sampleRate = 48000, frameCount = seconds * fps
  const rowBytes = Math.ceil(width * 3 / 4) * 4, frameBytes = rowBytes * height
  const samplesPerFrame = sampleRate / fps, audioBytes = samplesPerFrame * 2
  const main = chunk('avih', u32([
    1e6 / fps, frameBytes * fps + sampleRate * 2, 0, 0x10,
    frameCount, 0, 2, frameBytes, width, height, 0, 0, 0, 0,
  ]))
  const bitmap = Buffer.alloc(40)
  bitmap.writeUInt32LE(40, 0)
  bitmap.writeInt32LE(width, 4)
  bitmap.writeInt32LE(height, 8)
  bitmap.writeUInt16LE(1, 12)
  bitmap.writeUInt16LE(24, 14)
  bitmap.writeUInt32LE(frameBytes, 20)
  const wave = Buffer.alloc(16)
  wave.writeUInt16LE(1, 0)
  wave.writeUInt16LE(1, 2)
  wave.writeUInt32LE(sampleRate, 4)
  wave.writeUInt32LE(sampleRate * 2, 8)
  wave.writeUInt16LE(2, 12)
  wave.writeUInt16LE(16, 14)
  const header = list('hdrl', [main,
    list('strl', [streamHeader('vids', fps, 1, frameCount, frameBytes, 0, width, height), chunk('strf', bitmap)]),
    list('strl', [streamHeader('auds', sampleRate * 2, 2, seconds * sampleRate, audioBytes, 2), chunk('strf', wave)]),
  ])
  const packets = [], index = []
  let offset = 4
  function packet(id, data) {
    const encoded = chunk(id, data)
    packets.push(encoded)
    index.push(Buffer.concat([Buffer.from(id), u32([0x10, offset, data.length])]))
    offset += encoded.length
  }
  for (let frame = 0; frame < frameCount; frame += 1) {
    const image = Buffer.alloc(frameBytes)
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const stripe = Math.abs(x - ((frame * 3) % width)) < 6
      const at = y * rowBytes + x * 3
      for (let c = 0; c < 3; c += 1) image[at + c] = stripe ? 240 : color[2 - c]
    }
    packet('00db', image)
    const audio = Buffer.alloc(audioBytes)
    for (let sample = 0; sample < samplesPerFrame; sample += 1) {
      const time = (frame * samplesPerFrame + sample) / sampleRate
      audio.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * time) * 2500), sample * 2)
    }
    packet('01wb', audio)
  }
  writeFileSync(file, chunk('RIFF', Buffer.concat([
    Buffer.from('AVI '), header, list('movi', packets), chunk('idx1', Buffer.concat(index)),
  ])))
}

export function makeRealFixtures(dir) {
  mkdirSync(dir, { recursive: true })
  return [
    { name: '01 红色片段.avi', seconds: 4, width: 160, height: 90, color: [160, 40, 40], frequency: 440 },
    { name: '02 绿色片段.avi', seconds: 6, width: 160, height: 90, color: [40, 160, 40], frequency: 550 },
    { name: '03 蓝色片段.avi', seconds: 3, width: 192, height: 108, color: [40, 40, 160], frequency: 660 },
  ].map((spec) => { const file = join(dir, spec.name); makeAvi(file, spec); return file })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  for (const file of makeRealFixtures(resolve(process.argv[2] || 'preview/real-media'))) console.log(file)
}
