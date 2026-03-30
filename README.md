# OpenMAIC - Enhanced Version

<p align="center">
  <img src="assets/banner.png" alt="OpenMAIC Banner" width="680"/>
</p>

This repository is an enhanced version of the original **OpenMAIC** project, focusing on improving the course recording experience, stability, and API integration.

---

## 📖 About OpenMAIC (Original Project)

> [OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) (Open Multi-Agent Interactive Classroom) is an open-source AI platform that turns any topic or document into a rich, interactive classroom experience.
>
> **Key Highlights:**
> - **One-click lesson generation** from topics or materials.
> - **Multi-agent classroom** with AI teachers and peers.
> - **Rich scene types** including slides, quizzes, and HTML simulations.
> - **Whiteboard & TTS** for real-time visual and vocal explanations.
> - **Export capabilities** to `.pptx` and `.html`.

---

## ✨ New Enhancements

This version introduces several critical improvements to make the platform more robust for professional course creation:

### **1. Professional Recording System**
- **Automatic Full-screen Capture**: The PPT area now automatically enters full-screen mode during recording to ensure a clean, UI-free video output.
- **Audio-Visual Synchronization**: Fixed the "silent video" issue by pre-warming the browser's `AudioContext` and ensuring stable audio track capture from AI agents.
- **Robust Media Recording**:
    - Implemented a **1-second data chunking** strategy to prevent video corruption.
    - Added a **Silent Track Fallback** to keep the recorder active even before the teacher starts speaking.
- **Reliable Automatic Saving**: Optimized the download lifecycle (5s buffer) to ensure large video files are saved correctly to your local machine.

### **2. Enhanced TTS Integration**
- **Zhipu GLM-TTS Optimization**:
    - Fixed API header conflicts and default parameter issues for the GLM provider.
    - Improved error parsing to provide clearer feedback during voice synthesis failures.
    - Corrected default voice mapping to the high-quality `tongtong` (彤彤) model.

### **3. System Stability & Developer Experience**
- **SSR & Hydration Fixes**: Added hydration guards to prevent "client-side exception" crashes during initial page load in Next.js.
- **Windows Build Fix**: Resolved `EPERM` permission errors during the build process of internal packages (`pptxgenjs`) on Windows environments.
- **API Connectivity Suite**: Added a dedicated API testing tool (`api_test.py`) to verify LLM, Search, and TTS provider configurations instantly.

---

## 🚀 Quick Start

### 1. Clone & Install
```bash
git clone <your-repo-url>
cd OpenMAIC
pnpm install
```

### 2. Configure API
Copy `.env.example` to `.env.local` and fill in your keys. Use `python api_test.py` to verify your configuration.

### 3. Run
```bash
pnpm dev
```

---

## 📄 License

This project follows the original [GNU Affero General Public License v3.0](LICENSE).
