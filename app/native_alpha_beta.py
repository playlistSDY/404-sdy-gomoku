from __future__ import annotations

import os
import subprocess
from pathlib import Path

BOARD_SIZE = 15
DEFAULT_BINARY = "/usr/local/bin/gomoku_alpha_beta"
LOCAL_BINARY = Path(__file__).resolve().parent.parent / "native" / "gomoku_alpha_beta"


def native_binary_path() -> Path | None:
    if os.getenv("GOMOKU_NATIVE_DISABLED") == "1":
        return None

    configured = Path(os.getenv("GOMOKU_NATIVE_ENGINE", DEFAULT_BINARY))
    if configured.exists() and os.access(configured, os.X_OK):
        return configured
    if LOCAL_BINARY.exists() and os.access(LOCAL_BINARY, os.X_OK):
        return LOCAL_BINARY
    return None


def native_timeout(difficulty: str) -> float:
    if difficulty == "easy":
        return 0.55
    if difficulty == "normal":
        return 0.9
    if difficulty == "hard":
        return 1.35
    return 1.8


def choose_alpha_beta_move_native(
    board: list[list[int]],
    ai_player: int,
    difficulty: str,
    forbidden_rule: str,
    tactic_style: str,
) -> dict | None:
    binary = native_binary_path()
    if not binary:
        return None

    cells = "".join(str(cell) for row in board for cell in row)
    if len(cells) != BOARD_SIZE * BOARD_SIZE:
        return None

    payload = f"{ai_player} {difficulty} {forbidden_rule} {tactic_style}\n{cells}\n"
    try:
        result = subprocess.run(
            [str(binary)],
            input=payload,
            capture_output=True,
            check=False,
            text=True,
            timeout=native_timeout(difficulty),
        )
    except (OSError, subprocess.SubprocessError):
        return None

    if result.returncode != 0:
        return None

    line = result.stdout.strip().splitlines()
    if not line or line[0] == "NONE":
        return None

    parts = line[0].split()
    if len(parts) < 2:
        return None

    try:
        row = int(parts[0])
        col = int(parts[1])
    except ValueError:
        return None

    if not (0 <= row < BOARD_SIZE and 0 <= col < BOARD_SIZE):
        return None

    move = {
        "row": row,
        "col": col,
        "reason": parts[2] if len(parts) > 2 else "search-native",
    }
    if len(parts) > 3:
        try:
            move["decision"] = {
                "mode": "native-alpha-beta",
                "searchScore": round(float(parts[3]), 2),
            }
        except ValueError:
            pass
    return move
