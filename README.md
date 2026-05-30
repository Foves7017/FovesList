# FovesList — 象限图待办事项

一个基于**四象限法则**（艾森豪威尔矩阵）的待办事项管理工具。每个事件按重要 / 紧急程度分布在二维坐标图上，一目了然。

---

## 快速开始

```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 启动后端
uvicorn middle:app --reload --port 23535

# 3. 打开浏览器
# http://localhost:23535/events
```

---

## 项目结构

```
FovesList/
├── middle.py              # FastAPI 后端入口，路由 + CORS
├── backend.py             # 核心逻辑：Event 类、增删改查、归档恢复
├── mcp_stdio.py           # MCP 服务器（供 Claude Desktop 等调用）
│
├── pages/
│   ├── index.html / css / js  # 象限图主页面
│   └── trash.html / css / js  # 回收站页面
│
├── json/
│   ├── Events.json            # 活跃事件存储（自动创建）
│   └── DeletedEvents.json     # 已归档事件存储（自动创建）
├── start_foveslist.bat    # 一键启动脚本
│
├── README.md              # 本文件
├── skill.md               # AI 使用工具提示词
└── ILINA_记忆.md          # AI 记忆文件
```

---

## 功能

### 象限图

| 操作 | 方式 |
|------|------|
| 查看事件 | 事件点 + 标题标签分布在四象限 |
| 悬停 | 虚线高亮环，显示 grab 光标 |
| 点击事件点 | 右侧滑出详情面板 |
| 双击空白 | 在对应位置新建事件 |
| 拖拽事件点 | 改变重要 / 紧急程度，松开自动保存 |
| 右击事件点 | 归档事件（无未完成子任务时） |
| 子任务卫星 | 绕父事件点旋转的小点，`~...~` 状态的隐藏 |

### 详情面板

| 操作 | 方式 |
|------|------|
| 编辑标题 | 点击标题 → 内联编辑 → Enter 保存 |
| 编辑描述 | 点击描述 → textarea → Ctrl+Enter 保存 |
| 子任务列表 | 显示 / 点击切换完成状态 |
| 右击子任务 | 删除（未完成需确认） |
| 添加子任务 | 点击 `+` 按钮 → 输入 → Enter 保存 |

### 回收站 (`/events/trash`)

- 卡片式列表，按象限着色
- 一键恢复事件
- 页面滚动条隐藏

### 主题

自动跟随系统亮色 / 暗色模式切换。

---

## API 路由

| 路径 | 方法 | 说明 |
|------|------|------|
| `/events` | GET | 象限图页面 |
| `/events/trash` | GET | 回收站页面 |
| `/events/list` | GET | 所有活跃事件 |
| `/events/add` | POST | 添加事件 |
| `/events/delete` | POST | 归档事件 |
| `/events/update` | POST | 修改事件属性 |
| `/events/deleted/list` | GET | 已归档事件列表 |
| `/events/deleted/restore` | POST | 恢复归档事件 |
| `/events/sub/add` | POST | 原子追加子任务 |
| `/events/sub/toggle` | POST | 原子切换子任务完成状态 |
| `/events/sub/remove` | POST | 原子删除子任务 |

---

## MCP 工具

参见 `mcp_stdio.py`，提供 11 个工具：

`add_event` · `delete_event` · `update_event` · `list_events` · `add_sub_event` · `remove_sub_event` · `toggle_sub_event` · `list_deleted_events` · `restore_event` · `check_status` · `open_dashboard`

启动方式：

```bash
fastmcp run mcp_stdio.py
```

---

## 技术栈

- **后端**：Python FastAPI + uvicorn
- **前端**：原生 HTML / CSS / JS，Canvas 绘图，无框架
- **存储**：JSON 文件（`json/Events.json` / `json/DeletedEvents.json`，目录自动创建）
- **MCP**：FastMCP

## 设计要点

子任务操作（add / toggle / remove）使用**原子化端点**：不经过 GET→本地修改→POST 的分离流程，而是由单一 POST 在 `threading.Lock` 内完成读-改-写全流程，避免并发竞态。5 并发测试无丢失。
