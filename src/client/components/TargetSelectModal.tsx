import React from 'react';
import { SkillCardType, SkillCardNames } from '../../shared/types';

interface Player {
  name: string;
  seatIndex: number;
  handCount: number;
}

interface Props {
  skillType: SkillCardType;
  players: Player[];
  mySeat: number;
  onSelect: (targetSeat: number) => void;
  onCancel: () => void;
}

export const TargetSelectModal: React.FC<Props> = ({ skillType, players, mySeat, onSelect, onCancel }) => {
  // Filter out self and players with no cards
  const validTargets = players.filter(p => p.seatIndex !== mySeat && p.handCount > 0);
  const skillName = SkillCardNames[skillType];

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-[#252526] border border-[#3c3c3c] rounded-xl p-6 shadow-2xl min-w-[300px]">
        <h2 className="text-xl font-bold text-white mb-4 text-center">
          选择【{skillName}】的目标
        </h2>
        
        <div className="flex flex-col gap-3">
          {validTargets.length === 0 ? (
            <p className="text-gray-400 text-center">没有可选择的目标</p>
          ) : (
            validTargets.map(player => (
              <button
                key={player.seatIndex}
                onClick={() => onSelect(player.seatIndex)}
                className={`
                  px-4 py-3 rounded-lg text-white font-medium transition-all
                  ${player.seatIndex % 2 === mySeat % 2 
                    ? 'bg-blue-700 hover:bg-blue-600' 
                    : 'bg-red-700 hover:bg-red-600'}
                  flex justify-between items-center
                `}
              >
                <span>{player.name}</span>
                <span className="text-sm opacity-75">
                  {player.seatIndex % 2 === mySeat % 2 ? '队友' : '对手'} 
                  · {player.handCount}张牌
                </span>
              </button>
            ))
          )}
        </div>

        <button
          onClick={onCancel}
          className="mt-4 w-full px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-white font-medium transition-all"
        >
          取消
        </button>
      </div>
    </div>
  );
};
