/* ============================================================
 *  时间轴画布 · 跨模块常量（拖放配色 / 标记几何 / 边缘平移）
 *  原 TimelineTrack 工厂内的散落常量，按主题聚合，供 add / drag /
 *  trim / render / interactions 各模块共享
 * ============================================================ */

/* ---------- 素材库 → 时间轴 HTML5 拖放：预览配色 ---------- */
/** 拖入预览配色（与色板同系：媒体块 0x004d52 / 音频块 0x103c5c） */
export const DND_SLOT_COLOR = 0x3c4046
export const DND_LANE_DIM = 0x000000
export const DND_LANE_DIM_ALPHA = 0.22
export const DND_LANE_HL = 0xffffff
export const DND_LANE_HL_ALPHA = 0.08

/** 自动磁吸线颜色（剪映：开启磁吸后开头/结尾对齐时出现的青色竖线） */
export const DND_SNAP_COLOR = 0x18b9d4
/** 拖入 / 块体重排磁吸阈值（7px / 缩放，换算为秒）；边缘拖裁不做磁吸 */
export const DND_SNAP_THRESHOLD_PX = 7

/* ---------- 标尺标记图标几何（剪映 marker 7×11px 五边形小盾牌） ---------- */
/** 盾牌半宽（全宽 7px；中心对齐半像素坐标，左右缘正好落在整数列） */
export const MARKER_HALF_W = 3.5
/** 矩形身段高度（其下 3px 收成尖） */
export const MARKER_BODY_H = 8
/** 盾牌总高（顶边到尖角） */
export const MARKER_H = 11
/** 尖角距标尺带下沿的距离 */
export const MARKER_BOTTOM_PAD = 2
/** 顶部两角圆角半径（7px 尺寸下剪映为直角，0） */
export const MARKER_CORNER_R = 0
/** 悬停提亮色（常态用 cfg.accentColor 0x18b9d4） */
export const MARKER_HOVER_COLOR = 0x45c6de
/** 盾牌命中半径（px），比视觉略宽方便点击 */
export const MARKER_HIT_PX = 6

/* ---------- 拖裁 / 块体拖动时的边缘自动横滚 ----------
   指针停在视口左右缘 48px 内即按距离加速平移；世界宽度按"若此刻松手提交"的
   预览终点实时扩展，主轨末片右拉可以一直拉出当前轨道 / 标尺边界 */
export const PAN_EDGE = 48
/** px/s：最深缩放 200px/s 下约 4s/s，最浅约 37s/s */
export const PAN_VMAX = 800
