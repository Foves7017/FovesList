import json, os
from typing import Any

JSON_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'json')
SAVE_NAME = os.path.join(JSON_DIR, 'Events.json')
DELETED_SAVE_NAME = os.path.join(JSON_DIR, 'DeletedEvents.json')

class Event:
    """ 待办清单的事件项 """
    def __init__(self, 
                 title: str, 
                 timestamp: float, 
                 description: str,
                 importence: float,
                 urgency: float,
                 sub_event: list[str] = [],
                 ):
        self.title = title
        self.timestamp = timestamp
        self.description = description
        self.importence = importence
        self.urgency = urgency
        self.sub_event = sub_event
    
    @classmethod
    def from_event(cls, event: "Event") -> "Event":
        return cls(
            title=event.title,
            timestamp=event.timestamp,
            description=event.description,
            importence=event.importence,
            urgency=event.urgency,
            sub_event=event.sub_event,
        )

    @classmethod
    def from_json(cls, json_obj: dict) -> "Event":
        return cls(
            title=json_obj['title'],
            timestamp=json_obj['timestamp'],
            description=json_obj['description'],
            importence=json_obj['importence'],
            urgency=json_obj['urgency'],
            sub_event=json_obj['sub_event'],
        )

    def to_json(self) -> dict:
        return {
            'title': self.title,
            'timestamp': self.timestamp,
            'description': self.description,
            'importence': self.importence,
            'urgency': self.urgency,
            'sub_event': self.sub_event,
        }

def load_events_from_database() -> list[Event]:
    try:
        os.makedirs(JSON_DIR, exist_ok=True)
        with open(SAVE_NAME, 'r', encoding='UTF8') as f:
            return [Event.from_json(json_obj) for json_obj in json.load(f)]
    except FileNotFoundError:
        return []

def save_events_to_database(events: list[Event]):
    os.makedirs(JSON_DIR, exist_ok=True)
    with open(SAVE_NAME, 'w', encoding='UTF8') as f:
        json.dump([event.to_json() for event in events], f, ensure_ascii=False, indent=4)

def add_event(
        title: str,
        timestamp: float,
        description: str,
        importence: float,
        urgency: float,
        sub_event: list[str] = [],
        ):
    events = load_events_from_database()
    events.append(Event(
        title=title,
        timestamp=timestamp,
        description=description,
        importence=importence,
        urgency=urgency,
        sub_event=sub_event,
    ))
    save_events_to_database(events)

def _load_deleted() -> list[Event]:
    try:
        os.makedirs(JSON_DIR, exist_ok=True)
        with open(DELETED_SAVE_NAME, 'r', encoding='UTF8') as f:
            return [Event.from_json(obj) for obj in json.load(f)]
    except FileNotFoundError:
        return []

def _save_deleted(deleted: list[Event]):
    os.makedirs(JSON_DIR, exist_ok=True)
    with open(DELETED_SAVE_NAME, 'w', encoding='UTF8') as f:
        json.dump([e.to_json() for e in deleted], f, ensure_ascii=False, indent=4)

def delete_event(title: str):
    events = load_events_from_database()
    target = None
    remaining = []
    for e in events:
        if e.title == title:
            target = e
        else:
            remaining.append(e)
    if target is None:
        return  # 没找到，无事发生

    deleted = _load_deleted()
    deleted.append(target)
    _save_deleted(deleted)

    save_events_to_database(remaining)

def update_event(title: str, prop_name: str, new_value: Any):
    events = load_events_from_database()
    for i, event in enumerate(events):
        if event.title == title:
            new_event = Event.from_event(event)
            setattr(new_event, prop_name, new_value)
            events[i] = new_event
            break
    save_events_to_database(events)


def list_deleted_events() -> list[Event]:
    return _load_deleted()


def restore_event(title: str) -> Event | None:
    deleted = _load_deleted()
    target = None
    remaining = []
    for e in deleted:
        if e.title == title:
            target = e
        else:
            remaining.append(e)
    if target is None:
        return None

    _save_deleted(remaining)

    events = load_events_from_database()
    events.append(target)
    save_events_to_database(events)
    return target
