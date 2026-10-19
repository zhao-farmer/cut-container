/**
 * 外部演示数据 —— 这是"框架外部"拥有的数据。
 *
 * 架构约定：外部框架（Vue/React/Svelte/Solid）只负责把两类数据通过
 * cut-container.props 传给框架：
 *   1. MATERIALS —— 素材库数据（八分类）
 *   2. TRACKS    —— 轨道操作数据
 *
 * 注意：内置素材文件（视频 / 图片 / 动图 / 音频 / 字幕 / 贴纸 / 滤镜）
 * 与 Web 字体已经全部迁移到后端项目 `imitate-node`（static/files、static/fonts），
 * 前端不再内置这些资源。素材目录由后端 /api/catalog 下发：
 *   - 配置了后端（public/app-config.json 的 backend.enabled=true）时，
 *     启动后自动并入素材库；
 *   - 未配置后端时，这里是空工程，用户仍可从本地导入素材 / 音频 / 字体 / 字幕。
 *
 * 文本默认项是编辑器内建能力（无媒体文件），保留在前端。
 */
import type { MaterialsData, TrackObject } from '../editor/types'

/** 素材库数据：八分类 —— 资源型分类为空，等待后端目录合并 */
export const MATERIALS: MaterialsData = {
  material: [],
  audio: [],
  text: {
    defaults: [{ id: 't-default', name: '默认文本', content: '默认文本' }],
    templates: []
  },
  caption: [],
  sticker: [],
  filter: [],
  effect: [],
  transition: []
}

/** 轨道数据：前端不再内置示例时间线，由用户从素材库添加或后端配置扩展 */
export const TRACKS: TrackObject[] = []

/** 草稿名：默认取当天日期（M月D日），与标题栏初始草稿名保持一致 */
const now = new Date()
export const DRAFT_TITLE = `${now.getMonth() + 1}月${now.getDate()}日`
