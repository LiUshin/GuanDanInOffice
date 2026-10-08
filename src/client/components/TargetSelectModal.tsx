import React, { useId } from 'react';
import { SkillCardType, SkillCardNames } from '../../shared/types';
import { GameDialog } from './gameDialog';

interface Player { name: string; seatIndex: number; handCount: number; }
interface Props { skillType: SkillCardType; players: Player[]; mySeat: number; onSelect: (targetSeat: number) => void; onCancel: () => void; }

export const TargetSelectModal: React.FC<Props> = ({ skillType, players, mySeat, onSelect, onCancel }) => {
  const titleId = useId();
  const validTargets = players.filter(player => player.seatIndex !== mySeat && player.handCount > 0);
  return (
    <GameDialog open labelId={titleId} onClose={onCancel}>
      <div className="game-dialog__header"><div><span className="game-eyebrow">使用技能</span><h2 id={titleId}>{SkillCardNames[skillType]} · 选择目标</h2></div><button type="button" className="game-button" onClick={onCancel} aria-label="关闭目标选择">×</button></div>
      <div className="game-dialog__body game-targets">
        <p className="game-muted">选择后立即使用。请留意队友与对手。</p>
        {!validTargets.length && <p>没有可选择的目标</p>}
        {validTargets.map(player => (
          <button type="button" key={player.seatIndex} onClick={() => onSelect(player.seatIndex)} className={`game-target ${player.seatIndex % 2 === mySeat % 2 ? 'is-teammate' : ''}`}>
            <strong>{player.name}</strong><span>{player.seatIndex % 2 === mySeat % 2 ? '队友' : '对手'} · {player.handCount} 张</span>
          </button>
        ))}
      </div>
      <div className="game-dialog__footer"><button type="button" onClick={onCancel} className="game-button">取消</button></div>
    </GameDialog>
  );
};
