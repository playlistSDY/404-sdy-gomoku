from __future__ import annotations

import math
import time

BOARD_SIZE = 15
EMPTY = 0
BLACK = 1
WHITE = 2

DIRECTIONS = ((1, 0), (0, 1), (1, 1), (1, -1))
WIN_SCORE = 1_000_000_000
SEARCH_TIME_SECONDS = 1.1
ROOT_MOVE_LIMIT = 22
BRANCH_MOVE_LIMIT = 12
LEAF_MOVE_LIMIT = 18


def create_board() -> list[list[int]]:
    return [[EMPTY for _ in range(BOARD_SIZE)] for _ in range(BOARD_SIZE)]


def other_player(player: int) -> int:
    return WHITE if player == BLACK else BLACK


def is_inside(row: int, col: int) -> bool:
    return 0 <= row < BOARD_SIZE and 0 <= col < BOARD_SIZE


def validate_board(board: list[list[int]]) -> bool:
    return (
        isinstance(board, list)
        and len(board) == BOARD_SIZE
        and all(
            isinstance(row, list)
            and len(row) == BOARD_SIZE
            and all(cell in (EMPTY, BLACK, WHITE) for cell in row)
            for row in board
        )
    )


def place_move(board: list[list[int]], row: int, col: int, player: int) -> None:
    if not is_inside(row, col):
        raise ValueError("Move is outside the board.")
    if board[row][col] != EMPTY:
        raise ValueError("Intersection is already occupied.")
    board[row][col] = player


def get_winner(board: list[list[int]]) -> dict | None:
    for row in range(BOARD_SIZE):
        for col in range(BOARD_SIZE):
            player = board[row][col]
            if player == EMPTY:
                continue

            for dr, dc in DIRECTIONS:
                prev_row = row - dr
                prev_col = col - dc
                if is_inside(prev_row, prev_col) and board[prev_row][prev_col] == player:
                    continue

                line = []
                next_row = row
                next_col = col
                while is_inside(next_row, next_col) and board[next_row][next_col] == player:
                    line.append({"row": next_row, "col": next_col})
                    next_row += dr
                    next_col += dc

                if len(line) >= 5:
                    return {"winner": player, "line": line[:5]}

    full = all(cell != EMPTY for row in board for cell in row)
    return {"winner": 3, "line": []} if full else None


def get_candidates(board: list[list[int]], radius: int = 2) -> list[dict]:
    candidates: dict[tuple[int, int], dict] = {}
    has_stone = False

    for row in range(BOARD_SIZE):
        for col in range(BOARD_SIZE):
            if board[row][col] == EMPTY:
                continue
            has_stone = True
            for dr in range(-radius, radius + 1):
                for dc in range(-radius, radius + 1):
                    next_row = row + dr
                    next_col = col + dc
                    if not is_inside(next_row, next_col) or board[next_row][next_col] != EMPTY:
                        continue
                    candidates[(next_row, next_col)] = {"row": next_row, "col": next_col}

    if not has_stone:
        center = BOARD_SIZE // 2
        return [{"row": center, "col": center}]

    center = (BOARD_SIZE - 1) / 2
    return sorted(
        candidates.values(),
        key=lambda item: abs(item["row"] - center) + abs(item["col"] - center),
    )


def count_stones(board: list[list[int]]) -> int:
    return sum(1 for row in board for cell in row if cell != EMPTY)


def opening_move(board: list[list[int]], candidates: list[dict]) -> dict | None:
    stones = count_stones(board)
    center_index = BOARD_SIZE // 2
    if stones <= 1 and board[center_index][center_index] == EMPTY:
        return {"row": center_index, "col": center_index, "reason": "opening"}
    if stones > 1:
        return None

    ordered = sorted(
        candidates,
        key=lambda item: (
            abs(item["row"] - center_index) + abs(item["col"] - center_index),
            abs(item["row"] - item["col"]),
        ),
    )
    return {**ordered[0], "reason": "opening"} if ordered else None


def directional_run(board: list[list[int]], row: int, col: int, player: int, dr: int, dc: int) -> dict:
    forward = 0
    backward = 0

    r = row + dr
    c = col + dc
    while is_inside(r, c) and board[r][c] == player:
        forward += 1
        r += dr
        c += dc
    open_forward = is_inside(r, c) and board[r][c] == EMPTY

    r = row - dr
    c = col - dc
    while is_inside(r, c) and board[r][c] == player:
        backward += 1
        r -= dr
        c -= dc
    open_backward = is_inside(r, c) and board[r][c] == EMPTY

    return {
        "length": forward + backward + 1,
        "openEnds": int(open_forward) + int(open_backward),
    }


def score_pattern(length: int, open_ends: int) -> int:
    if length >= 5:
        return 100_000_000
    if length == 4 and open_ends == 2:
        return 5_000_000
    if length == 4 and open_ends == 1:
        return 850_000
    if length == 3 and open_ends == 2:
        return 180_000
    if length == 3 and open_ends == 1:
        return 25_000
    if length == 2 and open_ends == 2:
        return 9_000
    if length == 2 and open_ends == 1:
        return 1_200
    if length == 1 and open_ends == 2:
        return 180
    return 8


def score_broken_pattern(board: list[list[int]], row: int, col: int, player: int, dr: int, dc: int) -> int:
    score = 0
    for offset in range(-4, 1):
        stones = 0
        empties = 0
        valid = True
        for index in range(5):
            r = row + (offset + index) * dr
            c = col + (offset + index) * dc
            if not is_inside(r, c):
                valid = False
                break
            cell = player if r == row and c == col else board[r][c]
            if cell == player:
                stones += 1
            elif cell == EMPTY:
                empties += 1
            else:
                valid = False
                break
        if not valid:
            continue
        if stones == 4 and empties == 1:
            score += 260_000
        if stones == 3 and empties == 2:
            score += 17_000
        if stones == 2 and empties == 3:
            score += 850
    return score


def count_line_windows(
    board: list[list[int]],
    row: int,
    col: int,
    player: int,
    dr: int,
    dc: int,
    target_stones: int,
    target_empties: int,
) -> int:
    count = 0
    for offset in range(-4, 1):
        stones = 0
        empties = 0
        valid = True
        for index in range(5):
            r = row + (offset + index) * dr
            c = col + (offset + index) * dc
            if not is_inside(r, c):
                valid = False
                break
            cell = player if r == row and c == col else board[r][c]
            if cell == player:
                stones += 1
            elif cell == EMPTY:
                empties += 1
            else:
                valid = False
                break
        if valid and stones == target_stones and empties == target_empties:
            count += 1
    return count


def get_line_pattern(board: list[list[int]], row: int, col: int, player: int, dr: int, dc: int) -> str:
    chars = []
    for offset in range(-4, 5):
        r = row + offset * dr
        c = col + offset * dc
        if not is_inside(r, c):
            chars.append("B")
        elif r == row and c == col:
            chars.append("O")
        elif board[r][c] == EMPTY:
            chars.append("_")
        elif board[r][c] == player:
            chars.append("O")
        else:
            chars.append("B")
    return "".join(chars)


def has_five(pattern: str) -> bool:
    return "OOOOO" in pattern


def has_open_four(pattern: str) -> bool:
    return "_OOOO_" in pattern


def has_four(pattern: str) -> bool:
    for start in range(len(pattern) - 4):
        window = pattern[start : start + 5]
        if "B" not in window and window.count("O") == 4 and window.count("_") == 1:
            return True
    return False


def count_moves_creating(pattern: str, predicate) -> int:
    count = 0
    for index, char in enumerate(pattern):
        if char != "_":
            continue
        next_pattern = f"{pattern[:index]}O{pattern[index + 1:]}"
        if predicate(next_pattern):
            count += 1
    return count


def has_open_three(pattern: str) -> bool:
    if count_moves_creating(pattern, has_open_four) >= 2:
        return True
    return any(shape in pattern for shape in ("_OO_O_", "_O_OO_"))


def has_broken_three(pattern: str) -> bool:
    return count_moves_creating(pattern, has_four) >= 1


def has_open_two(pattern: str) -> bool:
    return count_moves_creating(pattern, has_open_three) >= 2


def classify_line_pattern(pattern: str) -> str:
    if has_five(pattern):
        return "five"
    if has_open_four(pattern):
        return "open_four"
    if has_four(pattern):
        return "four"
    if has_open_three(pattern):
        return "open_three"
    if has_broken_three(pattern):
        return "broken_three"
    if has_open_two(pattern):
        return "open_two"
    return "quiet"


def threat_summary(board: list[list[int]], row: int, col: int, player: int) -> dict:
    open_fours = 0
    fours = 0
    open_threes = 0
    broken_threes = 0
    open_twos = 0
    direct_five = False

    for dr, dc in DIRECTIONS:
        shape = classify_line_pattern(get_line_pattern(board, row, col, player, dr, dc))
        if shape == "five":
            direct_five = True
        elif shape == "open_four":
            open_fours += 1
            fours += 1
        elif shape == "four":
            fours += 1
        elif shape == "open_three":
            open_threes += 1
        elif shape == "broken_three":
            broken_threes += 1
        elif shape == "open_two":
            open_twos += 1

    double_four = open_fours + fours >= 2
    four_three = open_fours + fours >= 1 and open_threes + broken_threes >= 1
    double_three = open_threes >= 2 or (open_threes >= 1 and broken_threes >= 1)

    forcing = (
        direct_five
        or open_fours > 0
        or double_four
        or four_three
        or double_three
    )

    rank = (
        int(direct_five) * WIN_SCORE
        + open_fours * 100_000_000
        + int(double_four) * 90_000_000
        + int(four_three) * 80_000_000
        + int(double_three) * 30_000_000
        + fours * 10_000_000
        + open_threes * 500_000
        + broken_threes * 100_000
        + open_twos * 10_000
    )

    return {
        "brokenThrees": broken_threes,
        "directFive": direct_five,
        "doubleFour": double_four,
        "doubleThree": double_three,
        "fourThree": four_three,
        "forcing": forcing,
        "fours": fours,
        "openFours": open_fours,
        "openThrees": open_threes,
        "openTwos": open_twos,
        "rank": rank,
    }


def score_move(board: list[list[int]], row: int, col: int, player: int) -> float:
    if not is_inside(row, col) or board[row][col] != EMPTY:
        return -math.inf

    threat = threat_summary(board, row, col, player)
    center = (BOARD_SIZE - 1) / 2
    center_distance = abs(row - center) + abs(col - center)
    return threat["rank"] + max(0, 20 - center_distance) * 9


def winning_move(board: list[list[int]], candidate: dict, player: int) -> bool:
    row = candidate["row"]
    col = candidate["col"]
    if board[row][col] != EMPTY:
        return False

    board[row][col] = player
    result = get_winner(board)
    board[row][col] = EMPTY
    return bool(result and result["winner"] == player)


def immediate_winning_moves(board: list[list[int]], player: int, candidates: list[dict] | None = None) -> list[dict]:
    return [
        candidate
        for candidate in (candidates or get_candidates(board, 2))
        if winning_move(board, candidate, player)
    ]


def threat_priority(threat: dict) -> int:
    if threat["directFive"]:
        return 6
    if threat["openFours"] > 0:
        return 5
    if threat["doubleFour"] or threat["fourThree"]:
        return 4
    if threat["doubleThree"]:
        return 3
    if threat["openThrees"] > 0:
        return 2
    if threat["brokenThrees"] > 0:
        return 1
    return 0


def candidate_score(board: list[list[int]], candidate: dict, player: int, defending_player: int | None = None) -> dict:
    if defending_player is None:
        defending_player = other_player(player)
    attack = score_move(board, candidate["row"], candidate["col"], player)
    defense = score_move(board, candidate["row"], candidate["col"], defending_player)
    threat = threat_summary(board, candidate["row"], candidate["col"], player)
    defense_threat = threat_summary(board, candidate["row"], candidate["col"], defending_player)
    return {
        **candidate,
        "attack": attack,
        "defense": defense,
        "defenseThreat": defense_threat,
        "priority": threat_priority(threat),
        "score": attack + defense * 1.16 + threat["rank"] * 0.24 + defense_threat["rank"] * 0.16,
        "threat": threat,
    }


def ordered_moves(board: list[list[int]], player: int, limit: int = BRANCH_MOVE_LIMIT) -> list[dict]:
    opponent = other_player(player)
    moves = [candidate_score(board, candidate, player, opponent) for candidate in get_candidates(board, 2)]
    return sorted(moves, key=lambda item: (-item["score"], -item["defense"], -item["attack"]))[:limit]


def find_threat_space_move(board: list[list[int]], ai_player: int) -> dict | None:
    human_player = other_player(ai_player)
    candidates = get_candidates(board, 2)
    ai_threats = [
        item
        for item in (candidate_score(board, candidate, ai_player, human_player) for candidate in candidates)
        if item["threat"]["forcing"]
    ]
    ai_threats.sort(key=lambda item: (-item["priority"], -item["threat"]["rank"], -item["score"]))

    human_threats = [
        item
        for item in (candidate_score(board, candidate, human_player, ai_player) for candidate in candidates)
        if item["threat"]["forcing"]
    ]
    human_threats.sort(key=lambda item: (-item["priority"], -item["threat"]["rank"], -item["score"]))

    ai_best = ai_threats[0] if ai_threats else None
    human_best = human_threats[0] if human_threats else None

    if human_best and (
        not ai_best
        or human_best["priority"] > ai_best["priority"]
        or (
            human_best["priority"] == ai_best["priority"]
            and human_best["threat"]["rank"] >= ai_best["threat"]["rank"] * 0.88
        )
    ):
        return {**human_best, "reason": "contain"}
    if ai_best:
        return {**ai_best, "reason": "threat"}

    return None


def pick_tactical(scored_moves: list[dict], predicate, reason: str) -> dict | None:
    moves = [move for move in scored_moves if predicate(move["threat"])]
    if not moves:
        return None
    moves.sort(key=lambda item: (-item["priority"], -item["threat"]["rank"], -item["score"]))
    return {"row": moves[0]["row"], "col": moves[0]["col"], "reason": reason}


def find_tactical_move(board: list[list[int]], ai_player: int) -> dict | None:
    human_player = other_player(ai_player)
    candidates = get_candidates(board, 2)
    ai_moves = [candidate_score(board, candidate, ai_player, human_player) for candidate in candidates]
    human_moves = [candidate_score(board, candidate, human_player, ai_player) for candidate in candidates]

    own_open_four = pick_tactical(ai_moves, lambda threat: threat["openFours"] > 0, "open-four")
    if own_open_four:
        return own_open_four

    block_open_four = pick_tactical(human_moves, lambda threat: threat["openFours"] > 0, "block-open-four")
    if block_open_four:
        return block_open_four

    own_severe = pick_tactical(
        ai_moves,
        lambda threat: threat["doubleFour"] or threat["fourThree"],
        "force",
    )
    if own_severe:
        return own_severe

    block_severe = pick_tactical(
        human_moves,
        lambda threat: threat["doubleFour"] or threat["fourThree"],
        "contain",
    )
    if block_severe:
        return block_severe

    own_double_three = pick_tactical(ai_moves, lambda threat: threat["doubleThree"], "double-three")
    if own_double_three:
        return own_double_three

    block_double_three = pick_tactical(human_moves, lambda threat: threat["doubleThree"], "contain")
    if block_double_three:
        return block_double_three

    return None


def best_threat_rank(board: list[list[int]], player: int) -> int:
    threats = (
        threat_summary(board, candidate["row"], candidate["col"], player)
        for candidate in get_candidates(board, 2)
    )
    return max((threat["rank"] for threat in threats), default=0)


def opponent_safety_penalty(board: list[list[int]], move: dict, ai_player: int) -> float:
    human_player = other_player(ai_player)
    board[move["row"]][move["col"]] = ai_player
    try:
        if immediate_winning_moves(board, human_player):
            return WIN_SCORE * 2
        return best_threat_rank(board, human_player) * 0.55
    finally:
        board[move["row"]][move["col"]] = EMPTY


def evaluate_board(board: list[list[int]], ai_player: int) -> float:
    result = get_winner(board)
    if result and result["winner"] == ai_player:
        return WIN_SCORE
    if result and result["winner"] == other_player(ai_player):
        return -WIN_SCORE
    if result and result["winner"] == 3:
        return 0

    human_player = other_player(ai_player)
    candidates = get_candidates(board, 2)
    if not candidates:
        return 0

    ai_scores = sorted((candidate_score(board, item, ai_player, human_player)["score"] for item in candidates), reverse=True)
    human_scores = sorted((candidate_score(board, item, human_player, ai_player)["score"] for item in candidates), reverse=True)

    def weighted(scores: list[float]) -> float:
        return (scores[0] if len(scores) > 0 else 0) + (scores[1] if len(scores) > 1 else 0) * 0.38 + (scores[2] if len(scores) > 2 else 0) * 0.18

    return weighted(ai_scores) - weighted(human_scores) * 1.08


def minimax(
    board: list[list[int]],
    depth: int,
    alpha: float,
    beta: float,
    current_player: int,
    ai_player: int,
    deadline: float,
) -> dict:
    if time.monotonic() > deadline:
        return {"score": evaluate_board(board, ai_player), "timedOut": True}

    result = get_winner(board)
    if result and result["winner"] == ai_player:
        return {"score": WIN_SCORE + depth, "timedOut": False}
    if result and result["winner"] == other_player(ai_player):
        return {"score": -WIN_SCORE - depth, "timedOut": False}
    if result and result["winner"] == 3:
        return {"score": 0, "timedOut": False}
    winning_moves = immediate_winning_moves(board, current_player)
    if winning_moves:
        score = WIN_SCORE + depth if current_player == ai_player else -WIN_SCORE - depth
        return {"score": score, "timedOut": False}
    if depth == 0:
        return {"score": evaluate_board(board, ai_player), "timedOut": False}

    maximizing = current_player == ai_player
    moves = ordered_moves(board, current_player, BRANCH_MOVE_LIMIT if depth >= 2 else LEAF_MOVE_LIMIT)
    if not moves:
        return {"score": evaluate_board(board, ai_player), "timedOut": False}

    best_score = -math.inf if maximizing else math.inf
    timed_out = False

    for move in moves:
        board[move["row"]][move["col"]] = current_player
        child = minimax(board, depth - 1, alpha, beta, other_player(current_player), ai_player, deadline)
        board[move["row"]][move["col"]] = EMPTY
        timed_out = timed_out or child.get("timedOut", False)

        if maximizing:
            best_score = max(best_score, child["score"])
            alpha = max(alpha, best_score)
        else:
            best_score = min(best_score, child["score"])
            beta = min(beta, best_score)

        if beta <= alpha or timed_out:
            break

    return {"score": best_score, "timedOut": timed_out}


def choose_alpha_beta_move(board: list[list[int]], ai_player: int) -> dict | None:
    deadline = time.monotonic() + SEARCH_TIME_SECONDS
    root_moves = ordered_moves(board, ai_player, ROOT_MOVE_LIMIT)
    if root_moves:
        for move in root_moves:
            move["safetyPenalty"] = opponent_safety_penalty(board, move, ai_player)
        safe_moves = [move for move in root_moves if move["safetyPenalty"] < WIN_SCORE]
        if safe_moves:
            root_moves = safe_moves

    best_move = root_moves[0] if root_moves else None
    best_score = -math.inf

    for depth in (2, 3, 4):
        depth_best = best_move
        depth_best_score = -math.inf
        timed_out = False

        for move in root_moves:
            if time.monotonic() > deadline:
                timed_out = True
                break

            board[move["row"]][move["col"]] = ai_player
            result = minimax(board, depth - 1, -math.inf, math.inf, other_player(ai_player), ai_player, deadline)
            board[move["row"]][move["col"]] = EMPTY
            score = result["score"] - move.get("safetyPenalty", 0)

            if score > depth_best_score:
                depth_best_score = score
                depth_best = move
            if result.get("timedOut"):
                timed_out = True
                break

        if not timed_out and depth_best:
            best_move = depth_best
            best_score = depth_best_score

    if not best_move:
        return None
    return {
        "row": best_move["row"],
        "col": best_move["col"],
        "reason": "search" if best_score >= 0 else "defend",
    }


def choose_server_move(board: list[list[int]], ai_player: int = WHITE) -> dict | None:
    if not validate_board(board):
        raise ValueError("Invalid board.")

    human_player = other_player(ai_player)
    candidates = get_candidates(board, 2)
    if not candidates:
        return None

    opening = opening_move(board, candidates)
    if opening:
        return opening

    ai_win = next((candidate for candidate in candidates if winning_move(board, candidate, ai_player)), None)
    if ai_win:
        return {**ai_win, "reason": "finish"}

    human_win = next((candidate for candidate in candidates if winning_move(board, candidate, human_player)), None)
    if human_win:
        return {**human_win, "reason": "block"}

    tactical_move = find_tactical_move(board, ai_player)
    if tactical_move:
        return tactical_move

    searched_move = choose_alpha_beta_move(board, ai_player)
    if searched_move:
        return searched_move

    fallback = ordered_moves(board, ai_player, 1)[0]
    return {
        "row": fallback["row"],
        "col": fallback["col"],
        "reason": "counter" if fallback["defense"] > fallback["attack"] else "pressure",
    }


def serialize_move(move: dict) -> str:
    return f"{chr(65 + move['col'])}{move['row'] + 1}"
