/**
 * 四 Bot 自动对局测试脚本
 * 
 * 功能：模拟 4 个 Bot 进行完整的多轮掼蛋对局
 * 用法：npx ts-node test-bot-game.ts
 */

import { createDeck, shuffleDeck, updateCardProperties } from './src/shared/deck';
import { getHandType, compareHands, sortCards, getLogicValue } from './src/shared/rules';
import { Bot } from './src/shared/bot';
import { Card, Hand, HandType, Rank } from './src/shared/types';

// 游戏配置
const MAX_ROUNDS = 10;  // 最大对局轮数
const WINNING_LEVEL = 14; // 打到 A (14) 获胜

// 颜色输出
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
};

function log(msg: string, color: string = colors.reset) {
    console.log(`${color}${msg}${colors.reset}`);
}

function getRankName(rank: number): string {
    const names: { [key: number]: string } = {
        2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
        11: 'J', 12: 'Q', 13: 'K', 14: 'A',
        15: '小王', 16: '大王'
    };
    return names[rank] || String(rank);
}

function formatCards(cards: Card[]): string {
    return cards.map(c => {
        const suits = ['♠', '♥', '♣', '♦', '🃏'];
        const suit = c.rank >= 15 ? '' : suits[c.suit];
        return `${suit}${getRankName(c.rank)}`;
    }).join(' ');
}

interface GameState {
    level: number;
    hands: Card[][];
    currentTurn: number;
    lastHand: { playerIndex: number, hand: Hand } | null;
    passCount: number;
    winners: number[];
    teamLevels: { [key: number]: number };  // 0: Team 0,2  1: Team 1,3
    activeTeam: number;
}

function initGame(level: number): GameState {
    // 创建并洗牌
    const deck = shuffleDeck(createDeck());
    
    // 发牌 (每人 27 张)
    const hands: Card[][] = [[], [], [], []];
    for (let i = 0; i < 108; i++) {
        hands[i % 4].push(deck[i]);
    }
    
    // 更新牌属性（级牌等）并排序
    const processedHands = hands.map(h => {
        const updated = updateCardProperties(h, level);
        return sortCards(updated, level);
    });
    
    return {
        level,
        hands: processedHands,
        currentTurn: 0,
        lastHand: null,
        passCount: 0,
        winners: [],
        teamLevels: { 0: 2, 1: 2 },
        activeTeam: 0
    };
}

function advanceTurn(state: GameState): void {
    let next = (state.currentTurn + 1) % 4;
    let count = 0;
    while (state.hands[next].length === 0 && count < 4) {
        next = (next + 1) % 4;
        count++;
    }
    state.currentTurn = next;
}

function getActivePlayers(state: GameState): number {
    return state.hands.filter(h => h.length > 0).length;
}

function playRound(state: GameState): boolean {
    const seatIndex = state.currentTurn;
    const hand = state.hands[seatIndex];
    
    if (hand.length === 0) {
        advanceTurn(state);
        return true;
    }
    
    const bot = new Bot([...hand], state.level);
    const target = state.lastHand?.hand || null;
    
    // 自由出牌时
    if (!state.lastHand || state.lastHand.playerIndex === seatIndex) {
        const move = bot.decideMove(null);
        if (move && move.length > 0) {
            const handType = getHandType(move, state.level);
            if (handType) {
                // 出牌
                state.hands[seatIndex] = hand.filter(c => !move.some(m => m.id === c.id));
                state.lastHand = { playerIndex: seatIndex, hand: handType };
                state.passCount = 0;
                
                log(`  Bot ${seatIndex} 出牌: ${handType.type} ${formatCards(move)}`, colors.green);
                
                // 检查是否出完
                if (state.hands[seatIndex].length === 0) {
                    state.winners.push(seatIndex);
                    log(`  🏆 Bot ${seatIndex} 出完了！排名 #${state.winners.length}`, colors.yellow);
                }
                
                advanceTurn(state);
                return true;
            }
        }
        // 不应该发生：自由出牌时无法决定
        log(`  ❌ Bot ${seatIndex} 自由出牌失败！手牌: ${hand.length}`, colors.red);
        return false;
    }
    
    // 需要接牌
    const move = bot.decideMove(target);
    
    if (move && move.length > 0) {
        const handType = getHandType(move, state.level);
        if (handType) {
            const cmp = compareHands(handType, target!);
            if (cmp > 0) {
                // 出牌成功
                state.hands[seatIndex] = hand.filter(c => !move.some(m => m.id === c.id));
                state.lastHand = { playerIndex: seatIndex, hand: handType };
                state.passCount = 0;
                
                log(`  Bot ${seatIndex} 压牌: ${handType.type} ${formatCards(move)}`, colors.cyan);
                
                if (state.hands[seatIndex].length === 0) {
                    state.winners.push(seatIndex);
                    log(`  🏆 Bot ${seatIndex} 出完了！排名 #${state.winners.length}`, colors.yellow);
                }
                
                advanceTurn(state);
                return true;
            }
        }
    }
    
    // Pass
    state.passCount++;
    log(`  Bot ${seatIndex} 过`, colors.magenta);
    
    const activePlayers = getActivePlayers(state);
    const passThreshold = activePlayers - 1;
    
    if (state.passCount >= passThreshold) {
        // 所有人都过了，轮回到上家
        const lastPlayer = state.lastHand!.playerIndex;
        state.lastHand = null;
        state.passCount = 0;
        
        // 找到有牌的玩家
        const order = [lastPlayer, (lastPlayer + 2) % 4, (lastPlayer + 1) % 4, (lastPlayer + 3) % 4];
        for (const seat of order) {
            if (state.hands[seat].length > 0) {
                state.currentTurn = seat;
                log(`  ↩️  轮回到 Bot ${seat} 自由出牌`, colors.blue);
                return true;
            }
        }
    }
    
    advanceTurn(state);
    return true;
}

function playGame(state: GameState): number[] {
    log(`\n${'='.repeat(60)}`, colors.cyan);
    log(`🎴 开始对局 - 当前级别: ${getRankName(state.level)}`, colors.cyan);
    log(`${'='.repeat(60)}`, colors.cyan);
    
    for (let i = 0; i < 4; i++) {
        log(`  Bot ${i} (Team ${i % 2}): ${state.hands[i].length} 张牌`);
    }
    log('');
    
    let turnCount = 0;
    const maxTurns = 500;
    
    while (state.winners.length < 4 && turnCount < maxTurns) {
        turnCount++;
        
        // 检查双扣
        if (state.winners.length === 2) {
            const p1 = state.winners[0];
            const p2 = state.winners[1];
            if ((p1 % 2) === (p2 % 2)) {
                // 双扣！
                const losers = [0, 1, 2, 3].filter(i => !state.winners.includes(i));
                state.winners.push(...losers);
                log(`\n🎉 双扣！Team ${p1 % 2} 获胜！`, colors.yellow);
                break;
            }
        }
        
        // 检查 3 人出完
        if (state.winners.length === 3) {
            const last = [0, 1, 2, 3].find(i => !state.winners.includes(i))!;
            state.winners.push(last);
            break;
        }
        
        if (!playRound(state)) {
            log(`❌ 对局异常终止`, colors.red);
            break;
        }
    }
    
    if (turnCount >= maxTurns) {
        log(`⚠️ 达到最大回合数 ${maxTurns}，强制结束`, colors.red);
    }
    
    log(`\n📊 对局结果 (${turnCount} 回合):`, colors.yellow);
    state.winners.forEach((seat, rank) => {
        log(`  #${rank + 1}: Bot ${seat} (Team ${seat % 2})`, rank === 0 ? colors.green : colors.reset);
    });
    
    return state.winners;
}

function calculateLevelUp(winners: number[]): { team: number, step: number } {
    const p1 = winners[0];
    const p2 = winners[1];
    const isSameTeam = (a: number, b: number) => (a % 2) === (b % 2);
    
    const winningTeam = p1 % 2;
    let step = 0;
    
    if (isSameTeam(p1, p2)) {
        step = 3; // 双扣 +3
    } else if (isSameTeam(p1, winners[2])) {
        step = 2; // 1st, 3rd 同队 +2
    } else {
        step = 1; // 其他 +1
    }
    
    return { team: winningTeam, step };
}

function runTournament() {
    log('\n' + '🀄'.repeat(30), colors.yellow);
    log('          掼蛋四 Bot 自动对局测试', colors.yellow);
    log('🀄'.repeat(30) + '\n', colors.yellow);
    
    const teamLevels = { 0: 2, 1: 2 };  // Team 0: Bots 0,2  Team 1: Bots 1,3
    let activeTeam = 0;
    
    for (let round = 1; round <= MAX_ROUNDS; round++) {
        const currentLevel = teamLevels[activeTeam];
        
        log(`\n📍 第 ${round} 轮 - 当前轮次级别: ${getRankName(currentLevel)} (Team ${activeTeam} 庄家)`, colors.blue);
        log(`   Team 0 (Bots 0,2): 打 ${getRankName(teamLevels[0])}`, colors.reset);
        log(`   Team 1 (Bots 1,3): 打 ${getRankName(teamLevels[1])}`, colors.reset);
        
        const state = initGame(currentLevel);
        state.teamLevels = { ...teamLevels };
        state.activeTeam = activeTeam;
        
        const winners = playGame(state);
        
        if (winners.length < 4) {
            log(`❌ 对局未正常完成`, colors.red);
            break;
        }
        
        const result = calculateLevelUp(winners);
        
        log(`\n📈 升级计算:`, colors.green);
        log(`   获胜队伍: Team ${result.team}`, colors.green);
        log(`   升级步数: +${result.step}`, colors.green);
        
        if (result.team === activeTeam) {
            // 庄家赢了
            teamLevels[activeTeam] = Math.min(teamLevels[activeTeam] + result.step, WINNING_LEVEL);
            log(`   Team ${activeTeam}: ${getRankName(teamLevels[activeTeam] - result.step)} → ${getRankName(teamLevels[activeTeam])}`, colors.green);
        } else {
            // 闲家赢了，换庄
            activeTeam = result.team;
            teamLevels[activeTeam] = Math.min(teamLevels[activeTeam] + result.step, WINNING_LEVEL);
            log(`   换庄！Team ${activeTeam} 成为新庄家`, colors.yellow);
            log(`   Team ${activeTeam}: ${getRankName(teamLevels[activeTeam] - result.step)} → ${getRankName(teamLevels[activeTeam])}`, colors.green);
        }
        
        // 检查是否有队伍获胜
        if (teamLevels[0] >= WINNING_LEVEL) {
            log(`\n${'🏆'.repeat(20)}`, colors.yellow);
            log(`🎊 Team 0 (Bots 0, 2) 打到 A，游戏胜利！🎊`, colors.yellow);
            log(`${'🏆'.repeat(20)}`, colors.yellow);
            break;
        }
        if (teamLevels[1] >= WINNING_LEVEL) {
            log(`\n${'🏆'.repeat(20)}`, colors.yellow);
            log(`🎊 Team 1 (Bots 1, 3) 打到 A，游戏胜利！🎊`, colors.yellow);
            log(`${'🏆'.repeat(20)}`, colors.yellow);
            break;
        }
    }
    
    log(`\n${'='.repeat(60)}`, colors.cyan);
    log(`📊 最终状态:`, colors.cyan);
    log(`   Team 0 (Bots 0, 2): 打 ${getRankName(teamLevels[0])}`, colors.reset);
    log(`   Team 1 (Bots 1, 3): 打 ${getRankName(teamLevels[1])}`, colors.reset);
    log(`${'='.repeat(60)}\n`, colors.cyan);
}

// 运行测试
runTournament();
