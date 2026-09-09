# SlideFlow 设计文档

日期：2026-09-09

## 一、背景与目标

SlideFlow 是一个秋招简历项目，定位为挂载在 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 上的插件，目标是用一个小而实用的项目，证明对以下能力的实际工程经验：

- harness 插件化架构（"everything-is-a-plugin"）与 skills 设计
- MCP（Model Context Protocol）的真实集成
- 检索（retrieval）能力在 agent skill 中的落地
- 结构化输出 / function calling 的工程实践
- "plan and reexecute"：先出方案草稿、经确认后再真正执行的 agent 设计模式

范围要求：小而实用，不追求功能全面，能在有限时间内完成，且技术细节经得起面试深挖。

开发方式：使用 Claude Code / Codex 辅助编写代码（AI 生成约 80%-90%，作者主导设计决策、review 与修正），过程中的关键设计决策需要留下清晰记录（commit message / 简短笔记），用于后续撰写简历项目描述与准备面试问答。

## 二、非目标（Non-goals）

- 不做多模板/多主题样式系统，一个默认 Marp 主题即可
- 不做协作/多用户场景
- 不引入向量数据库 / embedding 检索
- 不做完整的 PPT 可视化编辑 UI，渲染出的幻灯片就是最终产物
- 不把自己的 skill 暴露为 MCP server（dsh 当前只支持 MCP client，接入外部 MCP server；这一点在实现和文档表述中必须保持准确，不能颠倒）

## 三、基础设施

基于 DeepSeek Harness (dsh)：

- "everything-is-a-plugin" 架构，底层基于 Cordis 框架
- Node.js / TypeScript 生态
- 支持通过 `mcp-client` 插件接入外部 MCP server，将其工具桥接为原生 tool（仅 client 方向，dsh 本身不作为 MCP server 对外暴露工具）

本地启动方式：

```sh
npx @deepseek-ai/dsh web
```

或从源码构建（参考 dsh 仓库 README 的 `pnpm install && pnpm run build && pnpm dsh web` 流程）。

## 四、架构总览

SlideFlow 由三个职责单一、可独立测试的 skill 组成，由 dsh 的 agent 对话流程按序调用，中间插入两次人工确认关卡（大纲确认、演讲稿确认）。确认关卡不需要额外 UI 机制，直接通过对话中的自然语言反馈实现：用户满意则 agent 调用下一个 skill，不满意则回退重新调用当前或上一个 skill（即 "plan and reexecute"）。

```
用户输入主题/要点 + 可选参考资料
        │
        ▼
  outline_skill ──(调用)──> search_reference 工具 (BM25 + MCP filesystem server)
        │
        ▼
   [大纲确认关卡] ──不满意──> 回退重新调用 outline_skill
        │ 满意
        ▼
   script_skill
        │
        ▼
   [演讲稿确认关卡] ──不满意──> 回退重新调用 outline_skill / script_skill
        │ 满意
        ▼
   render_skill ──> Marp markdown + HTML 幻灯片
```

## 五、组件设计

### 5.1 outline_skill（大纲生成）

- **输入**：主题/要点（自然语言）+ 可选参考资料来源（本地文件路径）
- **行为**：如提供了参考资料，先调用 `search_reference` 工具获取相关片段作为生成上下文；再生成结构化大纲
- **输出 schema**：

  ```json
  {
    "title": "string",
    "slides": [
      {
        "heading": "string",
        "key_points": ["string"],
        "notes_hint": "string"
      }
    ]
  }
  ```

- **约束**：输出必须通过 JSON schema 校验；校验失败要重试或明确报错，不能静默通过畸形结构

### 5.2 search_reference 工具（检索能力，挂在 outline_skill 下）

- **来源接入**：通过 dsh 的 `mcp-client` 插件接入一个外部 **MCP filesystem server**（配置方式参考 dsh 文档 `docs/user/guide/mcp-memory.md` 中的 overlay 配置模式），将"读取本地文件"能力桥接为原生 tool
- **检索算法**：对读取到的参考文本做分块，使用 **BM25** 做关键词检索，返回 top-k 相关片段
- **约束**：不引入 embedding 模型或向量数据库，保持依赖轻量

### 5.3 script_skill（演讲稿生成）

- **输入**：经用户确认的大纲 JSON
- **输出**：逐页演讲稿，例如 `[{ "heading": "string", "script_text": "string" }]`
- **人工确认**：agent 将演讲稿展示给用户，等待自然语言确认或修改意见；有修改意见时重新调用 `outline_skill` 或 `script_skill` 迭代
- 这是本项目 "plan and reexecute" 模式的核心体现，不可省略这一反馈闭环

### 5.4 render_skill（渲染出片）

- **输入**：经确认的大纲 + 演讲稿
- **输出**：Marp 风格 markdown 文件，以及渲染后的 HTML 幻灯片
- **实现**：使用 `@marp-team/marp-core`（或 `@marp-team/marp-cli`），保持在 Node/TS 单一语言栈内，不引入 Python 或跨语言调用

## 六、测试与评测

- 准备 3-5 组"主题（+参考资料）→ 大纲"的黄金样例，编写结构化输出的 schema 校验测试与快照对比测试
- 为 `render_skill` 编写测试：固定输入，检查生成的 Marp markdown 结构（标题数量、每页要点数量等）是否符合预期；不做视觉快照测试

## 七、技术栈

Node.js / TypeScript · dsh (Cordis 插件系统) · mcp-client 插件 + 外部 MCP filesystem server · BM25 检索 · `@marp-team/marp-core`

## 八、交付物

1. 可运行的 dsh 插件 / skill 集合（`outline_skill`、`search_reference`、`script_skill`、`render_skill`），目录结构清晰，README 说明整体架构
2. 测试通过，并接入 CI（简单的 GitHub Actions 跑测试即可）
3. 关键设计决策记录：为什么这样拆分 skill、为什么选择 BM25 而非 embedding、MCP filesystem server 的接入方式、confirm-and-reexecute 循环的具体实现
4. 一段话项目摘要 + 3-4 条可直接用作简历 bullet point 的技术亮点描述（动词开头、包含具体机制与数字，避免空洞形容词）

## 九、关键决策记录（用于面试问答准备）

| 决策点 | 选择 | 原因 |
|---|---|---|
| skill 拆分方式 | 拆成 3 个独立 skill，agent 按序编排 | 体现 agent scope（职责单一、可独立测试复用），比单一 skill 内部状态机更能讲出"设计了可复用 pipeline"的故事 |
| 渲染输出格式 | Markdown 驱动的 HTML 幻灯片（Marp 风格） | 比生成真实 .pptx 工作量更小，且天然契合 Node/TS 技术栈，不需要跨语言调用渲染库 |
| 检索方式 | BM25，不用 embedding | 依赖极轻，半天内可实现；同时与作者已有的 VeriClimate 项目（BM25/dense/rerank）思路呼应但不重复实现同一套技术 |
| MCP 集成点 | 通过 mcp-client 接入外部 MCP filesystem server，而非把 skill 暴露为 MCP server | dsh 当前架构只支持 MCP client 方向；这样描述在技术上准确、经得起面试深挖 |
| 人工确认机制 | 对话中的自然语言反馈，不做额外 UI | 保持项目规模可控，同时是 "plan and reexecute" 模式最直接的实现方式 |
