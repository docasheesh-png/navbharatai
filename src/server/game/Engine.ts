export class ChessEngine {
    private board: any[][];
    constructor() { this.board = Array(8).fill(null).map(() => Array(8).fill(null)); }
    move(from: [number, number], to: [number, number]) { return true; }
}