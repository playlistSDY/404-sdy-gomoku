from __future__ import annotations

import os
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response

from .gomoku_engine import (
    BLACK,
    DEFAULT_DIFFICULTY,
    DEFAULT_FORBIDDEN_RULE,
    WHITE,
    choose_server_move,
    create_board,
    get_winner,
    is_forbidden_move,
    normalize_difficulty,
    normalize_forbidden_rule,
    other_player,
    place_move,
    serialize_move,
)

PORT = int(os.getenv("PORT", "5195"))
CORS_ORIGIN = os.getenv("CORS_ORIGIN", "*")
ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DIR = ROOT / "public"
PUBLIC_ROOT = PUBLIC_DIR.resolve()

sessions: dict[str, dict[str, Any]] = {}

app = FastAPI(title="sdy-gomoku")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[CORS_ORIGIN] if CORS_ORIGIN != "*" else ["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


def normalize_session_options(options: dict[str, Any] | None = None) -> dict[str, str]:
    options = options or {}
    nested = options.get("options") if isinstance(options.get("options"), dict) else {}
    return {
        "difficulty": normalize_difficulty(options.get("difficulty") or nested.get("difficulty") or DEFAULT_DIFFICULTY),
        "forbiddenRule": normalize_forbidden_rule(
            options.get("forbiddenRule") or nested.get("forbiddenRule") or DEFAULT_FORBIDDEN_RULE
        ),
    }


def update_session_options(session: dict[str, Any], options: dict[str, Any]) -> None:
    current = session.get("options", normalize_session_options())
    merged = {
        "difficulty": options.get("difficulty", current["difficulty"]),
        "forbiddenRule": options.get("forbiddenRule", current["forbiddenRule"]),
    }
    session["options"] = normalize_session_options(merged)


def make_server_move(session: dict[str, Any]) -> None:
    options = session.get("options", normalize_session_options())
    server_move = choose_server_move(
        session["board"],
        session["serverPlayer"],
        difficulty=options["difficulty"],
        forbidden_rule=options["forbiddenRule"],
    )
    if not server_move:
        return

    place_move(session["board"], server_move["row"], server_move["col"], session["serverPlayer"])
    session["history"].append(
        {
            "player": session["serverPlayer"],
            "reason": server_move["reason"],
            "row": server_move["row"],
            "col": server_move["col"],
            "source": "server",
            "notation": serialize_move(server_move),
        }
    )
    finish_if_needed(session)


def create_session(options: dict[str, Any] | None = None) -> dict[str, Any]:
    options = options or {}
    session_options = normalize_session_options(options)
    human_player = BLACK
    if options.get("humanPlayer") in (WHITE, "white"):
        human_player = WHITE
    if options.get("humanPlayer") == "random" or options.get("randomSide") is True:
        human_player = BLACK if os.urandom(1)[0] > 127 else WHITE

    session = {
        "id": str(uuid4()),
        "board": create_board(),
        "currentPlayer": BLACK,
        "history": [],
        "humanPlayer": human_player,
        "options": session_options,
        "serverPlayer": other_player(human_player),
        "status": "playing",
        "winner": None,
        "winLine": [],
    }

    if session["currentPlayer"] == session["serverPlayer"]:
        make_server_move(session)
        if session["status"] == "playing":
            session["currentPlayer"] = session["humanPlayer"]

    sessions[session["id"]] = session
    return session


def public_session(session: dict[str, Any]) -> dict[str, Any]:
    return {
        "board": session["board"],
        "currentPlayer": session["currentPlayer"],
        "history": session["history"],
        "humanPlayer": session["humanPlayer"],
        "id": session["id"],
        "options": session.get("options", normalize_session_options()),
        "serverPlayer": session["serverPlayer"],
        "status": session["status"],
        "winner": session["winner"],
        "winLine": session["winLine"],
    }


def finish_if_needed(session: dict[str, Any]) -> bool:
    result = get_winner(session["board"])
    if not result:
        return False
    session["status"] = "finished"
    session["winner"] = result["winner"]
    session["winLine"] = result["line"]
    return True


async def read_json_body(request: Request) -> dict[str, Any]:
    body = await request.body()
    if not body:
        return {}
    return await request.json()


def json_error(status_code: int, message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status_code)


@app.post("/api/new")
async def new_session(request: Request) -> JSONResponse:
    body = await read_json_body(request)
    return JSONResponse(public_session(create_session(body)))


@app.post("/api/options")
async def options_update(request: Request) -> JSONResponse:
    body = await read_json_body(request)
    session = sessions.get(body.get("sessionId"))
    if not session:
        return json_error(404, "Session not found.")
    if session["status"] != "playing":
        return json_error(409, "Match is already finished.")

    update_session_options(session, body)
    return JSONResponse(public_session(session))


@app.post("/api/move")
async def move(request: Request) -> JSONResponse:
    try:
        body = await read_json_body(request)
        session = sessions.get(body.get("sessionId"))
        if not session:
            return json_error(404, "Session not found.")
        if session["status"] != "playing":
            return json_error(409, "Match is already finished.")
        if session["currentPlayer"] != session["humanPlayer"]:
            return json_error(409, "Server is already moving.")

        row = int(body.get("row"))
        col = int(body.get("col"))
        options = session.get("options", normalize_session_options())
        if is_forbidden_move(session["board"], row, col, session["humanPlayer"], options["forbiddenRule"]):
            return json_error(400, "금수입니다.")

        place_move(session["board"], row, col, session["humanPlayer"])
        session["history"].append(
            {
                "player": session["humanPlayer"],
                "row": row,
                "col": col,
                "source": "human",
                "notation": serialize_move({"row": row, "col": col}),
            }
        )

        if not finish_if_needed(session):
            session["currentPlayer"] = session["serverPlayer"]
            make_server_move(session)
            if session["status"] == "playing":
                session["currentPlayer"] = session["humanPlayer"]

        return JSONResponse(public_session(session))
    except Exception as error:
        return json_error(400, str(error))


@app.post("/api/undo")
async def undo(request: Request) -> JSONResponse:
    body = await read_json_body(request)
    session = sessions.get(body.get("sessionId"))
    if not session:
        return json_error(404, "Session not found.")

    removed = []
    while session["history"] and len(removed) < 2:
        move = session["history"].pop()
        session["board"][move["row"]][move["col"]] = 0
        removed.append(move)
        if move["source"] == "human":
            break

    session["status"] = "playing"
    session["winner"] = None
    session["winLine"] = []
    session["currentPlayer"] = session["humanPlayer"]
    return JSONResponse(public_session(session))


@app.get("/api/state")
async def state(id: str) -> JSONResponse:
    session = sessions.get(id)
    if not session:
        return json_error(404, "Session not found.")
    return JSONResponse(public_session(session))


@app.options("/{path:path}")
async def options(path: str) -> Response:
    return Response(status_code=204)


def should_serve_not_found_page(request: Request, path: str) -> bool:
    if request.method != "GET":
        return False
    if Path(path).suffix:
        return False
    accept = request.headers.get("accept", "")
    return not accept or "text/html" in accept or "*/*" in accept


def file_response(path: Path, status_code: int = 200) -> FileResponse:
    return FileResponse(path, status_code=status_code, headers={"Cache-Control": "no-store"})


@app.get("/")
async def index() -> FileResponse:
    return file_response(PUBLIC_DIR / "index.html")


@app.get("/{path:path}")
async def static_or_404(path: str, request: Request):
    requested = (PUBLIC_ROOT / path).resolve()

    try:
        requested.relative_to(PUBLIC_ROOT)
    except ValueError:
        return PlainTextResponse("Forbidden", status_code=403)

    if requested.is_file():
        return file_response(requested)

    if should_serve_not_found_page(request, path):
        return file_response(PUBLIC_DIR / "index.html", status_code=404)

    return PlainTextResponse("Not found", status_code=404)
