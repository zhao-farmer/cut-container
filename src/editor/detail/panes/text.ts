/* ============================================================
 *  编辑器框架 · 右侧详情 · ③ 文字视图（外部入口 / 桶文件）
 *
 *  文字面板的各个选项组拆分在 ../sections/ 下，按选项组独立成文件：
 *    textContent.ts    内容
 *    textFont.ts       字体
 *    textPosition.ts   位置
 *    textBlend.ts      混合
 *    textStroke.ts     描边
 *    textBackground.ts 背景
 *    textGlow.ts       发光
 *    textShadow.ts     阴影
 *  ../sections/textPanel.ts 负责把以上各组按顺序拼装为 .ed-text-pane。
 *
 *  本文件作为 detail/panes 目录的文字视图入口，转出组合后的四个对外契约，
 *  视图切换方（../index.ts）只认本文件，不直接接触 sections/ 内部结构。
 * ============================================================ */
export { renderText, bindText, syncTextTransform, syncTextValues } from '../sections/textPanel'
