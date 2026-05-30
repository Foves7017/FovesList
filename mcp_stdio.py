"""
FovesList MCP Server
====================
封装象限图待办事项系统的后端接口为 MCP 工具，
供 Claude Desktop 等 MCP 客户端调用。

启动方式:
    fastmcp run mcp.py
    或
    python mcp.py

前置条件: 后端已启动 (uvicorn middle:app --port 23535)
"""

import json
import webbrowser
from datetime import datetime

import requests
from fastmcp import FastMCP

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------
BASE_URL = "http://localhost:23535"
EVENTS_URL = f"{BASE_URL}/events"

mcp = FastMCP("FovesList 象限图待办")


# ---------------------------------------------------------------------------
# 辅助函数
# ---------------------------------------------------------------------------
def _get_events() -> list[dict]:
    """获取当前所有事件"""
    r = requests.get(f"{EVENTS_URL}/list", timeout=5)
    r.raise_for_status()
    return r.json()


def _find_event(title: str) -> dict | None:
    """按标题查找事件"""
    events = _get_events()
    for ev in events:
        if ev["title"] == title:
            return ev
    return None


def _update(title: str, prop: str, value: str) -> dict:
    """通用更新"""
    r = requests.post(
        f"{EVENTS_URL}/update",
        data={"title": title, "prop_name": prop, "new_value": value},
        timeout=5,
    )
    if r.status_code == 409:
        raise ValueError(r.json().get("message", "重名冲突"))
    r.raise_for_status()
    return r.json()


# ---------------------------------------------------------------------------
# 工具：基础 CRUD
# ---------------------------------------------------------------------------
@mcp.tool()
def add_event(
    title: str,
    importence: float,
    urgency: float,
    description: str = "",
    sub_event: str = "[]",
) -> str:
    """
    添加一个新的待办事件到象限图中。

    Args:
        title: 事件标题（唯一，不可重复）
        importence: 重要程度，范围 -1.0（不重要）到 1.0（非常重要）
        urgency: 紧急程度，范围 -1.0（不紧急）到 1.0（非常紧急）
        description: 事件描述（可选）
        sub_event: 子任务列表，JSON 数组字符串，如 '["子任务A","子任务B"]'。默认为空数组

    Returns:
        操作结果描述
    """
    try:
        sub_list = json.loads(sub_event) if isinstance(sub_event, str) else (sub_event or [])
    except json.JSONDecodeError:
        return f"❌ sub_event 格式错误，应为 JSON 数组，如 '[\"任务A\",\"任务B\"]'"

    r = requests.post(
        f"{EVENTS_URL}/add",
        data={
            "title": title,
            "importence": str(importence),
            "urgency": str(urgency),
            "description": description,
            "sub_event": json.dumps(sub_list, ensure_ascii=False),
            "timestamp": str(int(datetime.now().timestamp())),
        },
        timeout=5,
    )
    if r.status_code == 409:
        return f"❌ 事件「{title}」已存在，请换一个标题"
    r.raise_for_status()
    return f"✅ 已添加事件「{title}」— 重要 {importence}，紧急 {urgency}"


@mcp.tool()
def delete_event(title: str) -> str:
    """
    删除（归档）一个事件。事件会被移动到 DeletedEvents.json，可在回收站恢复。

    Args:
        title: 要删除的事件标题

    Returns:
        操作结果描述
    """
    ev = _find_event(title)
    if ev is None:
        return f"❌ 未找到事件「{title}」"

    # 检查未完成子任务
    incomplete = [s for s in (ev.get("sub_event") or []) if not (s.startswith("~") and s.endswith("~"))]
    if incomplete:
        return f"⚠️ 事件「{title}」仍有 {len(incomplete)} 个未完成子任务，已取消删除"

    r = requests.post(f"{EVENTS_URL}/delete", data={"title": title}, timeout=5)
    if r.status_code == 404:
        return f"❌ 未找到事件「{title}」"
    r.raise_for_status()
    return f"🗑️ 已归档事件「{title}」，可在回收站恢复"


@mcp.tool()
def update_event(title: str, prop_name: str, new_value: str) -> str:
    """
    修改事件的某个属性。

    Args:
        title: 事件标题（用于定位）
        prop_name: 要修改的属性名，可选值：
                   - "title"       → 修改标题
                   - "importence"  → 修改重要程度 (-1.0 ~ 1.0)
                   - "urgency"     → 修改紧急程度 (-1.0 ~ 1.0)
                   - "description" → 修改描述
                   - "sub_event"   → 修改子任务列表 (JSON 数组字符串)
        new_value: 新的属性值

    Returns:
        操作结果描述
    """
    valid_props = ["title", "importence", "urgency", "description", "sub_event"]
    if prop_name not in valid_props:
        return f"❌ 无效属性「{prop_name}」，可选: {', '.join(valid_props)}"

    try:
        _update(title, prop_name, new_value)
    except ValueError as e:
        return f"❌ {e}"

    return f"✅ 已更新事件「{title}」的 {prop_name} → {new_value}"


@mcp.tool()
def list_events() -> str:
    """
    列出当前所有事件（含坐标、描述、子任务等完整信息）。

    Returns:
        JSON 格式的事件列表
    """
    events = _get_events()
    if not events:
        return "📭 当前没有事件"

    lines = [f"共 {len(events)} 个事件："]
    for ev in events:
        subs = ev.get("sub_event") or []
        lines.append(
            f"  • {ev['title']}  "
            f"[重要:{ev['importence']:.2f} 紧急:{ev['urgency']:.2f}]  "
            f"子任务:{len(subs)}  "
            f"{'📝' if ev.get('description') else ''}"
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 工具：子任务操作
# ---------------------------------------------------------------------------
@mcp.tool()
def add_sub_event(title: str, sub_title: str) -> str:
    """
    为指定事件添加一个子任务。

    Args:
        title: 父事件标题
        sub_title: 子任务名称

    Returns:
        操作结果描述
    """
    r = requests.post(
        f"{EVENTS_URL}/sub/add",
        data={"title": title, "sub_title": sub_title},
        timeout=5,
    )
    r.raise_for_status()
    return r.json().get("message", "未知结果")


@mcp.tool()
def remove_sub_event(title: str, sub_title: str) -> str:
    """
    删除某个事件的子任务（同时匹配未完成和已完成状态）。

    Args:
        title: 父事件标题
        sub_title: 要删除的子任务名称（不含 ~ 标记）

    Returns:
        操作结果描述
    """
    r = requests.post(
        f"{EVENTS_URL}/sub/remove",
        data={"title": title, "sub_title": sub_title},
        timeout=5,
    )
    r.raise_for_status()
    return r.json().get("message", "未知结果")


@mcp.tool()
def toggle_sub_event(title: str, sub_title: str) -> str:
    """
    切换子任务的完成/未完成状态。
    完成 → 未完成（去掉 ~）
    未完成 → 完成（加上 ~...~）

    Args:
        title: 父事件标题
        sub_title: 子任务名称（不含 ~ 标记）

    Returns:
        操作结果描述
    """
    r = requests.post(
        f"{EVENTS_URL}/sub/toggle",
        data={"title": title, "sub_title": sub_title},
        timeout=5,
    )
    r.raise_for_status()
    return r.json().get("message", "未知结果")


# ---------------------------------------------------------------------------
# 工具：回收站
# ---------------------------------------------------------------------------
@mcp.tool()
def list_deleted_events() -> str:
    """
    列出回收站中已归档的事件。

    Returns:
        JSON 格式的归档事件列表
    """
    r = requests.get(f"{EVENTS_URL}/deleted/list", timeout=5)
    r.raise_for_status()
    deleted = r.json()
    if not deleted:
        return "🗑️ 回收站空空如也"

    lines = [f"回收站共 {len(deleted)} 个事件："]
    for ev in deleted:
        lines.append(f"  • {ev['title']}  [重要:{ev['importence']:.2f} 紧急:{ev['urgency']:.2f}]")
    return "\n".join(lines)


@mcp.tool()
def restore_event(title: str) -> str:
    """
    从回收站恢复一个已归档的事件。

    Args:
        title: 要恢复的事件标题

    Returns:
        操作结果描述
    """
    r = requests.post(f"{EVENTS_URL}/deleted/restore", data={"title": title}, timeout=5)
    if r.status_code == 404:
        return f"❌ 回收站中未找到事件「{title}」"
    r.raise_for_status()
    return f"♻️ 已恢复事件「{title}」"


# ---------------------------------------------------------------------------
# 工具：系统
# ---------------------------------------------------------------------------
@mcp.tool()
def check_status() -> str:
    """
    检查后端服务是否在线。

    Returns:
        后端状态
    """
    try:
        r = requests.get(BASE_URL, timeout=3)
        r.raise_for_status()
        events = _get_events()
        return f"🟢 后端在线 — 当前 {len(events)} 个事件，服务正常"
    except requests.ConnectionError:
        return "🔴 后端离线 — 无法连接到 localhost:23535，请先启动 uvicorn middle:app --port 23535"
    except Exception as e:
        return f"🟡 后端异常 — {e}"


@mcp.tool()
def open_dashboard() -> str:
    """
    唤起系统默认浏览器打开象限图页面 (http://localhost:23535/events)。

    Returns:
        操作结果
    """
    url = f"{BASE_URL}/events"
    try:
        webbrowser.open(url)
        return f"🌐 已在浏览器中打开 {url}"
    except Exception as e:
        return f"❌ 无法打开浏览器: {e}。请手动访问 {url}"


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    mcp.run(transport='stdio')
