
/**
 * 技能掼蛋 Bot 对局测试脚本
 * 
 * 功能：使用 src/server/game.ts 中的真实 Game 逻辑模拟 4 个 Bot 进行技能模式对局
 * 用法：npx ts-node test-skill-bot-game.ts
 */

import { Server, Socket } from 'socket.io';
import { Game } from './src/server/game';
import { GameMode, HandType, Rank, Suit } from './src/shared/types';
// Remove incorrect import
// import { getRankName } from './src/shared/deck';

// 颜色输出
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
};

function log(msg: string, color: string = colors.reset) {
    console.log(`${color}${msg}${colors.reset}`);
}

// Mock Socket.io Server & Socket
class MockSocket {
    id: string;
    connected: boolean = true;
    
    constructor(id: string) {
        this.id = id;
    }

    emit(event: string, ...args: any[]) {
        // 可以在这里捕获发给特定玩家的消息
        if (event === 'error') {
             // log(`[Socket ${this.id}] Error: ${args[0]}`, colors.red);
        }
    }
    
    join(room: string) {}
}

class MockServer {
    sockets: { [id: string]: MockSocket } = {};

    to(roomId: string) {
        return {
            emit: (event: string, ...args: any[]) => {
                if (event === 'error') {
                    log(`[Broadcast Error] ${args[0]}`, colors.red);
                } else if (event === 'chatMessage') {
                    const msg = args[0];
                    // Log all chat messages, including emojis
                    log(`[Chat] ${msg.sender} (Seat ${msg.seatIndex}): ${msg.text}`, colors.magenta);
                } else if (event === 'gameState') {
                    // 可以在这里捕获游戏状态更新
                } else if (event === 'gameOver') {
                    log(`[System] Game Over! Winners: ${args[0].winners}`, colors.yellow);
                }
            }
        };
    }
}

// 任务队列，用于驱动游戏循环（替代 setTimeout）
const taskQueue: { cb: Function, time: number }[] = [];
let currentTime = 0;

// 覆盖全局 setTimeout
global.setTimeout = ((callback: Function, ms: number = 0) => {
    taskQueue.push({ cb: callback, time: currentTime + ms });
    // 按时间排序，保证执行顺序
    taskQueue.sort((a, b) => a.time - b.time);
    return {} as any;
}) as any;

// 简单的 Rank 转换
function getRankStr(rank: number): string {
    if (rank === 16) return '大王';
    if (rank === 15) return '小王';
    if (rank === 14) return 'A';
    if (rank === 13) return 'K';
    if (rank === 12) return 'Q';
    if (rank === 11) return 'J';
    return String(rank);
}

// 运行测试
async function runSkillGameTest() {
    log('\n' + '🀄'.repeat(30), colors.yellow);
    log('          技能掼蛋真实逻辑测试 (Server-less)', colors.yellow);
    log('🀄'.repeat(30) + '\n', colors.yellow);

    const mockIo = new MockServer() as unknown as Server;
    const roomId = 'test-room';

    // 创建 4 个 Bot 玩家
    // 注意：src/server/game.ts 中的 Player 接口定义
    const players = [
        { id: 'bot1', name: 'Bot-0', seatIndex: 0, isBot: true, socket: new MockSocket('bot1') as unknown as Socket },
        { id: 'bot2', name: 'Bot-1', seatIndex: 1, isBot: true, socket: new MockSocket('bot2') as unknown as Socket },
        { id: 'bot3', name: 'Bot-2', seatIndex: 2, isBot: true, socket: new MockSocket('bot3') as unknown as Socket },
        { id: 'bot4', name: 'Bot-3', seatIndex: 3, isBot: true, socket: new MockSocket('bot4') as unknown as Socket }
    ];

    // 实例化 Game
    const game = new Game(mockIo, roomId, players as any, GameMode.Skill);

    // 监听 Game 的关键点（通过 Hook console.log 或者检查状态）
    // 这里我们简单地通过 console.log 输出（Game 内部已经有很多 log）
    
    // 启动游戏
    log('>>> 游戏开始初始化...', colors.cyan);
    
    // 手动触发 start (通常由 room.ts 处理)
    // Game.resetAndStart 是核心启动方法
    game.resetAndStart();

    // 驱动游戏循环
    // 因为所有 Bot 操作都是通过 setTimeout 调度的，我们需要不断处理 taskQueue
    const maxSteps = 10000;
    let steps = 0;

    log('>>> 进入事件循环...', colors.cyan);

    while (game.winners.length < 4 && steps < maxSteps) {
        if (taskQueue.length === 0) {
            // 如果队列空了但游戏没结束，可能是等待玩家输入（但在全 Bot 局不应该发生）
            // 或者某些操作没有触发后续事件
            log('⚠️ 事件队列为空，游戏可能已卡住或结束。', colors.red);
            break;
        }

        // 取出第一个任务
        const task = taskQueue.shift();
        if (task) {
            // 执行任务
            currentTime = task.time; // 更新“虚拟时间”
            try {
                task.cb();
            } catch (e) {
                log(`❌ 执行任务出错: ${e}`, colors.red);
                console.error(e);
            }
        }
        
        steps++;
        
        // 简单的进度显示
        if (steps % 100 === 0) {
            // process.stdout.write('.');
        }
    }

    log('\n' + '='.repeat(60), colors.cyan);
    log('📊 测试结束', colors.cyan);
    
    if (game.winners.length === 4) {
        log('✅ 游戏正常结束，所有玩家均已完成。', colors.green);
        log(`   赢家顺序: ${game.winners.join(', ')}`, colors.green);
        
        // 计算升级结果 (复用 Game 内部逻辑不容易，我们手动算一下验证)
        const p1 = game.winners[0];
        const p2 = game.winners[1];
        const team1 = p1 % 2;
        
        log(`   获胜队伍: Team ${team1} (${p1}, ${(p1+2)%4})`, colors.green);
        
        // 打印最终队伍等级
        log(`   Team 0 Level: ${getRankStr(game.teamLevels[0])}`, colors.white);
        log(`   Team 1 Level: ${getRankStr(game.teamLevels[1])}`, colors.white);
        
    } else {
        log(`❌ 游戏未正常结束 (Queue empty or max steps reached)`, colors.red);
        log(`   当前赢家: ${game.winners.join(', ')}`, colors.red);
        log(`   当前回合: ${game.currentTurn}`, colors.red);
        log(`   当前阶段: ${game.currentPhase}`, colors.red);
    }
    log('='.repeat(60) + '\n', colors.cyan);
}

runSkillGameTest().catch(console.error);
