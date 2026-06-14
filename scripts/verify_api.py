import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.gomoku_engine import (
    BLACK,
    DEFAULT_FORBIDDEN_RULE,
    DEFAULT_TACTIC_STYLE,
    WHITE,
    attach_move_decision,
    check_win_from,
    classify_line_pattern,
    choose_server_move,
    create_board,
    forbidden_moves,
    get_difficulty_settings,
    get_winner,
    is_forbidden_move,
    normalize_forbidden_rule,
    normalize_tactic_style,
    place_move,
    zobrist_hash,
    zobrist_value,
)


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def assert_move(move: dict, row: int, col: int, message: str) -> None:
    assert_true(move["row"] == row and move["col"] == col, message)


board = create_board()
empty_hash = zobrist_hash(board)
place_move(board, 7, 7, BLACK)
assert_true(
    zobrist_hash(board) == empty_hash ^ zobrist_value(7, 7, BLACK),
    "Zobrist hash did not update by xor for a black move.",
)
board[7][7] = 0

assert_true(get_difficulty_settings("expert")["depths"][-1] == 5, "Expert search did not attempt depth 5.")
assert_true(get_difficulty_settings("easy")["depths"] == (1,), "Easy search should only use depth 1.")
assert_true(
    get_difficulty_settings("easy")["useTactical"] is False,
    "Easy difficulty should skip tactical pre-search.",
)
empty_opening = choose_server_move(board, BLACK)
assert_move(empty_opening, 7, 7, "AI did not open at the center on an empty board.")

off_center_opening_board = create_board()
place_move(off_center_opening_board, 6, 6, WHITE)
assert_move(
    choose_server_move(off_center_opening_board, BLACK),
    7,
    7,
    "AI did not take the center when the first stone was off-center.",
)

player_first_board = create_board()
place_move(player_first_board, 6, 6, BLACK)
player_first_response = choose_server_move(player_first_board, WHITE, force_center_response=False)
assert_true(
    player_first_response["reason"] != "opening",
    "AI forced the center opening response after the player started first.",
)

place_move(board, 7, 7, BLACK)
first_server_move = choose_server_move(board, WHITE)
assert_true(first_server_move and isinstance(first_server_move["row"], int), "AI did not return a move.")
assert_true(
    first_server_move.get("decision", {}).get("mode") == "common-score",
    "Regular AI move did not include common score details.",
)
easy_response_board = create_board()
place_move(easy_response_board, 7, 7, BLACK)
place_move(easy_response_board, 6, 6, WHITE)
easy_response = choose_server_move(easy_response_board, BLACK, difficulty="easy")
assert_true(easy_response["reason"] == "easy", "Easy difficulty did not use the easy move selector.")
assert_true(bool(easy_response.get("explanation")), "Easy difficulty did not include a simple-choice explanation.")
assert_true(easy_response.get("decision", {}).get("mode") == "easy", "Easy difficulty did not include decision details.")
assert_true(
    easy_response.get("decision", {}).get("commonScore", {}).get("mode") == "common-score",
    "Easy difficulty did not include common score details.",
)

easy_must_block_board = create_board()
for col in range(11, 15):
    place_move(easy_must_block_board, 14, col, BLACK)
easy_must_block = choose_server_move(
    easy_must_block_board,
    WHITE,
    difficulty="easy",
    forbidden_rule="renju",
    force_center_response=False,
)
assert_move(easy_must_block, 14, 10, "Easy difficulty did not block an immediate edge win.")
assert_true(easy_must_block["reason"] == "block-easy", "Easy immediate block did not use block-easy reason.")
assert_true(
    easy_must_block.get("decision", {}).get("forced") is True,
    "Easy immediate block was not marked as forced.",
)

reason_alignment_board = create_board()
place_move(reason_alignment_board, 7, 5, BLACK)
place_move(reason_alignment_board, 7, 6, BLACK)
place_move(reason_alignment_board, 6, 6, WHITE)
aligned_move = attach_move_decision(
    reason_alignment_board,
    {"row": 7, "col": 7, "reason": "defend-native"},
    BLACK,
    WHITE,
    "normal",
    "renju",
    "aggressive",
)
assert_true(
    aligned_move["reason"] == "search-native",
    "Search reason did not align with common attack/defense score signals.",
)
assert_true(
    aligned_move["decision"]["rawReason"] == "defend-native",
    "Common score did not preserve the raw search reason.",
)
aggressive_server_move = choose_server_move(board, WHITE, tactic_style="aggressive")
assert_true(aggressive_server_move and isinstance(aggressive_server_move["row"], int), "Aggressive AI did not return a move.")

attack_board = create_board()
for col in range(3, 7):
    place_move(attack_board, 7, col, WHITE)
finish = choose_server_move(attack_board, WHITE)
assert_true(finish["row"] == 7 and finish["col"] in (2, 7), "AI did not finish open four.")

block_board = create_board()
for col in range(4, 8):
    place_move(block_board, 8, col, BLACK)
block = choose_server_move(block_board, WHITE)
assert_true(block["row"] == 8 and block["col"] in (3, 8), "AI did not block human open four.")

black_defense_board = create_board()
for col in range(4, 8):
    place_move(black_defense_board, 8, col, WHITE)
black_defense = choose_server_move(black_defense_board, BLACK)
assert_true(
    black_defense["row"] == 8 and black_defense["col"] in (3, 8),
    "AI did not block white open four while playing black.",
)

threat_board = create_board()
place_move(threat_board, 6, 6, BLACK)
place_move(threat_board, 7, 7, BLACK)
place_move(threat_board, 8, 8, BLACK)
place_move(threat_board, 5, 8, WHITE)
place_move(threat_board, 9, 4, WHITE)
contain = choose_server_move(threat_board, WHITE)
assert_true(
    (contain["row"] == 5 and contain["col"] == 5) or (contain["row"] == 9 and contain["col"] == 9),
    "AI did not contain an open diagonal threat.",
)

four_three_board = create_board()
place_move(four_three_board, 7, 3, BLACK)
for row, col in ((7, 4), (7, 5), (7, 6), (5, 7), (6, 7)):
    place_move(four_three_board, row, col, WHITE)
assert_move(choose_server_move(four_three_board, WHITE), 7, 7, "AI did not create a four-three threat.")

block_four_three_board = create_board()
place_move(block_four_three_board, 7, 3, WHITE)
for row, col in ((7, 4), (7, 5), (7, 6), (5, 7), (6, 7)):
    place_move(block_four_three_board, row, col, BLACK)
assert_move(choose_server_move(block_four_three_board, WHITE), 7, 7, "AI did not block a four-three threat.")

double_three_board = create_board()
for row, col in ((7, 5), (7, 6), (5, 7), (6, 7)):
    place_move(double_three_board, row, col, WHITE)
assert_move(choose_server_move(double_three_board, WHITE), 7, 7, "AI did not create a double-three threat.")

block_double_three_board = create_board()
for row, col in ((7, 5), (7, 6), (5, 7), (6, 7)):
    place_move(block_double_three_board, row, col, BLACK)
assert_move(choose_server_move(block_double_three_board, WHITE), 7, 7, "AI did not block a double-three threat.")

cross_double_three_board = create_board()
for row, col in ((6, 7), (7, 6), (7, 8), (8, 7)):
    place_move(cross_double_three_board, row, col, BLACK)
for row, col in ((3, 5), (3, 6), (1, 3), (2, 3)):
    place_move(cross_double_three_board, row, col, WHITE)
assert_move(
    choose_server_move(cross_double_three_board, WHITE, forbidden_rule="none"),
    7,
    7,
    "AI created its own double-three instead of blocking the cross double-three.",
)

forbidden_board = create_board()
for row, col in ((7, 5), (7, 6), (5, 7), (6, 7)):
    place_move(forbidden_board, row, col, BLACK)
assert_true(DEFAULT_FORBIDDEN_RULE == "none", "Forbidden rule should default to free rule.")
assert_true(DEFAULT_TACTIC_STYLE == "defensive", "Tactic style should default to defensive.")
assert_true(normalize_forbidden_rule(None) == "none", "Missing forbidden rule did not normalize to free rule.")
assert_true(normalize_forbidden_rule("none") == "none", "Forbidden rule off option did not normalize.")
assert_true(normalize_tactic_style(None) == "defensive", "Missing tactic style did not normalize.")
assert_true(normalize_tactic_style("aggressive") == "aggressive", "Aggressive tactic style did not normalize.")
assert_true(is_forbidden_move(forbidden_board, 7, 7, BLACK, "renju"), "Double-three forbidden move failed.")
forbidden_session_moves = forbidden_moves(forbidden_board, BLACK, "renju")
assert_true(
    {"row": 7, "col": 7} in forbidden_session_moves,
    "Session forbidden move list did not include the black double-three.",
)
forbidden_ai_move = choose_server_move(forbidden_board, BLACK, forbidden_rule="renju")
assert_true(
    forbidden_ai_move["row"] != 7 or forbidden_ai_move["col"] != 7,
    "AI selected a forbidden black double-three.",
)

win_board = create_board()
for col in range(5):
    place_move(win_board, 4, col, BLACK)
assert_true(get_winner(win_board)["winner"] == BLACK, "Winner detection failed.")
assert_true(check_win_from(win_board, 4, 2, BLACK)["winner"] == BLACK, "Last-move winner detection failed.")

assert_true(classify_line_pattern("BOOO_") == "quiet", "Blocked three was over-classified.")
assert_true(classify_line_pattern("_OOOB") == "quiet", "Blocked three was over-classified.")
assert_true(classify_line_pattern("_OO_O") == "broken_three", "Open jump three was not detected.")
assert_true(classify_line_pattern("_OOO_") == "open_three", "Open three was not detected.")

print("Gomoku engine checks passed.")
