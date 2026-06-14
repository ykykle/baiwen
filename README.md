# AI Chat Assistant

网页端 AI 对话助手，复刻千问核心体验。

## ✨ 功能特性

- 🗣️ **多轮对话** — 上下文感知的连续对话，支持 Markdown 渲染
- 📂 **多对话管理** — 侧边栏管理多个独立对话，可重命名/删除
- ⚡ **流式输出** — SSE 实时逐字显示，思考过程可视化
- 🧠 **模式切换** — 快速模式 / 深度思考模式一键切换
## 🚀 快速启动

```bash
# 1. 安装依赖
cd backend && pip install -r requirements.txt

# 2. 设置 API Key (或在.env 文件中配置)
export ANTHROPIC_API_KEY="sk-ant-xxxxxxxxxxxxx"

# 3. 启动服务
python main.py

# 4. 打开浏览器访问
# http://localhost:8001
```

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Python FastAPI + Langchain |
| 前端 | Vanilla HTML/CSS/JS + marked.js + highlight.js |
| AI | DeepSeek V4 (Flash / Pro) |

## 📁 项目结构

```
baiwen/
├── backend/          # FastAPI 后端服务
├── frontend/         # 前端静态资源
│   ├── css/          # 样式文件
│   └── js/           # JS 模块
├── docs/             # 项目文档
└── README.md
```

## 🎯 设计原则

- **零构建**：前端无需编译，开箱即用
- **模块化**：JS 按功能分模块，职责清晰
- **可扩展**：RESTful API 设计，易于对接其他前端框架
