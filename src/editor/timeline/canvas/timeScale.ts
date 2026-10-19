/* ============================================================
 *  时间轴 · 标尺刻度表（TimelineTrack 拆分）
 * ============================================================ */
import type { TimelineConfig } from '../core/config'

export interface TimeScaleInfo {
  /** 单帧像素宽 */
  frameWidth: number
  /** 短刻度周期（帧，无文字） */
  minor: number
  /** 中刻度周期（帧，无文字，可选） */
  mid: number
  /** 主刻度周期（帧，长刻度 + 时间文字） */
  major: number
  /**
   * 帧域：秒内帧主刻度点周期（帧）；0 = 时间域，无帧文字。
   * 帧域内秒界固定为主刻度（长刻度 + MM:SS），frameLabel 帧点同为
   * 主刻度长度并带 "N f" 文字（如 lv11：00:00 / 15f / 00:01）。
   */
  frameLabel: number
}

/**
 * 时间刻度表（剪映规格，fps=30；周期单位均为帧）。
 * 物理放大系数 frameWidth 每级 ×2（lv13 一帧 = 一个媒体格 trackMediaWidth），
 * 刻度周期只决定主 / 短刻度节奏，主刻度物理间距约 90-490px。
 *
 * 等级表（用户指定，与剪映一致）：
 *  lv1  主 10 分钟 / 短 1 分钟      lv2  主 10 分钟 / 短 1 分钟
 *  lv3  主  5 分钟 / 短 30 秒       lv4  主  3 分钟 / 短 15 秒
 *  lv5  主  1 分钟 / 短 5 秒        lv6  主 30 秒   / 短 3 秒
 *  lv7  主 10 秒   / 短 1 秒        lv8  主  5 秒   / 短 15 帧
 *  lv9  主  3 秒   / 短 10 帧       lv10 主  1 秒   / 短 3 帧
 *  lv11 主  1 秒与 15f / 短 3 帧    lv12 主  1 秒与 10f / 短 1 帧
 *  lv13 主  1 秒与 2f  / 短 1 帧
 *
 * 所有周期都是帧的整数且为 30 帧（1 秒）的整除因子，保证刻度点与帧网格严格重合。
 */
export function getTimeScaleInfo(level: number, cfg: TimelineConfig): TimeScaleInfo {
  const fps = cfg.fps
  const mw = cfg.trackMediaWidth
  // 默认兜底：10 分钟主刻度 / 1 分钟短刻度（lv1 规格）
  const result: TimeScaleInfo = {
    frameWidth: mw / 4096,
    minor: fps * 60,
    mid: 0,
    major: fps * 600,
    frameLabel: 0
  }
  switch (level) {
    // ---- 帧域：秒界主刻度 + MM:SS；帧主刻度点带 "N f"（与秒界等长）----
    case 13: // 一帧 = 一个媒体格；主 1 秒与 2f，短 1 帧
      result.frameWidth = mw
      Object.assign(result, { minor: 1, major: fps, frameLabel: 2 })
      break
    case 12: // 主 1 秒与 10f，短 1 帧
      result.frameWidth = mw / 2
      Object.assign(result, { minor: 1, major: fps, frameLabel: 10 })
      break
    case 11: // 主 1 秒与 15f，短 3 帧
      result.frameWidth = mw / 4
      Object.assign(result, { minor: 3, major: fps, frameLabel: 15 })
      break
    // ---- 秒 / 帧交界：秒界主刻度，无帧文字 ----
    case 10: // 主 1 秒，短 3 帧
      result.frameWidth = mw / 8
      Object.assign(result, { minor: 3, major: fps, frameLabel: 0 })
      break
    case 9: // 主 3 秒，短 10 帧
      result.frameWidth = mw / 16
      Object.assign(result, { minor: 10, major: fps * 3, frameLabel: 0 })
      break
    // ---- 秒域 ----
    case 8: // 主 5 秒，短 15 帧
      result.frameWidth = mw / 32
      Object.assign(result, { minor: 15, major: fps * 5, frameLabel: 0 })
      break
    case 7: // 主 10 秒，短 1 秒
      result.frameWidth = mw / 64
      Object.assign(result, { minor: fps, major: fps * 10, frameLabel: 0 })
      break
    case 6: // 主 30 秒，短 3 秒
      result.frameWidth = mw / 128
      Object.assign(result, { minor: fps * 3, major: fps * 30, frameLabel: 0 })
      break
    // ---- 分钟域 ----
    case 5: // 主 1 分钟，短 5 秒
      result.frameWidth = mw / 256
      Object.assign(result, { minor: fps * 5, major: fps * 60, frameLabel: 0 })
      break
    case 4: // 主 3 分钟，短 15 秒
      result.frameWidth = mw / 512
      Object.assign(result, { minor: fps * 15, major: fps * 180, frameLabel: 0 })
      break
    case 3: // 主 5 分钟，短 30 秒
      result.frameWidth = mw / 1024
      Object.assign(result, { minor: fps * 30, major: fps * 300, frameLabel: 0 })
      break
    case 2: // 主 10 分钟，短 1 分钟
      result.frameWidth = mw / 2048
      Object.assign(result, { minor: fps * 60, major: fps * 600, frameLabel: 0 })
      break
    case 1: // 主 10 分钟，短 1 分钟
      result.frameWidth = mw / 4096
      Object.assign(result, { minor: fps * 60, major: fps * 600, frameLabel: 0 })
      break
  }
  return result
}
