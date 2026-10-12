export interface RoomSession { playerName: string; roomId: string }
export const SESSION_KEY = 'guandan:room-session';
export const NAME_KEY = 'guandan:player-name';

// Storage is optional (private browsing, disabled cookies, embedded browsers).
export function readStorage(storage: Pick<Storage, 'getItem'> | undefined, key: string): string | null {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}
export function writeStorage(storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined, key: string, value: string | null) {
  try { value === null ? storage?.removeItem(key) : storage?.setItem(key, value); } catch { /* A room still works without persistence. */ }
}
export function parseSession(raw: string | null): RoomSession | null {
  try {
    const value = JSON.parse(raw || 'null');
    if (typeof value?.playerName !== 'string' || typeof value?.roomId !== 'string') return null;
    const playerName = value.playerName.trim();
    const roomId = value.roomId.trim();
    return playerName && playerName.length <= 10 && roomId && roomId.length <= 40 ? { playerName, roomId } : null;
  } catch { return null; }
}
export function roomFromUrl(url: string): string | null {
  try { return new URL(url).searchParams.get('room')?.trim().slice(0, 40) || null; } catch { return null; }
}
export function roomInviteUrl(url: string, roomId: string): string {
  const result = new URL(url);
  result.searchParams.set('room', roomId);
  result.hash = '';
  return result.toString();
}
export function browserStorage(kind: 'sessionStorage' | 'localStorage'): Storage | undefined {
  try { return window[kind]; } catch { return undefined; }
}
