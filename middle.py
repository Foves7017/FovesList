import os, json, fastapi
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from backend import *

BASE_DIR = r'D:\Find-A-Way-VII\FovesList'

app = fastapi.FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def read_root():
    return {"Hello": "World"}

@app.get("/events")
async def event_page():
    return FileResponse(os.path.join(BASE_DIR, "pages", "index.html"))

@app.get("/index.css")
async def index_css():
    return FileResponse(os.path.join(BASE_DIR, "pages", "index.css"), media_type="text/css")

@app.get("/index.js")
async def index_js():
    return FileResponse(os.path.join(BASE_DIR, "pages", "index.js"), media_type="application/javascript")

@app.get("/events/trash")
async def trash_page():
    return FileResponse(os.path.join(BASE_DIR, "pages", "trash.html"))

@app.get("/trash.css")
async def trash_css():
    return FileResponse(os.path.join(BASE_DIR, "pages", "trash.css"), media_type="text/css")

@app.get("/trash.js")
async def trash_js():
    return FileResponse(os.path.join(BASE_DIR, "pages", "trash.js"), media_type="application/javascript")

@app.get("/events/deleted/list")
async def list_deleted():
    return list_deleted_events()

@app.post("/events/deleted/restore")
async def restore_event_(title: str = fastapi.Form()):
    result = restore_event(title)
    if result is None:
        return fastapi.responses.JSONResponse(
            status_code=404,
            content={"status": "error", "message": f"未找到归档事件「{title}」"}
        )
    return {"status": "success", "event": result.to_json()}

@app.get("/events/list")
async def list_events():
    return load_events_from_database()

@app.post("/events/add")
async def add_event_(
        title: str = fastapi.Form(),
        timestamp: float = fastapi.Form(),
        description: str = fastapi.Form(),
        importence: float = fastapi.Form(),
        urgency: float = fastapi.Form(),
        sub_event: str = fastapi.Form(default="[]"),
        ):
    # 检查重名
    events = load_events_from_database()
    if any(e.title == title for e in events):
        return fastapi.responses.JSONResponse(
            status_code=409,
            content={"status": "error", "message": f"事件「{title}」已存在"}
        )
    sub_event_list = json.loads(sub_event) if sub_event else []
    add_event(title, timestamp, description, importence, urgency, sub_event_list)
    return {"status": "success"}

@app.post("/events/delete")
async def delete_event_(title: str = fastapi.Form()):
    delete_event(title)
    return {"status": "success"}

@app.post("/events/update")
async def update_event_(
    title: str = fastapi.Form(),
    prop_name: str = fastapi.Form(),
    new_value: str = fastapi.Form(),
):
    if prop_name in ("importence", "urgency", "timestamp"):
        val = float(new_value)
    elif prop_name == "sub_event":
        val = json.loads(new_value)
    elif prop_name in ("title", "description"):
        val = new_value
    else:
        return {"status": "error", "message": f"Unknown prop: {prop_name}"}

    # 改标题时检查重名
    if prop_name == "title" and val != title:
        events = load_events_from_database()
        if any(e.title == val for e in events):
            return fastapi.responses.JSONResponse(
                status_code=409,
                content={"status": "error", "message": f"事件「{val}」已存在"}
            )

    update_event(title, prop_name, val)
    return {"status": "success"}

# uvicorn middle:app --reload --port 23535