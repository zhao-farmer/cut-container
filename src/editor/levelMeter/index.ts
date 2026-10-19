/* ============================================================
 *  编辑器框架 · 音频电平表（对齐参考实现 04音频的使用）
 *    - getPeakDb：AnalyserNode 时域峰值 → dBFS
 *    - createStereoTap：input → splitter → L/R 两个 analyser（单声道自动上混为相同双声道）
 *    - GridLevelMeter：格子 DOM 电平表（播放器底栏，时间线含音频时常驻、播放跳动）
 *    - VerticalLevelMeter：竖井 Canvas 电平表（时间轴右侧第五模块，常驻、可左右拉宽；
 *      顶标为 L/R 实时 dB，时间线播放 / 音乐试听均可驱动，暂停双倍速缓落）
 * ============================================================ */

/** AnalyserNode 时域峰值振幅 → dBFS（[-100, 0]），不做 RMS */
export function getPeakDb(analyser: AnalyserNode): number {
  const buf = new Uint8Array(analyser.fftSize)
  analyser.getByteTimeDomainData(buf)
  let maxAmp = 0
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128
    const absV = Math.abs(v)
    if (absV > maxAmp) maxAmp = absV
  }
  if (maxAmp <= 1e-8) return -100
  return Math.max(-100, Math.min(0, 20 * Math.log10(maxAmp)))
}

export interface StereoTap {
  analyserL: AnalyserNode
  analyserR: AnalyserNode
  /** 断开 tap（input 侧断开 splitter；analyser 无需下游连接） */
  dispose: () => void
}

/** 从任意输出节点分流出 L/R 两路分析器（不影响原链路出声） */
export function createStereoTap(ctx: BaseAudioContext, input: AudioNode): StereoTap {
  const splitter = ctx.createChannelSplitter(2)
  const analyserL = ctx.createAnalyser()
  const analyserR = ctx.createAnalyser()
  analyserL.fftSize = 1024
  analyserR.fftSize = 1024
  analyserL.smoothingTimeConstant = 0
  analyserR.smoothingTimeConstant = 0
  input.connect(splitter)
  splitter.connect(analyserL, 0)
  splitter.connect(analyserR, 1)
  return {
    analyserL,
    analyserR,
    dispose() {
      try {
        input.disconnect(splitter)
      } catch {
        /* 节点已随 context 释放 */
      }
      try {
        splitter.disconnect()
      } catch {
        /* noop */
      }
    }
  }
}

/**
 * 格子 DOM 电平表：两声道各一列竖格（L / R 并排），从下往上点亮。
 * 档位与配色对齐「格子DOM实现」参考页（5 格：绿×3 / 橙 / 红）。
 */
export class GridLevelMeter {
  private host: HTMLElement
  private cellsL: HTMLElement[] = []
  private cellsR: HTMLElement[] = []
  private tap: StereoTap | null = null
  private raf = 0
  /** 峰值保持状态（衰减后值，dB） */
  private peakL = -100
  private peakR = -100
  /** 每帧下降 dB（约 60fps，参考值 1.2） */
  private static DECAY_DB = 1.2
  private static THRESHOLDS = [-50, -25, -12, -6, 0]

  constructor(host: HTMLElement) {
    this.host = host
    host.classList.add('jy-level')
    host.hidden = true
    host.innerHTML = `
      <span class="jy-level-col" data-ch="l"></span>
      <span class="jy-level-col" data-ch="r"></span>`
    const mk = (ch: string) => {
      const col = host.querySelector<HTMLElement>(`[data-ch="${ch}"]`)!
      // column-reverse：i=0 在最底部；点亮前 level 个即「从下往上」
      return GridLevelMeter.THRESHOLDS.map((_, i) => {
        const cell = document.createElement('i')
        cell.className = 'jy-level-cell'
        cell.dataset.i = String(i)
        col.appendChild(cell)
        return cell
      })
    }
    this.cellsL = mk('l')
    this.cellsR = mk('r')
  }

  /** 时间线是否含可发声片段：含即常驻显示（暂停时格子全灭） */
  setVisible(v: boolean) {
    this.host.hidden = !v
    if (!v) this.clear()
  }

  /** 播放：绑定 tap 开始逐帧刷新 */
  start(tap: StereoTap) {
    this.tap = tap
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(this.loop)
  }

  /** 暂停 / 停止：脱离 tap，快速衰减到全灭（仅在原本运行时启动余韵） */
  idle() {
    const wasRunning = this.tap !== null
    this.tap = null
    cancelAnimationFrame(this.raf)
    this.raf = 0
    if (wasRunning) this.startDecay()
  }

  /** 彻底停止并隐藏（轨道清空 / 销毁） */
  destroy() {
    this.tap = null
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.peakL = -100
    this.peakR = -100
    this.clear()
    this.host.hidden = true
  }

  private clear() {
    for (const c of [...this.cellsL, ...this.cellsR]) c.className = 'jy-level-cell'
  }

  private dbToLevel(db: number): number {
    let lv = 0
    for (const t of GridLevelMeter.THRESHOLDS) {
      if (db > t) lv++
    }
    return lv
  }

  private paint(cells: HTMLElement[], level: number) {
    for (let i = 0; i < cells.length; i++) {
      cells[i].className = i < level ? `jy-level-cell is-on lv${i}` : 'jy-level-cell'
    }
  }

  private step(currL: number, currR: number, decay: number) {
    if (currL > this.peakL) this.peakL = currL
    else this.peakL = Math.max(-100, this.peakL - decay)
    if (currR > this.peakR) this.peakR = currR
    else this.peakR = Math.max(-100, this.peakR - decay)
    this.paint(this.cellsL, this.dbToLevel(this.peakL))
    this.paint(this.cellsR, this.dbToLevel(this.peakR))
  }

  private loop = () => {
    if (!this.tap) {
      this.raf = 0
      return
    }
    this.raf = requestAnimationFrame(this.loop)
    this.step(getPeakDb(this.tap.analyserL), getPeakDb(this.tap.analyserR), GridLevelMeter.DECAY_DB)
  }

  /** 暂停后的余韵衰减（约 0.3s 掉到底即停） */
  private startDecay() {
    let frames = 0
    const tick = () => {
      frames++
      this.step(-100, -100, GridLevelMeter.DECAY_DB * 2)
      if (frames < 18 && (this.peakL > -100 || this.peakR > -100)) {
        this.raf = requestAnimationFrame(tick)
      } else {
        this.raf = 0
        this.peakL = -100
        this.peakR = -100
        this.clear()
      }
    }
    this.raf = requestAnimationFrame(tick)
  }
}

/**
 * 竖井 Canvas 电平表（剪映样式）：左 dB 刻度 + L/R 双柱 + 白色峰值保持线。
 * 时间轴右侧常驻第五模块：播放读实时峰值（柱顶数字为实时 dB）；
 * 暂停后瞬时柱匀速下落；白色峰值线在视觉柱高空间匀加速下落（越落越快），
 * 但任何时候不低于绿色瞬时柱的柱顶位置（始终贴在绿柱上方），落底停在 -∞
 * （面板始终可见，宽度可拖拽）。
 */
export class VerticalLevelMeter {
  private host: HTMLElement
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private wCss = 150
  private hCss = 248
  private tap: StereoTap | null = null
  private raf = 0
  private lastTs = 0
  private ro: ResizeObserver | null = null

  /** 剪映 UI 的 dB → 柱高百分比映射 */
  private static SCALE = [
    { db: 6, topPct: 0 },
    { db: 0, topPct: 16 },
    { db: -6, topPct: 36 },
    { db: -12, topPct: 52 },
    { db: -20, topPct: 68 },
    { db: -30, topPct: 80 },
    { db: -50, topPct: 92 },
    { db: -60, topPct: 100 }
  ]
  private static PEAK_HOLD_MS = 3000
  /** 暂停后绿色瞬时柱的下落速度基数（实际 ×4 = 64 dB/s） */
  private static FAST_DECAY = 16
  /** 白色峰值线起始下落速度（视觉柱高百分比 / 秒，百分比越大位置越靠下） */
  private static PEAK_VEL_START = 10
  /** 白色峰值线下落加速度（视觉柱高百分比 / 秒²）：视觉上越落越快 */
  private static PEAK_ACCEL = 30

  private state = {
    L: { db: -100, currDb: -100, holdUntil: 0, velPct: VerticalLevelMeter.PEAK_VEL_START },
    R: { db: -100, currDb: -100, holdUntil: 0, velPct: VerticalLevelMeter.PEAK_VEL_START }
  }

  constructor(host: HTMLElement) {
    this.host = host
    host.classList.add('ed-vumeter')
    host.innerHTML = '<canvas class="ed-vumeter-canvas"></canvas>'
    this.canvas = host.querySelector('canvas')!
    this.ctx = this.canvas.getContext('2d')!
    this.resize()
    this.draw(-100, -100, -100, -100)
    // 面板宽度可拖拽：宿主尺寸变化即重配位图并重绘当前帧
    this.ro = new ResizeObserver(() => {
      this.resize()
      this.draw(this.state.L.currDb, this.state.R.currDb, this.state.L.db, this.state.R.db)
    })
    this.ro.observe(host)
  }

  /** 按 CSS 尺寸 ×DPR 配置位图（以 canvas 自身盒为准，避开宿主边框） */
  resize() {
    const rect = this.canvas.getBoundingClientRect()
    this.wCss = rect.width || 150
    this.hCss = rect.height || 248
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.canvas.width = Math.round(this.wCss * dpr)
    this.canvas.height = Math.round(this.hCss * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  /** 播放（时间线 / 音乐试听）：绑定 tap 实时刷新 */
  start(tap: StereoTap) {
    this.resize()
    this.tap = tap
    const now = performance.now()
    this.lastTs = now
    this.state.L.holdUntil = now
    this.state.R.holdUntil = now
    this.state.L.velPct = VerticalLevelMeter.PEAK_VEL_START
    this.state.R.velPct = VerticalLevelMeter.PEAK_VEL_START
    if (!this.raf) this.raf = requestAnimationFrame(this.loop)
  }

  /** 暂停 / 停止：瞬时柱匀速下落，峰值线从初速度开始匀加速追落（不越过绿柱） */
  stop() {
    if (!this.tap && !this.raf) return
    this.tap = null
    this.lastTs = performance.now()
    this.state.L.velPct = VerticalLevelMeter.PEAK_VEL_START
    this.state.R.velPct = VerticalLevelMeter.PEAK_VEL_START
    if (!this.raf) this.raf = requestAnimationFrame(this.loop)
  }

  /** 销毁：停止帧循环并取消尺寸观察 */
  destroy() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.tap = null
    this.ro?.disconnect()
    this.ro = null
  }

  private dbToPct(dbVal: number): number {
    const table = VerticalLevelMeter.SCALE
    const db = Math.max(-60, Math.min(6, dbVal))
    for (let i = 0; i < table.length - 1; i++) {
      const a = table[i]
      const b = table[i + 1]
      if (db <= a.db && db >= b.db) {
        const ratio = (a.db - db) / (a.db - b.db)
        return a.topPct + ratio * (b.topPct - a.topPct)
      }
    }
    return 100
  }

  /** dbToPct 的反算（视觉柱高百分比 → dB）；落到底（100%）统一记 -100 以便停帧 */
  private pctToDb(pctVal: number): number {
    if (pctVal >= 100) return -100
    const p = Math.max(0, Math.min(100, pctVal))
    const table = VerticalLevelMeter.SCALE
    for (let i = 0; i < table.length - 1; i++) {
      const a = table[i]
      const b = table[i + 1]
      if (p >= a.topPct && p <= b.topPct) {
        const span = b.topPct - a.topPct
        if (span <= 0) return a.db
        const ratio = (p - a.topPct) / span
        return a.db - ratio * (a.db - b.db)
      }
    }
    return 6
  }

  private static FONT_NUM = '10px sans-serif'
  private static FONT_LABEL = '13px sans-serif'

  /**
   * 绘制 -∞：负号与 ∞ 分开渲染。textBaseline='middle' 下：
   * 负号中心在 y，∞ 中心在 y+1（∞ 略低 2px 与负号视觉齐平）。
   * x 按各自实测宽度 + 固定间距排布：align=right 时 x 为整体右缘（左刻度列），
   * align=center 时 x 为整体中心（柱顶）。
   */
  private static drawInf(
    ctx: CanvasRenderingContext2D,
    align: 'right' | 'center',
    x: number,
    y: number
  ) {
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = VerticalLevelMeter.FONT_NUM
    const wMinus = ctx.measureText('-').width
    const wInf = ctx.measureText('∞').width
    const gap = 1
    const total = wMinus + gap + wInf
    const xMinus =
      align === 'right' ? x - wInf - gap - wMinus / 2 : x - total / 2 + wMinus / 2
    const xInf = align === 'right' ? x - wInf / 2 : x - total / 2 + wMinus + gap + wInf / 2
    ctx.fillText('-', xMinus, y)
    ctx.fillText('∞', xInf, y + 1)
    ctx.restore()
  }

  /** 绘制 dB 文字：无信号（≤-60）走分段渲染的 -∞，否则整数（middle 基线）；y 为垂直中心。 */
  private static drawDb(
    ctx: CanvasRenderingContext2D,
    db: number,
    align: 'right' | 'center',
    x: number,
    y: number
  ) {
    if (db <= -60) {
      VerticalLevelMeter.drawInf(ctx, align, x, y)
      return
    }
    ctx.save()
    ctx.textBaseline = 'middle'
    ctx.textAlign = align
    ctx.font = VerticalLevelMeter.FONT_NUM
    ctx.fillText(String(Math.round(db)), x, y)
    ctx.restore()
  }

  private draw(currL: number, currR: number, pkL: number, pkR: number) {
    const ctx = this.ctx
    const W = this.wCss
    const H = this.hCss
    ctx.clearRect(0, 0, W, H)

    // 内容与面板四边的间距（按标注稿）：上 25 / 下 30 / 左 30 / 右 10
    const PAD_T = 25
    const PAD_B = 30
    const scaleW = 30
    const gap = 8
    const marginR = 10
    const chW = (W - scaleW - marginR - gap) / 2
    const chH = H - PAD_T - PAD_B
    const pctToY = (pct: number) => PAD_T + (pct / 100) * chH
    // 顶部实时 dB 数字：在上 25px 留白区内垂直居中；底部 L/R：在底线之下的 30px 区内垂直居中
    const yTopLabel = PAD_T / 2
    const yBottomLabel = PAD_T + chH + PAD_B / 2 + 1

    const chLX = scaleW
    const chRX = scaleW + chW + gap

    const grad = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + chH)
    grad.addColorStop(0, '#ff2b2b')
    grad.addColorStop(0.2, '#ff8800')
    grad.addColorStop(0.35, '#009619')
    grad.addColorStop(1, '#009619')

    const drawChannel = (x: number, currDb: number, pkDb: number, label: string) => {
      const yCurr = pctToY(this.dbToPct(currDb))
      const yPeak = pctToY(this.dbToPct(pkDb))
      // 柱顶暗区（未达到的部分）
      ctx.fillStyle = '#232323'
      ctx.fillRect(x, PAD_T, chW, yCurr - PAD_T)
      // 电平柱（自当前高度向下填满）：柱体整体 0.7 透明度
      ctx.globalAlpha = 0.7
      ctx.fillStyle = grad
      ctx.fillRect(x, yCurr, chW, PAD_T + chH - yCurr)
      ctx.globalAlpha = 1
      // 白色峰值保持线（细线 + 轻微光晕）
      ctx.fillStyle = '#ffffff'
      ctx.shadowColor = 'rgba(255,255,255,.5)'
      ctx.shadowBlur = 2
      ctx.fillRect(x, yPeak, chW, 1)
      ctx.shadowBlur = 0
      // 柱顶实时 dB（无信号 -∞），在上留白区垂直居中
      ctx.fillStyle = '#9ca3af'
      VerticalLevelMeter.drawDb(ctx, currDb, 'center', x + chW / 2, yTopLabel)
      // 柱底 L/R：比刻度数字大一号，在下留白区垂直居中
      ctx.fillStyle = '#adb5bd'
      ctx.save()
      ctx.font = VerticalLevelMeter.FONT_LABEL
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, x + chW / 2, yBottomLabel)
      ctx.restore()
    }
    drawChannel(chLX, currL, pkL, 'L')
    drawChannel(chRX, currR, pkR, 'R')

    // 刻度虚线 + 数值：全部以虚线为垂直中心对齐（含最顶的 6 与最底的 -∞）
    ctx.fillStyle = '#9ca3af'
    for (const item of VerticalLevelMeter.SCALE) {
      const y = pctToY(item.topPct)
      if (item.db === -60) VerticalLevelMeter.drawInf(ctx, 'right', scaleW - 4, y)
      else VerticalLevelMeter.drawDb(ctx, item.db, 'right', scaleW - 4, y)
      ctx.strokeStyle = 'rgba(255,255,255,.16)'
      ctx.lineWidth = 1
      ctx.setLineDash([2, 3])
      ctx.beginPath()
      ctx.moveTo(scaleW, y)
      ctx.lineTo(W - marginR, y)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  /**
   * 单声道峰值保持线推进：
   * - 实时电平超过白线 → 白线立刻抬到新峰值并重新保持 3s；
   * - 保持期内不动，下落速度复位为初速度；
   * - 保持结束后在「视觉柱高百分比」空间匀加速下落（屏幕上越落越快，
   *   避免恒定 dB/s 被底部非线性刻度压缩成视觉减速）；
   * - 硬约束：白线视觉位置不得低于绿色瞬时柱柱顶（ch.db ≥ currDb）。
   */
  private stepPeak(
    ch: { db: number; holdUntil: number; velPct: number },
    currDb: number,
    dt: number,
    now: number,
    allowHold: boolean
  ) {
    if (currDb > ch.db) {
      ch.db = currDb
      ch.holdUntil = now + VerticalLevelMeter.PEAK_HOLD_MS
      ch.velPct = VerticalLevelMeter.PEAK_VEL_START
      return
    }
    if (allowHold && now <= ch.holdUntil) {
      ch.velPct = VerticalLevelMeter.PEAK_VEL_START
      return
    }
    ch.velPct += VerticalLevelMeter.PEAK_ACCEL * dt
    let pct = this.dbToPct(ch.db) + ch.velPct * dt
    // 不超过绿色瞬时柱的下落位置（百分比越大越靠下）
    const pctCurr = this.dbToPct(currDb)
    if (pct > pctCurr) pct = pctCurr
    ch.db = this.pctToDb(pct)
  }

  private loop = (ts: number) => {
    const dt = Math.min(0.1, Math.max(0, (ts - this.lastTs) / 1000))
    this.lastTs = ts
    const now = performance.now()
    let currL: number
    let currR: number

    if (this.tap) {
      currL = getPeakDb(this.tap.analyserL)
      currR = getPeakDb(this.tap.analyserR)
      this.state.L.currDb = currL
      this.state.R.currDb = currR
      this.stepPeak(this.state.L, currL, dt, now, true)
      this.stepPeak(this.state.R, currR, dt, now, true)
    } else {
      // 暂停 / 结束：绿色瞬时柱匀速下落；白线匀加速追落但不越过绿柱
      const pkL = this.state.L
      pkL.currDb = Math.max(-100, pkL.currDb - VerticalLevelMeter.FAST_DECAY * 4 * dt)
      currL = pkL.currDb
      const pkR = this.state.R
      pkR.currDb = Math.max(-100, pkR.currDb - VerticalLevelMeter.FAST_DECAY * 4 * dt)
      currR = pkR.currDb
      this.stepPeak(pkL, currL, dt, now, false)
      this.stepPeak(pkR, currR, dt, now, false)
    }

    this.draw(currL, currR, this.state.L.db, this.state.R.db)

    if (this.tap || this.state.L.db > -100 || this.state.R.db > -100) {
      this.raf = requestAnimationFrame(this.loop)
    } else {
      // 落底停帧：面板常驻，保持 -∞ 静态画面
      this.raf = 0
    }
  }
}
