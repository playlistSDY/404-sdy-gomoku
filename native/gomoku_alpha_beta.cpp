#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <limits>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

constexpr int BOARD_SIZE = 15;
constexpr int CELLS = BOARD_SIZE * BOARD_SIZE;
constexpr int EMPTY = 0;
constexpr int BLACK = 1;
constexpr int WHITE = 2;
constexpr double WIN_SCORE = 1'000'000'000.0;
constexpr std::uint64_t ZOBRIST_MASK = ~std::uint64_t{0};
constexpr std::uint64_t ZOBRIST_SEED = 0x9E3779B97F4A7C15ULL;

const std::array<std::pair<int, int>, 4> DIRECTIONS = {{
    {1, 0},
    {0, 1},
    {1, 1},
    {1, -1},
}};

struct Move {
    int row = 0;
    int col = 0;
    double attack = 0;
    double defense = 0;
    double score = 0;
    double safety_penalty = 0;
    int priority = 0;
};

struct Threat {
    int broken_threes = 0;
    int fours = 0;
    int open_fours = 0;
    int open_threes = 0;
    bool direct_five = false;
    bool double_four = false;
    bool double_three = false;
    bool four_three = false;
    bool forcing = false;
    double rank = 0;
};

struct Settings {
    std::vector<int> depths;
    double search_time = 1.1;
    int branch_limit = 12;
    int leaf_limit = 18;
    int root_limit = 22;
};

struct StyleWeights {
    double attack = 1.0;
    double defense = 1.16;
    double attack_threat = 0.24;
    double defense_threat = 0.16;
    double board_defense = 1.08;
    double safety = 0.55;
};

struct SearchResult {
    double score = 0;
    bool timed_out = false;
};

using Board = std::array<int, CELLS>;
using Clock = std::chrono::steady_clock;
using Deadline = Clock::time_point;

std::array<std::array<std::uint64_t, 2>, CELLS> zobrist_table{};

int index_of(int row, int col) {
    return row * BOARD_SIZE + col;
}

bool is_inside(int row, int col) {
    return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

int other_player(int player) {
    return player == BLACK ? WHITE : BLACK;
}

std::uint64_t splitmix64(std::uint64_t value) {
    value = (value + ZOBRIST_SEED) & ZOBRIST_MASK;
    value = ((value ^ (value >> 30)) * 0xBF58476D1CE4E5B9ULL) & ZOBRIST_MASK;
    value = ((value ^ (value >> 27)) * 0x94D049BB133111EBULL) & ZOBRIST_MASK;
    return (value ^ (value >> 31)) & ZOBRIST_MASK;
}

void init_zobrist() {
    for (int row = 0; row < BOARD_SIZE; ++row) {
        for (int col = 0; col < BOARD_SIZE; ++col) {
            int cell = index_of(row, col);
            zobrist_table[cell][0] = splitmix64(static_cast<std::uint64_t>(cell * 2 + BLACK));
            zobrist_table[cell][1] = splitmix64(static_cast<std::uint64_t>(cell * 2 + WHITE));
        }
    }
}

std::uint64_t zobrist_value(int row, int col, int player) {
    return zobrist_table[index_of(row, col)][player - 1];
}

std::uint64_t zobrist_hash(const Board& board) {
    std::uint64_t hash = 0;
    for (int cell = 0; cell < CELLS; ++cell) {
        int player = board[cell];
        if (player != EMPTY) {
            hash ^= zobrist_table[cell][player - 1];
        }
    }
    return hash;
}

Settings settings_for(const std::string& difficulty) {
    if (difficulty == "easy") {
        return {{1}, 0.18, 5, 8, 8};
    }
    if (difficulty == "normal") {
        return {{2}, 0.36, 7, 10, 12};
    }
    if (difficulty == "hard") {
        return {{2, 3}, 0.78, 10, 14, 18};
    }
    return {{2, 3, 4, 5}, 1.1, 12, 18, 22};
}

bool renju_rule(const std::string& forbidden_rule) {
    return forbidden_rule == "renju";
}

bool aggressive_style(const std::string& tactic_style) {
    return tactic_style == "aggressive";
}

StyleWeights weights_for(const std::string& tactic_style) {
    if (aggressive_style(tactic_style)) {
        return {1.08, 1.02, 0.34, 0.11, 0.98, 0.43};
    }
    return {};
}

bool board_is_full(const Board& board) {
    return std::none_of(board.begin(), board.end(), [](int cell) { return cell == EMPTY; });
}

int count_stones(const Board& board) {
    return static_cast<int>(std::count_if(board.begin(), board.end(), [](int cell) { return cell != EMPTY; }));
}

bool check_win_from(const Board& board, int row, int col, int player) {
    if (!is_inside(row, col) || board[index_of(row, col)] != player) {
        return false;
    }

    for (auto [dr, dc] : DIRECTIONS) {
        int length = 1;
        int r = row + dr;
        int c = col + dc;
        while (is_inside(r, c) && board[index_of(r, c)] == player) {
            ++length;
            r += dr;
            c += dc;
        }

        r = row - dr;
        c = col - dc;
        while (is_inside(r, c) && board[index_of(r, c)] == player) {
            ++length;
            r -= dr;
            c -= dc;
        }

        if (length >= 5) {
            return true;
        }
    }
    return false;
}

bool has_win(const Board& board, int player) {
    for (int row = 0; row < BOARD_SIZE; ++row) {
        for (int col = 0; col < BOARD_SIZE; ++col) {
            if (board[index_of(row, col)] == player && check_win_from(board, row, col, player)) {
                return true;
            }
        }
    }
    return false;
}

std::vector<Move> get_candidates(const Board& board, int radius) {
    std::array<bool, CELLS> seen{};
    bool has_stone = false;

    for (int row = 0; row < BOARD_SIZE; ++row) {
        for (int col = 0; col < BOARD_SIZE; ++col) {
            if (board[index_of(row, col)] == EMPTY) {
                continue;
            }
            has_stone = true;
            for (int dr = -radius; dr <= radius; ++dr) {
                for (int dc = -radius; dc <= radius; ++dc) {
                    int nr = row + dr;
                    int nc = col + dc;
                    if (!is_inside(nr, nc) || board[index_of(nr, nc)] != EMPTY) {
                        continue;
                    }
                    seen[index_of(nr, nc)] = true;
                }
            }
        }
    }

    std::vector<Move> candidates;
    if (!has_stone) {
        candidates.push_back({BOARD_SIZE / 2, BOARD_SIZE / 2});
        return candidates;
    }

    double center = (BOARD_SIZE - 1) / 2.0;
    for (int row = 0; row < BOARD_SIZE; ++row) {
        for (int col = 0; col < BOARD_SIZE; ++col) {
            if (seen[index_of(row, col)]) {
                candidates.push_back({row, col});
            }
        }
    }

    std::sort(candidates.begin(), candidates.end(), [center](const Move& a, const Move& b) {
        double da = std::abs(a.row - center) + std::abs(a.col - center);
        double db = std::abs(b.row - center) + std::abs(b.col - center);
        return da < db;
    });
    return candidates;
}

std::string line_pattern(const Board& board, int row, int col, int player, int dr, int dc) {
    std::string pattern;
    pattern.reserve(9);
    for (int offset = -4; offset <= 4; ++offset) {
        int r = row + offset * dr;
        int c = col + offset * dc;
        if (!is_inside(r, c)) {
            pattern.push_back('B');
        } else if (r == row && c == col) {
            pattern.push_back('O');
        } else {
            int cell = board[index_of(r, c)];
            if (cell == EMPTY) {
                pattern.push_back('_');
            } else if (cell == player) {
                pattern.push_back('O');
            } else {
                pattern.push_back('B');
            }
        }
    }
    return pattern;
}

bool contains(const std::string& pattern, const std::string& shape) {
    return pattern.find(shape) != std::string::npos;
}

bool has_five(const std::string& pattern) {
    return contains(pattern, "OOOOO");
}

bool has_open_four(const std::string& pattern) {
    return contains(pattern, "_OOOO_");
}

bool has_four(const std::string& pattern) {
    for (std::size_t start = 0; start + 5 <= pattern.size(); ++start) {
        std::string window = pattern.substr(start, 5);
        if (window.find('B') == std::string::npos &&
            std::count(window.begin(), window.end(), 'O') == 4 &&
            std::count(window.begin(), window.end(), '_') == 1) {
            return true;
        }
    }
    return false;
}

int count_moves_creating(const std::string& pattern, bool (*detector)(const std::string&)) {
    int count = 0;
    for (std::size_t index = 0; index < pattern.size(); ++index) {
        if (pattern[index] != '_') {
            continue;
        }
        std::string next = pattern;
        next[index] = 'O';
        if (detector(next)) {
            ++count;
        }
    }
    return count;
}

bool has_open_three(const std::string& pattern) {
    if (contains(pattern, "_OOO_") || contains(pattern, "_OO_O_") || contains(pattern, "_O_OO_")) {
        return true;
    }
    return count_moves_creating(pattern, has_open_four) >= 2;
}

bool has_broken_three(const std::string& pattern) {
    if (has_open_three(pattern)) {
        return false;
    }
    bool shape = contains(pattern, "_OO_O") || contains(pattern, "OO_O_") ||
        contains(pattern, "_O_OO") || contains(pattern, "O_OO_");
    return shape && count_moves_creating(pattern, has_four) >= 1;
}

Threat threat_summary(const Board& board, int row, int col, int player) {
    Threat threat;
    for (auto [dr, dc] : DIRECTIONS) {
        std::string pattern = line_pattern(board, row, col, player, dr, dc);
        if (has_five(pattern)) {
            threat.direct_five = true;
        } else if (has_open_four(pattern)) {
            threat.open_fours += 1;
            threat.fours += 1;
        } else if (has_four(pattern)) {
            threat.fours += 1;
        } else if (has_open_three(pattern)) {
            threat.open_threes += 1;
        } else if (has_broken_three(pattern)) {
            threat.broken_threes += 1;
        }
    }

    threat.double_four = threat.fours >= 2;
    threat.four_three = threat.fours >= 1 && threat.open_threes + threat.broken_threes >= 1;
    threat.double_three = threat.open_threes >= 2 || (threat.open_threes >= 1 && threat.broken_threes >= 1);
    threat.forcing = threat.direct_five || threat.open_fours > 0 || threat.double_four ||
        threat.four_three || threat.double_three;
    threat.rank =
        (threat.direct_five ? WIN_SCORE : 0) +
        threat.open_fours * 100'000'000.0 +
        (threat.double_four ? 90'000'000.0 : 0) +
        (threat.four_three ? 80'000'000.0 : 0) +
        (threat.double_three ? 30'000'000.0 : 0) +
        threat.fours * 10'000'000.0 +
        threat.open_threes * 500'000.0 +
        threat.broken_threes * 100'000.0;
    return threat;
}

int threat_priority(const Threat& threat) {
    if (threat.direct_five) return 6;
    if (threat.open_fours > 0) return 5;
    if (threat.double_four || threat.four_three) return 4;
    if (threat.double_three) return 3;
    if (threat.open_threes > 0) return 2;
    if (threat.broken_threes > 0) return 1;
    return 0;
}

int line_length_after_move(const Board& board, int row, int col, int player, int dr, int dc) {
    int length = 1;
    int r = row + dr;
    int c = col + dc;
    while (is_inside(r, c) && board[index_of(r, c)] == player) {
        ++length;
        r += dr;
        c += dc;
    }
    r = row - dr;
    c = col - dc;
    while (is_inside(r, c) && board[index_of(r, c)] == player) {
        ++length;
        r -= dr;
        c -= dc;
    }
    return length;
}

bool is_forbidden_move(const Board& board, int row, int col, int player, const std::string& forbidden_rule) {
    if (!renju_rule(forbidden_rule) || player != BLACK || !is_inside(row, col) || board[index_of(row, col)] != EMPTY) {
        return false;
    }

    for (auto [dr, dc] : DIRECTIONS) {
        if (line_length_after_move(board, row, col, player, dr, dc) > 5) {
            return true;
        }
    }

    Threat threat = threat_summary(board, row, col, player);
    return threat.double_three || threat.double_four;
}

std::vector<Move> legal_candidates(const Board& board, int player, int radius, const std::string& forbidden_rule) {
    std::vector<Move> candidates;
    for (Move move : get_candidates(board, radius)) {
        if (!is_forbidden_move(board, move.row, move.col, player, forbidden_rule)) {
            candidates.push_back(move);
        }
    }
    return candidates;
}

bool winning_move(Board& board, const Move& move, int player, const std::string& forbidden_rule) {
    if (board[index_of(move.row, move.col)] != EMPTY ||
        is_forbidden_move(board, move.row, move.col, player, forbidden_rule)) {
        return false;
    }
    board[index_of(move.row, move.col)] = player;
    bool wins = check_win_from(board, move.row, move.col, player);
    board[index_of(move.row, move.col)] = EMPTY;
    return wins;
}

std::vector<Move> immediate_winning_moves(Board& board, int player, const std::string& forbidden_rule) {
    std::vector<Move> wins;
    for (const Move& move : legal_candidates(board, player, 2, forbidden_rule)) {
        if (winning_move(board, move, player, forbidden_rule)) {
            wins.push_back(move);
        }
    }
    return wins;
}

struct Run {
    int length = 1;
    int open_ends = 0;
};

Run directional_run(const Board& board, int row, int col, int player, int dr, int dc) {
    int forward = 0;
    int backward = 0;

    int r = row + dr;
    int c = col + dc;
    while (is_inside(r, c) && board[index_of(r, c)] == player) {
        ++forward;
        r += dr;
        c += dc;
    }
    bool open_forward = is_inside(r, c) && board[index_of(r, c)] == EMPTY;

    r = row - dr;
    c = col - dc;
    while (is_inside(r, c) && board[index_of(r, c)] == player) {
        ++backward;
        r -= dr;
        c -= dc;
    }
    bool open_backward = is_inside(r, c) && board[index_of(r, c)] == EMPTY;
    return {forward + backward + 1, static_cast<int>(open_forward) + static_cast<int>(open_backward)};
}

int score_pattern(int length, int open_ends) {
    if (length >= 5) return 100'000'000;
    if (length == 4 && open_ends == 2) return 5'000'000;
    if (length == 4 && open_ends == 1) return 850'000;
    if (length == 3 && open_ends == 2) return 180'000;
    if (length == 3 && open_ends == 1) return 25'000;
    if (length == 2 && open_ends == 2) return 9'000;
    if (length == 2 && open_ends == 1) return 1'200;
    if (length == 1 && open_ends == 2) return 180;
    return 8;
}

int score_broken_pattern(const Board& board, int row, int col, int player, int dr, int dc) {
    int score = 0;
    for (int offset = -4; offset <= 0; ++offset) {
        int stones = 0;
        int empties = 0;
        bool valid = true;
        for (int i = 0; i < 5; ++i) {
            int r = row + (offset + i) * dr;
            int c = col + (offset + i) * dc;
            if (!is_inside(r, c)) {
                valid = false;
                break;
            }
            int cell = (r == row && c == col) ? player : board[index_of(r, c)];
            if (cell == player) {
                ++stones;
            } else if (cell == EMPTY) {
                ++empties;
            } else {
                valid = false;
                break;
            }
        }
        if (!valid) continue;
        if (stones == 4 && empties == 1) score += 260'000;
        if (stones == 3 && empties == 2) score += 17'000;
        if (stones == 2 && empties == 3) score += 850;
    }
    return score;
}

double score_move(const Board& board, int row, int col, int player) {
    if (!is_inside(row, col) || board[index_of(row, col)] != EMPTY) {
        return -std::numeric_limits<double>::infinity();
    }

    Threat threat = threat_summary(board, row, col, player);
    int base = 0;
    for (auto [dr, dc] : DIRECTIONS) {
        Run run = directional_run(board, row, col, player, dr, dc);
        base += score_pattern(run.length, run.open_ends);
        base += score_broken_pattern(board, row, col, player, dr, dc);
    }

    double center = (BOARD_SIZE - 1) / 2.0;
    double center_distance = std::abs(row - center) + std::abs(col - center);
    double center_bonus = std::max(0.0, 20.0 - center_distance) * 9.0;
    return threat.rank + base * 0.35 + center_bonus;
}

Move candidate_score(const Board& board, Move move, int player, int defending_player, const std::string& tactic_style) {
    StyleWeights weights = weights_for(tactic_style);
    Threat threat = threat_summary(board, move.row, move.col, player);
    Threat defense_threat = threat_summary(board, move.row, move.col, defending_player);
    move.attack = score_move(board, move.row, move.col, player);
    move.defense = score_move(board, move.row, move.col, defending_player);
    move.priority = threat_priority(threat);
    move.score = move.attack * weights.attack + move.defense * weights.defense +
        threat.rank * weights.attack_threat + defense_threat.rank * weights.defense_threat;
    return move;
}

std::vector<Move> ordered_moves(
    const Board& board,
    int player,
    int limit,
    int radius,
    const std::string& forbidden_rule,
    const std::string& tactic_style
) {
    int opponent = other_player(player);
    std::vector<Move> moves;
    for (Move move : legal_candidates(board, player, radius, forbidden_rule)) {
        moves.push_back(candidate_score(board, move, player, opponent, tactic_style));
    }
    std::sort(moves.begin(), moves.end(), [](const Move& a, const Move& b) {
        if (a.score != b.score) return a.score > b.score;
        if (a.defense != b.defense) return a.defense > b.defense;
        return a.attack > b.attack;
    });
    if (static_cast<int>(moves.size()) > limit) {
        moves.resize(limit);
    }
    return moves;
}

double best_threat_rank(const Board& board, int player, const std::string& forbidden_rule) {
    double best = 0;
    for (const Move& move : legal_candidates(board, player, 2, forbidden_rule)) {
        best = std::max(best, threat_summary(board, move.row, move.col, player).rank);
    }
    return best;
}

double opponent_safety_penalty(
    Board& board,
    const Move& move,
    int ai_player,
    const std::string& forbidden_rule,
    const std::string& tactic_style
) {
    int human_player = other_player(ai_player);
    StyleWeights weights = weights_for(tactic_style);
    board[index_of(move.row, move.col)] = ai_player;
    double penalty = immediate_winning_moves(board, human_player, forbidden_rule).empty()
        ? best_threat_rank(board, human_player, forbidden_rule) * weights.safety
        : WIN_SCORE * 2;
    board[index_of(move.row, move.col)] = EMPTY;
    return penalty;
}

double evaluate_board(Board& board, int ai_player, const std::string& forbidden_rule, const std::string& tactic_style) {
    int human_player = other_player(ai_player);
    StyleWeights weights = weights_for(tactic_style);
    if (has_win(board, ai_player)) return WIN_SCORE;
    if (has_win(board, human_player)) return -WIN_SCORE;
    if (board_is_full(board)) return 0;

    std::vector<Move> ai_candidates = legal_candidates(board, ai_player, 2, forbidden_rule);
    std::vector<Move> human_candidates = legal_candidates(board, human_player, 2, forbidden_rule);
    if (ai_candidates.empty() && human_candidates.empty()) {
        return 0;
    }

    std::vector<double> ai_scores;
    for (Move move : ai_candidates) {
        ai_scores.push_back(candidate_score(board, move, ai_player, human_player, tactic_style).score);
    }
    std::vector<double> human_scores;
    for (Move move : human_candidates) {
        human_scores.push_back(candidate_score(board, move, human_player, ai_player, tactic_style).score);
    }
    std::sort(ai_scores.begin(), ai_scores.end(), std::greater<double>());
    std::sort(human_scores.begin(), human_scores.end(), std::greater<double>());

    auto weighted = [](const std::vector<double>& scores) {
        double value = 0;
        if (!scores.empty()) value += scores[0];
        if (scores.size() > 1) value += scores[1] * 0.38;
        if (scores.size() > 2) value += scores[2] * 0.18;
        return value;
    };

    return weighted(ai_scores) - weighted(human_scores) * weights.board_defense;
}

std::uint64_t mix_key(
    std::uint64_t hash,
    int current_player,
    int ai_player,
    int depth,
    const std::string& forbidden_rule,
    const std::string& tactic_style
) {
    std::uint64_t key = hash;
    key ^= splitmix64(static_cast<std::uint64_t>(current_player) + 0x1000ULL);
    key ^= splitmix64(static_cast<std::uint64_t>(ai_player) + 0x2000ULL);
    key ^= splitmix64(static_cast<std::uint64_t>(depth) + 0x3000ULL);
    key ^= splitmix64(renju_rule(forbidden_rule) ? 0x4001ULL : 0x4000ULL);
    key ^= splitmix64(aggressive_style(tactic_style) ? 0x5001ULL : 0x5000ULL);
    return key;
}

SearchResult minimax(
    Board& board,
    int depth,
    double alpha,
    double beta,
    int current_player,
    int ai_player,
    const Deadline& deadline,
    std::unordered_map<std::uint64_t, double>& transposition,
    const Settings& settings,
    const std::string& forbidden_rule,
    const std::string& tactic_style,
    std::uint64_t position_hash,
    int last_row,
    int last_col,
    int last_player
) {
    if (Clock::now() > deadline) {
        return {evaluate_board(board, ai_player, forbidden_rule, tactic_style), true};
    }

    if (last_player != EMPTY && check_win_from(board, last_row, last_col, last_player)) {
        if (last_player == ai_player) {
            return {WIN_SCORE + depth, false};
        }
        return {-WIN_SCORE - depth, false};
    }
    if (board_is_full(board)) {
        return {0, false};
    }

    std::uint64_t key = mix_key(position_hash, current_player, ai_player, depth, forbidden_rule, tactic_style);
    auto cached = transposition.find(key);
    if (cached != transposition.end()) {
        return {cached->second, false};
    }

    std::vector<Move> wins = immediate_winning_moves(board, current_player, forbidden_rule);
    if (!wins.empty()) {
        double score = current_player == ai_player ? WIN_SCORE + depth : -WIN_SCORE - depth;
        transposition[key] = score;
        return {score, false};
    }

    if (depth == 0) {
        double score = evaluate_board(board, ai_player, forbidden_rule, tactic_style);
        transposition[key] = score;
        return {score, false};
    }

    bool maximizing = current_player == ai_player;
    int limit = depth >= 2 ? settings.branch_limit : settings.leaf_limit;
    std::vector<Move> moves = ordered_moves(board, current_player, limit, 2, forbidden_rule, tactic_style);
    if (moves.empty()) {
        double score = evaluate_board(board, ai_player, forbidden_rule, tactic_style);
        transposition[key] = score;
        return {score, false};
    }

    double best_score = maximizing
        ? -std::numeric_limits<double>::infinity()
        : std::numeric_limits<double>::infinity();
    bool timed_out = false;
    bool cutoff = false;

    for (const Move& move : moves) {
        int cell = index_of(move.row, move.col);
        board[cell] = current_player;
        std::uint64_t next_hash = position_hash ^ zobrist_value(move.row, move.col, current_player);
        SearchResult child = minimax(
            board,
            depth - 1,
            alpha,
            beta,
            other_player(current_player),
            ai_player,
            deadline,
            transposition,
            settings,
            forbidden_rule,
            tactic_style,
            next_hash,
            move.row,
            move.col,
            current_player
        );
        board[cell] = EMPTY;
        timed_out = timed_out || child.timed_out;

        if (maximizing) {
            best_score = std::max(best_score, child.score);
            alpha = std::max(alpha, best_score);
        } else {
            best_score = std::min(best_score, child.score);
            beta = std::min(beta, best_score);
        }

        if (beta <= alpha) {
            cutoff = true;
            break;
        }
        if (timed_out) {
            break;
        }
    }

    if (!timed_out && !cutoff) {
        transposition[key] = best_score;
    }
    return {best_score, timed_out};
}

std::string choose_alpha_beta(
    Board& board,
    int ai_player,
    const std::string& difficulty,
    const std::string& forbidden_rule,
    const std::string& tactic_style
) {
    Settings settings = settings_for(difficulty);
    Deadline deadline = Clock::now() + std::chrono::duration_cast<Clock::duration>(
        std::chrono::duration<double>(settings.search_time)
    );
    int human_player = other_player(ai_player);
    double threat_rank = std::max(
        best_threat_rank(board, ai_player, forbidden_rule),
        best_threat_rank(board, human_player, forbidden_rule)
    );
    int root_radius = threat_rank >= 500'000.0 ? 3 : 2;
    std::vector<Move> root_moves = ordered_moves(
        board,
        ai_player,
        settings.root_limit,
        root_radius,
        forbidden_rule,
        tactic_style
    );
    if (root_moves.empty()) {
        return "NONE\n";
    }

    for (Move& move : root_moves) {
        move.safety_penalty = opponent_safety_penalty(board, move, ai_player, forbidden_rule, tactic_style);
    }
    std::vector<Move> safe_moves;
    for (const Move& move : root_moves) {
        if (move.safety_penalty < WIN_SCORE) {
            safe_moves.push_back(move);
        }
    }
    if (!safe_moves.empty()) {
        root_moves = safe_moves;
    }

    Move best_move = root_moves[0];
    double best_score = -std::numeric_limits<double>::infinity();
    std::uint64_t root_hash = zobrist_hash(board);
    std::unordered_map<std::uint64_t, double> transposition;
    transposition.reserve(80'000);

    for (int depth : settings.depths) {
        Move depth_best = best_move;
        double depth_best_score = -std::numeric_limits<double>::infinity();
        bool timed_out = false;

        for (const Move& move : root_moves) {
            if (Clock::now() > deadline) {
                timed_out = true;
                break;
            }

            int cell = index_of(move.row, move.col);
            board[cell] = ai_player;
            std::uint64_t move_hash = root_hash ^ zobrist_value(move.row, move.col, ai_player);
            SearchResult result = minimax(
                board,
                depth - 1,
                -std::numeric_limits<double>::infinity(),
                std::numeric_limits<double>::infinity(),
                human_player,
                ai_player,
                deadline,
                transposition,
                settings,
                forbidden_rule,
                tactic_style,
                move_hash,
                move.row,
                move.col,
                ai_player
            );
            board[cell] = EMPTY;

            double score = result.score - move.safety_penalty;
            if (score > depth_best_score) {
                depth_best_score = score;
                depth_best = move;
            }
            if (result.timed_out) {
                timed_out = true;
                break;
            }
        }

        if (!timed_out) {
            best_move = depth_best;
            best_score = depth_best_score;
        }
    }

    std::string reason = best_score >= 0 ? "search-native" : "defend-native";
    return std::to_string(best_move.row) + " " + std::to_string(best_move.col) + " " + reason + " " + std::to_string(best_score) + "\n";
}

}  // namespace

int main() {
    init_zobrist();

    int ai_player = WHITE;
    std::string difficulty = "expert";
    std::string forbidden_rule = "none";
    std::string tactic_style = "defensive";
    if (!(std::cin >> ai_player >> difficulty >> forbidden_rule >> tactic_style)) {
        std::cout << "NONE\n";
        return 0;
    }

    std::string cells;
    std::cin >> cells;
    if (cells.size() != CELLS) {
        std::cout << "NONE\n";
        return 0;
    }

    Board board{};
    for (int i = 0; i < CELLS; ++i) {
        char cell = cells[static_cast<std::size_t>(i)];
        if (cell < '0' || cell > '2') {
            std::cout << "NONE\n";
            return 0;
        }
        board[i] = cell - '0';
    }

    std::cout << choose_alpha_beta(board, ai_player, difficulty, forbidden_rule, tactic_style);
    return 0;
}
