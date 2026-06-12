import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.gomoku_engine import (
    BLACK,
    WHITE,
    check_win_from,
    classify_line_pattern,
    choose_server_move,
    create_board,
    get_winner,
    is_forbidden_move,
    place_move,
)


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def assert_move(move: dict, row: int, col: int, message: str) -> None:
    assert_true(move["row"] == row and move["col"] == col, message)


board = create_board()
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

place_move(board, 7, 7, BLACK)
first_server_move = choose_server_move(board, WHITE)
assert_true(first_server_move and isinstance(first_server_move["row"], int), "AI did not return a move.")

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

forbidden_board = create_board()
for row, col in ((7, 5), (7, 6), (5, 7), (6, 7)):
    place_move(forbidden_board, row, col, BLACK)
assert_true(is_forbidden_move(forbidden_board, 7, 7, BLACK, "renju"), "Double-three forbidden move failed.")
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
