/* ============================================================
 *  素材库模块 · 统一入口
 *  面板装配见 materialsPanel.ts，各选项卡渲染在 panels/，
 *  文本/花字预设与拖拽载荷在 presets/ 与 dragPayload.ts。
 *  对外只暴露 createMaterialsPanel 与相关类型。
 * ============================================================ */
export { createMaterialsPanel } from './materialsPanel'
export { default } from './materialsPanel'
export type {
  AddTrackPayload,
  AnyAddTrackPayload,
  MaterialsPanelHandle,
  MaterialsPanelOptions,
  PanelCtx,
  PanelRenderer
} from './materialsPanel'
