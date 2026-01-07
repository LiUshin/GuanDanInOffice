import { Server } from 'socket.io';
import { Game } from './game';
import { Player } from './room';
import { GameMode } from '../shared/types';

/**
 * Match represents a full game series (从2打到A)
 * Contains multiple Games until one team reaches A and wins twice consecutively
 */
export class Match {
    io: Server;
    roomId: string;
    players: Player[];
    gameMode: GameMode;
    
    currentGame: Game | null = null;
    teamLevels: { [key: number]: number } = { 0: 2, 1: 2 }; // Team 0 (seats 0,2) and Team 1 (seats 1,3)
    activeTeam: number = 0; // Which team is the banker (打庄)
    
    // Match end tracking
    consecutiveWins: { [key: number]: number } = { 0: 0, 1: 0 }; // Track consecutive wins at level A
    matchWinner: number | null = null; // Team that won the match
    
    // Store last game's winners for tribute phase
    private lastWinners: number[] = [];
    
    constructor(io: Server, roomId: string, players: Player[], gameMode: GameMode) {
        this.io = io;
        this.roomId = roomId;
        this.players = players;
        this.gameMode = gameMode;
    }
    
    /**
     * Start the first game in the match
     */
    startMatch() {
        console.log(`[Match ${this.roomId}] Starting new match. Mode: ${this.gameMode}`);
        this.teamLevels = { 0: 2, 1: 2 };
        this.activeTeam = 0;
        this.consecutiveWins = { 0: 0, 1: 0 };
        this.matchWinner = null;
        this.startNextGame();
    }
    
    /**
     * Start a new game within the match
     */
    startNextGame() {
        if (this.matchWinner !== null) {
            console.log(`[Match ${this.roomId}] Match already won by Team ${this.matchWinner}`);
            return;
        }
        
        console.log(`[Match ${this.roomId}] Starting new game. Team levels: ${JSON.stringify(this.teamLevels)}, Active team: ${this.activeTeam}`);
        
        // Destroy old game instance to clean up timeouts and listeners
        if (this.currentGame) {
            this.currentGame.destroy();
        }
        
        // Get previous winners from Match storage
        const prevWinners = this.lastWinners || [];
        
        // Deep copy players array to avoid reference conflicts
        const gamePlayers = this.players.map(p => ({ ...p }));
        
        // Create new game
        this.currentGame = new Game(this.io, this.roomId, gamePlayers, this.gameMode);
        this.currentGame.teamLevels = { ...this.teamLevels };
        this.currentGame.activeTeam = this.activeTeam;
        this.currentGame.prevWinners = prevWinners;
        
        // Listen for game end
        this.currentGame.onGameEnd = (winners: number[]) => this.handleGameEnd(winners);
        
        this.currentGame.start();
    }
    
    /**
     * Handle end of a single game
     */
    handleGameEnd(winners: number[]) {
        if (winners.length !== 4) {
            console.error(`[Match ${this.roomId}] Invalid winners array:`, winners);
            return;
        }
        
        console.log(`[Match ${this.roomId}] Game ended. Winners order: ${winners}`);
        
        // Calculate level up
        const { winningTeam, levelIncrease } = this.calculateLevelUp(winners);
        
        // Update team levels
        const oldLevel = this.teamLevels[winningTeam];
        this.teamLevels[winningTeam] += levelIncrease;
        
        // Cap at A (14)
        if (this.teamLevels[winningTeam] > 14) {
            this.teamLevels[winningTeam] = 14;
        }
        
        const newLevel = this.teamLevels[winningTeam];
        console.log(`[Match ${this.roomId}] Team ${winningTeam} level: ${oldLevel} -> ${newLevel} (+${levelIncrease})`);
        
        // Update active team (banker)
        if (winningTeam !== this.activeTeam) {
            // Banker changes
            this.activeTeam = winningTeam;
            console.log(`[Match ${this.roomId}] Banker changed to Team ${this.activeTeam}`);
        }
        
        // Check for match end condition
        if (this.teamLevels[winningTeam] === 14) {
            // Team reached A
            this.consecutiveWins[winningTeam]++;
            const otherTeam = 1 - winningTeam;
            this.consecutiveWins[otherTeam] = 0; // Reset other team's consecutive wins
            
            console.log(`[Match ${this.roomId}] Team ${winningTeam} at level A. Consecutive wins: ${this.consecutiveWins[winningTeam]}`);
            
            if (this.consecutiveWins[winningTeam] >= 2) {
                // Match won!
                this.matchWinner = winningTeam;
                console.log(`[Match ${this.roomId}] MATCH WON by Team ${winningTeam}!`);
                this.broadcastMatchEnd(winningTeam);
                return;
            }
        } else {
            // Not at A yet, reset consecutive wins
            this.consecutiveWins[0] = 0;
            this.consecutiveWins[1] = 0;
        }
        
        // Store winners in Match for next game's tribute phase
        this.lastWinners = winners;
        
        // Auto-start next game after a short delay
        setTimeout(() => {
            this.startNextGame();
        }, 3000); // 3 second delay before next game
    }
    
    /**
     * Calculate level increase based on winners
     */
    calculateLevelUp(winners: number[]): { winningTeam: number, levelIncrease: number } {
        const p1 = winners[0];
        const p2 = winners[1];
        const p3 = winners[2];
        
        const isSameTeam = (a: number, b: number) => (a % 2) === (b % 2);
        const winningTeam = p1 % 2;
        
        let levelIncrease = 0;
        if (isSameTeam(p1, p2)) {
            // Double win (1st and 2nd same team) -> +3
            levelIncrease = 3;
        } else if (isSameTeam(p1, p3)) {
            // 1st and 3rd same team -> +2
            levelIncrease = 2;
        } else {
            // Only 1st place -> +1
            levelIncrease = 1;
        }
        
        return { winningTeam, levelIncrease };
    }
    
    /**
     * Broadcast match end to all players
     */
    broadcastMatchEnd(winningTeam: number) {
        const teamPlayers = this.players.filter(p => p.seatIndex % 2 === winningTeam);
        this.io.to(this.roomId).emit('matchOver', {
            winningTeam,
            winners: teamPlayers.map(p => ({ name: p.name, seatIndex: p.seatIndex })),
            finalLevels: this.teamLevels
        });
    }
    
    /**
     * Get current match state for clients
     */
    getMatchState() {
        return {
            teamLevels: this.teamLevels,
            activeTeam: this.activeTeam,
            consecutiveWins: this.consecutiveWins,
            matchWinner: this.matchWinner,
            inProgress: this.currentGame !== null && this.matchWinner === null
        };
    }
    
    /**
     * Force end the current match
     */
    forceEndMatch() {
        console.log(`[Match ${this.roomId}] Force ending match`);
        this.currentGame = null;
        this.matchWinner = null;
        this.consecutiveWins = { 0: 0, 1: 0 };
    }
}
