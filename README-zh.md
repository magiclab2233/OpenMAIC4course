# OpenMAIC - 增强版

<p align="center">
  <img src="assets/banner.png" alt="OpenMAIC Banner" width="680"/>
</p>

本仓库是 **OpenMAIC** 原项目的增强版本，专注于优化课程录制体验、提升系统稳定性和完善 API 集成。

---

## 📖 关于 OpenMAIC (源项目)

> [OpenMAIC](https://github.com/THU-MAIC/OpenMAIC)（Open Multi-Agent Interactive Classroom）是一个开源的 AI 互动课堂平台，能够将任何主题或文档转化为丰富的互动学习体验。
>
> **核心亮点：**
> - **一键生成课堂**：支持通过主题或材料快速构建完整课程。
> - **多智能体互动**：AI 老师与同学实时授课、讨论与互动。
> - **丰富场景类型**：包含幻灯片、测验、HTML 交互模拟等。
> - **白板与语音**：支持实时绘图讲解与多语种语音合成。
> - **灵活导出**：可导出为 `.pptx` 幻灯片或互动 `.html` 网页。

---

## ✨ 新增功能特性

此版本引入了多项关键改进，使平台更适合专业级的课程视频制作：

### **1. 专业级录课系统**
- **自动全屏捕获**：录制开始时，PPT 区域会自动切换至全屏模式，确保生成的视频画面纯净，无浏览器 UI 干扰。
- **音画同步优化**：通过预激活浏览器 `AudioContext` 并优化 AI 智能体音轨捕获逻辑，彻底解决了“视频无声音”的问题。
- **高可靠性录制**：
    - 引入 **1 秒数据分片（Chunking）策略**，有效防止因长录制导致的视频文件损坏。
    - 增加 **静音音轨兜底机制**，确保在老师开口说话前录制器也能稳定运行。
- **自动保存增强**：优化了下载生命周期管理（5秒缓冲），确保大体积视频文件能稳定保存到本地。

### **2. 增强型 TTS 集成**
- **智谱 GLM-TTS 深度优化**：
    - 修复了智谱 API 的请求头冲突及默认参数错误。
    - 增强了语音合成失败时的错误解析，提供更清晰的故障排查反馈。
    - 修正了默认音色映射，确保自动调用高质量的 `tongtong` (彤彤) 模型。

### **3. 系统稳定性与开发体验**
- **SSR 水合修复**：针对 Next.js 引入了挂载状态保护，解决了页面初始化时可能出现的 "client-side exception" 崩溃。
- **Windows 构建修复**：解决了 Windows 环境下 `pptxgenjs` 等内部包在构建过程中出现的 `EPERM` 权限锁定问题。
- **API 连通性测试套件**：新增了专用的 API 测试工具（`api_test.py`），可一键验证 LLM、搜索及 TTS 服务商的配置是否有效。

---

## 🚀 快速开始

### 1. 克隆与安装
```bash
git clone <您的仓库地址>
cd OpenMAIC
pnpm install
```

### 2. 配置 API
将 `.env.example` 复制为 `.env.local` 并填入您的 API Key。建议运行 `python api_test.py` 来验证配置。

### 3. 运行
```bash
pnpm dev
```

---

## 📄 许可证

本项目遵循原项目的 [GNU Affero General Public License v3.0](LICENSE) 开源协议。
