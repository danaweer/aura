"""Project catalog. Selecting a model never reassigns a physical device."""
import json
from pathlib import Path

PROJECT_IDS = ("atrium-building", "meeting-room")
PROJECT_ROOT = Path(__file__).resolve().parent / "projects"


def project_catalog(room):
    projects = []
    for project_id in PROJECT_IDS:
        project = json.loads((PROJECT_ROOT / project_id / "project.json").read_text(encoding="utf-8"))
        if project["id"] != project_id:
            raise ValueError(f"Project ID mismatch: {project_id}")
        if project_id == "meeting-room":
            project.update(name=room["name"], code=room["code"], room=room)
        projects.append(project)
    return {"default_project": "atrium-building", "projects": projects}
