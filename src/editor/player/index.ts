/* ============================================================
 *  播放器模块 · 统一入口
 *
 *  目录结构：
 *    index.ts                 本文件：对外统一出口
 *    playerStage.ts           mediaBunnyPlayer 的薄封装（视图状态 / handle）
 *    fullscreenBar.ts         全屏简易播放控制条
 *    transformOverlay.ts      画面操作框覆盖层
 *    core/                    内核：类型 / 常量 / 状态基类 / 装配类
 *    ui/                      外壳与弹层：shell / popover / zoomPan / menus
 *    stage/                   pixi 舞台：pixiStage
 *    timeline/                时间线：tracks（轨道注入）/ layers（多层静帧）
 *                             / playback（合成播放帧泵与 ticker 主循环）
 *    playback/                单素材 mediabunny 加载与 A/V 同步循环
 *
 *  编解码相关逻辑独立在 editor/codec（按消费方前缀区分）：
 *    playerResources.ts        播放器：解码器 / 图片 / GIF 资源池 + 静帧串行链
 *    playerMixer.ts            播放器：唯一的 Web Audio 混音单元（独立文件）
 *    playerMediaSourceDecoder.ts 播放器：单源 mediabunny 解码器
 * ============================================================ */
export { MediaBunnyPlayer } from './core/mediaBunnyPlayer'
export { createPlayerStage } from './playerStage'
export type {
  EmitFn,
  MediaBunnyPlayerOptions,
  LayerBox,
  PlayerCommand
} from './core/types'
export type { PlayerViewState, PlayerStageHandle } from './playerStage'
export { default } from './core/mediaBunnyPlayer'
